import { z } from 'zod';

// QA: LLM claim + brand-safety review over the script.
export const QAReviewSchema = z.object({
  claims_ok: z.boolean(),
  brand_ok: z.boolean(),
  issues: z.array(z.string()).default([]),
});
export type QAReview = z.infer<typeof QAReviewSchema>;

// Shorts: LLM selects high-retention segments to clip vertically.
export const ShortsPlanSchema = z.object({
  shorts: z.array(z.object({
    start_section: z.string(),
    end_section: z.string(),
    hook: z.string().min(4),
    why: z.string(),
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
