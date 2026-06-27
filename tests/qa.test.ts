import { describe, it, expect, beforeEach } from 'vitest';
import { qa } from '../src/agents/qa.js';
import { newEpisodeState } from '../src/types/episode.js';
import { __setLLM } from '../src/llm/client.js';
import { ctxFor } from './helpers.js';

beforeEach(() => __setLLM(null));

function base() {
  const s = newEpisodeState('qa1');
  s.shot_list = [{ shot_id: 'sh1', section_id: 's1', source: 'generated', duration_s: 4, prompt: { runway: 'x' }, selected_asset: null, cost_estimate_usd: 0 }];
  s.generated_video = [{ shot_id: 'sh1', model: 'runway', takes: ['u'], selected_uri: 'u', cost_usd: 0 }];
  s.music = { track_uri: 'm', sfx: [], license: 'epidemic', cost_usd: 0 };
  return s;
}

describe('qa', () => {
  it('passes and requires AI disclosure when generated video is used', async () => {
    const r = await qa.run(ctxFor(base()));
    expect(r.writes.qa?.passed).toBe(true);
    expect(r.writes.qa?.ai_disclosure_required).toBe(true);
    expect(r.writes.qa?.blocking_issues.length).toBe(0);
  });
  it('blocks when a shot has no visual', async () => {
    const s = base();
    s.shot_list.push({ shot_id: 'sh2', section_id: 's2', source: 'stock', duration_s: 4, prompt: {}, selected_asset: null, cost_estimate_usd: 0 });
    const r = await qa.run(ctxFor(s));
    expect(r.writes.qa?.passed).toBe(false);
    expect(r.writes.qa?.blocking_issues.join(' ')).toMatch(/without a visual/);
  });
  it('blocks on an unlicensed asset', async () => {
    const s = base();
    s.shot_list.push({ shot_id: 'sh2', section_id: 's2', source: 'stock', duration_s: 4, prompt: {}, selected_asset: null, cost_estimate_usd: 0 });
    s.sourced_assets = [{ shot_id: 'sh2', type: 'stock', uri: 'a', license: 'unknown', cost_usd: 0 }];
    const r = await qa.run(ctxFor(s));
    expect(r.writes.qa?.passed).toBe(false);
    expect(r.writes.qa?.blocking_issues.join(' ')).toMatch(/unlicensed/);
  });
});
