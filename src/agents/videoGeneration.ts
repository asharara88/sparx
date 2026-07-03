import { defineAgent } from './core.js';
import type { GeneratedVideo } from '../types/episode.js';
import { getVideo, type VideoModel } from '../media/video.js';
import { settleLimit } from '../util/concurrency.js';
import { cachedArtifact, contentKey } from '../skills/artifactCache.js';
import { estimateImageCost, estimateShotCost, shouldThrottle } from '../skills/costModel.js';
import { config } from '../config.js';

// Agent 5 — Video Generation. Generates takes for every `generated` shot IN
// PARALLEL (each shot is a multi-minute provider poll — serially this stage was
// the pipeline's wall-clock ceiling), self-QCs, selects the best. Budget-gated
// per shot with pessimistic in-flight reservation; content-cached so a Producer
// retry never re-bills identical prompts. Skipped/failed shots are recorded in
// notes — the editor's placeholder fallback covers the gaps.

const TAKES = 2; // takes per shot for the free mock; the paid provider follows RUNWAY_MAX_TAKES

export const videoGeneration = defineAgent({
  name: 'video_generation',
  description: 'Generate AI video takes per generated shot in parallel, budget-gated and content-cached; select the best take.',
  skills: ['artifact-cache', 'cost-model'],
  reads: ['shot_list', 'budget'],
  writes: ['generated_video'],

  async execute(ctx) {
    const provider = getVideo();
    const c = config();
    const model: VideoModel = 'runway';
    const shots = ctx.state.shot_list.filter((s) => s.source === 'generated');

    // Take count for the paid provider follows RUNWAY_MAX_TAKES (the dashboard's
    // "Runway takes" setting); selectBest is still a stub, so extra takes only buy
    // retry insurance. Mocks keep the free default.
    const effectiveTakes = provider.live ? Math.max(1, c.RUNWAY_MAX_TAKES) : TAKES;

    // Reserve estimates BEFORE dispatch: parallel shots can't see each other's
    // in-flight spend, so each estimate is committed pessimistically up front and
    // a shot is skipped when it would cross the remaining budget.
    let reserved = 0;
    const throttled: string[] = [];
    // Only gate live spend — mock shots cost $0 and must never be skipped under
    // a small cap (same live-only gating as voiceover/music).
    const dispatch = !provider.live ? shots : shots.filter((shot) => {
      const est = effectiveTakes * (estimateShotCost(shot.duration_s, model) + estimateImageCost()); // + start image per take
      if (shouldThrottle(ctx.state, reserved + est)) { throttled.push(shot.shot_id); return false; }
      reserved += est;
      return true;
    });

    const { ok: made, failed } = await settleLimit(dispatch, c.MEDIA_CONCURRENCY, async (shot): Promise<GeneratedVideo> => {
      const prompt = shot.prompt[model] ?? shot.prompt.kling ?? shot.prompt.veo ?? '';
      let takes: string[] = [];
      const art = await cachedArtifact(contentKey('video', model, prompt, shot.duration_s, shot.prompt.seed), async () => {
        const out = await provider.generate({ prompt, model, durationS: shot.duration_s, takes: effectiveTakes, seed: shot.prompt.seed });
        takes = out.map((t) => t.uri);
        return { uri: selectBest(takes), costUsd: out.reduce((n, t) => n + t.costUsd, 0) };
      });
      if (art.cached) { takes = [art.uri]; ctx.log.debug('shot served from cache', { shot: shot.shot_id }); }
      return { shot_id: shot.shot_id, model, takes, selected_uri: art.uri, cost_usd: art.costUsd };
    });

    for (const f of failed) ctx.log.warn('generation failed; editor placeholder covers the gap', { shot: f.item.shot_id, err: String(f.error).slice(0, 200) });
    const out = made.map((m) => m.value);
    const cost = out.reduce((n, g) => n + g.cost_usd, 0);
    ctx.log.info('video generation done', { generated: out.length, throttled: throttled.length, failed: failed.length, provider: provider.name });

    const bits = [`${out.length} clips`];
    if (throttled.length) bits.push(`${throttled.length} skipped over budget: ${throttled.join(', ')}`);
    if (failed.length) bits.push(`${failed.length} failed: ${failed.map((f) => f.item.shot_id).join(', ')}`);
    return { writes: { generated_video: out }, cost_usd: cost, notes: `${bits.join('; ')} (${provider.name})` };
  },
});

// Self-QC stub: pick the first valid take. Replace with quality scoring later.
function selectBest(uris: string[]): string { return uris[0] ?? ''; }
