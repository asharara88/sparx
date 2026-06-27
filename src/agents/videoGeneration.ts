import type { Agent } from './types.js';
import { ok } from './types.js';
import type { GeneratedVideo } from '../types/episode.js';
import { getVideo, type VideoModel } from '../media/video.js';
import { canAfford } from '../producer/budget.js';
import { createLogger } from '../logger.js';

// Agent 5 — Video Generation. For each generated shot: generate takes, self-QC,
// select the best. Budget-aware: shots that can't be afforded are left for the
// Asset Sourcing fallback (recorded in notes). Records cost per clip.
export const videoGeneration: Agent = {
  name: 'video_generation',
  async run(ctx) {
    const log = createLogger({ agent: 'video_generation', episode: ctx.episode_id });
    const provider = getVideo();
    const gen = ctx.state.shot_list.filter((s) => s.source === 'generated');

    const out: GeneratedVideo[] = [];
    let cost = 0; let skipped = 0;
    for (const shot of gen) {
      const model: VideoModel = 'runway';
      const prompt = shot.prompt[model] ?? shot.prompt.kling ?? shot.prompt.veo ?? '';
      const est = shot.cost_estimate_usd;
      if (!canAfford(ctx.state, cost + est)) { skipped++; continue; }
      try {
        const takes = await provider.generate({ prompt, model, durationS: shot.duration_s, takes: 2, seed: shot.prompt.seed });
        const best = selectBest(takes.map((t) => t.uri));
        const clipCost = takes.reduce((n, t) => n + t.costUsd, 0);
        cost += clipCost;
        out.push({ shot_id: shot.shot_id, model, takes: takes.map((t) => t.uri), selected_uri: best, cost_usd: clipCost });
      } catch (err) {
        log.warn('generation failed; leaving for stock fallback', { shot: shot.shot_id, err: String(err) });
        skipped++;
      }
    }
    log.info('video generation done', { generated: out.length, skipped, provider: provider.name });
    return ok(ctx, { generated_video: out }, cost, `${out.length} clips${skipped ? `, ${skipped} skipped` : ''} (${provider.name})`);
  },
};

// Self-QC stub: pick the first valid take. Replace with quality scoring later.
function selectBest(uris: string[]): string { return uris[0] ?? ''; }
