import type { EpisodeState } from '../types/episode.js';
import { defineSkill } from './registry.js';

// Consolidated cost/credit model — the single source of pricing truth. Every
// paid step estimates here BEFORE spending and records actuals to the budget
// ledger AFTER. Rates are estimates of credit-billed APIs; tune to your plan.

export const PRICES = {
  // Per-second USD. api.dev.runwayml.com is credit-billed (~$0.05/s for gen4.5),
  // unlike the consumer 'relaxed mode' web app which is unlimited.
  video_per_s: { runway: 0.05, kling: 0.08, veo: 0.5 } as Record<'runway' | 'kling' | 'veo', number>,
  avatar_per_min: 0.3,        // HeyGen credit-billed ~$0.30/min
  image_flat: 0.08,           // Runway gen4_image ~$0.08/image
  voice_per_1k_chars: 0.3,    // ElevenLabs ~$0.30 per 1k characters (Creator-tier credits)
  music_flat: 0,              // mock/no-cost provider today; real providers report actuals
};

export function estimateShotCost(durationS: number, model: 'runway' | 'kling' | 'veo'): number {
  return Math.round(durationS * PRICES.video_per_s[model] * 100) / 100;
}

export function estimateAvatarCost(durationS: number): number {
  return Math.round((durationS / 60) * PRICES.avatar_per_min * 1e4) / 1e4;
}

export function estimateImageCost(): number { return PRICES.image_flat; }

export function estimateVoiceCost(chars: number): number {
  return Math.round((chars / 1000) * PRICES.voice_per_1k_chars * 1e4) / 1e4;
}

export function shouldThrottle(state: EpisodeState, plannedUsd: number): boolean {
  return state.budget.spent_this_episode_usd + plannedUsd > state.budget.cap_usd_month;
}

export const costModelSkill = defineSkill<{ kind: 'video'; durationS: number; model: 'runway' | 'kling' | 'veo' } | { kind: 'avatar'; durationS: number } | { kind: 'image' } | { kind: 'voice'; chars: number }, number>({
  name: 'cost-model',
  description: 'Estimate USD cost of a planned media-generation step (video/avatar/image/voice) from the consolidated price table.',
  run: async (input) => {
    switch (input.kind) {
      case 'video': return estimateShotCost(input.durationS, input.model);
      case 'avatar': return estimateAvatarCost(input.durationS);
      case 'image': return estimateImageCost();
      case 'voice': return estimateVoiceCost(input.chars);
    }
  },
});
