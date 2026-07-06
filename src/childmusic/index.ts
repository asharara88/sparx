// Music & Early-Childhood-Development specialist — public surface.
//
// A self-contained subsystem that turns a caregiver/product request into a
// graded, safety-checked AI-music-generation brief (ElevenLabs/Suno/Udio),
// grounded in the evidence review. Decoupled from the YouTube EpisodeState
// pipeline; importing this module also registers its rule engines as sparx
// skills (see ./skills.js).
//
// Design guide: docs/Child-Music-Specialist.md

export * from './types.js';

// Orchestrator (primary entry point).
export { composeChildMusicBrief } from './specialist.js';

// Rule engines (pure functions — usable without the skill registry).
export { routeGoal } from './router.js';
export { profileStage, resolveStage } from './stageProfiler.js';
export { selectParameters } from './parameters.js';
export { planLyrics } from './lyrics.js';
export { checkSafety, type SafetyInput } from './safety.js';
export { groundClaim, claimsForBrief } from './evidence.js';
export { toElevenLabs, toSuno, toUdio, buildPrompts } from './adapters.js';

// Knowledge base (graded claims, parameter table, stage matrix, protocols, safety).
export {
  GRADED_CLAIMS,
  CLAIMS_BY_ID,
  STAGES,
  STAGES_BY_ID,
  stageForAgeMonths,
  WINDOW_INFO,
  PARAMETER_OPTIONS,
  PROTOCOLS,
  PROTOCOL_FOR_GOAL,
  SAFETY,
  RECORDED_CEILING_CAVEAT,
  type StageInfo,
  type ParameterOption,
  type Protocol,
} from './knowledge.js';

// Register the specialist's skills (side effect).
export {
  childMusicRouterSkill,
  childMusicStageProfilerSkill,
  childMusicParametersSkill,
  childMusicSafetySkill,
  childMusicEvidenceSkill,
  childMusicSpecialistSkill,
} from './skills.js';
