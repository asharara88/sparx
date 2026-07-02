import { describe, it, expect, afterEach } from 'vitest';
import { factChecker } from '../src/agents/factChecker.js';
import { newEpisodeState } from '../src/types/episode.js';
import { __setLLM, type LLM, type CompleteArgs, type CompleteResult } from '../src/llm/client.js';
import { __setWebSearch, type WebSearchProvider } from '../src/skills/research/webSearch.js';
import { ctxFor } from './helpers.js';

afterEach(() => { __setLLM(null); __setWebSearch(null); });

function base(vo = 'Some narration.') {
  const s = newEpisodeState('fc1');
  s.script.hook = 'The hook';
  s.script.sections = [{ id: 's1', beat: 'open', vo_text: vo, shot_note: '', on_screen: '', retention_device: '' }];
  return s;
}

// Fake LLM routing on prompt shape: extraction prompts start with 'Narration:',
// per-claim verdict prompts (evidence-retrieval skill) start with 'Claim:'.
function fakeLLM(claims: string[], verdictFor: (claim: string) => unknown, counters?: { verdicts: number }): LLM {
  return {
    live: true,
    async complete<T>(args: CompleteArgs<T>): Promise<CompleteResult<T>> {
      let data: unknown;
      if (args.prompt.startsWith('Claim:')) {
        if (counters) counters.verdicts++;
        data = verdictFor(args.prompt.slice('Claim:'.length, args.prompt.indexOf('\n')).trim());
      } else data = { claims };
      return { text: JSON.stringify(data), data: data as T, usage: { inputTokens: 1, outputTokens: 1, costUsd: 0.001 }, live: true };
    },
    totalUsage: () => ({ inputTokens: 0, outputTokens: 0, costUsd: 0 }),
  };
}

function liveSearch(calls: string[]): WebSearchProvider {
  return {
    name: 'test-live',
    search: async (q) => { calls.push(q); return [{ title: 'Source', url: 'https://ex.com/1', snippet: 'evidence text' }]; },
  };
}

describe('fact_checker', () => {
  it('short-circuits when no checkable claims are extracted (no search spend)', async () => {
    const calls: string[] = [];
    __setWebSearch(liveSearch(calls));
    __setLLM(fakeLLM([], () => ({ verdict: 'supported', note: 'n/a' })));
    const r = await factChecker.run(ctxFor(base()));
    expect(r.status).toBe('ok');
    expect(r.writes.fact_check).toEqual({ checked: true, claims: [], unsupported_count: 0 });
    expect(r.notes).toMatch(/no checkable claims/);
    expect(calls.length).toBe(0);
  });

  it('counts unsupported verdicts and records the cited source', async () => {
    const calls: string[] = [];
    __setWebSearch(liveSearch(calls));
    __setLLM(fakeLLM(
      ['The moon is made of green cheese', 'Water boils at 100C at sea level'],
      (claim) => (claim.includes('moon') ? { verdict: 'unsupported', note: 'refuted by [1]', source_index: 1 } : { verdict: 'supported', note: 'confirmed by [1]' }),
    ));
    const r = await factChecker.run(ctxFor(base()));
    expect(r.writes.fact_check?.checked).toBe(true);
    expect(r.writes.fact_check?.claims.length).toBe(2);
    expect(r.writes.fact_check?.unsupported_count).toBe(1);
    const moon = r.writes.fact_check?.claims.find((c) => c.claim.includes('moon'));
    expect(moon?.verdict).toBe('unsupported');
    expect(moon?.source).toBe('https://ex.com/1');
    expect(calls.length).toBe(2);
  });

  it('skips verification below the budget floor, leaving claims uncertain', async () => {
    const calls: string[] = [];
    __setWebSearch(liveSearch(calls));
    __setLLM(fakeLLM(['A very specific statistic about markets'], () => ({ verdict: 'supported', note: 'should not run' })));
    const s = base();
    s.budget.spent_this_episode_usd = s.budget.cap_usd_month - 0.2;   // $0.20 remaining < $0.50 floor
    const r = await factChecker.run(ctxFor(s));
    expect(r.status).toBe('ok');
    expect(r.writes.fact_check?.checked).toBe(true);
    expect(r.writes.fact_check?.unsupported_count).toBe(0);
    expect(r.writes.fact_check?.claims.every((c) => c.verdict === 'uncertain')).toBe(true);
    expect(r.notes).toMatch(/budget/);
    expect(calls.length).toBe(0);
  });

  it('dedupes near-identical claims before verifying', async () => {
    const calls: string[] = [];
    const counters = { verdicts: 0 };
    __setWebSearch(liveSearch(calls));
    __setLLM(fakeLLM(
      ['The Earth orbits the Sun.', 'the earth orbits  the SUN', 'Mars has two moons'],
      () => ({ verdict: 'supported', note: 'confirmed by [1]' }),
      counters,
    ));
    const r = await factChecker.run(ctxFor(base()));
    expect(r.writes.fact_check?.claims.length).toBe(2);
    expect(counters.verdicts).toBe(2);
    expect(r.notes).toMatch(/1 deduped/);
  });

  it('degrades to uncertain when search is mock (fail-closed on fake evidence)', async () => {
    // default mock search provider stays installed — its results must never
    // launder into a confident verdict
    __setLLM(fakeLLM(['A checkable claim about something'], () => ({ verdict: 'supported', note: 'should be ignored' })));
    const r = await factChecker.run(ctxFor(base()));
    expect(r.writes.fact_check?.claims[0]?.verdict).toBe('uncertain');
    expect(r.writes.fact_check?.unsupported_count).toBe(0);
  });

  it('fails the precondition without a script', async () => {
    const s = newEpisodeState('fc2');
    const r = await factChecker.run(ctxFor(s));
    expect(r.status).toBe('failed');
    expect(r.notes).toMatch(/no script/);
  });
});
