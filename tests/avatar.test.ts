import { describe, it, expect, vi, afterEach } from 'vitest';
import { HeyGenAvatar } from '../src/media/avatar.js';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; vi.restoreAllMocks(); });

function mockFetch(post: any, get: any) {
  globalThis.fetch = vi.fn(async (_url: any, init: any) => {
    const body = (init?.method ?? 'GET') === 'POST' ? post : get;
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as any;
  }) as any;
}

describe('HeyGenAvatar (real API flow)', () => {
  it('creates a video then polls to completed and returns the url', async () => {
    mockFetch({ error: null, data: { video_id: 'vid_9' } }, { data: { status: 'completed', video_url: 'https://cdn.heygen/v.mp4', duration: 6 } });
    const hg = new HeyGenAvatar('key');
    const art = await hg.generate({ text: 'hello world from the host', avatarId: 'av_1', voiceId: 'vo_1', durationS: 6 });
    expect(art.uri).toBe('https://cdn.heygen/v.mp4');
    expect(art.durationS).toBe(6);
    expect(art.costUsd).toBeGreaterThan(0);
    const calls = (globalThis.fetch as any).mock.calls.map((c: any[]) => `${c[1]?.method ?? 'GET'} ${c[0]}`);
    expect(calls.some((c: string) => c.startsWith('POST') && c.includes('/v2/video/generate'))).toBe(true);
    expect(calls.some((c: string) => c.includes('/v1/video_status.get'))).toBe(true);
  });

  it('throws when the video fails', async () => {
    mockFetch({ error: null, data: { video_id: 'vid_x' } }, { data: { status: 'failed', error: { msg: 'bad' } } });
    const hg = new HeyGenAvatar('key');
    await expect(hg.generate({ text: 'x', avatarId: 'a', voiceId: 'v', durationS: 4 })).rejects.toThrow(/failed/i);
  });
});
