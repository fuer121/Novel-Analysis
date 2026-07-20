import { createHash } from "node:crypto";
import { sql } from "kysely";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createContentCipher, createIndexRepository, type DatabaseConnection } from "@novel-analysis/database";
import { createBoss, OutboxDispatcher } from "@novel-analysis/jobs";
import { JobWorker, createWorkerStepExecutor } from "../../apps/worker/src/worker.js";
import { createDisposablePostgres, type DisposablePostgres } from "../../packages/database/src/testing/postgres.js";

import { controlledPhase2Adapter, createPhase2LibraryExecutor, failingL1Adapter, PHASE2_SENTINELS } from "./helpers/phase2-harness.js";
import { startPhase2TestApi } from "./helpers/test-api.js";

const SENTINELS = Object.values(PHASE2_SENTINELS);

async function waitUntil(check: () => Promise<boolean>, label: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function json(response: Response, status = 200): Promise<Record<string, any>> {
  const body = await response.json() as Record<string, any>;
  expect(response.status, JSON.stringify(body)).toBe(status);
  return body;
}

async function configure(database: DatabaseConnection) {
  const indexes = createIndexRepository(database, createContentCipher({ activeKeyVersion: "phase2-test", keys: { "phase2-test": Buffer.alloc(32, 8) } }));
  const l1 = "phase2 l1 prompt";
  await indexes.createPromptVersion({ target: "l1-index", version: "phase2-l1", content: l1, contentHash: createHash("sha256").update(l1).digest("hex") });
  await indexes.createWorkflowVersion({ target: "l1-index", contractVersion: "phase2-l1", dslHash: "phase2-l1-dsl" });
  const l2 = "phase2 l2 prompt";
  const prompt = await indexes.createPromptVersion({ target: "l2-index", version: "phase2-l2", content: l2, contentHash: createHash("sha256").update(l2).digest("hex") });
  await indexes.createWorkflowVersion({ target: "l2-index", contractVersion: "phase2-l2", dslHash: "phase2-l2-dsl" });
  return prompt.id;
}

async function businessSnapshot(database: DatabaseConnection) {
  return Promise.all([
    database.selectFrom("jobs").select(["id", "status", "progress"]).orderBy("id").execute(),
    database.selectFrom("job_steps").select(["id", "status", "attempt_count", "output_ref"]).orderBy("id").execute(),
    database.selectFrom("job_events").select(["job_id", "type", "dedupe_key", "payload"]).orderBy("id").execute(),
    database.selectFrom("l2_facts").select(["id", "chapter_id", "subject_key", "fact_type", "metadata"]).orderBy("id").execute(),
  ]);
}

describe("Phase 2 independent library indexing acceptance", () => {
  let postgres: DisposablePostgres | undefined;
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => { while (cleanups.length) await cleanups.pop()!(); await postgres?.destroy(); vi.restoreAllMocks(); });

  it("drives create, import, L1 and L2 through the API and a real JobWorker", async () => {
    const observedLogs: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...values) => observedLogs.push(values.map(String).join(" ")));
    postgres = await createDisposablePostgres();
    const userId = (await postgres.db.insertInto("users").values({ display_name: "Phase 2 member", avatar_url: null, role: "member", status: "active" }).returning("id").executeTakeFirstOrThrow()).id;
    const promptVersionId = await configure(postgres.db);
    const api = await startPhase2TestApi(postgres.db, userId); cleanups.push(api.stop);
    const boss = createBoss(postgres.databaseUrl);
    const worker = new JobWorker({ database: postgres.db, boss, workerId: "phase2-vertical-worker", pollIntervalMs: 20, executor: createWorkerStepExecutor({ database: postgres.db, libraryExecutor: createPhase2LibraryExecutor(postgres.db) }) });
    await worker.start(); cleanups.push(() => worker.stop());

    const created = await json(await api.request("/books", { method: "POST", body: JSON.stringify({ title: "Three Chapters", source: { provider: "dify", sourceId: "42", startChapter: 1, endChapter: 3 } }), headers: { "Content-Type": "application/json" } }), 201);
    const bookId = created.book.id as string;
    const importPreview = await json(await api.request(`/books/${bookId}/import-preview`, { method: "POST", body: "{}", headers: { "Content-Type": "application/json" } }));
    expect(importPreview).toMatchObject({ requested: 3, executable: 3, existingFresh: 0, existingStale: 0, scopeHash: expect.any(String) });
    const imported = await json(await api.request(`/books/${bookId}/import-jobs`, { method: "POST", body: JSON.stringify({ scopeHash: importPreview.scopeHash, autoStartL1: true }), headers: { "Content-Type": "application/json" } }), 201);
    await waitUntil(async () => (await postgres!.db.selectFrom("jobs").select("status").where("id", "=", imported.job.id).executeTakeFirst())?.status === "completed", "import completion");
    await waitUntil(async () => (await postgres!.db.selectFrom("jobs").select("status").where("type", "=", "l1-index").executeTakeFirst())?.status === "completed", "automatic L1 completion");
    expect(await postgres.db.selectFrom("chapters").select("id").where("book_id", "=", bookId).execute()).toHaveLength(importPreview.executable);

    const groupResponse = await json(await api.request(`/books/${bookId}/index-groups`, { method: "POST", body: JSON.stringify({ key: "events", name: "Events", categoryScope: "general", promptVersionId }), headers: { "Content-Type": "application/json" } }), 201);
    const groupId = groupResponse.indexGroup.id as string;
    const scope = { startChapter: 1, endChapter: 3, mode: "missing", force: false };
    const l2Preview = await json(await api.request(`/books/${bookId}/index-groups/${groupId}/l2-preview`, { method: "POST", body: JSON.stringify(scope), headers: { "Content-Type": "application/json" } }));
    expect(l2Preview).toMatchObject({ total: 3, missing: 3, executable: 3, skipped: 0, scopeHash: expect.any(String) });
    const l2 = await json(await api.request(`/books/${bookId}/index-groups/${groupId}/l2-jobs`, { method: "POST", body: JSON.stringify({ ...scope, scopeHash: l2Preview.scopeHash }), headers: { "Content-Type": "application/json" } }), 201);
    await waitUntil(async () => (await postgres!.db.selectFrom("jobs").select("status").where("id", "=", l2.job.id).executeTakeFirst())?.status === "completed", "L2 completion");
    expect(await postgres.db.selectFrom("l2_facts").select("id").where("group_id", "=", groupId).execute()).toHaveLength(l2Preview.executable);

    const firstRead = await Promise.all([api.request(`/books/${bookId}`), api.request(`/jobs/${l2.job.id}`), api.request(`/books/${bookId}/index-groups/${groupId}/coverage`), api.request(`/books/${bookId}/index-groups/${groupId}/facts?limit=20`)]).then((responses) => Promise.all(responses.map((response) => json(response))));
    await api.stop(); cleanups.splice(cleanups.indexOf(api.stop), 1);
    const restarted = await startPhase2TestApi(postgres.db, userId); cleanups.push(restarted.stop);
    const secondRead = await Promise.all([restarted.request(`/books/${bookId}`), restarted.request(`/jobs/${l2.job.id}`), restarted.request(`/books/${bookId}/index-groups/${groupId}/coverage`), restarted.request(`/books/${bookId}/index-groups/${groupId}/facts?limit=20`)]).then((responses) => Promise.all(responses.map((response) => json(response))));
    expect(secondRead).toEqual(firstRead);
    expect(firstRead[3].facts.map((fact: { body: string }) => fact.body)).toEqual(expect.arrayContaining([expect.stringContaining(PHASE2_SENTINELS.fact)]));
    const invalidResponse = await restarted.request(`/books/${bookId}/index-groups/${groupId}/facts?limit=0`);
    expect(invalidResponse.status).toBe(400);
    const invalidBody = await invalidResponse.json();

    const ordinaryPersistence = JSON.stringify({ jobs: await postgres.db.selectFrom("jobs").select(["scope", "config_snapshot", "progress"]).execute(), steps: await postgres.db.selectFrom("job_steps").select("output_ref").execute(), events: await postgres.db.selectFrom("job_events").select("payload").execute(), outbox: await postgres.db.selectFrom("job_outbox").select("payload").execute(), attempts: await postgres.db.selectFrom("job_attempts").select(["error_code", "error_message"]).execute(), audit: await postgres.db.selectFrom("audit_logs").select("metadata").execute() });
    const operationalResponses = JSON.stringify({ created, importPreview, imported, groupResponse, l2Preview, l2, book: firstRead[0], job: firstRead[1], coverage: firstRead[2], invalidBody });
    for (const sentinel of SENTINELS) { expect(ordinaryPersistence).not.toContain(sentinel); expect(operationalResponses).not.toContain(sentinel); expect(observedLogs.join("\n")).not.toContain(sentinel); }
    const encrypted = await postgres.db.selectFrom("chapters").select("content_ciphertext").where("book_id", "=", bookId).execute();
    const encryptedFacts = await postgres.db.selectFrom("l2_facts").select("fact_ciphertext").where("group_id", "=", groupId).execute();
    for (const sentinel of SENTINELS) expect(Buffer.concat([...encrypted.map((row) => row.content_ciphertext), ...encryptedFacts.map((row) => row.fact_ciphertext)]).includes(Buffer.from(sentinel))).toBe(false);

    const outbox = await postgres.db.selectFrom("job_outbox").select(["id", "job_id"]).where("job_id", "=", l2.job.id).executeTakeFirstOrThrow();
    const beforeReplay = await businessSnapshot(postgres.db);
    const priorQueueIds = new Set((await sql<{ id: string }>`select id::text from pgboss.job where data ->> 'outboxId' = ${outbox.id}`.execute(postgres.db)).rows.map((row) => row.id));
    await postgres.db.updateTable("job_outbox").set({ delivered_at: null, claimed_by: null, claim_expires_at: null }).where("id", "=", outbox.id).execute();
    expect(await new OutboxDispatcher({ database: postgres.db, boss, dispatcherId: "phase2-replay-dispatcher" }).dispatchNext()).toBe(true);
    await waitUntil(async () => (await sql<{ id: string; state: string }>`select id::text, state from pgboss.job where data ->> 'outboxId' = ${outbox.id} order by created_on desc limit 1`.execute(postgres!.db)).rows.some((row) => !priorQueueIds.has(row.id) && row.state === "completed"), "exact outbox replay consumption");
    expect((await postgres.db.selectFrom("job_outbox").select("delivered_at").where("id", "=", outbox.id).executeTakeFirstOrThrow()).delivered_at).not.toBeNull();
    expect(await businessSnapshot(postgres.db)).toEqual(beforeReplay);
  });

  it.each(["chapter-import", "l1-index", "l2-index"] as const)("recovers Worker A's expired %s provider call in Worker B", async (blockedKind) => {
    postgres = await createDisposablePostgres();
    const userId = (await postgres.db.insertInto("users").values({ display_name: "Recovery member", avatar_url: null, role: "member", status: "active" }).returning("id").executeTakeFirstOrThrow()).id;
    const promptVersionId = await configure(postgres.db);
    const api = await startPhase2TestApi(postgres.db, userId); cleanups.push(api.stop);
    const control = controlledPhase2Adapter(blockedKind);
    const workerA = new JobWorker({ database: postgres.db, boss: createBoss(postgres.databaseUrl), workerId: "phase2-worker-a", leaseDurationMs: 250, pollIntervalMs: 20, executor: createWorkerStepExecutor({ database: postgres.db, libraryExecutor: createPhase2LibraryExecutor(postgres.db, control.adapter) }) });
    await workerA.start();
    let workerACleaned = false;
    const cleanupWorkerA = async () => { if (workerACleaned) return; workerACleaned = true; control.release(); await workerA.stop(); };
    cleanups.push(cleanupWorkerA);
    const created = await json(await api.request("/books", { method: "POST", body: JSON.stringify({ title: "Recovery", source: { provider: "dify", sourceId: "7", startChapter: 1, endChapter: 1 } }), headers: { "Content-Type": "application/json" } }), 201);
    const preview = await json(await api.request(`/books/${created.book.id}/import-preview`, { method: "POST", body: "{}", headers: { "Content-Type": "application/json" } }));
    const importJob = await json(await api.request(`/books/${created.book.id}/import-jobs`, { method: "POST", body: JSON.stringify({ scopeHash: preview.scopeHash, autoStartL1: false }), headers: { "Content-Type": "application/json" } }), 201);
    let recoveredJobId: string | undefined;
    const recover = async (jobId: string) => {
      recoveredJobId = jobId;
      await control.started;
      expect(await postgres!.db.selectFrom("job_steps").select(["status", "lease_owner"]).where("job_id", "=", jobId).executeTakeFirstOrThrow()).toEqual({ status: "running", lease_owner: "phase2-worker-a" });
      workerA.stopAtBoundary();
      const workerB = new JobWorker({ database: postgres!.db, boss: createBoss(postgres!.databaseUrl), workerId: "phase2-worker-b", leaseDurationMs: 250, pollIntervalMs: 20, executor: createWorkerStepExecutor({ database: postgres!.db, libraryExecutor: createPhase2LibraryExecutor(postgres!.db) }) });
      await workerB.start(); cleanups.push(() => workerB.stop());
      await waitUntil(async () => (await postgres!.db.selectFrom("jobs").select("status").where("id", "=", jobId).executeTakeFirst())?.status === "completed", `Worker B ${blockedKind} recovery`);
      control.release(); await cleanupWorkerA();
    };
    if (blockedKind === "chapter-import") await recover(importJob.job.id); else await waitUntil(async () => (await postgres!.db.selectFrom("jobs").select("status").where("id", "=", importJob.job.id).executeTakeFirst())?.status === "completed", "import before recovery");

    const l1Preview = await json(await api.request(`/books/${created.book.id}/l1-preview`, { method: "POST", body: "{}", headers: { "Content-Type": "application/json" } }));
    const l1Job = await json(await api.request(`/books/${created.book.id}/l1-jobs`, { method: "POST", body: JSON.stringify({ scopeHash: l1Preview.scopeHash }), headers: { "Content-Type": "application/json" } }), 201);
    if (blockedKind === "l1-index") await recover(l1Job.job.id); else await waitUntil(async () => (await postgres!.db.selectFrom("jobs").select("status").where("id", "=", l1Job.job.id).executeTakeFirst())?.status === "completed", "L1 before recovery");

    const group = await json(await api.request(`/books/${created.book.id}/index-groups`, { method: "POST", body: JSON.stringify({ key: "events", name: "Events", categoryScope: "general", promptVersionId }), headers: { "Content-Type": "application/json" } }), 201);
    const scope = { startChapter: 1, endChapter: 1, mode: "missing", force: false };
    const l2Preview = await json(await api.request(`/books/${created.book.id}/index-groups/${group.indexGroup.id}/l2-preview`, { method: "POST", body: JSON.stringify(scope), headers: { "Content-Type": "application/json" } }));
    const l2Job = await json(await api.request(`/books/${created.book.id}/index-groups/${group.indexGroup.id}/l2-jobs`, { method: "POST", body: JSON.stringify({ ...scope, scopeHash: l2Preview.scopeHash }), headers: { "Content-Type": "application/json" } }), 201);
    if (blockedKind === "l2-index") await recover(l2Job.job.id); else await waitUntil(async () => (await postgres!.db.selectFrom("jobs").select("status").where("id", "=", l2Job.job.id).executeTakeFirst())?.status === "completed", "L2 after recovery");

    expect(await postgres.db.selectFrom("chapters").select("id").where("book_id", "=", created.book.id).execute()).toHaveLength(1);
    expect(await postgres.db.selectFrom("l1_indexes").select("id").where("chapter_id", "in", postgres.db.selectFrom("chapters").select("id").where("book_id", "=", created.book.id)).where("is_current", "=", true).execute()).toHaveLength(1);
    expect(await postgres.db.selectFrom("l2_chapter_statuses").select("chapter_id").where("group_id", "=", group.indexGroup.id).execute()).toHaveLength(1);
    expect(await postgres.db.selectFrom("l2_facts").select("id").where("group_id", "=", group.indexGroup.id).execute()).toHaveLength(1);
    expect((await postgres.db.selectFrom("job_attempts as a").innerJoin("job_steps as s", "s.id", "a.step_id").select("a.status").where("s.job_id", "=", recoveredJobId!).orderBy("a.attempt_no").execute()).map((row) => row.status)).toEqual(["abandoned", "completed"]);
  });

  it("sanitizes a failing provider path across HTTP, logs, attempts and events", async () => {
    postgres = await createDisposablePostgres();
    const userId = (await postgres.db.insertInto("users").values({ display_name: "Failure member", avatar_url: null, role: "member", status: "active" }).returning("id").executeTakeFirstOrThrow()).id;
    await configure(postgres.db);
    const logs: string[] = [];
    const api = await startPhase2TestApi(postgres.db, userId, { error: (message) => logs.push(message) }); cleanups.push(api.stop);
    let failedInput = "";
    const executor = createWorkerStepExecutor({ database: postgres.db, libraryExecutor: createPhase2LibraryExecutor(postgres.db, failingL1Adapter((input) => { failedInput = JSON.stringify(input); })) });
    const worker = new JobWorker({ database: postgres.db, boss: createBoss(postgres.databaseUrl), workerId: "phase2-failing-worker", pollIntervalMs: 20, executor, onBackgroundError: (error) => logs.push(String(error)) });
    await worker.start(); cleanups.push(() => worker.stop());
    const created = await json(await api.request("/books", { method: "POST", body: JSON.stringify({ title: "Failure", source: { provider: "dify", sourceId: "9", startChapter: 1, endChapter: 1 } }), headers: { "Content-Type": "application/json" } }), 201);
    const preview = await json(await api.request(`/books/${created.book.id}/import-preview`, { method: "POST", body: "{}", headers: { "Content-Type": "application/json" } }));
    await json(await api.request(`/books/${created.book.id}/import-jobs`, { method: "POST", body: JSON.stringify({ scopeHash: preview.scopeHash, autoStartL1: true }), headers: { "Content-Type": "application/json" } }), 201);
    await waitUntil(async () => (await postgres!.db.selectFrom("jobs").select("status").where("type", "=", "l1-index").executeTakeFirst())?.status === "failed", "controlled L1 failure");
    expect(failedInput).toContain(PHASE2_SENTINELS.chapter);
    const failedJob = await postgres.db.selectFrom("jobs").select("id").where("type", "=", "l1-index").executeTakeFirstOrThrow();
    const http = await json(await api.request(`/jobs/${failedJob.id}`));
    const attempts = await postgres.db.selectFrom("job_attempts as a").innerJoin("job_steps as s", "s.id", "a.step_id").select(["a.status", "a.error_code", "a.error_message"]).where("s.job_id", "=", failedJob.id).execute();
    const events = await postgres.db.selectFrom("job_events").select(["type", "payload"]).where("job_id", "=", failedJob.id).execute();
    expect(JSON.stringify({ attempts, events })).toContain("provider_unavailable");
    expect(http.job.status).toBe("failed");
    for (const sentinel of SENTINELS) { expect(JSON.stringify(http)).not.toContain(sentinel); expect(JSON.stringify(attempts)).not.toContain(sentinel); expect(JSON.stringify(events)).not.toContain(sentinel); expect(logs.join("\n")).not.toContain(sentinel); }
  });

});
