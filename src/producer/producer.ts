import type { EpisodeState, EpisodeStatus, HistoryEntry } from '../types/episode.js';
import type { AgentResult } from './envelope.js';
import { MACHINE, GUARDS, validateMachine } from './stateMachine.js';
import { AGENTS } from '../agents/index.js';
import { validateAgents } from '../agents/core.js';
import { PipelineError } from '../errors.js';
import { createStore, type StateStore } from '../state/store.js';
import * as budget from './budget.js';

export interface ProducerOpts {
  autoApproveGates?: boolean;   // dev: auto-pass A/B/C so the skeleton runs end to end
  store?: StateStore;
  onGate?: (gate: 'A' | 'B' | 'C', state: EpisodeState) => Promise<boolean>; // return true=approve
  maxRetries?: number;
  log?: (msg: string) => void;
}

const RETRYABLE_STATES: EpisodeStatus[] = ['generating'];

export class Producer {
  private store: StateStore;
  private autoApprove: boolean;
  private onGate?: ProducerOpts['onGate'];
  private maxRetries: number;
  private log: (m: string) => void;

  constructor(opts: ProducerOpts = {}) {
    this.store = opts.store ?? createStore();
    this.autoApprove = opts.autoApproveGates ?? (process.env.AUTO_APPROVE_GATES === 'true');
    this.onGate = opts.onGate;
    this.maxRetries = opts.maxRetries ?? 2;
    this.log = opts.log ?? (() => {});
    // Fail fast on wiring mistakes: machine ↔ registry mismatch, unknown skill declarations.
    const problems = [...validateMachine(AGENTS), ...validateAgents(AGENTS)];
    if (problems.length) throw new Error(`pipeline wiring invalid:\n  ${problems.join('\n  ')}`);
  }

  private async pushHistory(state: EpisodeState, agent: string, event: string) {
    const h: HistoryEntry = { at: new Date().toISOString(), agent, event };
    state.history.push(h);
    await this.store.logEvent(state.episode_id, agent, event);
  }

  // Drive the pipeline until it reaches a terminal state, a gate it can't pass, or on_hold.
  async run(state: EpisodeState): Promise<EpisodeState> {
    await this.store.save(state);

    while (true) {
      const def = MACHINE[state.status];
      if (def === null) { this.log(`■ terminal: ${state.status}`); return state; }

      // Gate states: pause for human approval.
      if (def.gate) {
        const approved = this.autoApprove
          ? true
          : this.onGate ? await this.onGate(def.gate, state) : false;
        await this.pushHistory(state, 'producer', `gate_${def.gate}_${approved ? 'approved' : 'held'}`);
        if (!approved) {
          this.log(`▌ holding at GATE ${def.gate} (${state.status}) — awaiting human approval`);
          await this.store.save(state);
          return state;
        }
        this.applyGateApproval(state, def.gate);
        state.status = def.next;
        await this.store.save(state);
        this.log(`✓ GATE ${def.gate} approved → ${state.status}`);
        continue;
      }

      // Guard before entering a (already-current) working state's transition.
      const guard = GUARDS[state.status];
      if (guard) {
        const violation = guard(state);
        if (violation) {
          this.log(`✗ guard failed entering ${state.status}: ${violation}`);
          state.status = 'on_hold';
          await this.pushHistory(state, 'producer', `on_hold:${violation}`);
          await this.store.save(state);
          return state;
        }
      }

      // Run all agents for this state (concurrently), with retry on retryable states.
      const ok = await this.runState(state, def.stages);
      if (!ok) {
        await this.store.save(state);
        return state; // failed or on_hold already set
      }

      state.status = def.next;
      await this.store.save(state);
      this.log(`→ ${state.status}`);
    }
  }

  private async runState(state: EpisodeState, stages: string[][]): Promise<boolean> {
    for (const stage of stages) {
      if (stage.length === 0) continue;

      const results = await Promise.all(stage.map((name) => this.invokeWithRetry(state, name)));

      // Merge each stage's writes before the next stage runs, so dependent
      // agents (e.g. visual_director, music) see upstream outputs.
      for (const r of results) {
        this.mergeWrites(state, r.writes);
        budget.record(state, r.agent, r.cost_usd);
        if (r.cost_usd > 0) await this.store.recordCost(state.episode_id, r.agent, r.cost_usd, r.notes);
        const timing = r.duration_ms !== undefined ? ` [${(r.duration_ms / 1000).toFixed(1)}s]` : '';
        await this.pushHistory(state, r.agent, `${r.status}${r.notes ? ':' + r.notes : ''}${timing}`);
      }

      if (results.some((r) => r.status === 'failed')) {
        state.status = 'failed';
        this.log(`\u2717 ${state.status}: an agent failed`);
        return false;
      }
      if (results.some((r) => r.status === 'needs_human')) {
        state.status = 'on_hold';
        this.log('\u258c on_hold: agent requested human input');
        return false;
      }
    }
    return true;
  }

  private async invokeWithRetry(state: EpisodeState, name: string): Promise<AgentResult> {
    const agent = AGENTS[name];
    if (!agent) return { episode_id: state.episode_id, agent: name, status: 'failed', writes: {}, cost_usd: 0, notes: 'unknown agent' };

    // Agents built on defineAgent never throw (the runtime maps errors to statuses),
    // but a legacy agent or a runtime bug must not escape Promise.all and crash the
    // pipeline past the 'failed' bookkeeping — catch here as defense in depth.
    const retries = RETRYABLE_STATES.includes(state.status) ? this.maxRetries : 0;
    let last: AgentResult | null = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      let res: AgentResult;
      const started = Date.now();
      try {
        res = await agent.run({
          episode_id: state.episode_id,
          agent: name,
          state,
          budget_remaining_usd: budget.remaining(state),
        });
      } catch (err) {
        const retryable = err instanceof PipelineError && err.retryable;
        const msg = err instanceof Error ? err.message : String(err);
        this.log(`✗ ${name} threw: ${msg.slice(0, 160)}`);
        res = { episode_id: state.episode_id, agent: name, status: retryable ? 'retry' : 'failed', writes: {}, cost_usd: 0, notes: msg.slice(0, 300), duration_ms: Date.now() - started };
      }
      last = res;
      if (res.status !== 'retry') return res;
      this.log(`↻ ${name} retry ${attempt + 1}/${retries}`);
    }
    // Retries exhausted while still asking to retry → the stage failed.
    return { ...last!, status: 'failed', notes: `retries exhausted: ${last!.notes ?? ''}`.trim() };
  }

  private mergeWrites(state: EpisodeState, writes: Partial<EpisodeState>) {
    Object.assign(state, writes); // agents write disjoint top-level fields by contract
  }

  private applyGateApproval(state: EpisodeState, gate: 'A' | 'B' | 'C') {
    if (gate === 'A') state.concept.approved = true;
    if (gate === 'B') { state.script.approved = true; }
    if (gate === 'C') { state.edit.approved = true; }
  }
}
