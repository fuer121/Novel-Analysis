import { afterEach, describe, expect, it } from "vitest";

import { createBoss } from "@novel-analysis/jobs";
import { JobWorker, createWorkerStepExecutor } from "../../apps/worker/src/worker.js";
import {
  createDisposablePostgres,
  type DisposablePostgres,
} from "../../packages/database/src/testing/postgres.js";

import { createPhase2LibraryExecutor, runLeaseRecovery, runVerticalWorkflow } from "./helpers/phase2-harness.js";
import { startPhase2TestApi } from "./helpers/test-api.js";

describe("Phase 2 independent library indexing acceptance", () => {
  let postgres: DisposablePostgres | undefined;

  afterEach(async () => postgres?.destroy());

  async function waitUntil(check: () => Promise<boolean>, label: string): Promise<void> {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      if (await check()) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`Timed out waiting for ${label}`);
  }

  it("completes import, L1 and L2 for one three-chapter book", async () => {
    postgres = await createDisposablePostgres();
    expect(await postgres.db.selectFrom("books").select("id").execute()).toEqual([]);

    const evidence = await runVerticalWorkflow(postgres.db);

    expect(evidence).toMatchObject({
      completed: true,
      chapterCount: 3,
      l1Fresh: 3,
      l2Fresh: 3,
      factCount: 3,
      leakageSafe: true,
    });

    const readAfterStart = async () => {
      const api = await startPhase2TestApi(postgres!.db, evidence.userId);
      const headers = { Cookie: api.cookie };
      const [book, job, coverage, facts] = await Promise.all([
        fetch(`${api.origin}/api/books/${evidence.bookId}`, { headers }),
        fetch(`${api.origin}/api/jobs/${evidence.l2JobId}`, { headers }),
        fetch(`${api.origin}/api/books/${evidence.bookId}/index-groups/${evidence.groupId}/coverage`, { headers }),
        fetch(`${api.origin}/api/books/${evidence.bookId}/index-groups/${evidence.groupId}/facts?limit=20`, { headers }),
      ]);
      const snapshot = await Promise.all([book.json(), job.json(), coverage.json(), facts.json()]);
      await api.stop();
      return snapshot;
    };
    expect(await readAfterStart()).toEqual(await readAfterStart());

    const businessSnapshot = () => Promise.all([
      postgres!.db.selectFrom("jobs").select(["id", "status", "progress"]).orderBy("id").execute(),
      postgres!.db.selectFrom("job_steps").select(["id", "status", "attempt_count", "output_ref"]).orderBy("id").execute(),
      postgres!.db.selectFrom("job_events").select(["job_id", "type", "dedupe_key", "payload"]).orderBy("id").execute(),
      postgres!.db.selectFrom("l2_facts").select(["id", "chapter_id", "subject_key", "fact_type", "metadata"]).orderBy("id").execute(),
    ]);
    const boss = createBoss(postgres.databaseUrl);
    const worker = new JobWorker({ database: postgres.db, boss, workerId: "phase2-replay-worker", pollIntervalMs: 20, executor: createWorkerStepExecutor({ database: postgres.db, libraryExecutor: createPhase2LibraryExecutor(postgres.db) }) });
    await worker.start();
    await waitUntil(async () => (await postgres!.db.selectFrom("job_outbox").select("id").where("delivered_at", "is", null).execute()).length === 0, "initial outbox delivery");
    const beforeReplay = await businessSnapshot();
    await boss.send("jobs.wake", { jobId: evidence.l2JobId, outboxId: crypto.randomUUID() }, { singletonKey: `phase2-replay:${crypto.randomUUID()}` });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(await businessSnapshot()).toEqual(beforeReplay);
    await worker.stop();
  });

  it("recovers an expired library lease with one committed effect", async () => {
    postgres = await createDisposablePostgres();

    expect(await runLeaseRecovery(postgres.db)).toEqual({
      chapterCount: 1,
      attemptStatuses: ["abandoned", "completed"],
      lateDisposition: "already-completed",
    });
  });
});
