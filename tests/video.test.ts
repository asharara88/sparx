import { describe, it, expect, vi, afterEach } from 'vitest';
import { RunwayVideo } from '../src/media/video.js';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; vi.restoreAllMocks(); });

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
});
