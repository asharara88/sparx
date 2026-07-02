import type { Agent } from './types.js';
import { ok } from './types.js';
import { captioningAssembly } from '../skills/captioningAssembly.js';
import { shotTimeline } from '../producer/timeline.js';
import { createLogger } from '../logger.js';
import { AgentError } from '../errors.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Agent 7 — Editor / Assembly. Builds a REAL edit decision list (EDL) from the
// shared shot timeline (producer/timeline.ts — the same resolution the render,
// shorts, and publishing agents use). Writes timeline.json as an artifact.
// render_uri is a forward EDL reference here; the render agent (Agent 8) replaces it
// with the real ffmpeg-rendered cut.mp4 path before the publisher uploads.
export const editor: Agent = {
  name: 'editor',
  async run(ctx) {
    const log = createLogger({ agent: 'editor', episode: ctx.episode_id });

    const edl = shotTimeline(ctx.state).map((t, i) => ({
      index: i,
      shot_id: t.shot_id,
      section_id: t.section_id,
      visual_uri: t.visual_uri,
      missing_visual: t.visual_uri === null,
      audio_uri: t.audio_uri,
      duration_s: t.duration_s,
      caption: t.vo_text,
      on_screen: t.on_screen,
    }));

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
