import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Point channel memory at a temp file BEFORE any config-reading import (config
// caches process.env on first read; static imports hoist, so the modules under
// test are imported dynamically after the env is set).
const tmp = mkdtempSync(join(tmpdir(), 'sparx-publishing-'));
process.env.CHANNEL_MEMORY_PATH = join(tmp, 'memory.json');

const { publishing } = await import('../src/agents/publishing.js');
const { __setYouTube } = await import('../src/media/youtube.js');
const { loadChannelMemory, saveChannelMemory } = await import('../src/skills/channelMemory.js');
const { newEpisodeState } = await import('../src/types/episode.js');
const { ctxFor } = await import('./helpers.js');

// Recording provider stub: captures every request publishing makes.
function recorder(opts: { uploaded?: boolean } = {}) {
  const reqs = { uploads: [] as any[], thumbnails: [] as [string, string][], captions: [] as [string, string, string][] };
  const provider = {
    name: 'stub', live: false,
    async upload(req: any) { reqs.uploads.push(req); return { videoId: 'vid_1', uploaded: opts.uploaded ?? false }; },
    async uploadThumbnail(videoId: string, filePath: string) { reqs.thumbnails.push([videoId, filePath]); return { ref: 'thumbref', uploaded: true }; },
    async uploadCaptions(videoId: string, srtPath: string, language: string) { reqs.captions.push([videoId, srtPath, language]); return { ref: 'capref', uploaded: true }; },
  };
  return { provider, reqs };
}

function base(id = 'pub1', sectionCount = 4, durS = 15) {
  const s = newEpisodeState(id);
  s.qa.passed = true;
  s.qa.ai_disclosure_required = true;
  s.concept.topic = 'sleep science';
  s.concept.working_title = 'Sleep better tonight';
  s.concept.angle = 'why common sleep advice backfires';
  s.concept.keywords = ['sleep', 'deep sleep', 'energy'];
  s.packaging.titles = ['My Packaged Title'];
  s.packaging.descriptions = ['A base description that says what the video is about.'];
  for (let i = 1; i <= sectionCount; i++) {
    s.script.sections.push({ id: `s${i}`, beat: `beat ${i}`, vo_text: `narration ${i}`, shot_note: '', on_screen: `Chapter ${i}`, retention_device: '' });
    s.voiceover.clips.push({ section_id: `s${i}`, audio_uri: `a${i}`, duration_s: durS });
  }
  s.edit.render_uri = 'render://pub/cut.mp4'; // not a real file → provider decides
  return s;
}

beforeEach(() => { __setYouTube(null); saveChannelMemory({ episodes: [] }); });

describe('publishing metadata validation', () => {
  it('includes chapters starting at 0:00 when they meet YouTube rules', async () => {
    const { provider, reqs } = recorder();
    __setYouTube(provider as any);
    const r = await publishing.run(ctxFor(base('pub_ok')));
    expect(r.status).toBe('ok');
    expect(r.writes.publish?.chapters.length).toBe(4);
    expect(r.writes.publish?.chapters[0]).toMatch(/^0:00 /);
    const desc = reqs.uploads[0].description as string;
    expect(desc).toContain('Chapters:\n0:00 Chapter 1');
    expect(desc).toContain('0:45 Chapter 4');
  });

  it('omits chapters from the description when there are fewer than 3', async () => {
    const { provider, reqs } = recorder();
    __setYouTube(provider as any);
    const r = await publishing.run(ctxFor(base('pub_few', 2)));
    expect(reqs.uploads[0].description).not.toContain('Chapters:');
    expect(r.notes).toContain('chapters omitted');
    expect(r.notes).toContain('needs ≥3');
  });

  it('omits chapters when entries are closer than 10s apart', async () => {
    const { provider, reqs } = recorder();
    __setYouTube(provider as any);
    const r = await publishing.run(ctxFor(base('pub_close', 4, 5)));
    expect(reqs.uploads[0].description).not.toContain('Chapters:');
    expect(r.notes).toContain('chapters omitted');
  });

  it('trims tags to the ~500-character TOTAL budget, not a count cap', async () => {
    const { provider, reqs } = recorder();
    __setYouTube(provider as any);
    const s = base('pub_tags');
    s.concept.keywords = Array.from({ length: 60 }, (_, i) => `long keyword number ${i} padding`);
    await publishing.run(ctxFor(s));
    const tags = reqs.uploads[0].tags as string[];
    const total = tags.reduce((n, t) => n + t.length + (t.includes(' ') ? 2 : 0), 0);
    expect(total).toBeLessThanOrEqual(500);
    expect(tags.length).toBeLessThan(60);
    expect(tags.length).toBeGreaterThan(0);
  });

  it('truncates the description at a line boundary, keeps ≤5000 chars and the AI note', async () => {
    const { provider, reqs } = recorder();
    __setYouTube(provider as any);
    const s = base('pub_desc');
    const line = 'x'.repeat(80);
    s.packaging.descriptions = [Array.from({ length: 100 }, () => line).join('\n')]; // ~8100 chars
    const r = await publishing.run(ctxFor(s));
    const desc = reqs.uploads[0].description as string;
    expect(desc.length).toBeLessThanOrEqual(5000);
    // every surviving line is complete — nothing was cut mid-line/mid-chapter
    const known = new Set([line, '', 'This video contains AI-generated content.', 'Chapters:', ...(r.writes.publish?.chapters ?? [])]);
    expect(desc.split('\n').every((l) => known.has(l))).toBe(true);
    // the disclosure + chapter block are budgeted before the prose, so truncation never drops them
    expect(desc).toContain('This video contains AI-generated content.');
    expect(desc).toContain('Chapters:\n0:00 Chapter 1');
  });

  it('passes the AI disclosure through to the upload metadata honestly', async () => {
    const { provider, reqs } = recorder();
    __setYouTube(provider as any);
    const r = await publishing.run(ctxFor(base('pub_ai')));
    expect(reqs.uploads[0].containsSyntheticMedia).toBe(true);
    expect(r.writes.publish?.ai_label_applied).toBe(true);

    const s2 = base('pub_no_ai');
    s2.qa.ai_disclosure_required = false;
    const r2 = await publishing.run(ctxFor(s2));
    expect(reqs.uploads[1].containsSyntheticMedia).toBe(false);
    expect(r2.writes.publish?.ai_label_applied).toBe(false);
    expect(reqs.uploads[1].description).not.toContain('AI-generated');
  });

  it('fails the precondition when QA has not passed', async () => {
    __setYouTube(recorder().provider as any);
    const s = base('pub_noqa');
    s.qa.passed = false;
    const r = await publishing.run(ctxFor(s));
    expect(r.status).toBe('failed');
    expect(r.notes).toContain('precondition');
  });
});

describe('publishing side effects', () => {
  it('records the episode into channel memory (mock path: no published_at/video id)', async () => {
    __setYouTube(recorder({ uploaded: false }).provider as any);
    await publishing.run(ctxFor(base('pub_mem')));
    const mem = loadChannelMemory();
    const e = mem.episodes.find((x) => x.episode_id === 'pub_mem');
    expect(e).toBeDefined();
    expect(e?.topic).toBe('sleep science');
    expect(e?.title).toBe('My Packaged Title');
    expect(e?.angle).toBe('why common sleep advice backfires');
    expect(e?.keywords).toEqual(['sleep', 'deep sleep', 'energy']);
    expect(e?.published_at).toBe('');
    expect(e?.youtube_video_id).toBe('');
  });

  it('records the real video id and published_at after a real upload', async () => {
    __setYouTube(recorder({ uploaded: true }).provider as any);
    await publishing.run(ctxFor(base('pub_mem_live')));
    const e = loadChannelMemory().episodes.find((x) => x.episode_id === 'pub_mem_live');
    expect(e?.youtube_video_id).toBe('vid_1');
    expect(e?.published_at).not.toBe('');
  });

  it('uploads the caption track and thumbnail after a real upload when real files exist', async () => {
    const { provider, reqs } = recorder({ uploaded: true });
    __setYouTube(provider as any);
    const srt = join(tmp, 'caps.srt');
    writeFileSync(srt, '1\n00:00:00,000 --> 00:00:02,000\nhi\n');
    const png = join(tmp, 'thumb.png');
    writeFileSync(png, 'png');
    const s = base('pub_caps');
    s.captions = { srt_uri: srt, vtt_uri: '', cue_count: 1 };
    s.packaging.thumbnails = [png];
    const r = await publishing.run(ctxFor(s));
    expect(reqs.captions).toEqual([['vid_1', srt, 'en']]);
    expect(reqs.thumbnails).toEqual([['vid_1', png]]);
    expect(r.notes).toContain('captions(en)');
    expect(r.notes).toContain('thumbnail');
  });

  it('skips caption/thumbnail uploads on the mock (no-upload) path', async () => {
    const { provider, reqs } = recorder({ uploaded: false });
    __setYouTube(provider as any);
    const srt = join(tmp, 'caps2.srt');
    writeFileSync(srt, '1\n00:00:00,000 --> 00:00:01,000\nhi\n');
    const s = base('pub_caps_mock');
    s.captions = { srt_uri: srt, vtt_uri: '', cue_count: 1 };
    await publishing.run(ctxFor(s));
    expect(reqs.captions.length).toBe(0);
    expect(reqs.thumbnails.length).toBe(0);
  });
});
