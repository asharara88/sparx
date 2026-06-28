import type { Agent } from './types.js';
import { ok } from './types.js';
import { config, isTruthy } from '../config.js';
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

    // Reconstruct the per-shot EDL from state (same resolution order as the editor).
    const genByShot = new Map(ctx.state.generated_video.map((g) => [g.shot_id, g]));
    const avatarByShot = new Map(ctx.state.avatar_clips.map((a) => [a.shot_id, a]));
    const assetByShot = new Map(ctx.state.sourced_assets.map((a) => [a.shot_id, a]));
    const voBySection = new Map(ctx.state.voiceover.clips.map((c) => [c.section_id, c]));
    const secById = new Map(ctx.state.script.sections.map((s) => [s.id, s]));

    const shots: RenderShot[] = ctx.state.shot_list.map((shot) => {
      const vo = voBySection.get(shot.section_id);
      const sec = secById.get(shot.section_id);
      return {
        visual_uri: genByShot.get(shot.shot_id)?.selected_uri ?? avatarByShot.get(shot.shot_id)?.video_uri ?? assetByShot.get(shot.shot_id)?.uri ?? null,
        audio_uri: vo?.audio_uri ?? null,
        duration_s: vo?.duration_s ?? shot.duration_s,
        caption: sec?.on_screen || sec?.vo_text || '',
      };
    });

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
