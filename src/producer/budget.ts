import type { EpisodeState } from '../types/episode.js';

export function remaining(state: EpisodeState): number {
  return state.budget.cap_usd_month - state.budget.spent_this_episode_usd;
}

export function record(state: EpisodeState, agent: string, costUsd: number): void {
  if (costUsd <= 0) return;
  state.budget.ledger.push({ agent, cost_usd: costUsd, at: new Date().toISOString() });
  state.budget.spent_this_episode_usd += costUsd;
}

// Guard used before money-spending steps.
export function canAfford(state: EpisodeState, estimateUsd: number): boolean {
  return remaining(state) >= estimateUsd;
}
