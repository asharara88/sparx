import { describe, it, expect } from 'vitest';
import { editor } from '../src/agents/editor.js';
import { newEpisodeState } from '../src/types/episode.js';
import type { EpisodeState } from '../src/types/episode.js';
import { ctxFor } from './helpers.js';

function coveredState(id: string): EpisodeState {
  const s = newEpisodeState(id);
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
  return s;
}

describe('editor', () => {
  it('builds an EDL covering every shot, sums duration, flags none when covered', async () => {
    const r = await editor.run(ctxFor(coveredState('ed1')));
    expect(r.status).toBe('ok');
    expect(r.writes.edit?.duration_s).toBe(12);
    // captioned is no longer faked true here — the captions agent owns caption truth (state.captions).
    expect(r.writes.edit?.captioned).toBe(false);
    expect(r.writes.edit?.timeline_uri).toBeTruthy();
    expect(r.writes.edit?.render_uri).toBe('render://ed1/cut.mp4'); // forward ref for the render agent
    expect(r.notes).not.toContain('placeholder');
  });

  it('flags placeholder shots in notes but still assembles the timeline', async () => {
    const s = coveredState('ed2');
    s.sourced_assets = []; // sh2 loses its visual → placeholder
    const r = await editor.run(ctxFor(s));
    expect(r.status).toBe('ok');
    expect(r.notes).toContain('1 placeholder');
    expect(r.writes.edit?.duration_s).toBe(12); // placeholder shots still count toward runtime
  });

  it('fails the precondition cleanly when there are no shots to assemble', async () => {
    const r = await editor.run(ctxFor(newEpisodeState('ed_empty')));
    expect(r.status).toBe('failed');
    expect(r.notes).toContain('no shots to assemble');
    expect(r.writes).toEqual({});
  });
});
