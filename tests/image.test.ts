import { describe, it, expect, vi, afterEach } from 'vitest';
import { RunwayImage } from '../src/media/image.js';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; vi.restoreAllMocks(); });

function mockFetch(post: any, get: any) {
  globalThis.fetch = vi.fn(async (_url: any, init: any) => {
    const body = (init?.method ?? 'GET') === 'POST' ? post : get;
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as any;
  }) as any;
}

describe('RunwayImage (gen4_image flow)', () => {
  it('submits text_to_image then polls to SUCCEEDED and returns the image url', async () => {
    mockFetch({ id: 'img_1' }, { id: 'img_1', status: 'SUCCEEDED', output: ['https://cdn.runway/thumb.png'] });
    const ri = new RunwayImage('key');
    const art = await ri.generate({ prompt: 'bold youtube thumbnail' });
    expect(art.uri).toBe('https://cdn.runway/thumb.png');
    expect(art.costUsd).toBeGreaterThan(0);
    const calls = (globalThis.fetch as any).mock.calls.map((c: any[]) => `${c[1]?.method ?? 'GET'} ${c[0]}`);
    expect(calls.some((c: string) => c.startsWith('POST') && c.includes('/v1/text_to_image'))).toBe(true);
    expect(calls.some((c: string) => c.includes('/v1/tasks/img_1'))).toBe(true);
  });
  it('throws on FAILED', async () => {
    mockFetch({ id: 'img_2' }, { id: 'img_2', status: 'FAILED', failure: 'nope' });
    await expect(new RunwayImage('key').generate({ prompt: 'x' })).rejects.toThrow(/failed/i);
  });
  it('throws immediately on a non-transient 4xx without retrying', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 403, json: async () => ({}), text: async () => 'forbidden' } as any)) as any;
    await expect(new RunwayImage('key').generate({ prompt: 'x' })).rejects.toThrow(/403/);
    expect((globalThis.fetch as any).mock.calls).toHaveLength(1); // the old req() retried 4xx with backoff
  });
});
