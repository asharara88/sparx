import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { defineAgent } from './core.js';
import { config } from '../config.js';
import { getYouTube } from '../media/youtube.js';
import { rememberEpisode } from '../skills/channelMemory.js';
import { buildTimeline, renderedTotal, sectionSpans } from '../skills/timeline.js';
import { fetchWithRetry } from '../util/http.js';

// Agent 11 — SEO & Publishing. Assembles VALIDATED publish metadata — chapters
// only when they meet YouTube's parsing rules (start 0:00, ≥3 entries, ≥10s
// apart, last chapter ≥10s before the end), tags trimmed to the ~500-char TOTAL
// limit, description ≤5000 chars cut at a line boundary (never mid-chapter-line)
// — and uploads via the YouTube provider with the honest synthetic-media
// declaration. Chapter stamps come from the RENDERED clock (sectionSpans) — the
// renderer pads shots to whole seconds, so raw VO sums drift from what YouTube
// actually shows. On a real upload it also attaches the packaging thumbnail
// (downloading a remote CDN thumbnail locally first) and the captions agent's
// SRT track, and it records the episode into channel memory so research/
// packaging dedup has a source. Privacy defaults to PRIVATE — going public is a
// separate, deliberate action, never automated.
const MIN_CHAPTERS = 3;         // YouTube ignores chapter lists with fewer entries
const MIN_CHAPTER_GAP_S = 10;   // …and chapters shorter than 10s
const MAX_TAG_CHARS = 500;      // YouTube's tag limit is TOTAL characters, not a count cap
const MAX_TAG_LEN = 100;        // per-tag hard limit
const MAX_DESC_CHARS = 5000;

export const publishing = defineAgent({
  name: 'publishing',
  description: 'Validate publish metadata (chapters/tags/description), upload with AI disclosure, attach thumbnail + captions, and record the episode in channel memory.',
  skills: ['channel-memory', 'timeline'],
  reads: ['packaging', 'edit', 'captions', 'qa', 'concept', 'shorts', 'script', 'voiceover', 'channel', 'shot_list', 'generated_video', 'avatar_clips', 'sourced_assets'],
  writes: ['publish'],
  requires: (s) => (s.qa.passed ? null : 'QA has not passed'),

  async execute(ctx) {
    const cfg = config();
    const st = ctx.state;

    // Chapters on the RENDERED clock — the stamps YouTube resolves against
    // cut.mp4, not the fractional VO walk (the renderer pads shots to whole
    // seconds, so the clocks drift apart on fast-cut episodes).
    const timeline = buildTimeline(st);
    const secById = new Map(st.script.sections.map((s) => [s.id, s]));
    const entries = sectionSpans(timeline).map((sp) => {
      const sec = secById.get(sp.section_id);
      return { startS: sp.startS, line: `${fmt(sp.startS)} ${sec?.on_screen || sec?.beat || sp.section_id}` };
    });
    const chapters = entries.map((e) => e.line);
    // YouTube only parses chapter lists that start at 0:00, have ≥3 entries, are
    // ≥10s apart, AND whose last chapter is ≥10s before the video end — an
    // invalid list is dead weight, so omit it and say why.
    const videoEndS = renderedTotal(timeline) || st.edit.duration_s;
    const chapterProblem = validateChapters(entries, videoEndS);
    if (chapterProblem) ctx.log.warn('chapters omitted from description', { reason: chapterProblem });

    const title = st.packaging.titles[0] ?? st.concept.working_title;
    const baseDesc = st.packaging.descriptions[0] ?? st.concept.angle;
    // Budget the disclosure + chapter block first, then give the prose whatever
    // remains (cut at a line boundary) — an over-long description can never push
    // the AI note or a partial chapter line past the 5000-char limit.
    const aiNote = st.qa.ai_disclosure_required ? '\n\nThis video contains AI-generated content.' : '';
    const chapterBlock = chapterProblem ? '' : `\n\nChapters:\n${chapters.join('\n')}`;
    const suffix = `${aiNote}${chapterBlock}`;
    const description = suffix.length >= MAX_DESC_CHARS
      ? truncateAtLine(suffix.trimStart(), MAX_DESC_CHARS)  // pathological chapter count: keep disclosure + leading chapters
      : `${truncateAtLine(baseDesc, MAX_DESC_CHARS - suffix.length)}${suffix}`;

    const tags = fitTags(st.concept.keywords);

    // The render agent sets render_uri to an absolute cut.mp4 path; if render was
    // skipped it's still an EDL ref (render://…), so upload only a real local file.
    const filePath = st.edit.render_uri.startsWith('/') ? st.edit.render_uri : undefined;
    const yt = getYouTube();
    const res = await yt.upload({
      filePath,
      title,
      description,
      tags,
      privacyStatus: cfg.YOUTUBE_PRIVACY,
      madeForKids: false,
      containsSyntheticMedia: st.qa.ai_disclosure_required, // the real disclosure, not just a description footnote
    });

    // Real upload → attach the secondary artifacts that exist as real files.
    const attached: string[] = [];
    let thumbProblem: string | null = null;
    if (res.uploaded) {
      // Packaging may store a remote https:// CDN URL (Runway) for the best
      // thumbnail — thumbnails.set needs a local file, so download it first.
      // A paid thumbnail must never silently fail to attach.
      const { path: thumb, problem } = await resolveThumbnail(ctx.episode_id, st.packaging.thumbnails);
      thumbProblem = problem;
      if (thumbProblem) ctx.log.warn('thumbnail not attached', { reason: thumbProblem });
      if (thumb) {
        const tr = await yt.uploadThumbnail(res.videoId, thumb).catch((e) => {
          ctx.log.warn('thumbnail upload failed', { err: String(e).slice(0, 160) });
          return null;
        });
        if (tr?.uploaded) attached.push('thumbnail');
      }
      if (st.captions.srt_uri && existsSync(st.captions.srt_uri)) {
        const lang = st.channel.languages[0] ?? 'en';
        const cr = await yt.uploadCaptions(res.videoId, st.captions.srt_uri, lang).catch((e) => {
          ctx.log.warn('caption upload failed', { err: String(e).slice(0, 160) });
          return null;
        });
        if (cr?.uploaded) attached.push(`captions(${lang})`);
      }
    }

    // Feed channel memory — the dedup source research + packaging read on the
    // NEXT episode. published_at / video id stay '' until a real upload happened.
    rememberEpisode({
      episode_id: ctx.episode_id,
      topic: st.concept.topic,
      title,
      angle: st.concept.angle,
      keywords: st.concept.keywords,
      published_at: res.uploaded ? new Date().toISOString() : '',
      youtube_video_id: res.uploaded ? res.videoId : '',
    });

    // Publishing runs AFTER the shorts renderer — record only shorts that exist
    // as real local files; plan:// refs (renderer skipped or failed) are not posted.
    const renderedShorts = st.shorts.filter((s) => !/^[a-z+]+:\/\//i.test(s.render_uri) && existsSync(s.render_uri));
    const unrenderedShorts = st.shorts.length - renderedShorts.length;
    if (unrenderedShorts > 0) ctx.log.warn('planned shorts without a rendered file are not posted', { planned: st.shorts.length, rendered: renderedShorts.length });

    const publish = {
      youtube_video_id: res.videoId,
      uploaded: res.uploaded, // authoritative flag (mock/metadata-only → false); analytics reads this, never the id shape
      scheduled_at: new Date(Date.now() + 86_400_000).toISOString(),
      tags,
      chapters, // computed stamps kept in state; the description omits them when they break YouTube's rules
      ai_label_applied: st.qa.ai_disclosure_required,
      shorts_posted: renderedShorts.map((s) => s.short_id),
    };
    ctx.log.info('publish prepared', { title: title.slice(0, 40), chapters: chapters.length, chaptersInDesc: !chapterProblem, tags: tags.length, uploaded: res.uploaded, attached, shortsPosted: renderedShorts.length, privacy: cfg.YOUTUBE_PRIVACY, provider: yt.name });
    const notes = [
      `${res.uploaded ? 'uploaded' : 'metadata ready'} "${title.slice(0, 32)}" (${yt.name}, ${cfg.YOUTUBE_PRIVACY})`,
      chapterProblem ? `chapters omitted: ${chapterProblem}` : null,
      thumbProblem,
      attached.length ? `attached ${attached.join(' + ')}` : null,
      unrenderedShorts > 0 ? `${unrenderedShorts} planned shorts unrendered (not posted)` : null,
    ].filter(Boolean).join('; ');
    return { writes: { publish }, notes };
  },
});

/**
 * Pick the best attachable thumbnail: packaging orders thumbnails best-first, so
 * take the first entry that is a real local file or a remote https URL. Remote
 * URLs are downloaded to generated/<episode>/thumbnail.jpg; a failed download is
 * reported (problem), never silently skipped.
 */
async function resolveThumbnail(episodeId: string, thumbnails: string[]): Promise<{ path: string | null; problem: string | null }> {
  const candidate = thumbnails.find((u) => (u.startsWith('/') && existsSync(u)) || /^https:\/\//.test(u));
  if (!candidate) return { path: null, problem: null }; // nothing rendered (text concepts only) — nothing to attach
  if (candidate.startsWith('/')) return { path: candidate, problem: null };
  try {
    const res = await fetchWithRetry(candidate, {}, { label: 'thumbnail.download' });
    const bytes = Buffer.from(await res.arrayBuffer());
    const dir = join('generated', episodeId);
    mkdirSync(dir, { recursive: true });
    const path = resolve(join(dir, 'thumbnail.jpg'));
    writeFileSync(path, bytes);
    return { path, problem: null };
  } catch (e) {
    return { path: null, problem: `thumbnail download failed (${candidate.slice(0, 80)}): ${String(e).slice(0, 120)}` };
  }
}

function fmt(sec: number): string { const m = Math.floor(sec / 60), s = Math.floor(sec % 60); return `${m}:${String(s).padStart(2, '0')}`; }

function validateChapters(entries: { startS: number }[], videoEndS: number): string | null {
  if (entries.length < MIN_CHAPTERS) return `only ${entries.length} entries (YouTube needs ≥${MIN_CHAPTERS})`;
  if (entries[0]!.startS !== 0) return 'first chapter does not start at 0:00';
  for (let i = 1; i < entries.length; i++) {
    const gap = entries[i]!.startS - entries[i - 1]!.startS;
    if (gap < MIN_CHAPTER_GAP_S) return `chapter ${i + 1} starts ${Math.round(gap)}s after the previous (min ${MIN_CHAPTER_GAP_S}s)`;
  }
  // The final chapter also needs ≥10s of runway before the video ends.
  const lastGap = videoEndS - entries[entries.length - 1]!.startS;
  if (videoEndS > 0 && lastGap < MIN_CHAPTER_GAP_S) return `last chapter is only ${Math.round(lastGap)}s before the video end (min ${MIN_CHAPTER_GAP_S}s)`;
  return null;
}

/** Truncate to `max` chars at a line boundary — never mid-line, never mid-chapter. */
function truncateAtLine(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.lastIndexOf('\n', max);
  return (cut > 0 ? text.slice(0, cut) : text.slice(0, max)).trimEnd();
}

/** Keep tags within YouTube's ~500-char TOTAL budget (multi-word tags count their quotes). */
function fitTags(keywords: string[]): string[] {
  const tags: string[] = [];
  let total = 0;
  for (const raw of keywords) {
    const tag = raw.trim();
    if (!tag || tag.length > MAX_TAG_LEN) continue;
    const cost = tag.length + (tag.includes(' ') ? 2 : 0);
    if (total + cost > MAX_TAG_CHARS) break;
    total += cost;
    tags.push(tag);
  }
  return tags;
}
