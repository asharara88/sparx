// Evidence-Citation Grounder (§10b, §2, §9) — RULE-BASED / retrieval.
//
// Two jobs:
//   1. groundClaim(text)   — screen any developmental claim a caller wants to
//      surface. Over-claims (IQ/cognitive boost, accelerated bilingual/L2,
//      passive-listening brain change, long-term transfer) are BLOCKED and
//      returned with a safe, graded hedge. Known-good claims get their grade +
//      sources attached. Anything unrecognized is allowed but flagged ungrounded.
//   2. claimsForBrief(...)  — the set of graded claims a brief legitimately
//      implies for its goal/stage/languages, including the explicit "do NOT
//      claim acceleration" guardrails for bilingual work and the recorded-music
//      ceiling caveat. Entertainment briefs imply no developmental claims.
//
// This is where the pipeline's promise lives: never assert cognitive or
// bilingual acceleration; always surface the grade when a benefit is implied.

import type { Goal, GroundedClaim, Intent, LangTag, SensitiveWindow, StageId } from './types.js';
import { CLAIMS_BY_ID, RECORDED_CEILING_CAVEAT } from './knowledge.js';

interface OverclaimPattern {
  test: RegExp;
  claimId: string;
  rewrite: string;
}

// Ordered most-specific → least. First match wins. Patterns match the verb→object
// AND object→verb orders (marketing copy writes it both ways: "boost IQ" and "IQ
// boost", "smarter baby" and "baby … smarter") so a reversed phrasing can't slip
// the guardrail. Bilingual triggers are kept to ACCELERATION verbs so legitimate
// "improve bilingual exposure" claims aren't blocked — only acceleration is.
const OVERCLAIM_PATTERNS: OverclaimPattern[] = [
  {
    test: /mozart effect|baby einstein|\bgenius\b|\bbrainier\b|\b(?:boost|rais\w*|increas\w*|improv\w*|higher|enhanc\w*|maximi[sz]\w*|develop\w*|supercharg\w*|build\w*|support\w*|help\w*|promot\w*|nurtur\w*|foster\w*|unlock\w*|grow\w*|bigger)\b[\s\S]{0,30}\b(?:iq|intelligence|cognit\w*)\b|\b(?:iq|intelligence|cognit\w*)\b[\s\S]{0,30}\b(?:boost|rais\w*|increas\w*|improv\w*|higher|gains?|enhanc\w*|bigger)\b|\bsmart(?:er)?\b[\s\S]{0,20}\b(?:baby|babies|child|children|kid|kids|toddler|infant|newborn)\b|\b(?:baby|babies|child|children|kid|kids|toddler|infant|newborn)\b[\s\S]{0,20}\bsmart(?:er)?\b|\b(?:baby|babies|child|children|kid|kids|toddler|infant|newborn)(?:['’]s)?\b[\s\S]{0,20}\b(?:iq|intelligence)\b|\b(?:iq|intelligence)\b[\s\S]{0,20}\b(?:baby|babies|child|children|kid|kids|toddler|infant|newborn)\b/i,
    claimId: 'mozart-effect',
    rewrite:
      'Music reliably supports infant arousal regulation, calming, and bonding — it does NOT raise IQ or general intelligence (the "Mozart effect" is Debunked).',
  },
  {
    test: /passive[\s\S]{0,30}(?:brain|neural)|listening[\s\S]{0,30}(?:brain|neural)|(?:\bbrain\b|\bneural\b)[\s\S]{0,20}(?:develop\w*|grow\w*|boost\w*|build\w*|wir\w*|structure|structural)|(?:develop\w*|grow\w*|boost\w*|build\w*|rewir\w*)[\s\S]{0,20}(?:\bbrain\b|\bneural\b)/i,
    claimId: 'passive-listening-brain',
    rewrite:
      'There is no RCT-grade evidence that passive recorded-music listening changes infant brain structure (Emerging/insufficient). Beat and contour perception are innate; that is the defensible neural claim.',
  },
  {
    test: /\barabic\b[\s\S]{0,40}\benglish\b|\benglish\b[\s\S]{0,40}\barabic\b/i,
    claimId: 'arabic-english-music',
    rewrite:
      'Rigorous Arabic–English early-childhood music evidence is essentially absent. Exposure to both languages helps (Strong); do not claim songs specifically accelerate Arabic/English acquisition.',
  },
  {
    // Pure-acceleration verbs block bare "bilingual"; generic verbs (boost/
    // increase/improve) only block when the OBJECT is acquisition/fluency — so
    // "boost bilingual EXPOSURE" (a Strong, legitimate claim) is left allowed.
    test: /(?:acceler\w*|faster|quicker|sooner|speed\w*|jump[- ]?start\w*|fast[- ]?track\w*)[\s\S]{0,30}(?:bilingual|second[- ]language|\bl2\b|dual[- ]language|language acquisition|language learning)|(?:bilingual|second[- ]language|\bl2\b|language acquisition)[\s\S]{0,30}(?:acceler\w*|faster|quicker|sooner|speed\w*)|(?:boost\w*|increas\w*|improv\w*|enhanc\w*)[\s\S]{0,25}(?:bilingual|second[- ]language|\bl2\b|dual[- ]language)[\s\S]{0,25}(?:acquisition|acquir\w*|learning|fluen\w*|proficien\w*)|(?:songs?|music)[\s\S]{0,30}(?:teach\w*|make\w*)[\s\S]{0,20}(?:bilingual|fluent)/i,
    claimId: 'music-accelerates-bilingual',
    rewrite:
      'Bilingual EXPOSURE benefits are well established (Strong), but songs are NOT proven to accelerate second-language acquisition (Contested; the best-controlled preschool study found songs inferior to stories). Use songs as an engagement vehicle, not an accelerator.',
  },
  {
    test: /(?:cognitive|academic|executive[- ]function)[\s\S]{0,30}(?:transfer|gains?|boost\w*|improv\w*|accelerat\w*|advantage|benefit)|(?:boost\w*|improv\w*|enhanc\w*|develop\w*|increas\w*|accelerat\w*)[\s\S]{0,30}(?:cognit\w*|executive[- ]function|brain development|mental development)|(?:cognitive|intellectual|mental)\s+(?:development|growth|skills?|abilit\w*)|music (?:training|lessons?|class\w*|instruction)[\s\S]{0,30}(?:iq|smart\w*|academic|cognit\w*|grades?|test scores?)/i,
    claimId: 'music-training-transfer',
    rewrite:
      'Broad cognitive/academic transfer from music training is Contested (near-null in the best-controlled meta-analyses; small inhibitory-control effects survive) and pertains to active music-making ages 3–12, not infant listening.',
  },
  {
    test: /(?:long[- ]term|24[- ]month|permanent\w*|lasting|durable|lifelong)[\s\S]{0,30}(?:language|vocabulary|reading|literacy|cognit\w*|academic|development|outcomes?)|(?:language|vocabulary|reading|literacy|cognit\w*|academic|outcomes?)[\s\S]{0,25}(?:long[- ]term|lasting|permanent\w*|lifelong)/i,
    claimId: 'long-term-language-transfer',
    rewrite:
      'The large LongSTEP RCT found infant-directed singing did NOT significantly improve 24-month language outcomes — do not claim long-term language gains.',
  },
];

// Keyword → known-good claim id, for attaching a grade to a benign benefit claim.
const POSITIVE_HINTS: { test: RegExp; claimId: string }[] = [
  { test: /\b(arous|calm|sooth|settle|relax|regulat)/i, claimId: 'arousal-regulation' },
  { test: /\bbond|attach|closeness\b/i, claimId: 'bonding' },
  { test: /\b(rhythm|beat).{0,30}(read|phonolog|literacy)/i, claimId: 'rhythm-reading-link' },
  { test: /\b(repetition|statistical|segment)/i, claimId: 'statistical-learning' },
  { test: /\b(phoneme|native language|narrowing)/i, claimId: 'perceptual-narrowing' },
  { test: /\bsleep\b/i, claimId: 'lullaby-calming-recorded' },
  { test: /\bpreterm|nicu|feeding\b/i, claimId: 'nicu-music-therapy' },
];

function grounded(claimId: string, opts: { allowed: boolean; rewrite?: string; reason?: string; claimText?: string }): GroundedClaim {
  const c = CLAIMS_BY_ID[claimId];
  if (!c) {
    return { claim: opts.claimText ?? claimId, grade: 'Emerging', sources: [], allowed: opts.allowed, rewrite: opts.rewrite, reason: opts.reason };
  }
  return {
    claim: opts.claimText ?? c.statement,
    grade: c.grade,
    sources: c.sources,
    allowed: opts.allowed,
    rewrite: opts.rewrite,
    reason: opts.reason,
  };
}

/** Screen a single free-text developmental claim. */
export function groundClaim(text: string): GroundedClaim {
  for (const p of OVERCLAIM_PATTERNS) {
    if (p.test.test(text)) {
      return grounded(p.claimId, {
        allowed: false,
        rewrite: p.rewrite,
        reason: 'over-claim blocked by the evidence grounder',
        claimText: text,
      });
    }
  }
  for (const h of POSITIVE_HINTS) {
    if (h.test.test(text)) {
      return grounded(h.claimId, { allowed: true, claimText: text, reason: 'matched a graded claim' });
    }
  }
  return {
    claim: text,
    grade: 'Emerging',
    sources: [],
    allowed: true,
    reason: 'no matching graded claim — surface descriptively, do not assert as established.',
  };
}

/** The graded claims a brief legitimately implies. */
export function claimsForBrief(input: {
  goal: Goal;
  intent: Intent;
  stage: StageId;
  windows: SensitiveWindow[];
  languages: LangTag[];
}): GroundedClaim[] {
  // Entertainment briefs make no developmental claims by design (§7b).
  if (input.intent === 'entertainment') return [];

  const ids = new Set<string>();
  const GOAL_CLAIMS: Record<Goal, string[]> = {
    sleep: ['arousal-regulation', 'lullaby-calming-recorded'],
    calm: ['arousal-regulation', 'lullaby-calming-recorded', 'bonding'],
    play: ['id-singing-preference', 'beat-perception-innate'],
    feeding: ['nicu-music-therapy'],
    focus: ['statistical-learning', 'rhythm-reading-link', 'vocab-via-song'],
    entertain: [],
  };
  for (const id of GOAL_CLAIMS[input.goal]) ids.add(id);

  if (input.stage === 'prenatal') ids.add('prenatal-auditory-learning');
  if (input.windows.includes('phoneme-narrowing') || input.windows.includes('rhythm-enculturation')) {
    ids.add('perceptual-narrowing');
  }

  const out: GroundedClaim[] = [...ids].map((id) => grounded(id, { allowed: true }));

  // Bilingual work: exposure is Strong; acceleration is a blocked over-claim that
  // we carry EXPLICITLY so the brief documents what must not be said.
  const langs = input.languages.map((l) => l.toLowerCase().slice(0, 2));
  if (new Set(langs).size >= 2) {
    out.push(grounded('bilingual-exposure', { allowed: true }));
    const hasArEn = langs.includes('ar') && langs.includes('en');
    out.push(
      grounded(hasArEn ? 'arabic-english-music' : 'music-accelerates-bilingual', {
        allowed: false,
        reason: 'guardrail: bilingual/L2 acceleration must not be claimed',
        rewrite: hasArEn
          ? 'Keep Arabic and English in separate songs/sections; pair with caregiver interaction. Exposure helps (Strong); do not claim accelerated Arabic/English acquisition (evidence absent).'
          : 'Exposure to both languages helps (Strong); songs are an engagement vehicle, not a proven accelerator (Contested).',
      }),
    );
  }

  // The single most important product caveat rides on every developmental brief.
  out.push({
    claim: RECORDED_CEILING_CAVEAT,
    grade: 'Strong',
    sources: [{ ref: 'Knowledge base §9 (recorded/AI ceiling; LongSTEP null 24-mo result)' }],
    allowed: true,
    reason: 'product caveat — recorded/AI music is a supplement to live caregiver singing, not a replacement',
  });

  return out;
}
