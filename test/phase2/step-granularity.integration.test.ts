import { performance } from "node:perf_hooks";

import { sql } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDisposablePostgres, type DisposablePostgres } from "../../packages/database/src/testing/postgres.js";

type Candidate = "one-chapter" | "fixed-100-batch";

function experimentalSteps(candidate: Candidate, chapterCount: number) {
  const stepCount = candidate === "one-chapter" ? chapterCount : Math.ceil(chapterCount / 100);
  return Array.from({ length: stepCount }, (_, position) => {
    const start = candidate === "one-chapter" ? position + 1 : position * 100 + 1;
    const end = candidate === "one-chapter" ? start : Math.min(chapterCount, start + 99);
    return {
      position,
      kind: candidate === "one-chapter" ? "chapter" : "chapter-batch",
      inputSignature: candidate === "one-chapter" ? `chapter:${start}` : `batch:${start}-${end}`,
      start,
      end,
    };
  });
}

function p95(samples: number[]): number {
  return samples.toSorted((left, right) => left - right)[18]!;
}

describe("PostgreSQL JobStep granularity candidates", () => {
  let postgres: DisposablePostgres;
  let userId: string;

  beforeEach(async () => {
    postgres = await createDisposablePostgres();
    userId = (await postgres.db.insertInto("users").values({
      display_name: "Scale owner",
      avatar_url: null,
      role: "member",
      status: "active",
    }).returning("id").executeTakeFirstOrThrow()).id;
  });

  afterEach(async () => postgres.destroy());

  it.each([
    ["one-chapter", 3],
    ["one-chapter", 100],
    ["one-chapter", 3000],
    ["fixed-100-batch", 3],
    ["fixed-100-batch", 100],
    ["fixed-100-batch", 3000],
  ] as const)("measures %s with %i chapters using job-level creation effects", async (candidate, chapterCount) => {
    const steps = experimentalSteps(candidate, chapterCount);
    const clientStarted = performance.now();
    const measurement = await postgres.db.transaction().execute(async (transaction) => {
      const serverStarted = await sql<{ now: Date }>`select clock_timestamp() as now`.execute(transaction);
      const job = await transaction.insertInto("jobs").values({
        type: "chapter_import",
        status: "queued",
        requested_by: userId,
        request_id: `${candidate}-${chapterCount}`,
        scope: { candidate, chapterCount },
        config_snapshot: {},
        concurrency_key: null,
        progress: { total: chapterCount, completed: 0, failed: 0, skipped: 0, current: "" },
      }).returning("id").executeTakeFirstOrThrow();
      await transaction.insertInto("job_steps").values(steps.map((step) => ({
        job_id: job.id,
        position: step.position,
        kind: step.kind,
        status: "completed" as const,
        input_signature: step.inputSignature,
        idempotency_key: `${job.id}:${step.position}`,
        output_ref: null,
        lease_owner: null,
        lease_expires_at: null,
      }))).execute();
      await transaction.insertInto("job_events").values({
        job_id: job.id,
        type: "created",
        dedupe_key: "created",
        payload: { status: "queued" },
      }).execute();
      await transaction.insertInto("job_outbox").values({
        job_id: job.id,
        topic: "jobs.wake",
        payload: { jobId: job.id },
        claimed_by: null,
        claim_expires_at: null,
        delivered_at: null,
      }).execute();
      const serverFinished = await sql<{ now: Date }>`select clock_timestamp() as now`.execute(transaction);
      return { jobId: job.id, serverMs: serverFinished.rows[0]!.now.getTime() - serverStarted.rows[0]!.now.getTime() };
    });
    const clientMs = performance.now() - clientStarted;

    const listSamples: number[] = [];
    const detailSamples: number[] = [];
    const aggregateSamples: number[] = [];
    for (let iteration = 0; iteration < 20; iteration += 1) {
      let started = performance.now();
      await postgres.db.selectFrom("job_steps").select(["position", "status"])
        .where("job_id", "=", measurement.jobId).orderBy("position").limit(100).execute();
      listSamples.push(performance.now() - started);
      started = performance.now();
      await postgres.db.selectFrom("jobs").select(["id", "status", "progress"])
        .where("id", "=", measurement.jobId).executeTakeFirstOrThrow();
      detailSamples.push(performance.now() - started);
      started = performance.now();
      await postgres.db.selectFrom("job_steps").select(["status", ({ fn }) => fn.countAll<string>().as("count")])
        .where("job_id", "=", measurement.jobId).groupBy("status").execute();
      aggregateSamples.push(performance.now() - started);
    }

    const rowCount = await postgres.db.selectFrom("job_steps")
      .select(({ fn }) => fn.countAll<string>().as("count"))
      .where("job_id", "=", measurement.jobId).executeTakeFirstOrThrow();
    const replay = await postgres.db.selectFrom("job_events").select("id")
      .where("job_id", "=", measurement.jobId).orderBy("id").limit(10).execute();
    const outbox = await postgres.db.selectFrom("job_outbox").select("id")
      .where("job_id", "=", measurement.jobId).execute();
    expect(Number(rowCount.count)).toBe(steps.length);
    expect(replay).toHaveLength(1);
    expect(outbox).toHaveLength(1);
    expect(Math.max(clientMs, measurement.serverMs)).toBeLessThan(5000);
    expect(p95(listSamples)).toBeLessThan(500);
    expect(p95(detailSamples)).toBeLessThan(500);
    expect(p95(aggregateSamples)).toBeLessThan(500);

    const failed = steps[Math.floor(steps.length / 2)]!;
    await postgres.db.updateTable("job_steps").set({ status: "failed", attempt_count: 1 })
      .where("job_id", "=", measurement.jobId).where("position", "=", failed.position).execute();
    const beforeSelection = await sql<{ fingerprint: string }>`
      select md5(string_agg(id::text || ':' || status || ':' || attempt_count, ',' order by position)) as fingerprint
      from job_steps where job_id = ${measurement.jobId}
    `.execute(postgres.db);
    const retrySelection = await postgres.db.selectFrom("job_steps")
      .select(["id", "position", "status", "attempt_count", "input_signature"])
      .where("job_id", "=", measurement.jobId).where("status", "=", "failed").execute();
    const afterSelection = await sql<{ fingerprint: string }>`
      select md5(string_agg(id::text || ':' || status || ':' || attempt_count, ',' order by position)) as fingerprint
      from job_steps where job_id = ${measurement.jobId}
    `.execute(postgres.db);
    const untouched = await postgres.db.selectFrom("job_steps")
      .select(({ fn }) => fn.countAll<string>().as("count"))
      .where("job_id", "=", measurement.jobId).where("status", "=", "completed").where("attempt_count", "=", 0)
      .executeTakeFirstOrThrow();
    expect(retrySelection).toEqual([expect.objectContaining({
      position: failed.position,
      status: "failed",
      attempt_count: 1,
      input_signature: failed.inputSignature,
    })]);
    expect(afterSelection.rows[0]!.fingerprint).toBe(beforeSelection.rows[0]!.fingerprint);
    expect(Number(untouched.count)).toBe(steps.length - 1);
    expect(failed.end - failed.start + 1).toBe(candidate === "one-chapter" ? 1 : Math.min(chapterCount, 100));

    console.info("step-granularity-candidate", {
      candidate,
      chapterCount,
      rowCount: steps.length,
      clientMs,
      serverMs: measurement.serverMs,
      listP95Ms: p95(listSamples),
      detailP95Ms: p95(detailSamples),
      aggregateP95Ms: p95(aggregateSamples),
      retryRange: [failed.start, failed.end],
      initialEvents: replay.length,
      initialOutbox: outbox.length,
    });
  });
});
