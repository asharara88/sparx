// Registers the Music & Early-Childhood specialist's rule engines as first-class
// sparx skills (side effect of import, like every other skill module). They are
// deterministic and always "live" — no provider, no mock. Importing this module
// (via ./index.js) makes the skills discoverable through listSkills() and lets a
// future pipeline agent declare them by name.

import { defineSkill } from '../skills/registry.js';
import type {
  ChildMusicBrief,
  ChildMusicRequest,
  GoalDecision,
  GroundedClaim,
  ParameterPlan,
  SafetyReport,
  StageProfile,
} from './types.js';
import { routeGoal } from './router.js';
import { profileStage } from './stageProfiler.js';
import { selectParameters } from './parameters.js';
import { checkSafety, type SafetyInput } from './safety.js';
import { groundClaim } from './evidence.js';
import { composeChildMusicBrief } from './specialist.js';

export const childMusicRouterSkill = defineSkill<Parameters<typeof routeGoal>[0], GoalDecision>({
  name: 'child-music-router',
  description: 'Developmental-Goal Router: classify a request into a sleep/calm/play/feeding/focus/entertain protocol + developmental/entertainment intent (rule-based).',
  run: async (input) => routeGoal(input),
});

export const childMusicStageProfilerSkill = defineSkill<Parameters<typeof profileStage>[0], StageProfile>({
  name: 'child-music-stage-profiler',
  description: 'Age/Stage Profiler: map age/stage to sensitive-window flags, allowed tempo envelope, complexity ceiling, vocal register, and screen note (rule-based).',
  run: async (input) => profileStage(input),
});

export const childMusicParametersSkill = defineSkill<Parameters<typeof selectParameters>[0], ParameterPlan>({
  name: 'child-music-parameters',
  description: 'Parameter selector: choose §5 generation parameters serving the goal, stage-clamped, each carrying its evidence grade.',
  run: async (input) => selectParameters(input),
});

export const childMusicSafetySkill = defineSkill<SafetyInput, SafetyReport>({
  name: 'child-music-safety',
  description: 'Safety/Compliance Checker: fail-closed hard gate over dB/volume, crib-speaker, sleep-safety, continuous-audio, screen-vs-audio, overstimulation (rule-based).',
  run: async (input) => checkSafety(input),
});

export const childMusicEvidenceSkill = defineSkill<{ claim: string }, GroundedClaim>({
  name: 'child-music-evidence',
  description: 'Evidence-Citation Grounder: attach an evidence grade + sources to a developmental claim and BLOCK cognitive/bilingual over-claims with a safe hedge.',
  run: async ({ claim }) => groundClaim(claim),
});

export const childMusicSpecialistSkill = defineSkill<ChildMusicRequest, ChildMusicBrief>({
  name: 'child-music-specialist',
  description: 'Compose a graded, safety-checked AI-music-generation brief for prenatal–6yr: routes goal, profiles stage, selects parameters, scaffolds lyrics, grounds claims, gates safety, and emits ElevenLabs/Suno/Udio prompts.',
  run: async (request) => composeChildMusicBrief(request),
});
