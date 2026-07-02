import { z } from 'zod';
import { createLogger } from '../logger.js';

// Shared "house style" and prompt builders for script generation, used by BOTH the
// production scriptwriter agent and the demo renderer so quality, format, and pacing
// stay consistent on every run. Centralizing this is what lets one edit improve every
// path at once, and the rotating "lens" keeps successive runs from converging on the
// same structure and phrasing.

const log = createLogger({ mod: 'scriptPrompt' });

// Lightweight demo/AB script shape (the production ScriptDraftSchema is richer). Shared
// so the demo renderer and the A/B harness validate against one definition. Max sized
// above what buildDemoPrompt callers request, so a correct response never fails validation.
export const DemoScriptSchema = z.object({
  hook: z.string().min(8),
  sections: z.array(z.object({ vo_text: z.string().min(1), on_screen: z.string().min(1) })).min(1).max(12),
  cta: z.string().min(1),
});
export type DemoScript = z.infer<typeof DemoScriptSchema>;

// Refined topic brief. A raw user topic (often a bare phrase like "AI tools" or a vague
// one-liner) is first optimized into a sharper, more specific topic + a concrete angle
// BEFORE it reaches the expensive creative model. This front-loads the "what should this
// actually be about?" thinking on a cheap model so the pro model spends its tokens writing.
export const RefinedTopicSchema = z.object({
  topic: z.string().min(8),   // sharpened, specific, self-contained topic line
  angle: z.string().min(8),   // the single most compelling angle to take on it
});
export type RefinedTopic = z.infer<typeof RefinedTopicSchema>;

// Spoken delivery target. Narration is for the ear, not the page — keep it close to
// natural speech tempo so on-screen pacing and runtime estimates line up.
export const SPOKEN_WPM = 140;

// Phrases that signal generic, low-effort YouTube narration. Banned outright so the
// model spends its tokens on substance instead of filler.
export const BANNED_PHRASES = [
  "in today's video",
  "let's dive in",
  'game-changer',
  'supercharge',
  'unlock the power',
  'in this fast-paced world',
  'buckle up',
  'without further ado',
  'the truth is',
  'at the end of the day',
];

// Rotating creative lenses. One is chosen per run so the same topic doesn't always
// produce the same shape. Variety WITHOUT abandoning the house rules below.
export const LENSES = [
  'Open on a concrete, surprising specific — a number, a named moment, a real failure — never a generic statement.',
  'Build the whole piece around ONE counterintuitive claim and keep circling back to it as proof accumulates.',
  'Use a before/after spine: vividly show the viewer\'s world before this insight, then how it changes after.',
  'Lead with a belief almost everyone repeats, then dismantle it piece by piece with evidence.',
  'Tell it as a short story with one protagonist and a clear turning point.',
  'Frame it as a teardown: take the "obvious" approach apart and show the better mechanism underneath.',
];

// Pick a lens for this run. Deterministic when given a seed (tests/repro), varied otherwise.
export function pickLens(seed?: number): string {
  const i = seed === undefined ? Math.floor(Math.random() * LENSES.length) : Math.abs(seed) % LENSES.length;
  return LENSES[i % LENSES.length]!;
}

export const HOUSE_STYLE = `House style — apply on every run:
- Write for the ear: short, natural sentences a person would actually say out loud. Use contractions.
- Plain language for a broad, general audience: aim for a ~6th–8th-grade reading level. Use everyday words over technical or formal ones (say "use" not "utilize", "doctors" not "clinicians", "rule of thumb" not "heuristic"). Prefer the simplest word that's still accurate.
- No unexplained jargon, acronyms, or insider terms. If a technical term is genuinely unavoidable, define it in one short, plain clause the first time ("sleep regression — when a baby who slept well suddenly stops").
- Explain it like you're talking to a smart friend who's new to the topic, not an expert. Use concrete, familiar comparisons over abstract or clinical phrasing.
- Earn attention continuously: every section either opens a curiosity loop or pays one off. No throat-clearing, no recap filler.
- Specifics over abstractions: concrete examples, real numbers, named things — never "many people", "a lot of value", "studies show".
- One idea per section, advancing the story; don't restate the previous section.
- Pacing: ~${SPOKEN_WPM} words per spoken minute; 2-4 sentences per section.
- Never use these phrases: ${BANNED_PHRASES.map((p) => `"${p}"`).join(', ')}.`;

// Shared system prompt (persona + house style). Both generators use this so the voice
// is identical regardless of entry point.
export const SCRIPT_SYSTEM =
  `You are an elite YouTube scriptwriter who obsesses over retention and writes for the ear, not the page. ` +
  `You plan tight, hook hard, and cut every word that doesn't move the viewer forward.\n${HOUSE_STYLE}`;

// Production draft prompt — rich sections with beats + retention devices.
export function buildDraftPrompt(p: {
  topic: string;
  angle: string;
  hostMode: string;
  hook: string;
  beats: string[];
  targetWords: number;
  minSections?: number;
  maxSections?: number;
  lens?: string;
  techBrief?: string;   // fixed tech-spotlight slot (skills/techSegment) — appended when the segment is enabled
}): string {
  const lens = p.lens ?? pickLens();
  const lo = p.minSections ?? 5;
  const hi = p.maxSections ?? 9;
  return [
    `Topic: ${p.topic}`,
    `Angle: ${p.angle}`,
    `Host mode: ${p.hostMode}`,
    `Chosen hook: ${p.hook}`,
    `Beat sheet: ${p.beats.join(' | ')}`,
    `Creative lens for THIS script: ${lens}`,
    `Total spoken target: ~${p.targetWords} words.`,
    ``,
    `Write the full narration. Return ONLY JSON:`,
    `{"hook": string, "sections": [${lo}-${hi} objects ` +
      `{"id": "s1".., "beat": short beat label, "vo_text": 2-4 spoken sentences, ` +
      `"shot_note": what's on screen, "on_screen": <=6-word caption, "retention_device": e.g. open loop / payoff / pattern interrupt}], "cta": string}`,
    `Make vo_text genuinely speakable and specific. The hook must create an immediate, concrete reason to keep watching.`,
    ...(p.techBrief ? ['', p.techBrief] : []),
  ].join('\n');
}

// Demo prompt — lightweight (caption-slate sections), same voice and rules.
export function buildDemoPrompt(p: { topic: string; sections: number; lens?: string; angle?: string }): string {
  const lens = p.lens ?? pickLens();
  return [
    `Topic: ${p.topic}`,
    ...(p.angle ? [`Angle: ${p.angle}`] : []),
    `Creative lens for THIS script: ${lens}`,
    ``,
    `Return ONLY JSON: {"hook": string, ` +
      `"sections": [exactly ${p.sections} objects {"vo_text": 2-4 spoken sentences, "on_screen": a <=6-word caption}], ` +
      `"cta": string}.`,
    `Every vo_text must be concrete and speakable; the hook must give an immediate reason to keep watching.`,
  ].join('\n');
}

// ── Topic refinement (runs BEFORE script generation, on a cheap tier) ────────────────
// System persona for the refinement pass. Its job is NOT to write the script — only to
// turn whatever the user typed into the best possible brief for the scriptwriter.
export const TOPIC_REFINE_SYSTEM =
  `You are a YouTube content strategist. Given a raw, often vague or overly broad topic a ` +
  `creator typed in, you reshape it into ONE sharp, specific, and genuinely compelling video ` +
  `topic, plus the single best angle to take on it. You DO NOT write the script — you set it up ` +
  `to succeed.\n` +
  `Rules:\n` +
  `- Narrow broad topics to something concrete and searchable (a specific claim, list, story, or question), not a category.\n` +
  `- Keep the creator's actual intent and subject; sharpen it, don't replace it with a different subject.\n` +
  `- Prefer specifics: real numbers, named things, a clear promise of what the viewer learns.\n` +
  `- The angle is the hook-worthy tension: what's surprising, counterintuitive, or high-stakes about this.\n` +
  `- Keep both fields to a single sentence. No preamble, no hashtags, no emoji.`;

export function buildTopicRefinePrompt(rawTopic: string): string {
  return [
    `Raw topic from the creator: "${rawTopic}"`,
    ``,
    `Return ONLY JSON: {"topic": string, "angle": string}.`,
    `"topic" = the sharpened, specific, self-contained video topic.`,
    `"angle" = the single most compelling angle/tension to build the video around.`,
  ].join('\n');
}

// Minimal shape of the LLM needed here — avoids importing the client type and the cycle
// that would create (client → skills → client).
interface RefineLLM {
  complete<T>(args: {
    tier: 'fast'; temperature: number; maxTokens: number; schema: typeof RefinedTopicSchema;
    system: string; prompt: string; mock: string;
  }): Promise<{ data?: RefinedTopic }>;
}

// Refine a raw user topic into an optimized {topic, angle} brief using the FAST (cheap)
// tier, so the pro/creative model receives a sharpened prompt. Never throws: on any
// failure it falls back to the raw topic with no angle, so a refinement hiccup can't
// block a render.
export async function refineTopic(llm: RefineLLM, rawTopic: string): Promise<RefinedTopic> {
  const raw = rawTopic.trim();
  const fallback: RefinedTopic = { topic: raw, angle: '' };
  if (!raw) return fallback;
  try {
    const res = await llm.complete({
      tier: 'fast', temperature: 0.5, maxTokens: 400, schema: RefinedTopicSchema,
      system: TOPIC_REFINE_SYSTEM,
      prompt: buildTopicRefinePrompt(raw),
      mock: JSON.stringify({ topic: raw, angle: `A specific, surprising take on ${raw}.` }),
    });
    return res.data ?? fallback;
  } catch (err) {
    log.warn('topic refinement failed, using raw topic', { err: String(err).slice(0, 160) });
    return fallback;
  }
}
