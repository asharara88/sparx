// Safety/Compliance Checker (§10b, §8) — RULE-BASED HARD GATE, FAIL-CLOSED.
//
// Runs LAST and is non-overridable. Anything unverifiable is treated as an issue
// (never a silent pass), mirroring brandCompliance. It separates hard `blocks`
// (a non-empty list fails the brief) from advisory `warnings`, and always emits
// positive `guidance` (dB target, wind-down, audio≠screen, overstim signs) so a
// caregiver gets actionable direction even on a clean pass.

import type { Goal, SafetyReport, StageId, TempoBand } from './types.js';
import { SAFETY } from './knowledge.js';

const SAFE_SPEAKERS = new Set(['room']);
const FORBIDDEN_SPEAKERS = new Set<string>(SAFETY.forbiddenSpeakerPlacements);
// Under-2 stages: headphones deliver sound at the ear, which the "never near-ear"
// hearing-safety rule forbids for an infant/toddler.
const INFANT_STAGES = new Set<StageId>(['prenatal', '0-3mo', '3-6mo', '6-12mo', '12-18mo', '18-24mo']);

export interface SafetyInput {
  goal: Goal;
  stage: StageId;
  speaker: 'room' | 'crib' | 'near-ear' | 'headphones';
  continuous: boolean;
  nicu: boolean;
  caregiverPresent: boolean;
  tempo: TempoBand;
}

export function checkSafety(input: SafetyInput): SafetyReport {
  const blocks: string[] = [];
  const warnings: string[] = [];
  const guidance: string[] = [];

  // 1) Speaker placement — the one hard, non-negotiable block (§8).
  if (FORBIDDEN_SPEAKERS.has(input.speaker)) {
    blocks.push(
      `speaker placement '${input.speaker}' is forbidden — never use in-crib or near-ear speakers for an infant (hearing-safety hard rule).`,
    );
  } else if (input.speaker === 'headphones') {
    // Headphones are near-ear delivery. Hard-block for infants/toddlers; for older
    // children (2 yr+) allow with a conservative-volume caution.
    if (INFANT_STAGES.has(input.stage)) {
      blocks.push(`headphones deliver sound at the ear — not safe for an infant/toddler (${input.stage}); use a room speaker at low volume instead.`);
    } else {
      warnings.push('headphones sit close to the ear — keep the volume conservative and prefer a room speaker.');
    }
  } else if (!SAFE_SPEAKERS.has(input.speaker)) {
    // Fail-closed: an unrecognized placement is a warning, not an assumed pass.
    warnings.push(`unrecognized speaker placement '${input.speaker}' — keep the source out of the crib and away from the ear.`);
  }

  // 2) Volume guidance — always present, tightened for NICU/preterm.
  if (input.nicu) {
    guidance.push(
      `NICU/preterm: keep sustained level ≤${SAFETY.db.nicuSustainedMax} dB and transient ≤${SAFETY.db.nicuTransientMax} dB. ${SAFETY.hearingVulnerability}`,
    );
  } else {
    guidance.push(`Keep volume low (~${SAFETY.db.homeTarget} dB range) for home infant listening; never via in-crib/near-ear speakers.`);
  }

  // 3) NICU feeding / clinical use — recorded AI is not a substitute for a
  //    certified therapist in that setting (§6). Strong caution, not a code block.
  if (input.nicu && input.goal === 'feeding') {
    warnings.push(
      'NICU feeding support requires a certified music therapist for live entrained work; AI-generated audio is a supplement, not a substitute, in the clinical setting.',
    );
  }

  // 4) Continuous background audio caveat (§8) — except a sleep wind-down, where
  //    steady low background is an accepted pattern.
  if (input.continuous && input.goal !== 'sleep') {
    warnings.push('continuous background audio can reduce caregiver talk — prefer bounded play and turn it off between activities.');
  }

  // 5) Sleep-specific guidance (§8) + a tempo sanity check for the sleep goal.
  if (input.goal === 'sleep') {
    guidance.push(...SAFETY.sleep);
    if (input.tempo.maxBpm > 90) {
      warnings.push(`tempo ceiling ${input.tempo.maxBpm} BPM is high for a sleep goal — a lullaby should sit near 60–70 BPM.`);
    }
  }

  // 6) Active-distress calming — the live-singing caveat is a caregiver-facing
  //    note rather than a block.
  if (input.goal === 'calm' && !input.caregiverPresent) {
    guidance.push('For active distress, live/contingent caregiver singing outperforms recorded audio — use this as a supplement.');
  }

  // 7) Universal guidance: overstimulation signs + audio-vs-screen distinction.
  guidance.push(`Stop if you see overstimulation: ${SAFETY.overstimulationSigns.join(', ')}.`);
  guidance.push(SAFETY.audioVsScreen);

  return { passed: blocks.length === 0, blocks, warnings, guidance };
}
