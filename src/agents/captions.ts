import { defineAgent } from './core.js';
import { writeCaptions, type CaptionSection } from '../skills/captioning.js';

// Agent — Captions. Produces real timed SRT/VTT caption files from the narration
// and the per-section voiceover durations (previously edit.captioned was a
// hardcoded lie and no caption track ever existed). Runs alongside the render —
// it needs only the script + voiceover timing, not the finished mp4.

export const captions = defineAgent({
  name: 'captions',
  description: 'Generate timed SRT + WebVTT caption tracks from the script and voiceover clip durations.',
  skills: ['captioning'],
  reads: ['script', 'voiceover', 'shot_list'],
  writes: ['captions'],
  requires: (s) => (s.script.sections.length === 0 ? 'no script sections to caption' : null),

  async execute(ctx) {
    const voBySection = new Map(ctx.state.voiceover.clips.map((c) => [c.section_id, c]));
    const shotBySection = new Map(ctx.state.shot_list.map((sh) => [sh.section_id, sh]));

    let t = 0;
    const sections: CaptionSection[] = [];
    for (const s of ctx.state.script.sections) {
      // Same timing source as the editor: VO clip duration, else the shot's planned duration.
      const durationS = voBySection.get(s.id)?.duration_s ?? shotBySection.get(s.id)?.duration_s ?? 0;
      if (durationS > 0 && s.vo_text) sections.push({ text: s.vo_text, startS: t, durationS });
      t += durationS;
    }

    const result = await writeCaptions(ctx.episode_id, sections);
    ctx.log.info('captions written', { cues: result.cue_count, srt: result.srt_uri });
    return {
      writes: { captions: { srt_uri: result.srt_uri, vtt_uri: result.vtt_uri, cue_count: result.cue_count } },
      notes: `${result.cue_count} cues → ${result.srt_uri}`,
    };
  },
});
