// Parameter selector — GENERATIVE WITHIN RULE-CONSTRAINED RANGES.
//
// Turns a (goal, stage) pair into a concrete ParameterPlan by selecting the §5
// options that serve the goal and are eligible at the stage, then clamping the
// tempo against the stage's allowed envelope. The SELECTION and CLAMPING are
// deterministic rules; the descriptors they carry are what the generative
// composer is then free to phrase. A tempo that a protocol wants but the stage
// forbids is clamped DOWN, never up — stage ceilings win.

import type { Goal, ParameterChoice, ParameterKey, ParameterPlan, StageId, TempoBand } from './types.js';
import { PARAMETER_OPTIONS, STAGES, type ParameterOption } from './knowledge.js';

const STAGE_INDEX: Record<StageId, number> = Object.fromEntries(
  STAGES.map((s, i) => [s.id, i]),
) as Record<StageId, number>;

/** True when `option.fromStage` (if any) is at or before the current stage. */
function stageEligible(option: ParameterOption, stage: StageId): boolean {
  if (!option.fromStage) return true;
  return STAGE_INDEX[stage] >= STAGE_INDEX[option.fromStage];
}

/** Clamp a tempo band into the stage envelope. Returns the clamped band plus
 *  whether the stage pulled either edge in. */
function clampTempo(want: TempoBand, envelope: TempoBand): { band: TempoBand; clamped: boolean } {
  const minBpm = Math.max(want.minBpm, envelope.minBpm);
  const maxBpm = Math.min(want.maxBpm, envelope.maxBpm);
  if (maxBpm < minBpm) {
    // The wanted band lies entirely outside the stage envelope — defer wholly to
    // the stage (this only happens for a mis-specified option; never silently
    // exceed the ceiling).
    return { band: { ...envelope }, clamped: true };
  }
  const clamped = minBpm > want.minBpm || maxBpm < want.maxBpm;
  return { band: { minBpm, maxBpm }, clamped };
}

const KEY_ORDER: ParameterKey[] = [
  'tempo', 'meter', 'repetition', 'contour', 'pitch', 'consonance',
  'dynamics', 'timbre', 'vocal', 'delivery', 'mode', 'lyric-language',
];

export function selectParameters(input: {
  goal: Goal;
  stage: StageId;
  envelope: TempoBand;
}): ParameterPlan {
  const { goal, stage, envelope } = input;

  // First eligible option per key that serves this goal (options are authored in
  // preference order within each key).
  const chosen = new Map<ParameterKey, ParameterOption>();
  for (const opt of PARAMETER_OPTIONS) {
    if (!opt.goals.includes(goal)) continue;
    if (!stageEligible(opt, stage)) continue;
    if (!chosen.has(opt.key)) chosen.set(opt.key, opt);
  }

  let planTempo: TempoBand = { ...envelope };
  let tempoClamped = false;
  const notes: string[] = [];
  const choices: ParameterChoice[] = [];

  for (const key of KEY_ORDER) {
    const opt = chosen.get(key);
    if (!opt) continue;
    const choice: ParameterChoice = {
      key: opt.key,
      value: opt.value,
      descriptors: [...opt.descriptors],
      avoid: [...opt.avoid],
      effect: opt.effect,
      grade: opt.grade,
    };
    if (opt.key === 'tempo' && opt.tempo) {
      const { band, clamped } = clampTempo(opt.tempo, envelope);
      choice.tempo = band;
      planTempo = band;
      tempoClamped = clamped;
      if (clamped) {
        notes.push(
          `tempo clamped to ${band.minBpm}–${band.maxBpm} BPM by the stage ceiling (protocol wanted ${opt.tempo.minBpm}–${opt.tempo.maxBpm}).`,
        );
      }
    }
    choices.push(choice);
  }

  return { goal, stage, choices, tempo: planTempo, tempoClamped, notes };
}
