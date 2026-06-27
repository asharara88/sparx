import { describe, it, expect, beforeEach } from 'vitest';
import { editor } from '../src/agents/editor.js';
import { newEpisodeState } from '../src/types/episode.js';
import { __setLLM } from '../src/llm/client.js';
import { ctxFor } from './helpers.js';

beforeEach(() => __setLLM(null));

describe('editor', () => {
  it('builds an EDL covering every shot, sums duration, flags none when covered', async () => {
    const s = newEpisodeState('ed1');
    s.script.sections = [
      { id: 's1', beat: 'open', vo_text: 'one', shot_note: '', on_screen: 'A', retention_device: 'loop' },
      { id: 's2', beat: 'pay', vo_text: 'two', shot_note: '', on_screen: 'B', retention_device: 'payoff' },
    ];
    s.shot_list = [
      { shot_id: 'sh1', section_id: 's1', source: 'generated', duration_s: 4, prompt: { runway: 'x' }, selected_asset: null, cost_estimate_usd: 0 },
      { shot_id: 'sh2', section_id: 's2', source: 'stock', duration_s: 4, prompt: {}, selected_asset: null, cost_estimate_usd: 0 },
    ];
    s.generated_video = [{ shot_id: 'sh1', model: 'runway', takes: ['u'], selected_uri: 'u', cost_usd: 0 }];
    s.sourced_assets = [{ shot_id: 'sh2', type: 'stock', uri: 'a', license: 'Pexels License', cost_usd: 0 }];
    s.voiceover = { voice_id: 'v', clips: [{ section_id: 's1', audio_uri: 'a1', duration_s: 5 }, { section_id: 's2', audio_uri: 'a2', duration_s: 7 }], total_duration_s: 12 };
    s.music = { track_uri: 'm', sfx: [], license: 'ok', cost_usd: 0 };

    const r = await editor.run(ctxFor(s));
    expect(r.status).toBe('ok');
    expect(r.writes.edit?.duration_s).toBe(12);
    expect(r.writes.edit?.captioned).toBe(true);
    expect(r.writes.edit?.timeline_uri).toBeTruthy();
    expect(r.notes).not.toContain('placeholder');
  });
});
