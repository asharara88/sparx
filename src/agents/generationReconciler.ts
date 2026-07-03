import { defineAgent } from './core.js';
import type { SourcedAsset } from '../types/episode.js';
import { getStock } from '../media/stock.js';
import { buildAssetQuery, rankAssets } from '../skills/assetMatching.js';
import { settleLimit } from '../util/concurrency.js';
import { config } from '../config.js';

// Agent — Generation Reconciler. Runs after the generation stage and before
// assembly: any shot whose planned visual never materialized (a Runway/HeyGen
// failure, a budget-throttled dispatch, a stock miss) is backfilled with ranked
// stock b-roll. Previously the only rescue was the editor's placeholder slate —
// a gray card in the middle of an otherwise real episode — and QA would block
// the cut for the coverage gap after the money was already spent.

const CANDIDATES = 6;

export const generationReconciler = defineAgent({
  name: 'generation_reconciler',
  description: 'Backfill ranked stock footage for planned visuals that generation failed to produce, before assembly.',
  skills: ['asset-matching'],
  reads: ['shot_list', 'script', 'concept', 'generated_video', 'avatar_clips', 'sourced_assets'],
  writes: ['sourced_assets'],

  async execute(ctx) {
    const covered = new Set<string>([
      ...ctx.state.generated_video.map((g) => g.shot_id),
      ...ctx.state.avatar_clips.map((a) => a.shot_id),
      ...ctx.state.sourced_assets.map((a) => a.shot_id),
    ]);
    // host shots are the presenter's own footage, resolved at edit time — not a generation gap
    const gaps = ctx.state.shot_list.filter((s) => s.source !== 'host' && !covered.has(s.shot_id));
    if (gaps.length === 0) {
      return { writes: {}, notes: 'no gaps: every planned visual is covered' };
    }

    const stock = getStock();
    const secById = new Map(ctx.state.script.sections.map((s) => [s.id, s]));
    const topic = ctx.state.concept.topic;

    const { ok: found, failed } = await settleLimit(gaps, config().MEDIA_CONCURRENCY, async (shot): Promise<SourcedAsset | null> => {
      const sec = secById.get(shot.section_id);
      const query = buildAssetQuery({ shot_note: sec?.shot_note ?? '', beat: sec?.beat, topic });
      const kind = shot.source === 'graphic' ? 'image' : 'video';
      const candidates = await stock.search(query, kind, CANDIDATES);
      if (candidates.length === 0) return null; // still uncovered — QA sees the gap and blocks honestly
      const [best] = rankAssets({ query, targetDurationS: kind === 'video' ? shot.duration_s : undefined, candidates });
      ctx.log.info('backfilled missing visual with stock', { shot: shot.shot_id, planned: shot.source, uri: best!.uri, score: best!.score });
      return { shot_id: shot.shot_id, type: kind === 'image' ? 'image' : 'stock', uri: best!.uri, license: best!.license, cost_usd: 0 };
    });

    for (const f of failed) ctx.log.warn('backfill lookup failed', { shot: f.item.shot_id, err: String(f.error).slice(0, 200) });
    const backfilled = found.map((f) => f.value).filter((v): v is SourcedAsset => v !== null);
    const unresolved = gaps.length - backfilled.length;

    return {
      writes: backfilled.length ? { sourced_assets: [...ctx.state.sourced_assets, ...backfilled] } : {},
      notes: `${backfilled.length}/${gaps.length} missing visuals backfilled with stock${unresolved ? `, ${unresolved} still uncovered` : ''} (${stock.name})`,
    };
  },
});
