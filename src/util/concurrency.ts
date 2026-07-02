// Bounded-parallelism helpers. The state machine parallelizes across agents;
// these parallelize *within* an agent (per-section narration, per-shot video,
// per-thumbnail render) so a stage's wall clock is ~max(item) instead of sum.

/** Map items → results with at most `limit` promises in flight. Order-preserving; rejects on first error. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  if (items.length === 0) return [];
  const bound = Math.max(1, Math.min(limit, items.length));
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!, i);
    }
  }
  await Promise.all(Array.from({ length: bound }, worker));
  return results;
}

export interface Settled<T, R> {
  ok: { item: T; index: number; value: R }[];
  failed: { item: T; index: number; error: unknown }[];
}

/**
 * Like mapLimit but never rejects: collects successes and failures separately.
 * For per-item media work where one provider failure shouldn't sink the batch
 * (the agent decides whether the failure count crosses its threshold).
 */
export async function settleLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<Settled<T, R>> {
  const out: Settled<T, R> = { ok: [], failed: [] };
  await mapLimit(items, limit, async (item, index) => {
    try {
      const value = await fn(item, index);
      out.ok.push({ item, index, value });
    } catch (error) {
      out.failed.push({ item, index, error });
    }
  });
  // mapLimit workers interleave; restore input order for deterministic output.
  out.ok.sort((a, b) => a.index - b.index);
  out.failed.sort((a, b) => a.index - b.index);
  return out;
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
