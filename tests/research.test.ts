import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { __setLLM, type LLM, type CompleteArgs, type CompleteResult } from '../src/llm/client.js';
import { __setWebSearch } from '../src/skills/research/webSearch.js';
import { rememberEpisode, pastTopics } from '../src/skills/channelMemory.js';
import { research } from '../src/agents/research.js';
import { newEpisodeState } from '../src/types/episode.js';
import { ctxFor } from './helpers.js';

// Point channel memory at a throwaway file before anything triggers config() (which caches env).
process.env.CHANNEL_MEMORY_PATH = join(mkdtempSync(join(tmpdir(), 'sparx-mem-')), 'memory.json');

// Prompt-capturing fake: parses each call's own mock through its schema, so the
// agent runs the exact production path while we observe prompts and tiers.
function captureLLM() {
  const calls: CompleteArgs<any>[] = [];
  const llm: LLM = {
    live: true,
    totalUsage: () => ({ inputTokens: 0, outputTokens: 0, costUsd: 0 }),
    async complete<T>(args: CompleteArgs<T>): Promise<CompleteResult<T>> {
      calls.push(args as CompleteArgs<any>);
      const data = args.schema ? args.schema.parse(JSON.parse(args.mock)) : undefined;
      return { text: args.mock, data: data as T, usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 }, live: true };
    },
  };
  return { llm, calls };
}

beforeEach(() => { __setLLM(null); __setWebSearch(null); });
afterEach(() => { __setLLM(null); __setWebSearch(null); });

describe('research', () => {
  it('dedups against channel memory and uses the current year (not a hardcoded one)', async () => {
    rememberEpisode({ episode_id: 'past1', topic: 'The pomodoro myth nobody questions', title: 'Pomodoro Lied To You', angle: 'a', keywords: ['pomodoro'], published_at: '', youtube_video_id: '' });
    expect(pastTopics().map((p) => p.topic)).toContain('The pomodoro myth nobody questions');

    const { llm, calls } = captureLLM();
    __setLLM(llm);
    const r = await research.run(ctxFor(newEpisodeState('ep1', { niche: 'productivity' })));
    expect(r.status).toBe('ok');
    // ideation prompt carries the remembered topic and the dynamic year
    expect(calls[0]!.prompt).toContain('The pomodoro myth nobody questions');
    expect(calls[0]!.prompt).toContain(String(new Date().getFullYear()));
  });

  it('produces a full mock concept with zero keys at zero cost', async () => {
    const r = await research.run(ctxFor(newEpisodeState('ep2', { niche: 'productivity' })));
    expect(r.status).toBe('ok');
    expect(r.cost_usd).toBe(0);
    expect(r.writes.concept?.topic).toBeTruthy();
    expect(r.writes.concept?.approved).toBe(false);
    expect(r.writes.concept?.angle_candidates.length).toBeGreaterThanOrEqual(3);
    expect(r.writes.concept?.keywords.length).toBeGreaterThan(0);
    expect(r.writes.concept?.keywords.length).toBeLessThanOrEqual(12);
  });

  it('tolerates a web search outage — evidence is enrichment, not a dependency', async () => {
    __setWebSearch({ name: 'tavily', search: async () => { throw new Error('network down'); } });
    const r = await research.run(ctxFor(newEpisodeState('ep3', { niche: 'productivity' })));
    expect(r.status).toBe('ok');
    expect(r.writes.concept?.topic).toBeTruthy();
    expect(r.notes).toMatch(/without evidence/i);
  });

  it('downgrades pro-tier calls to main when the budget is nearly exhausted', async () => {
    const { llm, calls } = captureLLM();
    __setLLM(llm);
    const s = newEpisodeState('ep4', { niche: 'productivity' });
    s.budget.spent_this_episode_usd = s.budget.cap_usd_month - 0.5;   // $0.50 remaining
    const r = await research.run(ctxFor(s));
    expect(r.status).toBe('ok');
    expect(calls.length).toBe(2);
    expect(calls.every((c) => c.tier === 'main')).toBe(true);
    expect(r.notes).toMatch(/budget low/i);
  });

  it('fails the precondition cleanly when the channel has no niche', async () => {
    const r = await research.run(ctxFor(newEpisodeState('ep5')));
    expect(r.status).toBe('failed');
    expect(r.notes).toMatch(/precondition/);
    expect(r.writes).toEqual({});
  });
});
