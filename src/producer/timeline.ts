import { existsSync } from 'node:fs';
import type { EpisodeState } from '../types/episode.js';

// A URI the renderer can actually fetch: downloadable http(s) or an existing local file.
export const isUsableUri = (u: string | null | undefined): u is string => !!u && (/^https?:\/\//i.test(u) || existsSync(u));

export interface TimelineShot {
  shot_id: string;
  section_id: string;
  visual_uri: string | null;
  // Explicit narration for the shot; null when the visual carries its own audio
  // (an avatar clip is lip-synced to its baked-in track).
  audio_uri: string | null;
  // Narration to fall back to if the visual can't be fetched at render time
  // (e.g. an expired HeyGen URL); only set when audio_uri was suppressed above.
  fallback_audio_uri: string | null;
  duration_s: number;
  vo_text: string;
  on_screen: string;
}

// Single source of truth for the episode timeline. The editor (EDL), the render
// agent (ffmpeg cut), shorts (source ranges), and publishing (chapter stamps) must
// all agree on each shot's visual, audio, and duration — deriving them separately
// let chapter timestamps drift from the actual cut for avatar episodes.
export function shotTimeline(state: EpisodeState): TimelineShot[] {
  const genByShot = new Map(state.generated_video.map((g) => [g.shot_id, g]));
  const avatarByShot = new Map(state.avatar_clips.map((a) => [a.shot_id, a]));
  const assetByShot = new Map(state.sourced_assets.map((a) => [a.shot_id, a]));
  const voBySection = new Map(state.voiceover.clips.map((c) => [c.section_id, c]));
  const secById = new Map(state.script.sections.map((s) => [s.id, s]));

  return state.shot_list.map((shot) => {
    const avatarClip = avatarByShot.get(shot.shot_id);
    const visual = genByShot.get(shot.shot_id)?.selected_uri ?? avatarClip?.video_uri ?? assetByShot.get(shot.shot_id)?.uri ?? null;
    // An avatar clip carries its own narration (HeyGen TTS or lip-synced ElevenLabs);
    // overlaying the separate voiceover would replace the audio the mouth is synced
    // to. Only trust it when the URI is actually fetchable — a mock:// or missing
    // clip would otherwise silence the shot entirely.
    const avatarAudio = !!avatarClip && visual === avatarClip.video_uri && isUsableUri(avatarClip.video_uri);
    const vo = voBySection.get(shot.section_id);
    const sec = secById.get(shot.section_id);
    return {
      shot_id: shot.shot_id,
      section_id: shot.section_id,
      visual_uri: visual,
      audio_uri: avatarAudio ? null : vo?.audio_uri ?? null,
      fallback_audio_uri: avatarAudio ? vo?.audio_uri ?? null : null,
      duration_s: avatarAudio ? avatarClip!.duration_s : vo?.duration_s ?? shot.duration_s,
      vo_text: sec?.vo_text ?? '',
      on_screen: sec?.on_screen ?? '',
    };
  });
}

// Cumulative per-section start times and durations, derived from the same timeline
// the cut is rendered from — used for chapter stamps and shorts source ranges.
export function sectionTimes(state: EpisodeState): { startBySec: Map<string, number>; durBySec: Map<string, number> } {
  const durBySec = new Map<string, number>();
  for (const t of shotTimeline(state)) durBySec.set(t.section_id, (durBySec.get(t.section_id) ?? 0) + t.duration_s);
  const startBySec = new Map<string, number>();
  let t = 0;
  for (const s of state.script.sections) { startBySec.set(s.id, t); t += durBySec.get(s.id) ?? 0; }
  return { startBySec, durBySec };
}
