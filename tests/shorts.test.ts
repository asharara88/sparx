import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { shorts } from '../src/agents/shorts.js';
import { newEpisodeState, type ScriptSection } from '../src/types/episode.js';
import { __setLLM, type LLM, type CompleteArgs, type CompleteResult } from '../src/llm/client.js';
import { ctxFor } from './helpers.js';

beforeEach(() => __setLLM(null));
afterEach(() => __setLLM(null));

const sec = (id: string, vo: string): ScriptSection => ({ id, beat: 'beat', vo_text: vo, shot_note: '', on_screen: '', retention_device: '' });

function base(durations: [string, number][] = [['s1', 10], ['s2', 20], ['s3', 30]]) {
  const s = newEpisodeState('sh1');
  s.script.hook = 'A punchy hook';
  s.script.sections = durations.map(([id]) => sec(id, `Narration for ${id} with enough words.`));
  s.voiceover = {
    voice_id: 'v',
    clips: durations.map(([section_id, duration_s]) => ({ section_id, audio_uri: 'a', duration_s })),
    total_duration_s: durations.reduce((n, [, d]) => n + d, 0),
  };
  return s;
}

function planLLM(plan: unknown): LLM {
  return {
    live: true,
    async complete<T>(_args: CompleteArgs<T>): Promise<CompleteResult<T>> {
      return { text: JSON.stringify(plan), data: plan as T, usage: { inputTokens: 1, outputTokens: 1, costUsd: 0.001 }, live: true };
    },
    totalUsage: () => ({ inputTokens: 0, outputTokens: 0, costUsd: 0 }),
  };
}

describe('shorts', () => {
  it('maps the mock plan to real cumulative voiceover durations', async () => {
    const r = await shorts.run(ctxFor(base()));   // MockLLM plan: s1..s2
    expect(r.status).toBe('ok');
    expect(r.writes.shorts?.length).toBe(1);
    expect(r.writes.shorts?.[0]?.source_range_s).toEqual([0, 30]);   // 10s + 20s, not '?? 0' guesses
    expect(r.writes.shorts?.[0]?.render_uri).toMatch(/^plan:\/\//); // plan ref; shorts_renderer cuts the real file
  });

  it('computes mid-video ranges from real durations', async () => {
    __setLLM(planLLM({ shorts: [{ start_section: 's2', end_section: 's3', hook: 'Mid hook', why: 'payoff' }] }));
    const r = await shorts.run(ctxFor(base()));
    expect(r.writes.shorts?.[0]?.source_range_s).toEqual([10, 60]);
    expect(r.writes.shorts?.[0]?.hook).toBe('Mid hook');
  });

  it('falls back to per-section shot durations when voiceover is empty', async () => {
    const s = base();
    s.voiceover = { voice_id: '', clips: [], total_duration_s: 0 };
    s.shot_list = [
      { shot_id: 'sh1', section_id: 's1', source: 'stock', duration_s: 4, prompt: {}, selected_asset: null, cost_estimate_usd: 0 },
      { shot_id: 'sh2', section_id: 's2', source: 'stock', duration_s: 6, prompt: {}, selected_asset: null, cost_estimate_usd: 0 },
      { shot_id: 'sh3', section_id: 's2', source: 'stock', duration_s: 3, prompt: {}, selected_asset: null, cost_estimate_usd: 0 },   // summed per section
      { shot_id: 'sh4', section_id: 's3', source: 'stock', duration_s: 5, prompt: {}, selected_asset: null, cost_estimate_usd: 0 },
    ];
    const r = await shorts.run(ctxFor(s));   // mock plan: s1..s2
    expect(r.writes.shorts?.[0]?.source_range_s).toEqual([0, 13]);   // 4 + (6+3)
  });

  it('drops plan items with unknown or inverted section refs, keeping the valid ones', async () => {
    __setLLM(planLLM({
      shorts: [
        { start_section: 's9', end_section: 's3', hook: 'bad ref', why: '' },
        { start_section: 's3', end_section: 's1', hook: 'inverted', why: '' },
        { start_section: 's1', end_section: 's2', hook: 'good', why: '' },
      ],
    }));
    const r = await shorts.run(ctxFor(base()));
    expect(r.writes.shorts?.length).toBe(1);
    expect(r.writes.shorts?.[0]?.hook).toBe('good');
    expect(r.writes.shorts?.[0]?.source_range_s).toEqual([0, 30]);
    expect(r.notes).toMatch(/2 invalid plan items dropped/);
  });

  it('falls back to a deterministic first-45s short when every plan item is invalid', async () => {
    __setLLM(planLLM({ shorts: [{ start_section: 'sX', end_section: 'sY', hook: 'hallucinated', why: '' }] }));
    const r = await shorts.run(ctxFor(base()));
    expect(r.writes.shorts?.length).toBe(1);
    expect(r.writes.shorts?.[0]?.source_range_s).toEqual([0, 45]);   // min(45, 60s total)
    expect(r.writes.shorts?.[0]?.hook).toBe('A punchy hook');
  });

  it('caps a span at the 60s Shorts limit', async () => {
    __setLLM(planLLM({ shorts: [{ start_section: 's1', end_section: 's2', hook: 'Long span', why: '' }] }));
    const r = await shorts.run(ctxFor(base([['s1', 50], ['s2', 50]])));
    expect(r.writes.shorts?.[0]?.source_range_s).toEqual([0, 60]);
  });

  it('skips the LLM entirely when there is no timing data', async () => {
    const s = base();
    s.voiceover = { voice_id: '', clips: [], total_duration_s: 0 };
    __setLLM({ live: true, complete: async () => { throw new Error('must not be called'); }, totalUsage: () => ({ inputTokens: 0, outputTokens: 0, costUsd: 0 }) });
    const r = await shorts.run(ctxFor(s));
    expect(r.status).toBe('ok');
    expect(r.writes.shorts).toEqual([]);
    expect(r.notes).toMatch(/no timing data/);
  });

  it('fails the precondition without script sections', async () => {
    const r = await shorts.run(ctxFor(newEpisodeState('sh2')));
    expect(r.status).toBe('failed');
    expect(r.notes).toMatch(/no script sections/);
  });
});
