import type { Agent } from './types.js';
import { ok } from './types.js';
import type { GeneratedVideo } from '../types/episode.js';
import { getVideo, type VideoModel } from '../media/video.js';
import { config } from '../config.js';
import { canAfford } from '../producer/budget.js';
import { mapLimit } from '../producer/concurrency.js';
import { createLogger } from '../logger.js';

// Runway rate limits apply per org; a small cap still overlaps the multi-minute
// image+video submit/poll cycles that dominate this agent's wall-clock.
const CONCURRENCY = 2;

// Agent 5 — Video Generation. For each generated shot: generate takes, self-QC,
// select the best. Budget-aware: shots that can't be afforded are left for the
// Asset Sourcing fallback (recorded in notes). Records cost per clip.
export const videoGeneration: Agent = {
  name: 'video_generation',
  async run(ctx) {
    const log = createLogger({ agent: 'video_generation', episode: ctx.episode_id });
    const provider = getVideo();
    const gen = ctx.state.shot_list.filter((s) => s.source === 'generated');

    // Pre-select the affordable set from the shot estimates so shots can generate
    // concurrently. Trade-off vs. the old serial loop: gating is by estimate rather
    // than accumulated actuals (identical with the default RUNWAY_MAX_TAKES=1), and
    // budget reserved for a shot that fails is not reallocated to later shots.
    let estTotal = 0; let skipped = 0;
    const affordable = gen.filter((shot) => {
      if (canAfford(ctx.state, estTotal + shot.cost_estimate_usd)) { estTotal += shot.cost_estimate_usd; return true; }
      skipped++;
      return false;
    });

    const results = await mapLimit(affordable, CONCURRENCY, async (shot): Promise<GeneratedVideo | null> => {
      const model: VideoModel = 'runway';
      const prompt = shot.prompt[model] ?? shot.prompt.kling ?? shot.prompt.veo ?? '';
      try {
        // Take count follows RUNWAY_MAX_TAKES (dashboard "Runway takes" slider);
        // selectBest is still a stub, so extra takes only buy retry insurance.
        const takes = await provider.generate({ prompt, model, durationS: shot.duration_s, takes: config().RUNWAY_MAX_TAKES, seed: shot.prompt.seed });
        const best = selectBest(takes.map((t) => t.uri));
        const clipCost = takes.reduce((n, t) => n + t.costUsd, 0);
        return { shot_id: shot.shot_id, model, takes: takes.map((t) => t.uri), selected_uri: best, cost_usd: clipCost };
      } catch (err) {
        log.warn('generation failed; leaving for stock fallback', { shot: shot.shot_id, err: String(err) });
        skipped++;
        return null;
      }
    });
    const out = results.filter((r): r is GeneratedVideo => r !== null);
    const cost = out.reduce((n, o) => n + o.cost_usd, 0);
    log.info('video generation done', { generated: out.length, skipped, provider: provider.name });
    return ok(ctx, { generated_video: out }, cost, `${out.length} clips${skipped ? `, ${skipped} skipped` : ''} (${provider.name})`);
  },
};

// Self-QC stub: pick the first valid take. Replace with quality scoring later.
function selectBest(uris: string[]): string { return uris[0] ?? ''; }
