import { defineAgent } from './core.js';
import { writeCaptions, type CaptionSection } from '../skills/captioning.js';
import { buildTimeline, sectionSpans } from '../skills/timeline.js';

// Agent — Captions. Produces real timed SRT/VTT caption files from the narration
// and the per-section RENDERED timing (previously edit.captioned was a hardcoded
// lie and no caption track ever existed). Section spans come from
// sectionSpans(buildTimeline) — the whole-second clock the renderer actually
// cuts — so the SRT lines up with cut.mp4 even on multi-shot sections. Runs
// alongside the render — it needs only the resolved timeline, not the finished mp4.

export const captions = defineAgent({
  name: 'captions',
  description: 'Generate timed SRT + WebVTT caption tracks from the script and the rendered per-section timeline spans.',
  skills: ['captioning', 'timeline'],
  reads: ['script', 'voiceover', 'shot_list', 'generated_video', 'avatar_clips', 'sourced_assets'],
  writes: ['captions'],
  requires: (s) => (s.script.sections.length === 0 ? 'no script sections to caption' : null),

  async execute(ctx) {
    const secById = new Map(ctx.state.script.sections.map((s) => [s.id, s]));
    const sections: CaptionSection[] = [];
    for (const span of sectionSpans(buildTimeline(ctx.state))) {
      const text = secById.get(span.section_id)?.vo_text ?? '';
      if (span.durationS > 0 && text) sections.push({ text, startS: span.startS, durationS: span.durationS });
    }

    const result = await writeCaptions(ctx.episode_id, sections);
    ctx.log.info('captions written', { cues: result.cue_count, srt: result.srt_uri });
    return {
      writes: { captions: { srt_uri: result.srt_uri, vtt_uri: result.vtt_uri, cue_count: result.cue_count } },
      notes: `${result.cue_count} cues → ${result.srt_uri}`,
    };
  },
});
