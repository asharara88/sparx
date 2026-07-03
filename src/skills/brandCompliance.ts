import type { EpisodeState, Script } from '../types/episode.js';
import type { LLM } from '../llm/client.js';
import { QAReviewSchema, type QAReview } from '../schemas/phase34.js';
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

// Recognized license families. Providers return prose forms ('Pexels License',
// 'elevenlabs-music') and mocks suffix ('mock-stock-license'), so match by exact
// value, prefix, or token — never bare substring ('unlicensed' must NOT match
// 'licensed'). Anything unrecognized fails closed.
const LICENSE_KEYS = ['mock', 'pexels', 'cc0', 'cc-by', 'licensed', 'owned', 'epidemic', 'elevenlabs'];

export function isLicenseAccepted(license: string | null | undefined): boolean {
  if (!license) return false;
  const l = license.trim().toLowerCase();
  return LICENSE_KEYS.some((k) => l === k || l.startsWith(k) || l.split(/[^a-z0-9-]+/).includes(k));
}

export function checkCompliance(state: EpisodeState): ComplianceReport {
  const issues: string[] = [];

  // 1) banned phrases — the house style bans them in prompts, enforce them in output
  const text = [state.script.hook, ...state.script.sections.map((s) => s.vo_text), state.script.cta].join(' ').toLowerCase();
  const banned_phrase_hits = BANNED_PHRASES.filter((p) => text.includes(p.toLowerCase()));
  if (banned_phrase_hits.length) issues.push(`banned phrases in script: ${banned_phrase_hits.join(', ')}`);

  // 2) licensing — every sourced asset + the music bed (when one exists) must carry a recognized license
  for (const a of state.sourced_assets) {
    if (!isLicenseAccepted(a.license)) issues.push(`asset ${a.shot_id} license '${a.license || 'missing'}' not recognized`);
  }
  if (state.music.track_uri && !isLicenseAccepted(state.music.license)) {
    issues.push(`music license '${state.music.license || 'missing'}' not recognized`);
  }

  // 3) synthetic-media disclosure — required whenever AI-generated video or an avatar appears
  const disclosure_required = state.generated_video.length > 0 || state.avatar_clips.length > 0;

  return { passed: issues.length === 0, issues, banned_phrase_hits, disclosure_required };
}

// LLM voice review lives with compliance so QA stays a thin gate. Scoped to brand
// voice + sniffing claims that are unverifiable AS PHRASED (evidence-based checks
// are the fact_checker's job). Throws propagate — the caller decides fail-closed.
export async function reviewBrandVoice(script: Script, llm: LLM, extraRules?: string): Promise<{ review: QAReview; cost_usd: number }> {
  const narration = script.sections.map((s) => s.vo_text).join('\n').slice(0, 6000);
  const res = await llm.complete({
    tier: 'fast', temperature: 0.2, schema: QAReviewSchema,
    system: 'You review YouTube narration for brand voice (confident, specific, no hype cliches) and flag claims phrased so vaguely or absolutely that no source could verify them as stated. Do not re-verify facts against the world. Be specific and conservative.',
    prompt: `Hook: ${script.hook}\nNarration:\n${narration}${extraRules ? `\n\n${extraRules}` : ''}\n\nReturn JSON {"claims_ok":boolean,"brand_ok":boolean,"issues":["specific issue", ...]}.`,
    mock: JSON.stringify({ claims_ok: true, brand_ok: true, issues: [] }),
  });
  return { review: res.data!, cost_usd: res.usage.costUsd };
}

export const brandComplianceSkill = defineSkill<{ state: EpisodeState }, ComplianceReport>({
  name: 'brand-compliance',
  description: 'Deterministic fail-closed compliance pass: banned-phrase scan of the script, license validation for assets/music, synthetic-media disclosure computation.',
  run: async ({ state }) => checkCompliance(state),
});
