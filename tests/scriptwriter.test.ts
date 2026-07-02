import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { __setLLM, type LLM, type CompleteArgs, type CompleteResult } from '../src/llm/client.js';
import { scriptwriter } from '../src/agents/scriptwriter.js';
import { newEpisodeState } from '../src/types/episode.js';
import { ctxFor } from './helpers.js';

beforeEach(() => __setLLM(null));
afterEach(() => __setLLM(null));

function stateWithConcept() {
  const s = newEpisodeState('sw1', { niche: 'productivity' });
  s.concept.topic = 'The pomodoro myth';
  s.concept.angle = 'Why 25-minute timers backfire for deep work';
  s.concept.audience = 'knowledge workers';
  s.concept.target_length_min = 10;
  return s;
}

// Scripted fake: returns canned JSON in call order, parsed through each call's own
// schema (so transforms/refines run exactly as in production), recording every prompt.
function scriptedLLM(responses: string[]) {
  const calls: CompleteArgs<any>[] = [];
  let i = 0;
  const llm: LLM = {
    live: true,
    totalUsage: () => ({ inputTokens: 0, outputTokens: 0, costUsd: 0 }),
    async complete<T>(args: CompleteArgs<T>): Promise<CompleteResult<T>> {
      calls.push(args as CompleteArgs<any>);
      const raw = responses[i++];
      if (raw === undefined) throw new Error(`unexpected extra LLM call #${i}`);
      const data = args.schema ? args.schema.parse(JSON.parse(raw)) : undefined;
      return { text: raw, data: data as T, usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 }, live: true };
    },
  };
  return { llm, calls };
}

const outlineJson = JSON.stringify({
  hook_variants: ['A hook that is long enough to pass', 'Another hook that is long enough'],
  beat_sheet: ['Cold open', 'Common belief', 'Where it breaks', 'The fix'],
});
const draftJson = (marker: string, voExtra = '') => JSON.stringify({
  hook: `Hook ${marker}: everyone uses timers wrong`,
  sections: ['s1', 's2', 's3', 's4'].map((id, i) => ({
    id, beat: `beat ${i + 1}`,
    vo_text: `Section ${i + 1} narration for ${marker} with concrete details.${i === 1 ? voExtra : ''}`,
    shot_note: 'talking head', on_screen: 'caption', retention_device: 'open loop',
  })),
  cta: 'Subscribe for one deep dive a week.',
});
const passCritique = JSON.stringify({ passes: true, critique: 'Hook lands; payoffs resolve.' });

describe('scriptwriter', () => {
  it('a failing critique triggers exactly one redraft, then accepts regardless', async () => {
    const failCritique = JSON.stringify({ passes: false, critique: 'Hook is generic and payoffs are vague.' });
    const secondCritique = JSON.stringify({ passes: false, critique: 'Still weak but going to the gate.' });
    const { llm, calls } = scriptedLLM([outlineJson, draftJson('v1'), failCritique, draftJson('v2'), secondCritique]);
    __setLLM(llm);

    const r = await scriptwriter.run(ctxFor(stateWithConcept()));
    expect(r.status).toBe('ok');                                 // accepted despite the second failing critique
    expect(calls.length).toBe(5);                                // outline, draft, critique, ONE redraft, re-critique — no loop
    expect(calls[2]!.prompt).toContain('Section 1 narration for v1');   // critique sees actual vo_text, not beat labels
    expect(calls[3]!.prompt).toContain('Hook is generic');       // critique text fed back into the redraft prompt
    expect(r.writes.script?.hook).toContain('v2');               // redraft is the accepted draft
    expect(r.writes.script?.critique).toContain('Hook is generic');
    expect(r.writes.script?.critique).toContain('Still weak');   // both critiques recorded
  });

  it('a passing critique means no redraft (3 calls total)', async () => {
    const { llm, calls } = scriptedLLM([outlineJson, draftJson('v1'), passCritique]);
    __setLLM(llm);
    const r = await scriptwriter.run(ctxFor(stateWithConcept()));
    expect(r.status).toBe('ok');
    expect(calls.length).toBe(3);
    expect(r.writes.script?.hook).toContain('v1');
    expect(r.writes.script?.critique).toContain('Hook lands');
  });

  it('sets brand_voice_pass false when a banned phrase appears in the narration', async () => {
    const { llm } = scriptedLLM([outlineJson, draftJson('v1', ' This tool is a game-changer for your mornings.'), passCritique]);
    __setLLM(llm);
    const r = await scriptwriter.run(ctxFor(stateWithConcept()));
    expect(r.status).toBe('ok');                                 // flags for GATE B, never blocks
    expect(r.writes.script?.brand_voice_pass).toBe(false);
    expect(r.writes.script?.critique).toMatch(/game-changer/);
    expect(r.notes).toMatch(/banned phrases/);
  });

  it('zero-key mock path: ok at zero cost, clean brand voice, short draft flagged loudly', async () => {
    const r = await scriptwriter.run(ctxFor(stateWithConcept()));
    expect(r.status).toBe('ok');
    expect(r.cost_usd).toBe(0);
    expect(r.writes.script?.sections.length).toBeGreaterThan(0);
    expect(r.writes.script?.brand_voice_pass).toBe(true);
    expect(r.notes).toMatch(/SHORT SCRIPT/);                     // mock draft is far below the ~1400w target
    expect(r.writes.script?.critique).toMatch(/LENGTH/);
  });

  it('fails the precondition cleanly without a concept', async () => {
    const r = await scriptwriter.run(ctxFor(newEpisodeState('sw0')));
    expect(r.status).toBe('failed');
    expect(r.notes).toMatch(/precondition/);
    expect(r.writes).toEqual({});
  });
});
