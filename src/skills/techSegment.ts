import { z } from 'zod';
import type { TechSegment, TechSegmentMode, TechSegmentSignals } from '../types/episode.js';
import { defineSkill } from './registry.js';

// Tech-segment skill — the fixed "tech spotlight" slot every episode carries.
// Centralizes the mode rubric (spotlight vs explainer vs hybrid), the disclosure
// copy (legal, not style), the scriptwriter brief per mode, and the QA claim
// rules per mode. The mode decision is DETERMINISTIC code over LLM-extracted
// signals: auto-run, but every input that drove the call is stored on state
// (candidates + signals + decision_trace) so QA and a human can audit it later.

// ── LLM output contracts (validated in the planner agent) ───────────────────

export const TechCandidateSchema = z.object({
  name: z.string().min(2),                       // "Oura Ring 4" | "GLP-1 peptides"
  kind: z.enum(['product', 'category']),
  relevance: z.coerce.number().min(0).max(10),   // fit with THIS episode's main topic
  why: z.string().min(4),
});
export const TechCandidatesSchema = z.object({
  candidates: z.array(TechCandidateSchema).min(1).max(6),
});
export type TechCandidates = z.infer<typeof TechCandidatesSchema>;

export const TechSignalsSchema = z.object({
  specific_product_exists: z.boolean(),   // a single, named, real product
  gulf_available: z.boolean(),            // purchasable / officially sold in UAE or KSA
  claims_testable: z.boolean(),           // specs, accuracy, published validation — verifiable
  regulatory_murky: z.boolean(),          // unclear or unapproved status in the Gulf (peptides ⇒ true)
  category_or_concept: z.boolean(),       // a category/concept, not one product
  product_name: z.string().default(''),
  product_category: z.string().default(''),
  gulf_availability: z.string().default(''),  // one plain line, e.g. "sold via Amazon.ae + Noon"
});
export type TechSignals = z.infer<typeof TechSignalsSchema>;

// ── The rubric as code ───────────────────────────────────────────────────────
// Precedence matters and is a safety choice: regulatory murkiness ALWAYS wins
// and forces explainer — a skeptical show never product-spotlights something
// whose Gulf status is unclear. Explainer is also the fallback default.
export function decideMode(sig: TechSegmentSignals): { mode: TechSegmentMode; trace: string } {
  if (sig.regulatory_murky)
    return { mode: 'explainer', trace: 'regulatory status in the Gulf is murky → explainer (hard rule: never spotlight unclear-status items)' };
  if (sig.category_or_concept && !sig.specific_product_exists)
    return { mode: 'explainer', trace: 'category/concept with no single product → explainer' };
  if (sig.specific_product_exists && sig.gulf_available && sig.claims_testable)
    return { mode: 'spotlight', trace: 'named product + Gulf-available + testable claims → spotlight' };
  if (sig.specific_product_exists)
    return { mode: 'hybrid', trace: 'named product exists but availability or testable claims fall short → hybrid (explainer spine + short real-devices beat)' };
  return { mode: 'explainer', trace: 'no strong product signal → explainer (default)' };
}

// ── Disclosure (compliance, not style) ───────────────────────────────────────
// Unsponsored: the independence line IS the brand for a test-the-trend show.
// Sponsored: paid-partnership disclosure is a legal requirement (UAE media
// council rules), so QA treats a sponsored segment without it as blocking.
export function disclosureFor(sponsored: boolean): { ar: string; en: string } {
  return sponsored
    ? { ar: 'هذا المقطع برعاية مدفوعة.', en: 'This segment is a paid partnership.' }
    : { ar: 'لم يدفع لنا أحد — رأينا مستقل.', en: 'Nobody paid us for this — our take is independent.' };
}

// Lines that must appear (verbatim) in the tech section's narration for the
// channel's configured languages. QA passes if at least one is present — a
// single-language script isn't forced to carry both — EXCEPT that the copy
// must match the sponsorship status (an independence line can't stand in for
// a paid-partnership disclosure).
export function requiredDisclosureLines(ts: Pick<TechSegment, 'sponsored' | 'disclosure'>, languages: string[]): string[] {
  // Custom copy is honored, but the canonical copy of the OPPOSITE sponsorship
  // status is treated as stale, not custom: the planner always writes the
  // independence copy (sponsored=false), so flipping only the flag must switch
  // the requirement to the paid-partnership line — never let the stale
  // independence copy satisfy a sponsored segment's legal disclosure.
  const stale = disclosureFor(!ts.sponsored);
  const stored = ts.disclosure;
  const isStale = !!stored && stored.ar === stale.ar && stored.en === stale.en;
  const d = stored && (stored.ar || stored.en) && !isStale ? stored : disclosureFor(ts.sponsored);
  const lines: string[] = [];
  if (languages.some((l) => l.toLowerCase().startsWith('ar'))) lines.push(d.ar);
  if (languages.some((l) => l.toLowerCase().startsWith('en'))) lines.push(d.en);
  return lines.length ? lines : [d.en];
}

// ── Scriptwriter brief per mode ──────────────────────────────────────────────
// Injected into the draft prompt when the segment is enabled. The section id is
// a hard contract ("tech") so the visual director, asset sourcing, and QA can
// find it deterministically.
export const TECH_SECTION_ID = 'tech';

const MODE_RULES: Record<TechSegmentMode, string> = {
  explainer: [
    'EXPLAINER rules: explain what it is and where the evidence actually stands. Hedge mechanism claims ("early research suggests", not "it does").',
    'State regulatory status plainly if relevant (approved / cleared / not approved in the Gulf — and "cleared" is NOT "approved").',
    'No purchase recommendations, no invented product specs.',
  ].join(' '),
  spotlight: [
    'SPOTLIGHT rules: concrete, testable claims only — specs, battery life, sensor accuracy, published validation. Every number must be attributable to the maker or a study.',
    'NO medical-benefit claims ("improves your sleep quality" is out; "tracks sleep stages, validated against polysomnography in X study" is in).',
    'Never say "FDA approved" for a cleared device. Mention UAE/KSA price or availability if known.',
  ].join(' '),
  hybrid: [
    'HYBRID rules: explainer spine (hedged, evidence-first) then ONE closing beat naming up to three real devices people actually buy in this category.',
    'Name devices only — do not invent specs or prices for them. No medical-benefit claims.',
  ].join(' '),
};

export function buildTechBrief(ts: TechSegment, languages: string[]): string {
  const lines = requiredDisclosureLines(ts, languages);
  return [
    `REQUIRED TECH SEGMENT — every episode carries one. Add exactly ONE section with "id":"${TECH_SECTION_ID}" and "beat":"tech spotlight", placed just before the final payoff/CTA.`,
    `Tech topic: ${ts.topic}. Tie-in to this episode: ${ts.tie_in}`,
    ts.product ? `Product: ${ts.product.name} (${ts.product.category}). Gulf availability: ${ts.product.gulf_availability || 'unknown'}.` : '',
    MODE_RULES[ts.mode],
    `End the section's vo_text with this line VERBATIM: "${lines[0]}"`,
  ].filter(Boolean).join('\n');
}

// ── QA claim rules per mode (appended to the QA review prompt) ───────────────
export function techClaimRules(mode: TechSegmentMode): string {
  const shared = 'In the tech section: flag any "FDA approved" said of a device that is only cleared, and any Gulf regulatory status stated without basis.';
  if (mode === 'explainer')
    return `${shared} Flag mechanism or benefit claims stated as fact without hedging, and any implied purchase recommendation.`;
  if (mode === 'spotlight')
    return `${shared} Flag any spec/accuracy number without an attributable source, and ANY medical-benefit claim (spotlights stick to specs).`;
  return `${shared} Flag unhedged mechanism claims in the explainer spine, and any invented spec or price attached to the named devices.`;
}

// Registered so agents can declare the dependency (validated at startup); the
// callable surface is the deterministic rubric over extracted signals.
export const techSegmentSkill = defineSkill<TechSegmentSignals, { mode: TechSegmentMode; trace: string }>({
  name: 'tech-segment',
  description: 'Fixed tech-spotlight slot: deterministic spotlight/explainer/hybrid rubric over LLM-extracted signals, disclosure copy, and per-mode script/QA rules.',
  run: async (sig) => decideMode(sig),
});
