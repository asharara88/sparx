import type { Agent } from './types.js';
import { ok } from './types.js';
import { captioningAssembly } from '../skills/captioningAssembly.js';
import { createLogger } from '../logger.js';
import { AgentError } from '../errors.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Agent 7 — Editor / Assembly. Builds a REAL edit decision list (EDL): every shot
// in order, paired with its visual (generated clip or sourced asset), its section
// voiceover, and a caption from the narration. Writes timeline.json as an artifact.
// render_uri is a forward EDL reference here; the render agent (Agent 8) replaces it
// with the real ffmpeg-rendered cut.mp4 path before the publisher uploads.
export const editor: Agent = {
  name: 'editor',
  async run(ctx) {
    const log = createLogger({ agent: 'editor', episode: ctx.episode_id });
    const genByShot = new Map(ctx.state.generated_video.map((g) => [g.shot_id, g]));
    const avatarByShot = new Map(ctx.state.avatar_clips.map((a) => [a.shot_id, a]));
    const assetByShot = new Map(ctx.state.sourced_assets.map((a) => [a.shot_id, a]));
    const voBySection = new Map(ctx.state.voiceover.clips.map((c) => [c.section_id, c]));
    const secById = new Map(ctx.state.script.sections.map((s) => [s.id, s]));

    const edl = ctx.state.shot_list.map((shot, i) => {
      const avatarClip = avatarByShot.get(shot.shot_id);
      const visual = genByShot.get(shot.shot_id)?.selected_uri ?? avatarClip?.video_uri ?? assetByShot.get(shot.shot_id)?.uri ?? null;
      // An avatar clip carries its own narration (HeyGen TTS or lip-synced ElevenLabs);
      // overlaying the separate voiceover would replace the audio the mouth is synced to.
      const avatarAudio = !!avatarClip?.video_uri && visual === avatarClip.video_uri;
      const vo = voBySection.get(shot.section_id);
      const sec = secById.get(shot.section_id);
      return {
        index: i,
        shot_id: shot.shot_id,
        section_id: shot.section_id,
        visual_uri: visual,
        missing_visual: visual === null,
        audio_uri: avatarAudio ? null : vo?.audio_uri ?? null,
        duration_s: avatarAudio ? avatarClip.duration_s : vo?.duration_s ?? shot.duration_s,
        caption: sec?.vo_text ?? '',
        on_screen: sec?.on_screen ?? '',
      };
    });

    const missing = edl.filter((e) => e.missing_visual);
    if (missing.length) log.warn('shots missing a visual; placeholders inserted', { missing: missing.map((m) => m.shot_id) });

    const cap = await captioningAssembly({
      clips: edl.map((e) => e.visual_uri ?? 'placeholder'),
      vo: edl.map((e) => e.audio_uri ?? ''),
      music: ctx.state.music.track_uri,
    });

    const duration = edl.reduce((n, e) => n + e.duration_s, 0);
    const dir = join('generated', ctx.episode_id);
    let timelineUri = `mem://edit/${ctx.episode_id}/timeline.json`;
    try {
      mkdirSync(dir, { recursive: true });
      const path = join(dir, 'timeline.json');
      writeFileSync(path, JSON.stringify({ episode_id: ctx.episode_id, duration_s: duration, music: ctx.state.music.track_uri, edl }, null, 2));
      timelineUri = path;
    } catch (e) {
      log.warn('could not persist timeline artifact, using in-memory ref', { err: String(e) });
    }
    if (edl.length === 0) throw new AgentError('editor', 'no shots to assemble');

    log.info('assembled timeline', { shots: edl.length, duration, missing: missing.length });
    return ok(ctx, { edit: { timeline_uri: timelineUri, captioned: cap.captioned, render_uri: `render://${ctx.episode_id}/cut.mp4`, duration_s: duration, approved: false } }, 0, `${edl.length} shots, ${duration}s${missing.length ? `, ${missing.length} placeholder` : ''}`);
  },
};
