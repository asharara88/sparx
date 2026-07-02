import { describe, it, expect, vi, afterEach } from 'vitest';
import { RunwayVideo, __setVideo, type VideoProvider } from '../src/media/video.js';
import { videoGeneration } from '../src/agents/videoGeneration.js';
import { newEpisodeState, type Shot } from '../src/types/episode.js';
import type { MediaArtifact } from '../src/media/types.js';
import { ctxFor } from './helpers.js';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; __setVideo(null); vi.restoreAllMocks(); });

function mockFetch(handlers: { post: any; get: any }) {
  globalThis.fetch = vi.fn(async (url: any, init: any) => {
    const u = String(url); const method = init?.method ?? 'GET';
    const body = method === 'POST' ? handlers.post : handlers.get;
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as any;
  }) as any;
}

describe('RunwayVideo (real API flow)', () => {
  it('submits a task then polls to SUCCEEDED and returns the output url', async () => {
    mockFetch({ post: { id: 'task_1' }, get: { id: 'task_1', status: 'SUCCEEDED', output: ['https://cdn.runway/vid.mp4'] } });
    const rw = new RunwayVideo('test-key');
    const arts = await rw.generate({ prompt: 'a calm ocean', model: 'runway', durationS: 4, takes: 1 });
    expect(arts).toHaveLength(1);
    expect(arts[0]!.uri).toBe('https://cdn.runway/vid.mp4');
    expect(arts[0]!.costUsd).toBeGreaterThan(0);
    // verify it called POST image_to_video then GET tasks/
    const calls = (globalThis.fetch as any).mock.calls.map((c: any[]) => `${c[1]?.method ?? 'GET'} ${c[0]}`);
    expect(calls.some((c: string) => c.startsWith('POST') && c.includes('/v1/image_to_video'))).toBe(true);
    expect(calls.some((c: string) => c.startsWith('GET') && c.includes('/v1/tasks/task_1'))).toBe(true);
  });

  it('throws when the task FAILS', async () => {
    mockFetch({ post: { id: 'task_2' }, get: { id: 'task_2', status: 'FAILED', failureCode: 'SAFETY', failure: 'blocked' } });
    const rw = new RunwayVideo('test-key');
    await expect(rw.generate({ prompt: 'x', model: 'runway', durationS: 4, takes: 1 })).rejects.toThrow(/failed/i);
  });

  it('throws immediately on a non-transient 4xx without retrying', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 400, json: async () => ({}), text: async () => 'bad ratio' } as any)) as any;
    const rw = new RunwayVideo('test-key');
    await expect(rw.generate({ prompt: 'x', model: 'runway', durationS: 4, takes: 1 })).rejects.toThrow(/400/);
    expect((globalThis.fetch as any).mock.calls).toHaveLength(1); // the old copy-pasted retry loop burned 3 attempts on 4xx
  });
});

// ---- video_generation agent (defineAgent runtime + parallel dispatch) ----

const uniq = () => `${Date.now()}_${Math.random().toString(36).slice(2)}`; // cache-busting prompts (artifact cache is content-keyed)

function genShot(id: string, prompt: string, durationS = 4): Shot {
  return { shot_id: id, section_id: `sec_${id}`, source: 'generated', duration_s: durationS, prompt: { runway: prompt }, selected_asset: null, cost_estimate_usd: 0.2 };
}

function stubProvider(opts: { costPerTake?: number; failFor?: Set<string>; onCall?: () => Promise<void> } = {}): VideoProvider & { maxInFlight: number; calls: number } {
  let inFlight = 0;
  const p = {
    name: 'stub', live: false, maxInFlight: 0, calls: 0,
    async generate(req: { prompt: string; durationS: number; takes?: number }): Promise<MediaArtifact[]> {
      p.calls++; inFlight++; p.maxInFlight = Math.max(p.maxInFlight, inFlight);
      await opts.onCall?.();
      inFlight--;
      if (opts.failFor && [...opts.failFor].some((f) => req.prompt.includes(f))) throw new Error('provider exploded');
      return Array.from({ length: req.takes ?? 1 }, (_, i) => ({ uri: `mock://video/stub/${encodeURIComponent(req.prompt).slice(0, 16)}_${i}.mp4`, durationS: req.durationS, costUsd: opts.costPerTake ?? 0, license: 'mock' }));
    },
  };
  return p as any;
}

describe('videoGeneration agent', () => {
  it('generates shots in parallel (bounded), selects a take, and reports cost', async () => {
    const marker = uniq();
    const provider = stubProvider({ costPerTake: 0.1, onCall: () => new Promise((r) => setTimeout(r, 20)) });
    __setVideo(provider);
    const s = newEpisodeState('ep_vg1');
    s.shot_list = Array.from({ length: 6 }, (_, i) => genShot(`sh${i}`, `prompt ${marker} ${i}`));
    const r = await videoGeneration.run(ctxFor(s));
    expect(r.status).toBe('ok');
    expect(r.writes.generated_video).toHaveLength(6);
    expect(provider.maxInFlight).toBeGreaterThanOrEqual(2); // was a serial for-loop: sum of polls, not max
    expect(provider.maxInFlight).toBeLessThanOrEqual(4);    // MEDIA_CONCURRENCY bound
    expect(r.writes.generated_video![0]!.selected_uri).toContain('mock://video/stub/');
    expect(r.cost_usd).toBeCloseTo(6 * 2 * 0.1); // 2 takes per shot from the stub
  });

  it('skips shots whose pessimistic estimate crosses the remaining budget, with a note', async () => {
    const marker = uniq();
    const provider = stubProvider();
    __setVideo(provider);
    const s = newEpisodeState('ep_vg2');
    // per-shot estimate: 2 takes * (10s * $0.05 + $0.08 image) = $1.16 → cap fits exactly one
    s.budget.cap_usd_month = 1.5;
    s.shot_list = [genShot('sh0', `a ${marker}`, 10), genShot('sh1', `b ${marker}`, 10)];
    const r = await videoGeneration.run(ctxFor(s));
    expect(r.status).toBe('ok');
    expect(r.writes.generated_video).toHaveLength(1);
    expect(provider.calls).toBe(1); // throttled shot never dispatched
    expect(r.notes).toMatch(/over budget/);
    expect(r.notes).toContain('sh1');
  });

  it('degrades a failed shot to a skip (notes) instead of failing the batch', async () => {
    const marker = uniq();
    const provider = stubProvider({ failFor: new Set(['boom']) });
    __setVideo(provider);
    const s = newEpisodeState('ep_vg3');
    s.shot_list = [genShot('sh0', `fine ${marker}`), genShot('sh1', `boom ${marker}`)];
    const r = await videoGeneration.run(ctxFor(s));
    expect(r.status).toBe('ok');
    expect(r.writes.generated_video!.map((g) => g.shot_id)).toEqual(['sh0']);
    expect(r.notes).toMatch(/1 failed: sh1/);
  });
});
