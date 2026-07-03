// Approximate per-MTok USD pricing for cost accounting (input, output).
// Adjust to current rates; only used to populate the budget ledger estimate.
const PRICES: Record<string, { in: number; out: number }> = {
  'claude-fable-5': { in: 10, out: 50 },
  'claude-opus-4-8': { in: 5, out: 25 },
  'claude-sonnet-5': { in: 3, out: 15 },
  'claude-sonnet-4-6': { in: 3, out: 15 },
  'claude-haiku-4-5-20251001': { in: 1, out: 5 },
};
export function costFor(model: string, inputTokens: number, outputTokens: number): number {
  // Prefix match covers dated/versioned ids the API may echo back (e.g. a
  // server-side fallback reporting 'claude-opus-4-8-<date>') — an exact-only
  // lookup silently priced those at the Sonnet default, 3-5x under Opus/Fable.
  const p = PRICES[model]
    ?? Object.entries(PRICES).find(([k]) => model.startsWith(k))?.[1]
    ?? { in: 3, out: 15 };
  const usd = (inputTokens / 1e6) * p.in + (outputTokens / 1e6) * p.out;
  return Math.round(usd * 1e4) / 1e4;
}
