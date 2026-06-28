import type { Agent } from './types.js';
import { ok } from './types.js';
import { config } from '../config.js';
import { getYouTube } from '../media/youtube.js';
import { createLogger } from '../logger.js';

// Agent 11 — SEO & Publishing. Assembles real publish metadata (tags, timestamped
// chapters, description, AI-disclosure) and uploads via the YouTube provider
// (Data API v3 resumable). Privacy defaults to PRIVATE — going public is a separate,
// deliberate action, never automated. Requires qa.passed + packaging.
export const publishing: Agent = {
  name: 'publishing',
  async run(ctx) {
    const log = createLogger({ agent: 'publishing', episode: ctx.episode_id });
    const c = config();

    // chapters with cumulative timestamps from voiceover durations
    const durBySec = new Map(ctx.state.voiceover.clips.map((cl) => [cl.section_id, cl.duration_s]));
    let t = 0;
    const chapters = ctx.state.script.sections.map((s) => {
      const stamp = fmt(t); t += durBySec.get(s.id) ?? 0;
      return `${stamp} ${s.on_screen || s.beat}`;
    });

    const title = ctx.state.packaging.titles[0] ?? ctx.state.concept.working_title;
    const baseDesc = ctx.state.packaging.descriptions[0] ?? ctx.state.concept.angle;
    const aiNote = ctx.state.qa.ai_disclosure_required ? '\n\nThis video contains AI-generated content.' : '';
    const description = `${baseDesc}\n\nChapters:\n${chapters.join('\n')}${aiNote}`;

    // The render agent sets render_uri to an absolute cut.mp4 path; if render was
    // skipped it's still an EDL ref (render://…), so upload only a real local file.
    const filePath = ctx.state.edit.render_uri.startsWith('/') ? ctx.state.edit.render_uri : undefined;
    const yt = getYouTube();
    const res = await yt.upload({
      filePath,
      title,
      description,
      tags: ctx.state.concept.keywords,
      privacyStatus: c.YOUTUBE_PRIVACY,
      madeForKids: false,
    });

    const publish = {
      youtube_video_id: res.videoId,
      scheduled_at: new Date(Date.now() + 86_400_000).toISOString(),
      tags: ctx.state.concept.keywords,
      chapters,
      ai_label_applied: ctx.state.qa.ai_disclosure_required,
      shorts_posted: ctx.state.shorts.map((s) => s.short_id),
    };
    log.info('publish prepared', { title: title.slice(0, 40), chapters: chapters.length, uploaded: res.uploaded, privacy: c.YOUTUBE_PRIVACY, provider: yt.name });
    return ok(ctx, { publish }, 0, `${res.uploaded ? 'uploaded' : 'metadata ready'} "${title.slice(0, 32)}" (${yt.name}, ${c.YOUTUBE_PRIVACY})`);
  },
};

function fmt(sec: number): string { const m = Math.floor(sec / 60), s = Math.floor(sec % 60); return `${m}:${String(s).padStart(2, '0')}`; }
