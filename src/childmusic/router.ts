// Developmental-Goal Router (§10b) — RULE-BASED.
//
// Classifies a free-text ask (or an explicit goal) into one of the six §6
// protocols plus a developmental/entertainment intent. Deterministic keyword
// scoring with a fixed, auditable precedence — no LLM, no randomness — because
// which protocol (and therefore which parameter ceilings and safety rules) fires
// must be reproducible.

import type { Goal, GoalDecision, Intent } from './types.js';
import { PROTOCOL_FOR_GOAL } from './knowledge.js';

// Whole-word/substring cue terms per goal. Kept lowercase; matched against the
// lowercased request text. Ordered loosely by specificity within each list.
const GOAL_CUES: Record<Goal, string[]> = {
  // NB: 'nurse'/'nurs' would substring-match "nursery" (rhyme) and misroute to
  // feeding — use the non-colliding 'nursing'/'breastfeed' forms instead.
  feeding: ['feeding', 'breastfeed', 'breast feed', 'nursing', 'bottle', 'suckle', 'mealtime', 'latch', 'feed'],
  sleep: ['sleep', 'asleep', 'nap', 'bedtime', 'bed time', 'lullaby', 'goodnight', 'good night', 'night', 'drowsy', 'wind down', 'wind-down', 'settle'],
  calm: ['calm', 'sooth', 'fuss', 'cry', 'crying', 'distress', 'upset', 'self-regulat', 'self regulat', 'relax', 'quiet down', 'colic'],
  focus: ['focus', 'learn', 'teach', 'vocab', 'word', 'language', 'phonic', 'count', 'letter', 'attention', 'lesson', 'practice', 'alphabet', 'number'],
  play: ['play', 'dance', 'move', 'movement', 'active', 'energetic', 'wiggle', 'bounce', 'alert', 'wake', 'stimulate', 'tummy time'],
  entertain: ['fun', 'entertain', 'silly', 'sing along', 'sing-along', 'funny', 'enjoy', 'story', 'happy song', 'joyful'],
};

// Tie-break precedence: the more clinically specific / conservative outcome wins
// a tie (feeding & sleep are the most specific asks; entertain is the catch-all).
const GOAL_PRECEDENCE: Goal[] = ['feeding', 'sleep', 'calm', 'focus', 'play', 'entertain'];

// Cues that flip a functional goal into the entertainment track (§7b): the
// caller wants engagement, not a developmental claim.
const ENTERTAINMENT_CUES = ['just for fun', 'for fun', 'silly', 'funny', 'entertain', 'sing along', 'sing-along'];
// Cues that assert a developmental purpose.
const DEVELOPMENTAL_CUES = ['learn', 'teach', 'develop', 'language', 'phonic', 'vocab', 'word', 'literacy', 'educational'];

function scoreGoals(text: string): Record<Goal, number> {
  const scores = { sleep: 0, calm: 0, play: 0, feeding: 0, focus: 0, entertain: 0 } as Record<Goal, number>;
  for (const goal of GOAL_PRECEDENCE) {
    for (const cue of GOAL_CUES[goal]) {
      if (text.includes(cue)) scores[goal] += 1;
    }
  }
  return scores;
}

function pickGoal(scores: Record<Goal, number>): { goal: Goal; max: number } {
  let best: Goal = 'calm';
  let max = -1;
  for (const goal of GOAL_PRECEDENCE) {
    if (scores[goal] > max) {
      max = scores[goal];
      best = goal;
    }
  }
  return { goal: best, max };
}

function inferIntent(goal: Goal, text: string, explicit?: Intent): Intent {
  if (explicit) return explicit;
  if (goal === 'entertain') return 'entertainment';
  if (ENTERTAINMENT_CUES.some((c) => text.includes(c)) && !DEVELOPMENTAL_CUES.some((c) => text.includes(c))) {
    return 'entertainment';
  }
  return 'developmental';
}

/**
 * Route a request to a goal + intent + protocol. If `goal` is provided it wins
 * (no inference); otherwise the free text is scored. Falls back to the
 * conservative low-arousal 'calm' protocol when nothing matches.
 */
export function routeGoal(input: { text?: string; goal?: Goal; intent?: Intent }): GoalDecision {
  const text = (input.text ?? '').toLowerCase();

  if (input.goal) {
    const intent = inferIntent(input.goal, text, input.intent);
    return {
      goal: input.goal,
      intent,
      protocol: PROTOCOL_FOR_GOAL[input.goal],
      trace: `explicit goal '${input.goal}' → ${PROTOCOL_FOR_GOAL[input.goal]} protocol (${intent})`,
      inferred: false,
    };
  }

  const scores = scoreGoals(text);
  const { goal, max } = pickGoal(scores);

  if (max <= 0) {
    // No cue matched — default to calming, the safest low-arousal choice.
    const intent = inferIntent('calm', text, input.intent);
    return {
      goal: 'calm',
      intent,
      protocol: PROTOCOL_FOR_GOAL.calm,
      trace: 'no goal cue matched → default calming protocol (conservative low-arousal fallback)',
      inferred: true,
    };
  }

  const intent = inferIntent(goal, text, input.intent);
  const tied = GOAL_PRECEDENCE.filter((g) => scores[g] === max);
  const traceTie = tied.length > 1 ? ` (tie among ${tied.join(', ')} → precedence)` : '';
  return {
    goal,
    intent,
    protocol: PROTOCOL_FOR_GOAL[goal],
    trace: `inferred goal '${goal}' from text cues${traceTie} → ${PROTOCOL_FOR_GOAL[goal]} protocol (${intent})`,
    inferred: true,
  };
}
