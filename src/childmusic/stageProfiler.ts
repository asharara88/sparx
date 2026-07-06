// Age/Stage Profiler (§10b) — RULE-BASED.
//
// Maps a child's age (months) or an explicit stage to the developmental-stage
// profile: active sensitive windows, the allowed tempo envelope, the harmonic/
// structural complexity ceiling, the vocal register, and the stage-appropriate
// screen note. Stage-appropriateness MUST be deterministic (a tempo/complexity
// ceiling by age is a safety-adjacent constraint), so this is pure code over the
// §4 matrix — never generative.

import type { StageId, StageProfile } from './types.js';
import { STAGES_BY_ID, stageForAgeMonths } from './knowledge.js';

/** Resolve which stage a request refers to (explicit stage / prenatal / age). */
export function resolveStage(input: { ageMonths?: number; stage?: StageId; prenatal?: boolean }): {
  stage: StageId;
  ageMonths: number | null;
} {
  if (input.prenatal) return { stage: 'prenatal', ageMonths: input.ageMonths ?? null };
  if (input.stage) return { stage: input.stage, ageMonths: input.ageMonths ?? null };
  // Require a FINITE number — a NaN age (e.g. Number('') from a bad input) must
  // NOT fall through to the oldest, least-conservative band; it drops to the
  // "nothing specified" conservative default below.
  if (typeof input.ageMonths === 'number' && Number.isFinite(input.ageMonths)) {
    if (input.ageMonths < 0) return { stage: 'prenatal', ageMonths: input.ageMonths };
    return { stage: stageForAgeMonths(input.ageMonths), ageMonths: input.ageMonths };
  }
  // Nothing specified — the caller must handle this upstream; default to the
  // widest-appropriate infant band with a null age so nothing is silently
  // assumed to be older/younger than it is.
  return { stage: '3-6mo', ageMonths: null };
}

export function profileStage(input: { ageMonths?: number; stage?: StageId; prenatal?: boolean }): StageProfile {
  const { stage, ageMonths } = resolveStage(input);
  const info = STAGES_BY_ID[stage];
  return {
    stage,
    ageMonths,
    label: info.label,
    capacities: [...info.capacities],
    windows: [...info.windows],
    allowedTempo: { ...info.allowedTempo },
    maxComplexity: info.maxComplexity,
    vocalRegister: info.vocalRegister,
    caveats: [...info.caveats],
    screenNote: info.screenNote,
  };
}
