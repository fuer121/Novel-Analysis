import { z } from "zod";

const IdSchema = z.string().uuid();
const ChapterSchema = z.number().int().positive();
const TimestampSchema = z.string().datetime();
const NonEmptyStringSchema = z.string().trim().min(1);

export const AnalysisScopeHashSchema = z.string().regex(/^[0-9a-f]{64}$/);

export const AnalysisModeSchema = z.enum([
  "fast_index",
  "balanced",
  "precision",
  "full_text",
]);

export const AnalysisRunStatusSchema = z.enum([
  "queued",
  "running",
  "retrying",
  "paused",
  "completed",
  "failed",
  "cancelled",
]);

export const AnalysisPartStatusSchema = z.enum([
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
]);

const ChapterRangeSchema = {
  startChapter: ChapterSchema,
  endChapter: ChapterSchema,
};

function validChapterRange<T extends { startChapter: number; endChapter: number }>(value: T): boolean {
  return value.startChapter <= value.endChapter;
}

function validPartProgress<T extends { completedParts: number; totalParts: number }>(value: T): boolean {
  return value.completedParts <= value.totalParts;
}

export const AnalysisTemplateCreateInputSchema = z.strictObject({
  bookId: IdSchema,
  name: NonEmptyStringSchema,
  prompt: NonEmptyStringSchema,
  outputSchema: z.json(),
  indexGroupId: IdSchema.nullable(),
});

export const AnalysisTemplateUpdateInputSchema = z.strictObject({
  name: NonEmptyStringSchema,
  prompt: NonEmptyStringSchema,
  outputSchema: z.json(),
  indexGroupId: IdSchema.nullable(),
});

export const AnalysisTemplateSummarySchema = z.strictObject({
  id: IdSchema,
  bookId: IdSchema,
  name: NonEmptyStringSchema,
  currentVersionId: IdSchema,
  indexGroupId: IdSchema.nullable(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export const AnalysisTemplateDetailSchema = AnalysisTemplateSummarySchema.extend({
  prompt: NonEmptyStringSchema,
  outputSchema: z.json(),
});

export const AnalysisScopePreviewInputSchema = z.strictObject({
  bookId: IdSchema,
  templateId: IdSchema,
  mode: AnalysisModeSchema,
  ...ChapterRangeSchema,
}).refine(validChapterRange, { message: "startChapter must not exceed endChapter" });

export const AnalysisRunCreateInputSchema = z.strictObject({
  bookId: IdSchema,
  templateId: IdSchema,
  templateVersionId: IdSchema,
  mode: AnalysisModeSchema,
  ...ChapterRangeSchema,
  scopeHash: AnalysisScopeHashSchema,
  idempotencyKey: NonEmptyStringSchema,
}).refine(validChapterRange, { message: "startChapter must not exceed endChapter" });

export const AnalysisScopePreviewSchema = z.strictObject({
  bookId: IdSchema,
  templateVersionId: IdSchema,
  mode: AnalysisModeSchema,
  ...ChapterRangeSchema,
  chapterCount: z.number().int().positive(),
  reviewChapterCount: z.number().int().nonnegative(),
  readsL1: z.boolean(),
  readsL2: z.boolean(),
  readsOriginalChapters: z.boolean(),
  scopeHash: AnalysisScopeHashSchema,
}).refine(validChapterRange, { message: "startChapter must not exceed endChapter" });

export const AnalysisRunSummarySchema = z.strictObject({
  id: IdSchema,
  bookId: IdSchema,
  templateVersionId: IdSchema,
  jobId: IdSchema,
  mode: AnalysisModeSchema,
  ...ChapterRangeSchema,
  status: AnalysisRunStatusSchema,
  completedParts: z.number().int().nonnegative(),
  totalParts: z.number().int().nonnegative(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
})
  .refine(validChapterRange, { message: "startChapter must not exceed endChapter" })
  .refine(validPartProgress, { message: "completedParts must not exceed totalParts" });

export const AnalysisPartSummarySchema = z.strictObject({
  id: IdSchema,
  position: z.number().int().nonnegative(),
  kind: NonEmptyStringSchema,
  status: AnalysisPartStatusSchema,
  errorCode: NonEmptyStringSchema.nullable(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export const AnalysisRunDetailSchema = z.strictObject({
  id: IdSchema,
  bookId: IdSchema,
  templateVersionId: IdSchema,
  jobId: IdSchema,
  mode: AnalysisModeSchema,
  ...ChapterRangeSchema,
  status: AnalysisRunStatusSchema,
  completedParts: z.number().int().nonnegative(),
  totalParts: z.number().int().nonnegative(),
  parts: z.array(AnalysisPartSummarySchema),
  result: z.json().nullable(),
  diagnostics: z.array(NonEmptyStringSchema),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
})
  .refine(validChapterRange, { message: "startChapter must not exceed endChapter" })
  .refine(validPartProgress, { message: "completedParts must not exceed totalParts" });

export const AdminAnalysisRunMetadataSchema = z.strictObject({
  id: IdSchema,
  jobId: IdSchema,
  bookId: IdSchema,
  createdBy: IdSchema,
  mode: AnalysisModeSchema,
  status: AnalysisRunStatusSchema,
  completedParts: z.number().int().nonnegative(),
  totalParts: z.number().int().nonnegative(),
  errorCode: NonEmptyStringSchema.nullable(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
}).refine(validPartProgress, { message: "completedParts must not exceed totalParts" });

export const LegacyAnalysisSummarySchema = z.strictObject({
  id: NonEmptyStringSchema,
  bookId: IdSchema,
  name: NonEmptyStringSchema,
  ...ChapterRangeSchema,
  status: NonEmptyStringSchema,
  readOnly: z.literal(true),
  canResume: z.literal(false),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
}).refine(validChapterRange, { message: "startChapter must not exceed endChapter" });

export const LegacyAnalysisDetailSchema = z.strictObject({
  id: NonEmptyStringSchema,
  bookId: IdSchema,
  name: NonEmptyStringSchema,
  ...ChapterRangeSchema,
  status: NonEmptyStringSchema,
  result: z.json(),
  diagnostics: z.array(NonEmptyStringSchema),
  readOnly: z.literal(true),
  canResume: z.literal(false),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
}).refine(validChapterRange, { message: "startChapter must not exceed endChapter" });

export type AnalysisMode = z.infer<typeof AnalysisModeSchema>;
export type AnalysisRunStatus = z.infer<typeof AnalysisRunStatusSchema>;
export type AnalysisPartStatus = z.infer<typeof AnalysisPartStatusSchema>;
export type AnalysisTemplateCreateInput = z.infer<typeof AnalysisTemplateCreateInputSchema>;
export type AnalysisTemplateUpdateInput = z.infer<typeof AnalysisTemplateUpdateInputSchema>;
export type AnalysisTemplateSummary = z.infer<typeof AnalysisTemplateSummarySchema>;
export type AnalysisTemplateDetail = z.infer<typeof AnalysisTemplateDetailSchema>;
export type AnalysisScopePreviewInput = z.infer<typeof AnalysisScopePreviewInputSchema>;
export type AnalysisRunCreateInput = z.infer<typeof AnalysisRunCreateInputSchema>;
export type AnalysisScopePreview = z.infer<typeof AnalysisScopePreviewSchema>;
export type AnalysisRunSummary = z.infer<typeof AnalysisRunSummarySchema>;
export type AnalysisRunDetail = z.infer<typeof AnalysisRunDetailSchema>;
export type AnalysisPartSummary = z.infer<typeof AnalysisPartSummarySchema>;
export type AdminAnalysisRunMetadata = z.infer<typeof AdminAnalysisRunMetadataSchema>;
export type LegacyAnalysisSummary = z.infer<typeof LegacyAnalysisSummarySchema>;
export type LegacyAnalysisDetail = z.infer<typeof LegacyAnalysisDetailSchema>;
