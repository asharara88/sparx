import { describe, it, expect } from 'vitest';
import { buildTimeline, timelineSkill } from '../src/skills/timeline.js';
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
    { shot_id: 'sh1', avatar_id: 'a', video_uri: 'av1', duration_s: 4, cost_usd: 0 },
    // sh2 is covered by avatar AND sourced asset → the avatar clip must win.
    { shot_id: 'sh2', avatar_id: 'a', video_uri: 'av2', duration_s: 5, cost_usd: 0 },
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
    expect(entries.map((e) => e.visual_uri)).toEqual(['gen1', 'av2', 'asset3', null]);
  });

  it('attaches section voiceover audio and prefers VO duration over shot duration', () => {
    const { entries } = buildTimeline(stateWithShots());
    expect(entries[0]).toMatchObject({ shot_id: 'sh1', section_id: 's1', audio_uri: 'vo1', duration_s: 7 });
    expect(entries[1]).toMatchObject({ audio_uri: 'vo2', duration_s: 8 });
    // no VO clip → shot's planned duration, silence.
    expect(entries[2]).toMatchObject({ audio_uri: null, duration_s: 6 });
    expect(entries[3]).toMatchObject({ audio_uri: null, duration_s: 3 });
  });

  it('sums entry durations into duration_s and indexes entries in shot order', () => {
    const t = buildTimeline(stateWithShots());
    expect(t.duration_s).toBe(7 + 8 + 6 + 3);
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
});
