import { z } from 'zod';

// Schemas validating the LLM outputs at each Phase-1 step. Agents map these
// onto the stored Episode State types. Keeping the LLM contract explicit makes
// the agents robust to model drift (validated + auto-repaired in the client).

// --- Research: step 1 (ideate candidates) ---
export const AngleCandidateSchema = z.object({
  angle: z.string().min(8),
  why: z.string().min(8),
});
export const IdeationSchema = z.object({
  // Prompt asks for 3-8; an over-eager model returning more is benign drift —
  // keep the first 8 instead of forcing a paid repair round-trip.
  candidates: z.array(AngleCandidateSchema).min(3).transform((a) => a.slice(0, 8)),
});
export type Ideation = z.infer<typeof IdeationSchema>;

// --- Research: step 2 (score + select + package) ---
export const ScoredAngleSchema = z.object({
  angle: z.coerce.string(),   // models sometimes return the angle index as a number; coerce to avoid a repair round-trip
  score: z.coerce.number().min(0).max(10),
  why: z.string(),
});
export const ConceptOutputSchema = z.object({
  topic: z.string().min(3),
  working_title: z.string().min(3),
  angle: z.string().min(8),
  rationale: z.string().min(8),
  audience: z.string().min(3),
  thumbnail_concept: z.string().min(3),
  scored: z.array(ScoredAngleSchema).min(1),
  keywords: z.array(z.string()).min(3).transform((k) => k.slice(0, 12)),  // extra keywords are benign; trim, don't repair
  competitor_refs: z.array(z.string()).default([]),
  target_length_min: z.coerce.number().min(4).max(30),   // models sometimes return "10" as a string
});
export type ConceptOutput = z.infer<typeof ConceptOutputSchema>;

// Coerce a list element to a string: models sometimes return rich objects
// (e.g. {hook, rationale}) where a plain string was requested. Pull the most
// likely text field, else stringify — keeps the contract robust to model drift.
const elementToString = (v: unknown): string => {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const pick = o.hook ?? o.text ?? o.beat ?? o.variant ?? o.value ?? o.description ?? o.title ?? o.label;
    return typeof pick === 'string' ? pick : JSON.stringify(v);
  }
  return String(v ?? '');
};
// --- Scriptwriter: step 1 (beat sheet + hooks) ---
// Accept loose arrays (strings or rich objects), normalize to clean string lists,
// then enforce counts. The transform output types as string[], so callers stay typed.
export const OutlineSchema = z
  .object({
    hook_variants: z.array(z.unknown()),
    beat_sheet: z.array(z.unknown()),
  })
  .transform((o) => ({
    hook_variants: o.hook_variants.map(elementToString).filter((s) => s.length >= 8),
    beat_sheet: o.beat_sheet.map(elementToString).filter((s) => s.length >= 4),
  }))
  .refine((o) => o.hook_variants.length >= 2 && o.beat_sheet.length >= 4, {
    message: 'need >=2 hook_variants and >=4 beat_sheet items after normalization',
  });
export type Outline = z.infer<typeof OutlineSchema>;

// --- Scriptwriter: step 2 (full draft) ---
export const ScriptSectionSchema = z.object({
  id: z.coerce.string(),   // models sometimes return numeric ids; coerce to string
  beat: z.string(),
  vo_text: z.string().min(1),
  shot_note: z.string(),
  on_screen: z.string(),
  retention_device: z.string(),
});
export const ScriptDraftSchema = z.object({
  hook: z.string().min(8),
  // Max sized for the longest legitimate script: target_length_min caps at 30 and
  // sections run 2-4 sentences, so 12 was structurally too small for long targets.
  sections: z.array(ScriptSectionSchema).min(4).max(24),
  cta: z.string().min(4),
});
export type ScriptDraft = z.infer<typeof ScriptDraftSchema>;

// --- Scriptwriter: step 3 (self-critique) ---
export const CritiqueSchema = z.object({
  passes: z.boolean(),
  critique: z.string(),
  revised_hook: z.string().optional(),
});
export type Critique = z.infer<typeof CritiqueSchema>;

// --- Visual Director: shot plan ---
export const ShotPlanItemSchema = z.object({
  section_id: z.coerce.string(),   // models sometimes return numeric section ids; coerce like ScriptSectionSchema.id
  source: z.enum(['stock', 'generated', 'graphic', 'avatar', 'host']),
  reason: z.string(),
  description: z.string().min(3),
  style: z.string().optional(),
  camera: z.string().optional(),
  motion: z.enum(['low', 'medium', 'high']).optional(),
  mood: z.string().optional(),
  duration_s: z.coerce.number().min(1).max(15).optional(),   // "4" as a string is benign drift
  negative: z.array(z.string()).optional(),
});
export const ShotPlanSchema = z.object({ shots: z.array(ShotPlanItemSchema).min(1) });
export type ShotPlan = z.infer<typeof ShotPlanSchema>;
