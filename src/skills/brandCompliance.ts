import type { EpisodeState } from '../types/episode.js';
import { BANNED_PHRASES } from './scriptPrompt.js';
import { defineSkill } from './registry.js';

// Real brand/compliance checks (replaces the always-compliant stub — a compliance
// check that can only pass is a landmine on the Gate C path). Deterministic and
// FAIL-CLOSED: anything unverifiable is an issue, never a silent pass.

export interface ComplianceReport {
  passed: boolean;
  issues: string[];
  banned_phrase_hits: string[];
  disclosure_required: boolean;
}

const ACCEPTED_LICENSES = new Set(['pexels', 'cc0', 'cc-by', 'licensed', 'owned', 'mock']);

export function checkCompliance(state: EpisodeState): ComplianceReport {
  const issues: string[] = [];

  // 1) banned phrases — the house style bans them in prompts, enforce them in output
  const text = [state.script.hook, ...state.script.sections.map((s) => s.vo_text), state.script.cta].join(' ').toLowerCase();
  const banned_phrase_hits = BANNED_PHRASES.filter((p) => text.includes(p.toLowerCase()));
  if (banned_phrase_hits.length) issues.push(`banned phrases in script: ${banned_phrase_hits.join(', ')}`);

  // 2) licensing — every sourced asset + the music bed must carry a recognized license
  for (const a of state.sourced_assets) {
    if (!a.license || !ACCEPTED_LICENSES.has(a.license.toLowerCase())) issues.push(`asset ${a.shot_id} license '${a.license || 'missing'}' not recognized`);
  }
  if (state.music.track_uri && (!state.music.license || !ACCEPTED_LICENSES.has(state.music.license.toLowerCase()))) {
    issues.push(`music license '${state.music.license || 'missing'}' not recognized`);
  }

  // 3) synthetic-media disclosure — required whenever AI-generated video or an avatar appears
  const disclosure_required = state.generated_video.length > 0 || state.avatar_clips.length > 0;

  return { passed: issues.length === 0, issues, banned_phrase_hits, disclosure_required };
}

export const brandComplianceSkill = defineSkill<{ state: EpisodeState }, ComplianceReport>({
  name: 'brand-compliance',
  description: 'Deterministic fail-closed compliance pass: banned-phrase scan of the script, license validation for assets/music, synthetic-media disclosure computation.',
  run: async ({ state }) => checkCompliance(state),
});
