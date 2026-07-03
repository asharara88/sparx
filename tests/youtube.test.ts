import { describe, it, expect, vi, afterEach } from 'vitest';
import { writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RealYouTube, __setYouTube, getYouTube } from '../src/media/youtube.js';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; __setYouTube(null); vi.restoreAllMocks(); });

// Response stubs shaped for fetchWithRetry (it reads ok/status/headers/text/json).
function res(over: Partial<{ ok: boolean; status: number; location: string | null; json: unknown }> = {}) {
  return {
    ok: over.ok ?? true,
    status: over.status ?? 200,
    headers: {
      get: (h: string) => {
        if (h.toLowerCase() === 'location') return over.location ?? null;
        if (h.toLowerCase() === 'retry-after') return '0'; // keep transient-retry tests fast
        return null;
      },
    },
    json: async () => over.json ?? {},
    text: async () => '',
  } as any;
}

describe('RealYouTube (resumable upload)', () => {
  it('initiates a resumable session then PUTs the file and returns the video id', async () => {
    const f = join(tmpdir(), `yt_${Date.now()}.mp4`);
    writeFileSync(f, Buffer.from('fake-mp4-bytes'));
    globalThis.fetch = vi.fn(async (_url: any, init: any) => {
      if ((init?.method ?? 'GET') === 'POST') return res({ location: 'https://upload.youtube/session/abc' });
      return res({ json: { id: 'yt_video_42' } });
    }) as any;

    const yt = new RealYouTube(async () => 'token');
    const r = await yt.upload({ filePath: f, title: 'Hello', description: 'desc', tags: ['a', 'b'], containsSyntheticMedia: true });
    expect(r.uploaded).toBe(true);
    expect(r.videoId).toBe('yt_video_42');
    const calls = (globalThis.fetch as any).mock.calls;
    const urls = calls.map((c: any[]) => `${c[1]?.method ?? 'GET'} ${c[0]}`);
    expect(urls.some((c: string) => c.startsWith('POST') && c.includes('uploadType=resumable'))).toBe(true);
    expect(urls.some((c: string) => c.startsWith('PUT') && c.includes('upload.youtube/session/abc'))).toBe(true);
    // synthetic-media declaration lands on the insert metadata, not the description
    const initBody = JSON.parse(calls.find((c: any[]) => c[1]?.method === 'POST')![1].body);
    expect(initBody.status.containsSyntheticMedia).toBe(true);
    rmSync(f, { force: true });
  });

  it('retries a transient init failure before succeeding', async () => {
    const f = join(tmpdir(), `yt_retry_${Date.now()}.mp4`);
    writeFileSync(f, Buffer.from('fake-mp4-bytes'));
    let posts = 0;
    globalThis.fetch = vi.fn(async (_url: any, init: any) => {
      if ((init?.method ?? 'GET') === 'POST') {
        posts++;
        if (posts === 1) return res({ ok: false, status: 503 });
        return res({ location: 'https://upload.youtube/session/retry' });
      }
      return res({ json: { id: 'yt_video_retry' } });
    }) as any;

    const yt = new RealYouTube(async () => 'token');
    const r = await yt.upload({ filePath: f, title: 'Retry', description: 'd', tags: [] });
    expect(r.videoId).toBe('yt_video_retry');
    expect(posts).toBe(2);
    rmSync(f, { force: true });
  });

  it('skips upload (no real file) but still returns an id', async () => {
    globalThis.fetch = vi.fn() as any;
    const yt = new RealYouTube(async () => 'token');
    const r = await yt.upload({ filePath: '/nope/missing.mp4', title: 'T', description: 'd', tags: [] });
    expect(r.uploaded).toBe(false);
    expect((globalThis.fetch as any).mock.calls.length).toBe(0);
  });
});

describe('RealYouTube (thumbnail + captions)', () => {
  it('POSTs the thumbnail bytes to thumbnails.set', async () => {
    const f = join(tmpdir(), `yt_thumb_${Date.now()}.png`);
    writeFileSync(f, Buffer.from('png-bytes'));
    globalThis.fetch = vi.fn(async () => res({ json: { items: [{ default: { url: 'https://i.ytimg.com/vi/x/default.jpg' } }] } })) as any;

    const yt = new RealYouTube(async () => 'token');
    const r = await yt.uploadThumbnail('vid1', f);
    expect(r.uploaded).toBe(true);
    expect(r.ref).toBe('https://i.ytimg.com/vi/x/default.jpg');
    const [url, init] = (globalThis.fetch as any).mock.calls[0];
    expect(String(url)).toContain('thumbnails/set?videoId=vid1');
    expect(init.headers['Content-Type']).toBe('image/png');
    rmSync(f, { force: true });
  });

  it('inserts a caption track as multipart/related with snippet + srt payload', async () => {
    const f = join(tmpdir(), `yt_caps_${Date.now()}.srt`);
    writeFileSync(f, '1\n00:00:00,000 --> 00:00:02,000\nhello\n');
    globalThis.fetch = vi.fn(async () => res({ json: { id: 'cap_1' } })) as any;

    const yt = new RealYouTube(async () => 'token');
    const r = await yt.uploadCaptions('vid1', f, 'en');
    expect(r.uploaded).toBe(true);
    expect(r.ref).toBe('cap_1');
    const [url, init] = (globalThis.fetch as any).mock.calls[0];
    expect(String(url)).toContain('/captions?part=snippet');
    expect(init.headers['Content-Type']).toContain('multipart/related');
    expect(init.body).toContain('"videoId":"vid1"');
    expect(init.body).toContain('00:00:00,000 --> 00:00:02,000');
    rmSync(f, { force: true });
  });

  it('degrades to uploaded:false when the local file is missing (no network call)', async () => {
    globalThis.fetch = vi.fn() as any;
    const yt = new RealYouTube(async () => 'token');
    expect((await yt.uploadThumbnail('vid1', '/nope/t.png')).uploaded).toBe(false);
    expect((await yt.uploadCaptions('vid1', '/nope/c.srt', 'en')).uploaded).toBe(false);
    expect((globalThis.fetch as any).mock.calls.length).toBe(0);
  });
});

describe('MockYouTube (zero-key path)', () => {
  it('returns mock refs for upload, thumbnail, and captions without touching the network', async () => {
    globalThis.fetch = vi.fn() as any;
    __setYouTube(null);
    const yt = getYouTube(); // no YOUTUBE_* env in tests → mock provider
    expect(yt.live).toBe(false);
    const up = await yt.upload({ title: 'T', description: 'd', tags: [] });
    expect(up.uploaded).toBe(false);
    expect(up.videoId).toMatch(/^mock_/);
    expect((await yt.uploadThumbnail(up.videoId, '/x.png')).ref).toContain('mock://');
    expect((await yt.uploadCaptions(up.videoId, '/x.srt', 'en')).ref).toContain('mock://');
    expect((globalThis.fetch as any).mock.calls.length).toBe(0);
  });
});
