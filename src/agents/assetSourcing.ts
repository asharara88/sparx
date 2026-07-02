import type { Agent } from './types.js';
import { ok } from './types.js';
import type { SourcedAsset } from '../types/episode.js';
import { getStock } from '../media/stock.js';
import { TECH_SECTION_ID } from '../skills/techSegment.js';
import { createLogger } from '../logger.js';

// Agent 6 — Asset Sourcing. Finds stock b-roll / images for non-generated shots,
// AND backfills any generated shot that the Video Generation agent skipped
// (budget/failure) so every shot ends up with an asset. Records license + cost.
export const assetSourcing: Agent = {
  name: 'asset_sourcing',
  async run(ctx) {
    const log = createLogger({ agent: 'asset_sourcing', episode: ctx.episode_id });
    const stock = getStock();
    const sectionsById = new Map(ctx.state.script.sections.map((s) => [s.id, s]));

    const needStock = ctx.state.shot_list.filter((s) => s.source === 'stock' || s.source === 'graphic');
    const out: SourcedAsset[] = [];
    let cost = 0; let misses = 0;
    const ts = ctx.state.tech_segment;
    for (const shot of needStock) {
      const sec = sectionsById.get(shot.section_id);
      // Real-product tech shots search by product name (official press assets first);
      // everything else keeps the caption/shot-note heuristic.
      const query = shot.section_id === TECH_SECTION_ID && ts?.enabled && ts.mode !== 'explainer' && (ts.product?.name || ts.topic)
        ? `${ts.product?.name ?? ts.topic} official press`
        : (sec?.on_screen || sec?.shot_note || sec?.vo_text?.slice(0, 40) || 'b-roll');
      const kind = shot.source === 'graphic' ? 'image' : 'video';
      const art = await stock.find(query, kind);
      if (!art) { misses++; continue; }
      cost += art.costUsd;
      out.push({ shot_id: shot.shot_id, type: kind === 'image' ? 'image' : 'stock', uri: art.uri, license: art.license ?? 'unknown', cost_usd: art.costUsd });
    }
    log.info('assets sourced', { assets: out.length, misses, provider: stock.name });
    return ok(ctx, { sourced_assets: out }, cost, `${out.length} assets${misses ? `, ${misses} misses` : ''} (${stock.name})`);
  },
};
