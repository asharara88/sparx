import { defineSkill } from './registry.js';

// LLM outputs cross-reference state ids (shot.section_id, shorts source sections).
// Trusting them silently misaligns narration, visuals, and cuts. This skill turns
// hallucinated/missing references into typed findings at the point of cause.

export interface RefReport {
  ok: boolean;
  /** referenced ids that don't exist */
  unknown: string[];
  /** valid ids that were never referenced */
  unreferenced: string[];
  /** ids referenced more than once */
  duplicates: string[];
}

export function validateRefs(validIds: readonly string[], refs: readonly string[]): RefReport {
  const valid = new Set(validIds);
  const seen = new Map<string, number>();
  for (const r of refs) seen.set(r, (seen.get(r) ?? 0) + 1);
  const unknown = [...new Set(refs.filter((r) => !valid.has(r)))];
  const unreferenced = validIds.filter((id) => !seen.has(id));
  const duplicates = [...seen.entries()].filter(([, n]) => n > 1).map(([id]) => id);
  return { ok: unknown.length === 0 && unreferenced.length === 0, unknown, unreferenced, duplicates };
}

export const referenceValidationSkill = defineSkill<{ validIds: string[]; refs: string[] }, RefReport>({
  name: 'reference-validation',
  description: 'Validate LLM-produced cross-references (e.g. shot→section ids) against the real id set; reports unknown, unreferenced, and duplicate ids.',
  run: async ({ validIds, refs }) => validateRefs(validIds, refs),
});
