import { defineAgent } from './core.js';
import type { SourcedAsset } from '../types/episode.js';
import { getStock } from '../media/stock.js';
import { buildAssetQuery, rankAssets } from '../skills/assetMatching.js';
import { settleLimit } from '../util/concurrency.js';
import { config } from '../config.js';

// Agent 6 — Asset Sourcing. Finds stock b-roll / images for stock and graphic
// shots, in parallel. Queries come from the asset-matching skill (shot_note +
// beat + topic — not raw on-screen caption text); the provider returns several
// candidates and the skill ranks them by keyword/orientation/duration fit, so we
// never take candidate[0] blind. Misses/failures degrade to a skip (the editor's
// placeholder fallback covers gaps) and are recorded in notes.

const CANDIDATES = 6; // ask the provider for several options so ranking has real signal

export const assetSourcing = defineAgent({
  name: 'asset_sourcing',
  description: 'Source and rank stock b-roll/images for stock and graphic shots via the asset-matching skill.',
  skills: ['asset-matching'],
  reads: ['shot_list', 'script', 'concept'],
  writes: ['sourced_assets'],

  async execute(ctx) {
    const stock = getStock();
    const secById = new Map(ctx.state.script.sections.map((s) => [s.id, s]));
    const topic = ctx.state.concept.topic;
    const shots = ctx.state.shot_list.filter((s) => s.source === 'stock' || s.source === 'graphic');

    const { ok: found, failed } = await settleLimit(shots, config().MEDIA_CONCURRENCY, async (shot): Promise<SourcedAsset | null> => {
      const sec = secById.get(shot.section_id);
      const query = buildAssetQuery({ shot_note: sec?.shot_note ?? '', beat: sec?.beat, topic });
      const kind = shot.source === 'graphic' ? 'image' : 'video';
      const candidates = await stock.search(query, kind, CANDIDATES);
      if (candidates.length === 0) return null; // miss — editor placeholder covers it
      const [best] = rankAssets({ query, targetDurationS: kind === 'video' ? shot.duration_s : undefined, candidates });
      ctx.log.debug('asset ranked', { shot: shot.shot_id, query, best: best!.uri, score: best!.score, of: candidates.length });
      return { shot_id: shot.shot_id, type: kind === 'image' ? 'image' : 'stock', uri: best!.uri, license: best!.license, cost_usd: 0 };
    });

    for (const f of failed) ctx.log.warn('asset lookup failed; editor placeholder covers the gap', { shot: f.item.shot_id, err: String(f.error).slice(0, 200) });
    const out = found.map((f) => f.value).filter((v): v is SourcedAsset => v !== null);
    const misses = failed.length + (found.length - out.length);
    ctx.log.info('assets sourced', { assets: out.length, misses, provider: stock.name });
    return { writes: { sourced_assets: out }, cost_usd: 0, notes: `${out.length} assets${misses ? `, ${misses} misses` : ''} (${stock.name})` };
  },
});
