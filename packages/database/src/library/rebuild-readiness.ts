import { sql } from "kysely";

import type { DatabaseExecutor } from "../db.js";

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
  const coverage = await sql<{ chapter_total: number; l1_fresh: number; l2_fresh: number }>`
    select
      count(distinct c.id)::int as chapter_total,
      count(distinct c.id) filter (where l1.status = 'fresh')::int as l1_fresh,
      count(distinct c.id) filter (where l2.status = 'fresh')::int as l2_fresh
    from books b
    left join chapters c on c.book_id = b.id
    left join l1_indexes l1 on l1.chapter_id = c.id and l1.is_current
    left join index_groups g on g.book_id = b.id and g.key = 'base' and g.status = 'active'
    left join l2_chapter_statuses l2 on l2.group_id = g.id and l2.chapter_id = c.id
    where b.id = ${bookId}
    group by b.id
  `.execute(database);
  const row = coverage.rows[0];
  if (!row) throw new Error("Book not found");

  const chapterTotal = Number(row.chapter_total);
  const l1Fresh = Number(row.l1_fresh);
  const l2Fresh = Number(row.l2_fresh);
  const progressPercent = chapterTotal === 0 ? 0 : Math.floor(((l1Fresh + l2Fresh) * 100) / (chapterTotal * 2));

  const currentJob = await database.selectFrom("jobs")
    .select(["type", "status"])
    .where("type", "in", ["l1-index", "l2-index"])
    .where(sql<boolean>`scope ->> 'bookId' = ${bookId}`)
    .orderBy("updated_at", "desc")
    .orderBy("created_at", "desc")
    .orderBy("id", "desc")
    .executeTakeFirst();

  if (currentJob?.status === "failed") {
    return { state: "failed", chapterTotal, l1Fresh, l2Fresh, progressPercent, analysisAvailable: false, blockingCode: "rebuild_failed" };
  }
  if (currentJob?.type === "l1-index" && ACTIVE_JOB_STATUSES.has(currentJob.status)) {
    return { state: "building_l1", chapterTotal, l1Fresh, l2Fresh, progressPercent, analysisAvailable: false, blockingCode: "l1_incomplete" };
  }
  if (currentJob?.type === "l2-index" && ACTIVE_JOB_STATUSES.has(currentJob.status)) {
    return { state: "building_l2", chapterTotal, l1Fresh, l2Fresh, progressPercent, analysisAvailable: false, blockingCode: "l2_incomplete" };
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
