import { defineAgent } from './core.js';
import { config, isTruthy } from '../config.js';
import { buildTimeline } from '../skills/timeline.js';
import { probeMedia } from '../skills/mediaProbe.js';
import { ffmpegAvailable, renderEpisode, type RenderShot } from '../media/render.js';

// Agent 8 — Render / Compositing. Consumes the shared timeline (same EDL the
// editor persisted — one resolution source, no drift) and produces a single real
// mp4 (generated/<episode>/cut.mp4) via ffmpeg, setting edit.render_uri to that
// file so the publisher can actually upload it. Real footage is used when a
// shot's URI is a downloadable URL; otherwise a captioned placeholder slate stands
// in, so the loop closes end-to-end even with mock providers. If ffmpeg is missing,
// the step is skipped and the placeholder render ref is left untouched.

export const render = defineAgent({
  name: 'render',
  description: 'Composite the timeline into the real cut.mp4 via ffmpeg; skips gracefully under RENDER_FAKE or without ffmpeg.',
  skills: ['timeline', 'media-probe'],
  reads: ['shot_list', 'generated_video', 'avatar_clips', 'sourced_assets', 'voiceover', 'script', 'music', 'edit'],
  writes: ['edit'],

  async execute(ctx) {
    // Test/dev escape hatch: skip the (slow) real ffmpeg render. Leaves the editor's
    // EDL render ref untouched, so the publisher treats it as "no real file" and never
    // uploads. The real render path is covered directly by tests/render.test.ts.
    if (isTruthy(config().RENDER_FAKE)) {
      ctx.log.warn('RENDER_FAKE set; skipping real render (keeping placeholder ref)');
      return { writes: {}, notes: 'skipped: RENDER_FAKE' };
    }

    if (!ffmpegAvailable()) {
      ctx.log.warn('ffmpeg not available; skipping real render (keeping placeholder ref)');
      return { writes: {}, notes: 'skipped: ffmpeg not installed' };
    }

    const { entries } = buildTimeline(ctx.state);
    if (!entries.length) return { writes: {}, notes: 'no shots to render' };

    const shots: RenderShot[] = entries.map((e) => ({
      visual_uri: e.visual_uri,
      audio_uri: e.audio_uri,
      duration_s: e.duration_s,
      caption: e.on_screen || e.caption,
    }));

    try {
      const res = await renderEpisode({ episodeId: ctx.episode_id, shots, musicUri: ctx.state.music.track_uri });
      // renderEpisode rounds shot durations up to their audio, so trust the measured
      // file over the EDL estimate when ffprobe can see it.
      const probe = await probeMedia(res.path);
      const duration_s = probe?.durationS || res.durationS;
      ctx.log.info('render complete', { path: res.path, durationS: duration_s, shots: res.shots, real: res.real, placeholders: res.placeholders, music: res.music });
      return {
        writes: { edit: { ...ctx.state.edit, render_uri: res.path, duration_s } },
        notes: `rendered ${res.shots} shots (${res.real} real, ${res.placeholders} placeholder) → cut.mp4${res.music ? ' +music' : ''}`,
      };
    } catch (e) {
      // A render failure shouldn't sink the episode — keep the placeholder ref and flag it.
      ctx.log.warn('render failed; keeping placeholder ref', { err: String(e) });
      return { writes: {}, notes: `render failed: ${String(e).slice(0, 120)}` };
    }
  },
});
