import { defineAgent } from './core.js';
import { probeMedia } from '../skills/mediaProbe.js';
import { buildTimeline, renderedTotal } from '../skills/timeline.js';

// Agent — Render QC. Probes the actual rendered file (ffprobe) before QA sees it:
// duration vs the EDL timeline, audio presence when narration exists, and
// resolution. Previously nothing verified the mp4 — an empty or silent render
// sailed to publishing. The expected duration comes from buildTimeline (not
// edit.duration_s, which the render agent now overwrites with the probed value —
// that comparison would always pass). When there is no local render
// (mock/no-ffmpeg runs), it reports checked:false rather than fabricating a pass
// or blocking mock runs.

const DURATION_TOLERANCE = 0.2; // ±20% vs timeline before it's an issue
const MIN_HEIGHT = 720;

export const renderQc = defineAgent({
  name: 'render_qc',
  description: 'Probe the rendered cut with ffprobe and flag duration/audio/resolution problems before QA.',
  skills: ['media-probe', 'timeline'],
  reads: ['edit', 'voiceover', 'shot_list', 'script', 'generated_video', 'avatar_clips', 'sourced_assets'],
  writes: ['render_qc'],

  async execute(ctx) {
    const uri = ctx.state.edit.render_uri;
    const probe = await probeMedia(uri);

    if (!probe) {
      // Not a local real render (mock provider, RENDER_FAKE, or ffprobe absent) —
      // nothing to verify; QA sees checked:false and treats the cut as unverified.
      ctx.log.warn('no probeable render; QC skipped', { uri });
      return {
        writes: { render_qc: { checked: false, passed: true, duration_s: 0, has_audio: false, width: 0, height: 0, issues: [] } },
        notes: 'skipped: no local render to probe',
      };
    }

    const issues: string[] = [];
    // Independent expectation: re-derive the EDL from state instead of trusting
    // whatever the render agent wrote back. Compare on the RENDERED clock — the
    // renderer pads every shot to whole seconds, so the fractional timeline sum
    // would falsely trip the tolerance on fast-cut episodes.
    const expected = renderedTotal(buildTimeline(ctx.state));
    if (probe.durationS <= 0) issues.push('render has zero duration');
    if (expected > 0 && probe.durationS > 0) {
      const drift = Math.abs(probe.durationS - expected) / expected;
      if (drift > DURATION_TOLERANCE) issues.push(`duration ${probe.durationS.toFixed(1)}s deviates ${(drift * 100).toFixed(0)}% from timeline ${expected}s`);
    }
    if (ctx.state.voiceover.clips.length > 0 && !probe.hasAudio) issues.push('render has no audio stream but narration exists');
    if (!probe.hasVideo) issues.push('render has no video stream');
    if (probe.height > 0 && probe.height < MIN_HEIGHT) issues.push(`render is ${probe.width}x${probe.height}, below ${MIN_HEIGHT}p`);

    const passed = issues.length === 0;
    ctx.log.info('render probed', { passed, durationS: probe.durationS, hasAudio: probe.hasAudio, res: `${probe.width}x${probe.height}`, issues: issues.length });
    return {
      writes: { render_qc: { checked: true, passed, duration_s: probe.durationS, has_audio: probe.hasAudio, width: probe.width, height: probe.height, issues } },
      notes: passed ? `verified ${probe.durationS.toFixed(1)}s ${probe.width}x${probe.height}` : `${issues.length} issues`,
    };
  },
});
