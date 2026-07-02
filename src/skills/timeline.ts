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

export interface TimelineEntry {
  index: number;
  shot_id: string;
  section_id: string;
  visual_uri: string | null;   // resolved visual, null → placeholder
  audio_uri: string | null;    // section voiceover clip, null → silence
  duration_s: number;          // VO clip duration else shot duration
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

  const entries: TimelineEntry[] = state.shot_list.map((shot, index) => {
    const vo = voBySection.get(shot.section_id);
    const sec = secById.get(shot.section_id);
    return {
      index,
      shot_id: shot.shot_id,
      section_id: shot.section_id,
      visual_uri: genByShot.get(shot.shot_id)?.selected_uri ?? avatarByShot.get(shot.shot_id)?.video_uri ?? assetByShot.get(shot.shot_id)?.uri ?? null,
      audio_uri: vo?.audio_uri ?? null,
      duration_s: vo?.duration_s ?? shot.duration_s,
      caption: sec?.vo_text ?? '',
      on_screen: sec?.on_screen ?? '',
    };
  });

  return { entries, duration_s: entries.reduce((n, e) => n + e.duration_s, 0) };
}

export const timelineSkill = defineSkill<{ state: EpisodeState }, Timeline>({
  name: 'timeline',
  description: 'Resolve the edit decision list: per shot pick the visual (generated > avatar > sourced asset), attach the section voiceover, and time it.',
  run: async ({ state }) => buildTimeline(state),
});
