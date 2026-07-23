import { sql } from "kysely";

import type { DatabaseExecutor } from "../db.js";
import { selectCanonicalL1Freshness, selectCanonicalL2Freshness } from "./freshness-selector.js";

const ACTIVE_JOB_STATUSES = ["queued", "running", "retrying", "paused"] as const;

export interface BookAnalysisReadinessResult {
  state: "waiting" | "building_l1" | "building_l2" | "available" | "failed";
  chapterTotal: number;
  l1Fresh: number;
  l2Fresh: number;
  progressPercent: number;
  analysisAvailable: boolean;
  blockingCode: "l1_incomplete" | "l2_incomplete" | "rebuild_failed" | null;
}

export async function getBookAnalysisReadiness(
  database: DatabaseExecutor,
  bookId: string,
): Promise<BookAnalysisReadinessResult> {
  const book = await database.selectFrom("books").select("id").where("id", "=", bookId).executeTakeFirst();
  if (!book) throw new Error("Book not found");
  const baseGroup = await database.selectFrom("index_groups").select("id")
    .where("book_id", "=", bookId).where("key", "=", "base").where("status", "=", "active").executeTakeFirst();
  const l1Selection = await selectCanonicalL1Freshness(database, bookId);
  const l2Selection = baseGroup
    ? await selectCanonicalL2Freshness(database, { bookId, groupId: baseGroup.id })
    : undefined;
  const chapterTotal = l1Selection.kind === "selected" ? l1Selection.chapters.length : l1Selection.chapterTotal;
  const l1Fresh = l1Selection.kind === "selected"
    ? l1Selection.chapters.filter(({ state }) => state === "fresh").length
    : 0;
  const l2Fresh = l2Selection?.kind === "selected"
    ? l2Selection.chapters.filter(({ state }) => state === "fresh").length
    : 0;
  const progressPercent = chapterTotal === 0 ? 0 : Math.floor(((l1Fresh + l2Fresh) * 100) / (chapterTotal * 2));

  const l1Jobs = () => database.selectFrom("jobs")
    .select("status")
    .where("type", "=", "l1-index")
    .where(sql<boolean>`scope ->> 'bookId' = ${bookId}`);
  const l2Jobs = () => database.selectFrom("jobs")
    .select("status")
    .where("type", "=", "l2-index")
    .where(sql<boolean>`scope ->> 'bookId' = ${bookId}`)
    .where(sql<boolean>`scope -> 'indexGroupKeys' @> ${JSON.stringify([baseGroup!.id])}::jsonb`);
  const [activeL1Job, activeL2Job] = await Promise.all([
    l1Jobs().where("status", "in", ACTIVE_JOB_STATUSES).executeTakeFirst(),
    baseGroup ? l2Jobs().where("status", "in", ACTIVE_JOB_STATUSES).executeTakeFirst() : undefined,
  ]);

  if (activeL1Job) {
    return { state: "building_l1", chapterTotal, l1Fresh, l2Fresh, progressPercent, analysisAvailable: false, blockingCode: "l1_incomplete" };
  }
  if (activeL2Job) {
    return { state: "building_l2", chapterTotal, l1Fresh, l2Fresh, progressPercent, analysisAvailable: false, blockingCode: "l2_incomplete" };
  }

  const latestTerminal = <T extends ReturnType<typeof l1Jobs>>(query: T) => query
    .where("status", "in", ["completed", "cancelled", "failed"])
    .orderBy("updated_at", "desc").orderBy("created_at", "desc").orderBy("id", "desc")
    .executeTakeFirst();
  const [currentL1Job, currentL2Job] = await Promise.all([
    latestTerminal(l1Jobs()),
    baseGroup ? latestTerminal(l2Jobs()) : undefined,
  ]);
  if (currentL1Job?.status === "failed" || currentL2Job?.status === "failed") {
    return { state: "failed", chapterTotal, l1Fresh, l2Fresh, progressPercent, analysisAvailable: false, blockingCode: "rebuild_failed" };
  }

  const complete = chapterTotal > 0 && l1Fresh === chapterTotal && l2Fresh === chapterTotal;
  if (complete) {
    return { state: "available", chapterTotal, l1Fresh, l2Fresh, progressPercent: 100, analysisAvailable: true, blockingCode: null };
  }
  if (chapterTotal > 0 && l1Fresh === chapterTotal) {
    return { state: "building_l2", chapterTotal, l1Fresh, l2Fresh, progressPercent, analysisAvailable: false, blockingCode: "l2_incomplete" };
  }
  return { state: "waiting", chapterTotal, l1Fresh, l2Fresh, progressPercent, analysisAvailable: false, blockingCode: "l1_incomplete" };
}
