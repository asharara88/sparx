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
  candidates: z.array(AngleCandidateSchema).min(3).max(8),
});
export type Ideation = z.infer<typeof IdeationSchema>;

// --- Research: step 2 (score + select + package) ---
export const ScoredAngleSchema = z.object({
  angle: z.string(),
  score: z.number().min(0).max(10),
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
  keywords: z.array(z.string()).min(3).max(12),
  competitor_refs: z.array(z.string()).default([]),
  target_length_min: z.number().min(4).max(30),
});
export type ConceptOutput = z.infer<typeof ConceptOutputSchema>;

// --- Scriptwriter: step 1 (beat sheet + hooks) ---
export const OutlineSchema = z.object({
  hook_variants: z.array(z.string().min(8)).min(2).max(5),
  beat_sheet: z.array(z.string().min(4)).min(4).max(12),
});
export type Outline = z.infer<typeof OutlineSchema>;

// --- Scriptwriter: step 2 (full draft) ---
export const ScriptSectionSchema = z.object({
  id: z.string(),
  beat: z.string(),
  vo_text: z.string().min(1),
  shot_note: z.string(),
  on_screen: z.string(),
  retention_device: z.string(),
});
export const ScriptDraftSchema = z.object({
  hook: z.string().min(8),
  sections: z.array(ScriptSectionSchema).min(4).max(12),
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
  section_id: z.string(),
  source: z.enum(['stock', 'generated', 'graphic', 'avatar', 'host']),
  reason: z.string(),
  description: z.string().min(3),
  style: z.string().optional(),
  camera: z.string().optional(),
  motion: z.enum(['low', 'medium', 'high']).optional(),
  mood: z.string().optional(),
  duration_s: z.number().min(1).max(15).optional(),
  negative: z.array(z.string()).optional(),
});
export const ShotPlanSchema = z.object({ shots: z.array(ShotPlanItemSchema).min(1) });
export type ShotPlan = z.infer<typeof ShotPlanSchema>;
