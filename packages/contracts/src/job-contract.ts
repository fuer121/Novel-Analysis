import { z } from "zod";

export const JOB_TYPES = [
  "import",
  "l1-index",
  "l2-index",
  "query",
  "advanced-analysis",
  "migration",
] as const;

export const JOB_STATUSES = [
  "queued",
  "running",
  "retrying",
  "paused",
  "completed",
  "failed",
  "cancelled",
] as const;

export const JOB_EVENT_TYPES = [
  "created",
  "running",
  "progress",
  "warning",
  "retrying",
  "paused",
  "completed",
  "failed",
  "cancelled",
] as const;

export const JobTypeSchema = z.enum(JOB_TYPES);
export const JobStatusSchema = z.enum(JOB_STATUSES);
export const JobEventTypeSchema = z.enum(JOB_EVENT_TYPES);

export type JobType = z.infer<typeof JobTypeSchema>;
export type JobStatus = z.infer<typeof JobStatusSchema>;
export type JobEventType = z.infer<typeof JobEventTypeSchema>;

export const BookJobScopeSchema = z.object({
  bookId: z.string().trim().min(1),
  startChapter: z.number().int().positive().optional(),
  endChapter: z.number().int().positive().optional(),
  chapterIndexes: z.array(z.number().int().positive()).optional(),
  indexGroupKeys: z.array(z.string().trim().min(1)).optional(),
  mode: z.enum(["all", "missing", "retry_failed"]).optional(),
}).superRefine((scope, context) => {
  if (
    scope.startChapter !== undefined
    && scope.endChapter !== undefined
    && scope.endChapter < scope.startChapter
  ) {
    context.addIssue({
      code: "custom",
      path: ["endChapter"],
      message: "endChapter must be greater than or equal to startChapter",
    });
  }
});

export const MigrationJobScopeSchema = z.object({
  migrationId: z.string().uuid(),
  sourceLabel: z.string().trim().min(1),
});

export const JobScopeSchema = z.union([
  BookJobScopeSchema,
  MigrationJobScopeSchema,
]);

export type BookJobScope = z.infer<typeof BookJobScopeSchema>;
export type MigrationJobScope = z.infer<typeof MigrationJobScopeSchema>;
export type JobScope = z.infer<typeof JobScopeSchema>;

export const JobProgressSchema = z.object({
  total: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  current: z.string(),
});

const PublicJobFields = {
  id: z.string().uuid(),
  status: JobStatusSchema,
  requestedBy: z.string().uuid(),
  progress: JobProgressSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
};

export const PublicJobSchema = z.discriminatedUnion("type", [
  z.object({
    ...PublicJobFields,
    type: z.enum([
      "import",
      "l1-index",
      "l2-index",
      "query",
      "advanced-analysis",
    ]),
    scope: BookJobScopeSchema,
  }),
  z.object({
    ...PublicJobFields,
    type: z.literal("migration"),
    scope: MigrationJobScopeSchema,
  }),
]);

export type PublicJob = z.infer<typeof PublicJobSchema>;

export const JobEventSchema = z.object({
  id: z.number().int().positive(),
  jobId: z.string().uuid(),
  type: JobEventTypeSchema,
  createdAt: z.string().datetime(),
  payload: z.record(z.string(), z.unknown()),
});

export type JobEvent = z.infer<typeof JobEventSchema>;
