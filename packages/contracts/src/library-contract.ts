import { z } from "zod";

const FactCategorySchema = z.enum(["character", "relationship", "cultivation", "force", "event", "item", "magical_creature", "location", "foreshadowing", "other", "organization", "power", "mystery"]);

export const LIBRARY_STATUSES = ["active", "archived"] as const;
export const INDEX_STATUSES = ["fresh", "failed", "stale"] as const;

export const BookSummarySchema = z.strictObject({
  id: z.string().uuid(), title: z.string().trim().min(1), status: z.enum(LIBRARY_STATUSES),
  chapterCount: z.number().int().nonnegative(), createdAt: z.string().datetime(),
});
export const ChapterSummarySchema = z.strictObject({
  id: z.string().uuid(), bookId: z.string().uuid(), chapterIndex: z.number().int().positive(),
  title: z.string(), sourceVersion: z.string(), createdAt: z.string().datetime(),
});
export const IndexCoverageSchema = z.strictObject({
  total: z.number().int().nonnegative(), fresh: z.number().int().nonnegative(),
  missing: z.number().int().nonnegative(), failed: z.number().int().nonnegative(),
  stale: z.number().int().nonnegative(),
});
export const FactRetrievalMetadataSchema = z.strictObject({
  category: FactCategorySchema.optional(),
  importance: z.number().min(0).max(1).optional(),
  confidence: z.number().min(0).max(1).optional(),
  scopeEligible: z.boolean().optional(),
  transformationEligible: z.boolean().optional(),
  scopeFieldsComplete: z.boolean().optional(),
});
export const FactReviewSchema = z.strictObject({
  id: z.string().uuid(), chapterId: z.string().uuid(), chapterIndex: z.number().int().positive(),
  subjectKey: z.string(), factType: z.string(), body: z.string(), metadata: FactRetrievalMetadataSchema,
  createdAt: z.string().datetime(),
});
export const FactReviewPageSchema = z.strictObject({ facts: z.array(FactReviewSchema), nextCursor: z.string().min(1).nullable() });

export type BookSummary = z.infer<typeof BookSummarySchema>;
export type ChapterSummary = z.infer<typeof ChapterSummarySchema>;
export type IndexCoverage = z.infer<typeof IndexCoverageSchema>;
export type FactReviewPage = z.infer<typeof FactReviewPageSchema>;
