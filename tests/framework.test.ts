import { describe, expect, it } from 'vitest';
import { defineAgent, validateAgents } from '../src/agents/core.js';
import { AGENTS } from '../src/agents/index.js';
import { validateMachine } from '../src/producer/stateMachine.js';
import { mapLimit, settleLimit } from '../src/util/concurrency.js';
import { newEpisodeState } from '../src/types/episode.js';
import { AgentError } from '../src/errors.js';

const inv = (state = newEpisodeState('ep_fw')) => ({ episode_id: state.episode_id, agent: 'x', state, budget_remaining_usd: 100 });

describe('defineAgent runtime', () => {
  it('maps a non-retryable throw to status failed with the message in notes', async () => {
    const a = defineAgent({
      name: 'boom', description: 't', writes: [],
      async execute() { throw new AgentError('boom', 'exploded'); },
    });
    const r = await a.run(inv());
    expect(r.status).toBe('failed');
    expect(r.notes).toContain('exploded');
    expect(r.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it('maps a retryable PipelineError to status retry', async () => {
    const a = defineAgent({
      name: 'flaky', description: 't', writes: [],
      async execute() { throw new AgentError('flaky', 'transient', true); },
    });
    const r = await a.run(inv());
    expect(r.status).toBe('retry');
  });

  it('fails a run that writes undeclared state fields', async () => {
    const a = defineAgent({
      name: 'sneaky', description: 't', writes: ['concept'],
      async execute() { return { writes: { concept: newEpisodeState('x').concept, qa: newEpisodeState('x').qa } }; },
    });
    const r = await a.run(inv());
    expect(r.status).toBe('failed');
    expect(r.notes).toContain('undeclared writes');
    expect(r.writes).toEqual({}); // contract violation merges nothing
  });

  it('fails cleanly on a precondition violation without invoking execute', async () => {
    let ran = false;
    const a = defineAgent({
      name: 'guarded', description: 't', writes: [],
      requires: () => 'input missing',
      async execute() { ran = true; return { writes: {} }; },
    });
    const r = await a.run(inv());
    expect(r.status).toBe('failed');
    expect(r.notes).toContain('precondition');
    expect(ran).toBe(false);
  });

  it('passes through needs_human from execute', async () => {
    const a = defineAgent({
      name: 'asker', description: 't', writes: [],
      async execute() { return { writes: {}, status: 'needs_human' as const, notes: 'check me' }; },
    });
    const r = await a.run(inv());
    expect(r.status).toBe('needs_human');
  });
});

describe('pipeline wiring', () => {
  it('every state-machine stage references a registered agent', () => {
    expect(validateMachine(AGENTS)).toEqual([]);
  });

  it('every registered agent declares only registered skills', () => {
    expect(validateAgents(AGENTS)).toEqual([]);
  });
});

describe('concurrency utils', () => {
  it('mapLimit preserves order and honors the limit', async () => {
    let inFlight = 0, peak = 0;
    const out = await mapLimit([10, 20, 30, 40, 50], 2, async (n) => {
      inFlight++; peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, n));
      inFlight--;
      return n * 2;
    });
    expect(out).toEqual([20, 40, 60, 80, 100]);
    expect(peak).toBeLessThanOrEqual(2);
  });

  it('settleLimit collects failures without rejecting, in input order', async () => {
    const { ok, failed } = await settleLimit([1, 2, 3, 4], 3, async (n) => {
      if (n % 2 === 0) throw new Error(`even ${n}`);
      return n;
    });
    expect(ok.map((o) => o.value)).toEqual([1, 3]);
    expect(failed.map((f) => f.item)).toEqual([2, 4]);
  });
});
