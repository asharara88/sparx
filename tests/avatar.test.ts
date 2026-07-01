import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HeyGenAvatar, resolveAvatarVoice } from '../src/media/avatar.js';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; vi.restoreAllMocks(); });

function mockFetch(post: any, get: any) {
  globalThis.fetch = vi.fn(async (_url: any, init: any) => {
    const body = (init?.method ?? 'GET') === 'POST' ? post : get;
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as any;
  }) as any;
}

// Routes by url so the upload endpoint, generate, and status poll can each answer differently.
function mockRoutedFetch() {
  const calls: { url: string; init: any }[] = [];
  globalThis.fetch = vi.fn(async (url: any, init: any) => {
    const u = String(url);
    calls.push({ url: u, init });
    let body: any;
    if (u.includes('upload.heygen.com')) body = { data: { id: 'asset_7' } };
    else if (u.includes('/v2/video/generate')) body = { error: null, data: { video_id: 'vid_a' } };
    else body = { data: { status: 'completed', video_url: 'https://cdn.heygen/a.mp4', duration: 5 } };
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as any;
  }) as any;
  return calls;
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

  it('uses text TTS voice when no audioUri is given', async () => {
    const calls = mockRoutedFetch();
    const hg = new HeyGenAvatar('key');
    await hg.generate({ text: 'hello there', avatarId: 'av', voiceId: 'vo_1', durationS: 5 });
    const gen = calls.find((c) => c.url.includes('/v2/video/generate'))!;
    expect(JSON.parse(gen.init.body).video_inputs[0].voice).toEqual({ type: 'text', input_text: 'hello there', voice_id: 'vo_1' });
    expect(calls.some((c) => c.url.includes('upload.heygen.com'))).toBe(false);
  });

  it('uploads local narration audio and lip-syncs via audio_asset_id', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sparx-avatar-'));
    const audioPath = join(dir, 'clip.mp3');
    writeFileSync(audioPath, Buffer.from('mp3-bytes'));
    const calls = mockRoutedFetch();
    const hg = new HeyGenAvatar('key');
    const art = await hg.generate({ text: 'hello', avatarId: 'av', voiceId: 'vo', durationS: 5, audioUri: audioPath });
    expect(art.uri).toBe('https://cdn.heygen/a.mp4');
    const upload = calls.find((c) => c.url.includes('upload.heygen.com'))!;
    expect(upload.url).toContain('/v1/asset');
    expect(upload.init.headers['Content-Type']).toBe('audio/mpeg');
    const gen = calls.find((c) => c.url.includes('/v2/video/generate'))!;
    expect(JSON.parse(gen.init.body).video_inputs[0].voice).toEqual({ type: 'audio', audio_asset_id: 'asset_7' });
  });

  it('passes a remote audio url straight through without uploading', async () => {
    const calls = mockRoutedFetch();
    const hg = new HeyGenAvatar('key');
    await hg.generate({ text: 'hello', avatarId: 'av', voiceId: 'vo', durationS: 5, audioUri: 'https://cdn.example/vo.mp3' });
    expect(calls.some((c) => c.url.includes('upload.heygen.com'))).toBe(false);
    const gen = calls.find((c) => c.url.includes('/v2/video/generate'))!;
    expect(JSON.parse(gen.init.body).video_inputs[0].voice).toEqual({ type: 'audio', audio_url: 'https://cdn.example/vo.mp3' });
  });
});

describe('resolveAvatarVoice', () => {
  it('auto prefers elevenlabs when the voice provider is live', () => {
    expect(resolveAvatarVoice('auto', true)).toBe('elevenlabs');
    expect(resolveAvatarVoice('auto', false)).toBe('heygen');
  });
  it('heygen always wins; elevenlabs falls back to heygen when the voice is mock', () => {
    expect(resolveAvatarVoice('heygen', true)).toBe('heygen');
    expect(resolveAvatarVoice('elevenlabs', true)).toBe('elevenlabs');
    expect(resolveAvatarVoice('elevenlabs', false)).toBe('heygen');
  });
});
