import { z } from 'zod';

// QA: LLM brand-voice + unverifiable-claim review over the script.
// issues elements are coerced so a stray number doesn't buy a paid repair call.
export const QAReviewSchema = z.object({
  claims_ok: z.boolean(),
  brand_ok: z.boolean(),
  issues: z.array(z.coerce.string()).default([]),
});
export type QAReview = z.infer<typeof QAReviewSchema>;

// Shorts: LLM selects high-retention section spans to clip vertically.
// Ids are coerced (models return numeric section ids) and mins kept loose — the
// agent validates refs against the real section ids and drops/repairs bad items
// itself, which is cheaper than a schema-triggered LLM repair round-trip.
export const ShortsPlanSchema = z.object({
  shorts: z.array(z.object({
    start_section: z.coerce.string(),
    end_section: z.coerce.string(),
    hook: z.coerce.string().min(1),
    why: z.coerce.string().default(''),
  })).min(1).max(5),
});
export type ShortsPlan = z.infer<typeof ShortsPlanSchema>;

// Packaging: LLM title/description/thumbnail variants for CTR.
export const PackagingSchema = z.object({
  titles: z.array(z.string().min(4)).min(3).max(6),
  descriptions: z.array(z.string().min(20)).min(1).max(3),
  thumbnail_concepts: z.array(z.string().min(6)).min(2).max(4),
});
export type PackagingOut = z.infer<typeof PackagingSchema>;
