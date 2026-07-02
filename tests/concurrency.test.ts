import { describe, it, expect } from 'vitest';
import { mapLimit } from '../src/util/concurrency.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('mapLimit', () => {
  it('preserves item order in the results', async () => {
    const out = await mapLimit([50, 10, 30], 3, async (ms) => { await sleep(ms); return ms; });
    expect(out).toEqual([50, 10, 30]);
  });

  it('never exceeds the concurrency cap', async () => {
    let inFlight = 0; let peak = 0;
    await mapLimit(Array.from({ length: 8 }, (_, i) => i), 2, async () => {
      inFlight++; peak = Math.max(peak, inFlight);
      await sleep(10);
      inFlight--;
    });
    expect(peak).toBe(2);
  });

  it('rejects when fn rejects (callers isolate failures inside fn)', async () => {
    await expect(mapLimit([1, 2], 2, async (n) => { if (n === 2) throw new Error('boom'); return n; })).rejects.toThrow('boom');
  });

  it('handles empty input and limit larger than items', async () => {
    expect(await mapLimit([], 4, async (n) => n)).toEqual([]);
    expect(await mapLimit([1], 8, async (n) => n * 2)).toEqual([2]);
  });
});
