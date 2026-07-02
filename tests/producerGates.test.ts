import { describe, it, expect, beforeEach } from 'vitest';
import { Producer, type GateDecision } from '../src/producer/producer.js';
import { newEpisodeState } from '../src/types/episode.js';
import { __setLLM } from '../src/llm/client.js';
import { scriptwriter } from '../src/agents/scriptwriter.js';
import { parseArgs } from '../src/index.js';

// Gate protocol: approve / hold / revise (with creator notes) / reject.
process.env.RENDER_FAKE = 'true';
beforeEach(() => __setLLM(null)); // MockLLM

const gateEvents = (history: { event: string }[], prefix: string) => history.filter((h) => h.event.startsWith(prefix));

describe('gate revise', () => {
  it('revise at gate B re-runs scripting with the notes, resolves the revision, and reaches published', async () => {
    const s = newEpisodeState('ep_revise_b', { niche: 'test niche' });
    let bVisits = 0;
    const p = new Producer({
      onGate: async (gate): Promise<boolean | GateDecision> => {
        if (gate === 'B' && ++bVisits === 1) return { action: 'revise', notes: 'shorter hook, cut section three' };
        return true; // approve everything else (and B on its second visit)
      },
    });
    const f = await p.run(s);

    expect(f.status).toBe('published');
    expect(gateEvents(f.history, 'gate_B_revise').length).toBe(1);
    expect(f.revisions).toHaveLength(1);
    expect(f.revisions[0]).toMatchObject({ gate: 'B', resolved: true });
    // scripting ran twice: the original pass and the revision pass
    expect(f.history.filter((h) => h.agent === 'scriptwriter' && h.event.startsWith('ok')).length).toBe(2);
    expect(f.history.some((h) => h.event === 'revision_B_applied')).toBe(true);
  });

  it('reject at gate A fails the episode', async () => {
    const s = newEpisodeState('ep_reject', { niche: 'test niche' });
    const p = new Producer({ onGate: async () => ({ action: 'reject', notes: 'wrong direction' }) });
    const f = await p.run(s);
    expect(f.status).toBe('failed');
    expect(gateEvents(f.history, 'gate_A_rejected').length).toBe(1);
    expect(f.script.sections.length).toBe(0); // never got past concept review
  });

  it('caps revise loops and holds at the gate instead of burning money forever', async () => {
    const s = newEpisodeState('ep_cap', { niche: 'test niche' });
    const p = new Producer({
      maxRevisionsPerGate: 2,
      onGate: async (gate): Promise<boolean | GateDecision> =>
        gate === 'A' ? { action: 'revise', notes: 'again' } : false,
    });
    const f = await p.run(s);
    expect(f.status).toBe('concept_review'); // held, not looping
    expect(f.revisions.filter((r) => r.gate === 'A')).toHaveLength(2);
    expect(f.history.some((h) => h.event === 'gate_A_revision_cap_reached')).toBe(true);
  });

  it('passes revision notes to the scripting agents via params', async () => {
    // Drive the scriptwriter directly with a prompt-recording fake LLM.
    const prompts: string[] = [];
    __setLLM({
      live: false,
      totalUsage: () => ({ inputTokens: 0, outputTokens: 0, costUsd: 0 }),
      complete: async (args: any) => {
        prompts.push(args.prompt);
        const parsed = JSON.parse(args.mock); // fake serves each call's own mock payload
        return { text: args.mock, data: parsed, usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 }, live: false };
      },
    } as any);

    const s = newEpisodeState('ep_notes', { niche: 'test niche' });
    s.concept.topic = 'test topic';
    s.concept.angle = 'test angle';
    const r = await scriptwriter.run({
      episode_id: s.episode_id, agent: 'scriptwriter', state: s, budget_remaining_usd: 100,
      params: { revision_notes: 'make the hook about the hidden cost', revision_gate: 'B' },
    });
    expect(r.status).toBe('ok');
    expect(prompts.some((p) => p.includes('make the hook about the hidden cost'))).toBe(true);
  });
});

describe('cli args', () => {
  it('parses topic words, resume, and gate decisions', () => {
    expect(parseArgs(['AI', 'tools', 'roundup']).topic).toBe('AI tools roundup');
    expect(parseArgs(['--resume', 'ep_x', '--approve'])).toMatchObject({ resume: 'ep_x', decision: { action: 'approve' } });
    expect(parseArgs(['--resume', 'ep_x', '--revise', 'tighter hook']).decision).toEqual({ action: 'revise', notes: 'tighter hook' });
    expect(parseArgs(['--resume', 'ep_x', '--reject']).decision).toEqual({ action: 'reject' });
  });

  it('rejects decisions without --resume and revise without notes', () => {
    expect(() => parseArgs(['--approve'])).toThrow(/--resume/);
    expect(() => parseArgs(['--resume', 'ep_x', '--revise'])).toThrow(/notes/);
  });
});
