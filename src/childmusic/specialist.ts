// The specialist orchestrator (§10b handoff chain).
//
//   Router → Stage Profiler → (Parameters ∥ Lyrics) → Evidence Grounder
//          → Safety/Compliance gate (hard, last) → tool adapters → brief
//
// Deterministic where it must be (routing, stage ceilings, safety, evidence
// gating) and generative-within-constraints where it may be (descriptors, lyric
// templates, prompt phrasing). The Safety gate runs LAST and decides status; a
// blocked brief still carries every diagnostic so a caller can explain the block.

import type { ChildMusicBrief, ChildMusicRequest, Goal, NormalizedRequest } from './types.js';
import { PROTOCOLS } from './knowledge.js';
import { routeGoal } from './router.js';
import { profileStage } from './stageProfiler.js';
import { selectParameters } from './parameters.js';
import { planLyrics } from './lyrics.js';
import { claimsForBrief } from './evidence.js';
import { checkSafety } from './safety.js';
import { buildPrompts } from './adapters.js';

// Default clip length by goal (a target; the adapters clamp to provider bounds).
const DEFAULT_LENGTH_MS: Record<Goal, number> = {
  sleep: 120_000,
  feeding: 120_000,
  calm: 90_000,
  play: 45_000,
  focus: 60_000,
  entertain: 60_000,
};

function normalize(request: ChildMusicRequest, goal: Goal, stage: NormalizedRequest['stage'], ageMonths: number | null): NormalizedRequest {
  const languages = request.languages && request.languages.length ? request.languages : ['en'];
  const d = request.delivery ?? {};
  return {
    goal,
    intent: 'developmental', // overwritten by the caller with the routed intent
    stage,
    ageMonths,
    prenatal: stage === 'prenatal',
    languages,
    delivery: {
      speaker: d.speaker ?? 'room',
      continuous: d.continuous ?? false,
      nicu: d.nicu ?? false,
      caregiverPresent: d.caregiverPresent ?? true,
    },
    lengthMs: request.lengthMs ?? DEFAULT_LENGTH_MS[goal],
  };
}

export function composeChildMusicBrief(request: ChildMusicRequest): ChildMusicBrief {
  // 1) Route to a goal + intent + protocol.
  const goalDecision = routeGoal({ text: request.text, goal: request.goal, intent: request.intent });

  // 2) Profile the developmental stage.
  const stage = profileStage({ ageMonths: request.ageMonths, stage: request.stage, prenatal: request.prenatal });

  // Normalized, echoed request (carries the routed intent).
  const norm = normalize(request, goalDecision.goal, stage.stage, stage.ageMonths);
  norm.intent = goalDecision.intent;

  // 3) Parameters (stage-clamped) ∥ 4) Lyrics.
  const parameters = selectParameters({ goal: goalDecision.goal, stage: stage.stage, envelope: stage.allowedTempo });
  const lyrics = planLyrics({ goal: goalDecision.goal, intent: goalDecision.intent, stage: stage.stage, languages: norm.languages });

  // 5) Evidence grounding — graded claims + explicit over-claim guardrails.
  const claims = claimsForBrief({
    goal: goalDecision.goal,
    intent: goalDecision.intent,
    stage: stage.stage,
    windows: stage.windows,
    languages: norm.languages,
  });

  // 6) Safety/Compliance gate — HARD, runs last, decides status.
  const safety = checkSafety({
    goal: goalDecision.goal,
    stage: stage.stage,
    speaker: norm.delivery.speaker,
    continuous: norm.delivery.continuous,
    nicu: norm.delivery.nicu,
    caregiverPresent: norm.delivery.caregiverPresent,
    tempo: parameters.tempo,
  });

  // 7) Tool adapters.
  const prompts = buildPrompts({ goal: goalDecision.goal, plan: parameters, lyrics, lengthMs: norm.lengthMs });

  const protocolGrade = PROTOCOLS[goalDecision.protocol].grade;
  const status: ChildMusicBrief['status'] = safety.passed ? 'ok' : 'blocked';
  const summary = `${goalDecision.goal} · ${stage.label} · tempo ${parameters.tempo.minBpm}–${parameters.tempo.maxBpm} BPM · ${goalDecision.protocol} protocol (${protocolGrade}) · ${status}`;

  return {
    status,
    request: norm,
    goal: goalDecision,
    stage,
    parameters,
    lyrics,
    claims,
    safety,
    prompts,
    summary,
  };
}
