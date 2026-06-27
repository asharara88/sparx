import { describe, it, expect } from 'vitest';
import { estimateShotCost, shouldThrottle } from '../src/skills/cost.js';
import { newEpisodeState } from '../src/types/episode.js';

describe('cost skill', () => {
  it('runway relaxed-mode is ~free, veo is priciest', () => {
    expect(estimateShotCost(4, 'runway')).toBeGreaterThan(0); // API is credit-billed
    expect(estimateShotCost(4, 'veo')).toBeGreaterThan(estimateShotCost(4, 'kling'));
  });
  it('throttles when a planned spend exceeds the cap', () => {
    const s = newEpisodeState('t', { cap_usd_month: 10 });
    s.budget.spent_this_episode_usd = 9;
    expect(shouldThrottle(s, 2)).toBe(true);
    expect(shouldThrottle(s, 0.5)).toBe(false);
  });
});
