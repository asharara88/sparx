import type { EpisodeState } from '../types/episode.js';
import { defineSkill } from './registry.js';

// Single source of truth for EDL resolution. Previously the editor and render
// agents each rebuilt the same genByShot/avatarByShot/assetByShot/voBySection
// maps and had already drifted (different caption fields); every consumer now
// resolves the timeline through buildTimeline so the cut, the persisted
// timeline.json, and QC all describe the same edit.
//
// Resolution order per shot: generated take > avatar clip > sourced asset >
// null (placeholder slate). Audio comes from the section's voiceover clip;
// duration is the VO clip's measured duration, else the shot's planned one.
// Exception: when the resolved visual IS the avatar clip, that clip already
// carries its own narration (HeyGen TTS or lip-synced ElevenLabs) — overlaying
// the separate voiceover would replace the audio the mouth is synced to, so the
// entry stays audio_uri-null and takes the avatar clip's duration.

export interface TimelineEntry {
  index: number;
  shot_id: string;
  section_id: string;
  visual_uri: string | null;   // resolved visual, null → placeholder
  audio_uri: string | null;    // section voiceover clip (first shot of the section only), null → silence
  duration_s: number;          // VO clip duration (first shot of section) else shot duration
  caption: string;             // narration text (section vo_text)
  on_screen: string;           // on-screen title text (section on_screen)
}

export interface Timeline {
  entries: TimelineEntry[];
  duration_s: number;          // sum of entry durations
}

export function buildTimeline(state: EpisodeState): Timeline {
  const genByShot = new Map(state.generated_video.map((g) => [g.shot_id, g]));
  const avatarByShot = new Map(state.avatar_clips.map((a) => [a.shot_id, a]));
  const assetByShot = new Map(state.sourced_assets.map((a) => [a.shot_id, a]));
  const voBySection = new Map(state.voiceover.clips.map((c) => [c.section_id, c]));
  const secById = new Map(state.script.sections.map((s) => [s.id, s]));

  // A section's narration plays exactly once, on its FIRST shot. Extra shots for
  // the same section (multi-shot sections, surplus plan shots) are silent b-roll
  // at their planned duration — previously every shot repeated the full VO clip.
  const voiced = new Set<string>();
  const entries: TimelineEntry[] = state.shot_list.map((shot, index) => {
    const sec = secById.get(shot.section_id);
    const first = !voiced.has(shot.section_id);
    voiced.add(shot.section_id);
    const vo = first ? voBySection.get(shot.section_id) : undefined;
    const avatarClip = avatarByShot.get(shot.shot_id);
    const visual = genByShot.get(shot.shot_id)?.selected_uri ?? avatarClip?.video_uri ?? assetByShot.get(shot.shot_id)?.uri ?? null;
    // An avatar clip carries its own narration (HeyGen TTS or lip-synced ElevenLabs);
    // overlaying the separate voiceover would replace the audio the mouth is synced to.
    const avatarAudio = !!avatarClip?.video_uri && visual === avatarClip.video_uri;
    return {
      index,
      shot_id: shot.shot_id,
      section_id: shot.section_id,
      visual_uri: visual,
      audio_uri: avatarAudio ? null : vo?.audio_uri ?? null,
      duration_s: avatarAudio ? avatarClip.duration_s : vo?.duration_s ?? shot.duration_s,
      caption: first ? sec?.vo_text ?? '' : '',
      on_screen: sec?.on_screen ?? '',
    };
  });

  return { entries, duration_s: entries.reduce((n, e) => n + e.duration_s, 0) };
}

// The renderer pads every shot to whole seconds (slates round, real audio ceils),
// so the RENDERED clock runs ahead of the fractional VO clock. Everything that
// addresses positions in cut.mp4 — shorts cut ranges, caption cues, chapter
// stamps, render-QC expectations — must use this clock, not raw VO sums.
export function renderedDuration(durationS: number): number {
  return Math.max(1, Math.ceil(durationS));
}

export interface SectionSpan { section_id: string; startS: number; durationS: number }

/** Per-section start/duration on the rendered clock, in timeline order. */
export function sectionSpans(timeline: Timeline): SectionSpan[] {
  const spans: SectionSpan[] = [];
  let t = 0;
  for (const e of timeline.entries) {
    const d = renderedDuration(e.duration_s);
    const last = spans[spans.length - 1];
    if (last && last.section_id === e.section_id) last.durationS += d;
    else spans.push({ section_id: e.section_id, startS: t, durationS: d });
    t += d;
  }
  return spans;
}

/** Total episode duration on the rendered clock. */
export function renderedTotal(timeline: Timeline): number {
  return timeline.entries.reduce((n, e) => n + renderedDuration(e.duration_s), 0);
}

export const timelineSkill = defineSkill<{ state: EpisodeState }, Timeline>({
  name: 'timeline',
  description: 'Resolve the edit decision list: per shot pick the visual (generated > avatar > sourced asset), attach the section voiceover, and time it.',
  run: async ({ state }) => buildTimeline(state),
});
