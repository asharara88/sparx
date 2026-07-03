import { afterEach, describe, expect, it } from 'vitest';
import { generationReconciler } from '../src/agents/generationReconciler.js';
import { __setStock, type StockProvider } from '../src/media/stock.js';
import { newEpisodeState, type EpisodeState } from '../src/types/episode.js';

const ctxFor = (state: EpisodeState) => ({ episode_id: state.episode_id, agent: 'generation_reconciler', state, budget_remaining_usd: 100 });

function stateWithShots(): EpisodeState {
  const s = newEpisodeState('ep_rec');
  s.concept.topic = 'test topic';
  s.script.sections = [
    { id: 's1', beat: 'open', vo_text: 'first', shot_note: 'city skyline drone', on_screen: '', retention_device: '' },
    { id: 's2', beat: 'payoff', vo_text: 'second', shot_note: 'server room lights', on_screen: '', retention_device: '' },
  ];
  s.shot_list = [
    { shot_id: 'sh1', section_id: 's1', source: 'generated', duration_s: 4, prompt: { runway: 'x' }, selected_asset: null, cost_estimate_usd: 0.2 },
    { shot_id: 'sh2', section_id: 's2', source: 'stock', duration_s: 4, prompt: {}, selected_asset: null, cost_estimate_usd: 0 },
  ];
  return s;
}

const fakeStock = (calls: string[]): StockProvider => ({
  name: 'fake',
  live: false,
  search: async (query, kind) => {
    calls.push(`${kind}:${query}`);
    return [{ uri: `https://fake.test/${encodeURIComponent(query)}.mp4`, width: 1920, height: 1080, durationS: 8, description: query, license: 'mock' }];
  },
});

afterEach(() => __setStock(null));

describe('generation_reconciler', () => {
  it('backfills stock for shots whose planned visual never materialized', async () => {
    const calls: string[] = [];
    __setStock(fakeStock(calls));
    const s = stateWithShots();
    // sh2 was sourced; sh1's Runway generation failed → gap
    s.sourced_assets = [{ shot_id: 'sh2', type: 'stock', uri: 'https://fake.test/have.mp4', license: 'mock', cost_usd: 0 }];

    const r = await generationReconciler.run(ctxFor(s));
    expect(r.status).toBe('ok');
    const assets = r.writes.sourced_assets!;
    expect(assets.map((a) => a.shot_id).sort()).toEqual(['sh1', 'sh2']); // existing kept, gap filled
    expect(calls.length).toBe(1);
    expect(r.notes).toContain('1/1');
  });

  it('is a no-op when every planned visual is covered', async () => {
    const calls: string[] = [];
    __setStock(fakeStock(calls));
    const s = stateWithShots();
    s.generated_video = [{ shot_id: 'sh1', model: 'runway', takes: [], selected_uri: 'https://fake.test/gen.mp4', cost_usd: 0.2 }];
    s.sourced_assets = [{ shot_id: 'sh2', type: 'stock', uri: 'https://fake.test/have.mp4', license: 'mock', cost_usd: 0 }];

    const r = await generationReconciler.run(ctxFor(s));
    expect(r.status).toBe('ok');
    expect(r.writes).toEqual({});
    expect(calls.length).toBe(0);
    expect(r.notes).toContain('no gaps');
  });

  it('ignores host shots and reports still-uncovered gaps honestly', async () => {
    __setStock({ name: 'empty', live: false, search: async () => [] });
    const s = stateWithShots();
    s.shot_list.push({ shot_id: 'sh3', section_id: 's1', source: 'host', duration_s: 4, prompt: {}, selected_asset: null, cost_estimate_usd: 0 });

    const r = await generationReconciler.run(ctxFor(s));
    expect(r.status).toBe('ok');
    expect(r.writes).toEqual({}); // nothing backfillable — but host shot was never counted a gap
    expect(r.notes).toContain('0/2');
    expect(r.notes).toContain('2 still uncovered');
  });
});
