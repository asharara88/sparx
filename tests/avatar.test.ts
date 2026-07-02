import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HeyGenAvatar, resolveAvatarVoice, __setAvatar, type AvatarProvider } from '../src/media/avatar.js';
import { avatar } from '../src/agents/avatar.js';
import { newEpisodeState, type Shot, type ScriptSection } from '../src/types/episode.js';
import type { MediaArtifact } from '../src/media/types.js';
import { config } from '../src/config.js';
import { ctxFor } from './helpers.js';

const realFetch = globalThis.fetch;
delete process.env.HEYGEN_AVATAR_ID; // agent tests assert the empty-id default (runs before the config cache is primed)
afterEach(() => { globalThis.fetch = realFetch; __setAvatar(null); vi.restoreAllMocks(); });

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

  it('throws immediately on a non-transient 4xx without retrying', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}), text: async () => 'bad key' } as any)) as any;
    const hg = new HeyGenAvatar('key');
    await expect(hg.generate({ text: 'x', avatarId: 'a', voiceId: 'v', durationS: 4 })).rejects.toThrow(/401/);
    expect((globalThis.fetch as any).mock.calls).toHaveLength(1); // the old req() retried 4xx with backoff
  });

  it('throws when completed without a video_url instead of shipping an empty uri', async () => {
    mockFetch({ error: null, data: { video_id: 'vid_e' } }, { data: { status: 'completed', duration: 5 } });
    await expect(new HeyGenAvatar('key').generate({ text: 'x', avatarId: 'a', voiceId: 'v', durationS: 4 })).rejects.toThrow(/video_url/);
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

// ---- avatar agent (defineAgent runtime + parallel dispatch) ----

const uniq = () => `${Date.now()}_${Math.random().toString(36).slice(2)}`; // cache-busting text (artifact cache is content-keyed)

function avatarShot(id: string, sectionId: string, durationS = 6): Shot {
  return { shot_id: id, section_id: sectionId, source: 'avatar', duration_s: durationS, prompt: {}, selected_asset: null, cost_estimate_usd: 0 };
}
function section(id: string, vo_text: string): ScriptSection {
  return { id, beat: 'payoff', vo_text, shot_note: '', on_screen: '', retention_device: '' };
}

function stubProvider(opts: { live?: boolean; costUsd?: number } = {}): AvatarProvider & { maxInFlight: number; calls: number } {
  let inFlight = 0;
  const p = {
    name: 'stub', live: opts.live ?? false, maxInFlight: 0, calls: 0,
    async generate(req: { text: string; durationS: number }): Promise<MediaArtifact> {
      p.calls++; inFlight++; p.maxInFlight = Math.max(p.maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 20));
      inFlight--;
      return { uri: `mock://avatar/stub/${encodeURIComponent(req.text).slice(0, 12)}.mp4`, durationS: req.durationS, costUsd: opts.costUsd ?? 0, license: 'mock' };
    },
  };
  return p as any;
}

describe('avatar agent', () => {
  it('renders avatar shots in parallel and skips shots without narration', async () => {
    const marker = uniq();
    const provider = stubProvider({ costUsd: 0.05 });
    __setAvatar(provider);
    const s = newEpisodeState('ep_av1', { host_mode: 'avatar' });
    s.script.sections = [section('s1', `alpha ${marker}`), section('s2', `beta ${marker}`), section('s3', `gamma ${marker}`)];
    s.shot_list = [avatarShot('sh1', 's1'), avatarShot('sh2', 's2'), avatarShot('sh3', 's3'), avatarShot('sh4', 's_missing')];
    const r = await avatar.run(ctxFor(s));
    expect(r.status).toBe('ok');
    expect(r.writes.avatar_clips).toHaveLength(3);
    expect(provider.maxInFlight).toBeGreaterThanOrEqual(2); // was a serial loop over multi-minute polls
    expect(r.cost_usd).toBeCloseTo(3 * 0.05);
    expect(r.notes).toMatch(/1 without narration: sh4/);
  });

  it('uses the measured VO duration as the cost basis and throttles over-budget LIVE shots', async () => {
    const marker = uniq();
    const provider = stubProvider({ live: true }); // the budget gate only applies to live spend
    __setAvatar(provider);
    // live provider needs an avatar id or the agent escalates before the gate;
    // config caches on first read, so patch the cached object for this test.
    const c = config() as unknown as { HEYGEN_AVATAR_ID: string };
    const prevId = c.HEYGEN_AVATAR_ID;
    c.HEYGEN_AVATAR_ID = 'av_test';
    try {
      const s = newEpisodeState('ep_av2', { host_mode: 'avatar' });
      s.script.sections = [section('s1', `one ${marker}`), section('s2', `two ${marker}`)];
      s.shot_list = [avatarShot('sh1', 's1', 5), avatarShot('sh2', 's2', 5)];
      // VO says each section actually speaks 10 min → $3/clip at $0.30/min; cap fits one
      s.voiceover.clips = [{ section_id: 's1', audio_uri: 'a', duration_s: 600 }, { section_id: 's2', audio_uri: 'b', duration_s: 600 }];
      s.budget.cap_usd_month = 4;
      const r = await avatar.run(ctxFor(s));
      expect(r.status).toBe('ok');
      expect(r.writes.avatar_clips).toHaveLength(1);
      expect(provider.calls).toBe(1); // throttled shot never dispatched
      expect(r.notes).toMatch(/over budget/);
    } finally {
      c.HEYGEN_AVATAR_ID = prevId;
    }
  });

  it('never budget-gates a mock ($0) provider, even under a tiny cap', async () => {
    const marker = uniq();
    const provider = stubProvider(); // live: false
    __setAvatar(provider);
    const s = newEpisodeState('ep_av4', { host_mode: 'avatar' });
    s.script.sections = [section('s1', `uno ${marker}`), section('s2', `dos ${marker}`)];
    s.shot_list = [avatarShot('sh1', 's1', 5), avatarShot('sh2', 's2', 5)];
    s.voiceover.clips = [{ section_id: 's1', audio_uri: 'a', duration_s: 600 }, { section_id: 's2', audio_uri: 'b', duration_s: 600 }];
    s.budget.cap_usd_month = 0.01; // would throttle everything if the gate ran
    const r = await avatar.run(ctxFor(s));
    expect(r.status).toBe('ok');
    expect(r.writes.avatar_clips).toHaveLength(2); // mock shots are free — none skipped
    expect(r.notes).not.toMatch(/over budget/);
  });

  it('escalates to needs_human when a live provider has no avatar id configured', async () => {
    const marker = uniq();
    __setAvatar(stubProvider({ live: true })); // live path; config HEYGEN_AVATAR_ID defaults to ''
    const s = newEpisodeState('ep_av3', { host_mode: 'avatar' });
    s.script.sections = [section('s1', `solo ${marker}`)];
    s.shot_list = [avatarShot('sh1', 's1')];
    const r = await avatar.run(ctxFor(s));
    expect(r.status).toBe('needs_human');
    expect(r.notes).toMatch(/HEYGEN_AVATAR_ID/);
    expect(r.writes.avatar_clips).toEqual([]);
  });
});
