import { describe, it, expect } from 'vitest';
import { buildTimeline, renderedDuration, renderedTotal, sectionSpans, timelineSkill } from '../src/skills/timeline.js';
import { hasSkill } from '../src/skills/registry.js';
import { newEpisodeState } from '../src/types/episode.js';
import type { EpisodeState } from '../src/types/episode.js';

// The shared EDL resolver — the single source of truth the editor, render, and
// render_qc agents all consume (previously duplicated and drifting).

function stateWithShots(): EpisodeState {
  const s = newEpisodeState('tl1');
  s.script.sections = [
    { id: 's1', beat: 'open', vo_text: 'narration one', shot_note: '', on_screen: 'Title A', retention_device: 'loop' },
    { id: 's2', beat: 'mid', vo_text: 'narration two', shot_note: '', on_screen: 'Title B', retention_device: 'tension' },
    { id: 's3', beat: 'pay', vo_text: 'narration three', shot_note: '', on_screen: '', retention_device: 'payoff' },
    { id: 's4', beat: 'cta', vo_text: 'narration four', shot_note: '', on_screen: 'Title D', retention_device: 'cta' },
  ];
  s.shot_list = [
    { shot_id: 'sh1', section_id: 's1', source: 'generated', duration_s: 4, prompt: { runway: 'x' }, selected_asset: null, cost_estimate_usd: 0 },
    { shot_id: 'sh2', section_id: 's2', source: 'avatar', duration_s: 5, prompt: {}, selected_asset: null, cost_estimate_usd: 0 },
    { shot_id: 'sh3', section_id: 's3', source: 'stock', duration_s: 6, prompt: {}, selected_asset: null, cost_estimate_usd: 0 },
    { shot_id: 'sh4', section_id: 's4', source: 'graphic', duration_s: 3, prompt: {}, selected_asset: null, cost_estimate_usd: 0 },
  ];
  // sh1 is covered by ALL THREE sources → the generated take must win.
  s.generated_video = [{ shot_id: 'sh1', model: 'runway', takes: ['gen1'], selected_uri: 'gen1', cost_usd: 0 }];
  s.avatar_clips = [
    { shot_id: 'sh1', avatar_id: 'a', video_uri: 'https://cdn.heygen/av1.mp4', duration_s: 4, cost_usd: 0 },
    // sh2 is covered by avatar AND sourced asset → the avatar clip must win.
    { shot_id: 'sh2', avatar_id: 'a', video_uri: 'https://cdn.heygen/av2.mp4', duration_s: 5, cost_usd: 0 },
  ];
  s.sourced_assets = [
    { shot_id: 'sh1', type: 'stock', uri: 'asset1', license: 'Pexels License', cost_usd: 0 },
    { shot_id: 'sh2', type: 'stock', uri: 'asset2', license: 'Pexels License', cost_usd: 0 },
    { shot_id: 'sh3', type: 'stock', uri: 'asset3', license: 'Pexels License', cost_usd: 0 },
    // sh4 has nothing → visual_uri null (placeholder).
  ];
  s.voiceover = {
    voice_id: 'v',
    clips: [
      { section_id: 's1', audio_uri: 'vo1', duration_s: 7 },
      { section_id: 's2', audio_uri: 'vo2', duration_s: 8 },
      // s3/s4 have no VO clip → duration falls back to the shot's planned duration.
    ],
    total_duration_s: 15,
  };
  return s;
}

describe('buildTimeline', () => {
  it('resolves visuals in priority order: generated > avatar > sourced asset > null', () => {
    const { entries } = buildTimeline(stateWithShots());
    expect(entries.map((e) => e.visual_uri)).toEqual(['gen1', 'https://cdn.heygen/av2.mp4', 'asset3', null]);
  });

  it('attaches section voiceover audio and prefers VO duration over shot duration', () => {
    const { entries } = buildTimeline(stateWithShots());
    expect(entries[0]).toMatchObject({ shot_id: 'sh1', section_id: 's1', audio_uri: 'vo1', duration_s: 7 });
    // sh2's visual IS the avatar clip → it speaks its own narration; no VO overlay,
    // and the clip's duration (not the VO clip's) times the entry.
    expect(entries[1]).toMatchObject({ audio_uri: null, duration_s: 5 });
    // no VO clip → shot's planned duration, silence.
    expect(entries[2]).toMatchObject({ audio_uri: null, duration_s: 6 });
    expect(entries[3]).toMatchObject({ audio_uri: null, duration_s: 3 });
  });

  it('does not silence the VO when an avatar clip exists but a generated take won the visual', () => {
    // sh1 has an avatar clip in the fixture, but the generated take outranks it —
    // the entry is ordinary b-roll, so the section VO must still be overlaid.
    const { entries } = buildTimeline(stateWithShots());
    expect(entries[0]).toMatchObject({ visual_uri: 'gen1', audio_uri: 'vo1', duration_s: 7 });
  });

  it('only trusts avatar-carried audio when the clip URI is fetchable — a mock:// clip keeps the VO', () => {
    // Zero-key runs produce mock:// avatar clips; suppressing the VO for those
    // rendered a fully silent cut. The VO must survive as the entry's audio.
    const s = stateWithShots();
    s.avatar_clips[1]!.video_uri = 'mock://avatar/default/12w.mp4';
    const { entries } = buildTimeline(s);
    expect(entries[1]).toMatchObject({ visual_uri: 'mock://avatar/default/12w.mp4', audio_uri: 'vo2', duration_s: 8, fallback_audio_uri: null });
  });

  it('carries the suppressed VO as fallback_audio_uri when the avatar clip DOES carry the audio', () => {
    // If the fetchable HeyGen URL later expires at render time, the renderer
    // falls back to this narration instead of cutting a silent shot.
    const { entries } = buildTimeline(stateWithShots());
    expect(entries[1]).toMatchObject({ audio_uri: null, fallback_audio_uri: 'vo2' });
    expect(entries[0]).toMatchObject({ audio_uri: 'vo1', fallback_audio_uri: null }); // normal shots carry no fallback
  });

  it('sums entry durations into duration_s and indexes entries in shot order', () => {
    const t = buildTimeline(stateWithShots());
    expect(t.duration_s).toBe(7 + 5 + 6 + 3); // sh2 runs at its avatar clip's length
    expect(t.entries.map((e) => e.index)).toEqual([0, 1, 2, 3]);
  });

  it('carries section narration as caption and on_screen text separately', () => {
    const { entries } = buildTimeline(stateWithShots());
    expect(entries[0]).toMatchObject({ caption: 'narration one', on_screen: 'Title A' });
    expect(entries[2]).toMatchObject({ caption: 'narration three', on_screen: '' });
  });

  it('returns an empty timeline for a state with no shots', () => {
    const t = buildTimeline(newEpisodeState('tl_empty'));
    expect(t.entries).toEqual([]);
    expect(t.duration_s).toBe(0);
  });

  it('registers as the "timeline" skill and the skill delegates to buildTimeline', async () => {
    expect(hasSkill('timeline')).toBe(true);
    const s = stateWithShots();
    await expect(timelineSkill.run({ state: s })).resolves.toEqual(buildTimeline(s));
  });

  it('attaches section VO to the FIRST shot only; later shots of the section are silent b-roll', () => {
    const s = stateWithShots();
    // second shot for s1: must NOT repeat the section's VO clip
    s.shot_list.splice(1, 0, { shot_id: 'sh1b', section_id: 's1', source: 'stock', duration_s: 3, prompt: {}, selected_asset: null, cost_estimate_usd: 0 });
    const { entries } = buildTimeline(s);
    expect(entries[0]).toMatchObject({ shot_id: 'sh1', audio_uri: 'vo1', duration_s: 7, caption: 'narration one' });
    expect(entries[1]).toMatchObject({ shot_id: 'sh1b', audio_uri: null, duration_s: 3, caption: '' }); // silent, planned duration
    expect(entries[2]).toMatchObject({ shot_id: 'sh2', audio_uri: null }); // avatar clip carries its own narration
  });
});

describe('rendered clock (sectionSpans / renderedTotal / renderedDuration)', () => {
  it('renderedDuration ceils to whole seconds with a 1s floor', () => {
    expect(renderedDuration(4)).toBe(4);
    expect(renderedDuration(4.2)).toBe(5);
    expect(renderedDuration(0.3)).toBe(1);
    expect(renderedDuration(0)).toBe(1);
  });

  it('sectionSpans aggregates per-section whole-second spans in timeline order', () => {
    const s = stateWithShots();
    // fractional VO + a multi-shot section: s1 = 7.3s VO shot + 2.4s b-roll shot
    s.voiceover.clips[0]!.duration_s = 7.3;
    s.shot_list.splice(1, 0, { shot_id: 'sh1b', section_id: 's1', source: 'stock', duration_s: 2.4, prompt: {}, selected_asset: null, cost_estimate_usd: 0 });
    const spans = sectionSpans(buildTimeline(s));
    // s1: ceil(7.3) + ceil(2.4) = 8 + 3 = 11; then s2 5s (avatar clip length), s3 6s, s4 3s
    expect(spans).toEqual([
      { section_id: 's1', startS: 0, durationS: 11 },
      { section_id: 's2', startS: 11, durationS: 5 },
      { section_id: 's3', startS: 16, durationS: 6 },
      { section_id: 's4', startS: 22, durationS: 3 },
    ]);
    // spans are contiguous and non-overlapping on the rendered clock
    for (let i = 1; i < spans.length; i++) expect(spans[i]!.startS).toBe(spans[i - 1]!.startS + spans[i - 1]!.durationS);
  });

  it('renderedTotal is the whole-second sum, ahead of the fractional timeline sum', () => {
    const s = stateWithShots();
    s.voiceover.clips[0]!.duration_s = 6.1;
    s.avatar_clips[1]!.duration_s = 7.5; // sh2 times by its avatar clip, not the VO
    const t = buildTimeline(s);
    expect(t.duration_s).toBeCloseTo(6.1 + 7.5 + 6 + 3);
    expect(renderedTotal(t)).toBe(7 + 8 + 6 + 3);
    expect(renderedTotal(t)).toBe(sectionSpans(t).reduce((n, sp) => n + sp.durationS, 0));
  });
});
