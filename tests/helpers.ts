import type { EpisodeState } from '../src/types/episode.js';
import type { AgentInvocation } from '../src/producer/envelope.js';
export function ctxFor(state: EpisodeState): AgentInvocation {
  return { episode_id: state.episode_id, agent: 'test', state, budget_remaining_usd: state.budget.cap_usd_month - state.budget.spent_this_episode_usd };
}
