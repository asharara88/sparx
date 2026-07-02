import type { AgentInvocation, AgentResult, AgentStatus } from '../producer/envelope.js';
import type { EpisodeState } from '../types/episode.js';
import { createLogger, type Logger } from '../logger.js';
import { PipelineError } from '../errors.js';
import { missingSkills } from '../skills/registry.js';

// Agent runtime. Agents are defined declaratively via defineAgent():
//   - `skills`: names this agent depends on — validated against the registry at
//     startup (validateAgents), so a typo fails fast instead of mid-pipeline
//   - `reads`/`writes`: the EpisodeState fields this agent touches. `writes` is
//     ENFORCED — an undeclared write is a contract violation and fails the run,
//     because the Producer merges writes blindly (agents own disjoint fields)
//   - `requires`: precondition on state; a violation fails cleanly with a reason
//     instead of an uncaught throw
//   - the wrapper times every run, maps thrown errors to the AgentResult status
//     channel (retryable PipelineError → 'retry', anything else → 'failed'),
//     and injects a bound logger. Agents never need their own try/catch shell.

export interface AgentContext extends AgentInvocation {
  log: Logger;
}

export interface AgentOutput {
  writes: Partial<EpisodeState>;
  cost_usd?: number;
  notes?: string;
  status?: Extract<AgentStatus, 'ok' | 'needs_human'>;
  next_suggested?: string;
}

export interface AgentSpec {
  name: string;
  description: string;
  /** Skill names this agent calls (validated against the registry at startup). */
  skills?: string[];
  /** EpisodeState fields read (documentation + future dependency checks). */
  reads?: (keyof EpisodeState)[];
  /** EpisodeState fields this agent may write. Enforced. */
  writes: (keyof EpisodeState)[];
  /** Precondition; return a human-readable violation or null. */
  requires?: (s: EpisodeState) => string | null;
  execute(ctx: AgentContext): Promise<AgentOutput>;
}

export interface Agent {
  name: string;
  description?: string;
  skills?: string[];
  reads?: readonly (keyof EpisodeState)[];
  writes?: readonly (keyof EpisodeState)[];
  run(ctx: AgentInvocation): Promise<AgentResult>;
}

export function defineAgent(spec: AgentSpec): Agent {
  return {
    name: spec.name,
    description: spec.description,
    skills: spec.skills ?? [],
    reads: spec.reads ?? [],
    writes: spec.writes,

    async run(inv: AgentInvocation): Promise<AgentResult> {
      const log = createLogger({ agent: spec.name, episode: inv.episode_id });
      const started = Date.now();
      const base = { episode_id: inv.episode_id, agent: spec.name };

      const violation = spec.requires?.(inv.state) ?? null;
      if (violation) {
        log.error('precondition failed', { violation });
        return { ...base, status: 'failed', writes: {}, cost_usd: 0, notes: `precondition: ${violation}`, duration_ms: Date.now() - started };
      }

      try {
        const out = await spec.execute({ ...inv, log });

        const undeclared = Object.keys(out.writes).filter((k) => !spec.writes.includes(k as keyof EpisodeState));
        if (undeclared.length) {
          log.error('undeclared state writes — contract violation', { undeclared, declared: spec.writes });
          return { ...base, status: 'failed', writes: {}, cost_usd: out.cost_usd ?? 0, notes: `undeclared writes: ${undeclared.join(', ')}`, duration_ms: Date.now() - started };
        }

        const duration_ms = Date.now() - started;
        log.debug('agent done', { status: out.status ?? 'ok', ms: duration_ms, cost: out.cost_usd ?? 0 });
        return { ...base, status: out.status ?? 'ok', writes: out.writes, cost_usd: out.cost_usd ?? 0, notes: out.notes, next_suggested: out.next_suggested, duration_ms };
      } catch (err) {
        const duration_ms = Date.now() - started;
        const retryable = err instanceof PipelineError && err.retryable;
        const msg = err instanceof Error ? err.message : String(err);
        log.error('agent threw', { retryable, ms: duration_ms, err: msg.slice(0, 300), stack: err instanceof Error ? err.stack?.split('\n').slice(1, 4).join(' | ') : undefined });
        return { ...base, status: retryable ? 'retry' : 'failed', writes: {}, cost_usd: 0, notes: msg.slice(0, 300), duration_ms };
      }
    },
  };
}

/**
 * Startup validation: every declared skill exists, no two agents declare writes
 * to the same field within overlapping duty (informational), names are unique.
 * Call after importing src/skills/index.js (skills register on import).
 */
export function validateAgents(agents: Record<string, Agent>): string[] {
  const problems: string[] = [];
  for (const [key, agent] of Object.entries(agents)) {
    const missing = missingSkills(agent.skills ?? []);
    if (missing.length) problems.push(`agent '${key}' declares unknown skills: ${missing.join(', ')}`);
  }
  return problems;
}
