import { sql } from "kysely";

import type { DatabaseExecutor } from "../db.js";
import { selectCanonicalL1Freshness, selectCanonicalL2Freshness } from "./freshness-selector.js";

const ACTIVE_JOB_STATUSES = new Set(["queued", "running", "retrying", "paused"]);

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

  const currentJob = (type: "l1-index" | "l2-index") => database.selectFrom("jobs")
    .select("status")
    .where("type", "=", type)
    .where(sql<boolean>`scope ->> 'bookId' = ${bookId}`)
    .orderBy("updated_at", "desc").orderBy("created_at", "desc").orderBy("id", "desc")
    .executeTakeFirst();
  const [currentL1Job, currentL2Job] = await Promise.all([currentJob("l1-index"), currentJob("l2-index")]);

  if (currentL1Job && ACTIVE_JOB_STATUSES.has(currentL1Job.status)) {
    return { state: "building_l1", chapterTotal, l1Fresh, l2Fresh, progressPercent, analysisAvailable: false, blockingCode: "l1_incomplete" };
  }
  if (currentL2Job && ACTIVE_JOB_STATUSES.has(currentL2Job.status)) {
    return { state: "building_l2", chapterTotal, l1Fresh, l2Fresh, progressPercent, analysisAvailable: false, blockingCode: "l2_incomplete" };
  }
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
