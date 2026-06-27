import type { EpisodeState } from '../types/episode.js';

// Uniform agent invocation/result envelope (Build-Spec §3.1).
export interface AgentInvocation {
  episode_id: string;
  agent: string;
  state: EpisodeState;            // the shared state (passed by ref to the run ctx)
  params?: Record<string, unknown>;
  budget_remaining_usd: number;
}

export type AgentStatus = 'ok' | 'needs_human' | 'retry' | 'failed';

export interface AgentResult {
  episode_id: string;
  agent: string;
  status: AgentStatus;
  writes: Partial<EpisodeState>;  // merged into Episode State by the Producer
  cost_usd: number;
  notes?: string;
  next_suggested?: string;
}
