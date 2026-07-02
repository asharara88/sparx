import type { Agent } from './types.js';
import { ok } from './types.js';
import { config, isTruthy } from '../config.js';
import { shotTimeline } from '../producer/timeline.js';
import { createLogger } from '../logger.js';
import { ffmpegAvailable, renderEpisode, type RenderShot } from '../media/render.js';

// Agent 8 — Render / Compositing. Consumes the editor's timeline and produces a
// single real mp4 (generated/<episode>/cut.mp4) via ffmpeg, setting edit.render_uri
// to that file so the publisher can actually upload it. Real footage is used when a
// shot's URI is a downloadable URL; otherwise a captioned placeholder slate stands
// in, so the loop closes end-to-end even with mock providers. If ffmpeg is missing,
// the step is skipped and the placeholder render ref is left untouched.
export const render: Agent = {
  name: 'render',
  async run(ctx) {
    const log = createLogger({ agent: 'render', episode: ctx.episode_id });

    // Test/dev escape hatch: skip the (slow) real ffmpeg render. Leaves the editor's
    // EDL render ref untouched, so the publisher treats it as "no real file" and never
    // uploads. The real render path is covered directly by tests/render.test.ts.
    if (isTruthy(config().RENDER_FAKE)) {
      log.warn('RENDER_FAKE set; skipping real render (keeping placeholder ref)');
      return ok(ctx, {}, 0, 'skipped: RENDER_FAKE');
    }

    if (!ffmpegAvailable()) {
      log.warn('ffmpeg not available; skipping real render (keeping placeholder ref)');
      return ok(ctx, {}, 0, 'skipped: ffmpeg not installed');
    }

    // The shared shot timeline (producer/timeline.ts) — the same resolution the
    // editor's EDL and the shorts/publishing time math are built from.
    const shots: RenderShot[] = shotTimeline(ctx.state).map((t) => ({
      visual_uri: t.visual_uri,
      audio_uri: t.audio_uri,
      fallback_audio_uri: t.fallback_audio_uri,
      duration_s: t.duration_s,
      caption: t.on_screen || t.vo_text || '',
    }));

    if (!shots.length) return ok(ctx, {}, 0, 'no shots to render');

    try {
      const res = await renderEpisode({ episodeId: ctx.episode_id, shots, musicUri: ctx.state.music.track_uri });
      log.info('render complete', { path: res.path, durationS: res.durationS, shots: res.shots, real: res.real, placeholders: res.placeholders, music: res.music });
      return ok(
        ctx,
        { edit: { ...ctx.state.edit, render_uri: res.path } },
        0,
        `rendered ${res.shots} shots (${res.real} real, ${res.placeholders} placeholder) → cut.mp4${res.music ? ' +music' : ''}`,
      );
    } catch (e) {
      // A render failure shouldn't sink the episode — keep the placeholder ref and flag it.
      log.warn('render failed; keeping placeholder ref', { err: String(e) });
      return ok(ctx, {}, 0, `render failed: ${String(e).slice(0, 120)}`);
    }
  },
};
