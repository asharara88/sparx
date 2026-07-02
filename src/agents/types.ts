import type { AgentInvocation, AgentResult } from '../producer/envelope.js';

// Back-compat shim: the agent contract now lives in src/agents/core.ts
// (defineAgent + declarative spec). Re-exported here so existing imports keep
// working while agents migrate.
export type { Agent, AgentContext, AgentOutput, AgentSpec } from './core.js';
export { defineAgent, validateAgents } from './core.js';

// Legacy helper for agents not yet migrated to defineAgent.
export function ok(ctx: AgentInvocation, writes: AgentResult['writes'], cost = 0, notes?: string): AgentResult {
  return { episode_id: ctx.episode_id, agent: ctx.agent, status: 'ok', writes, cost_usd: cost, notes };
}
