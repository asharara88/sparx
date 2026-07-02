import { defineAgent } from './core.js';
import { buildTimeline } from '../skills/timeline.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Agent 7 — Editor / Assembly. Resolves the edit decision list (EDL) through the
// shared timeline skill (one resolution source for editor, render, and QC) and
// persists it as generated/<episode>/timeline.json. render_uri is a forward EDL
// reference here; the render agent (Agent 8) replaces it with the real
// ffmpeg-rendered cut.mp4 path before the publisher uploads. Captions are NOT
// this agent's job anymore: the captions agent writes real SRT/VTT tracks into
// state.captions, so edit.captioned stays false here.

export const editor = defineAgent({
  name: 'editor',
  description: 'Assemble the edit decision list from shots, visuals, and voiceover; persist timeline.json and seed state.edit.',
  skills: ['timeline'],
  reads: ['shot_list', 'generated_video', 'avatar_clips', 'sourced_assets', 'voiceover', 'script', 'music'],
  writes: ['edit'],
  requires: (s) => (s.shot_list.length === 0 ? 'no shots to assemble' : null),

  async execute(ctx) {
    const { entries, duration_s } = buildTimeline(ctx.state);

    const missing = entries.filter((e) => e.visual_uri === null);
    if (missing.length) ctx.log.warn('shots missing a visual; placeholders inserted', { missing: missing.map((m) => m.shot_id) });

    const dir = join('generated', ctx.episode_id);
    let timelineUri = `mem://edit/${ctx.episode_id}/timeline.json`;
    try {
      mkdirSync(dir, { recursive: true });
      const path = join(dir, 'timeline.json');
      writeFileSync(path, JSON.stringify({ episode_id: ctx.episode_id, duration_s, music: ctx.state.music.track_uri, edl: entries }, null, 2));
      timelineUri = path;
    } catch (e) {
      ctx.log.warn('could not persist timeline artifact, using in-memory ref', { err: String(e) });
    }

    ctx.log.info('assembled timeline', { shots: entries.length, duration: duration_s, missing: missing.length });
    return {
      writes: { edit: { timeline_uri: timelineUri, captioned: false, render_uri: `render://${ctx.episode_id}/cut.mp4`, duration_s, approved: false } },
      notes: `${entries.length} shots, ${duration_s}s${missing.length ? `, ${missing.length} placeholder` : ''}`,
    };
  },
});
