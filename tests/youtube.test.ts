import { describe, it, expect, vi, afterEach } from 'vitest';
import { writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RealYouTube } from '../src/media/youtube.js';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; vi.restoreAllMocks(); });

describe('RealYouTube (resumable upload)', () => {
  it('initiates a resumable session then PUTs the file and returns the video id', async () => {
    const f = join(tmpdir(), `yt_${Date.now()}.mp4`);
    writeFileSync(f, Buffer.from('fake-mp4-bytes'));
    globalThis.fetch = vi.fn(async (_url: any, init: any) => {
      if ((init?.method ?? 'GET') === 'POST') {
        return { ok: true, status: 200, headers: { get: (h: string) => (h.toLowerCase() === 'location' ? 'https://upload.youtube/session/abc' : null) }, text: async () => '' } as any;
      }
      return { ok: true, status: 200, json: async () => ({ id: 'yt_video_42' }), text: async () => '' } as any;
    }) as any;

    const yt = new RealYouTube(async () => 'token');
    const res = await yt.upload({ filePath: f, title: 'Hello', description: 'desc', tags: ['a', 'b'] });
    expect(res.uploaded).toBe(true);
    expect(res.videoId).toBe('yt_video_42');
    const calls = (globalThis.fetch as any).mock.calls.map((c: any[]) => `${c[1]?.method ?? 'GET'} ${c[0]}`);
    expect(calls.some((c: string) => c.startsWith('POST') && c.includes('uploadType=resumable'))).toBe(true);
    expect(calls.some((c: string) => c.startsWith('PUT') && c.includes('upload.youtube/session/abc'))).toBe(true);
    rmSync(f, { force: true });
  });

  it('skips upload (no real file) but still returns an id', async () => {
    globalThis.fetch = vi.fn() as any;
    const yt = new RealYouTube(async () => 'token');
    const res = await yt.upload({ filePath: '/nope/missing.mp4', title: 'T', description: 'd', tags: [] });
    expect(res.uploaded).toBe(false);
    expect((globalThis.fetch as any).mock.calls.length).toBe(0);
  });
});
