import { z } from "zod";

const IdSchema = z.string().uuid();
const ChapterSchema = z.number().int().positive();

export const QueryIntentSchema = z.strictObject({
  kind: z.enum(["single-target", "collection", "general"]),
  target: z.string().trim().min(1).nullable(),
  aliases: z.array(z.string().trim().min(1)).max(20),
  referents: z.array(z.string().trim().min(1)).max(20),
  categories: z.array(z.string().trim().min(1)).max(20).default([]),
  keywords: z.array(z.string().trim().min(1)).max(50).default([]),
});

export const QUERY_TURN_STATUSES = [
  "queued",
  "running",
  "awaiting_fallback",
  "completed",
  "degraded",
  "failed",
  "cancelled",
] as const;

export const QuerySourceStatsSchema = z.strictObject({
  candidates: z.number().int().nonnegative(),
  used: z.number().int().nonnegative(),
  excluded: z.number().int().nonnegative(),
  gaps: z.number().int().nonnegative(),
});

export const QuerySessionSchema = z.strictObject({
  id: IdSchema,
  bookId: IdSchema,
  groupId: IdSchema,
  createdBy: IdSchema,
  title: z.string().trim().min(1),
  visibility: z.enum(["private", "team"]),
  defaultStartChapter: ChapterSchema,
  defaultEndChapter: ChapterSchema,
  canManage: z.boolean(),
  archivedAt: z.string().datetime().nullable(),
});

export const QueryTurnSchema = z.strictObject({
  id: IdSchema,
  sessionId: IdSchema,
  createdBy: IdSchema,
  question: z.string().trim().min(1),
  startChapter: ChapterSchema,
  endChapter: ChapterSchema,
  status: z.enum(QUERY_TURN_STATUSES),
  answer: z.string().nullable(),
  degradation: z.string().nullable(),
  sourceStats: QuerySourceStatsSchema,
});

export const QueryEvidenceSchema = z.strictObject({
  turnId: IdSchema,
  factId: IdSchema,
  chapterIndex: ChapterSchema,
  body: z.string().trim().min(1),
  rank: z.number().int().positive(),
  recallReason: z.string().trim().min(1),
  disposition: z.enum(["used", "excluded"]),
  exclusionReason: z.string().trim().min(1).nullable(),
});

export type QueryIntent = z.infer<typeof QueryIntentSchema>;
export type QuerySession = z.infer<typeof QuerySessionSchema>;
export type QueryTurn = z.infer<typeof QueryTurnSchema>;
export type QueryEvidence = z.infer<typeof QueryEvidenceSchema>;
