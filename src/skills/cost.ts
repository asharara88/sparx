import type { EpisodeState } from '../types/episode.js';
// Cost/credit skill. estimate a planned step; decide throttle. Used by Producer (0), Visual Director (3), Video Gen (5).
export function estimateShotCost(durationS: number, model: 'runway' | 'kling' | 'veo'): number {
  // Per-second USD. NOTE: api.dev.runwayml.com is credit-billed (~$0.05/s for gen4.5),
  // unlike the consumer 'relaxed mode' web app which is unlimited. Tune to your plan.
  const perSec = { runway: 0.05, kling: 0.08, veo: 0.5 };
  return Math.round(durationS * perSec[model] * 100) / 100;
}
export function shouldThrottle(state: EpisodeState, plannedUsd: number): boolean {
  return state.budget.spent_this_episode_usd + plannedUsd > state.budget.cap_usd_month;
}

// HeyGen avatar video is credit-billed (~$0.30/min). Estimate per second.
export function estimateAvatarCost(durationS: number): number {
  return Math.round((durationS / 60) * 0.30 * 1e4) / 1e4;
}

// Runway gen4_image ~ $0.08 per image. Flat estimate.
export function estimateImageCost(): number { return 0.08; }
