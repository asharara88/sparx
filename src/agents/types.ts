import type { AgentInvocation, AgentResult } from '../producer/envelope.js';

export interface Agent {
  name: string;
  run(ctx: AgentInvocation): Promise<AgentResult>;
}

// Helper to build a successful result.
export function ok(ctx: AgentInvocation, writes: AgentResult['writes'], cost = 0, notes?: string): AgentResult {
  return { episode_id: ctx.episode_id, agent: ctx.agent, status: 'ok', writes, cost_usd: cost, notes };
}
