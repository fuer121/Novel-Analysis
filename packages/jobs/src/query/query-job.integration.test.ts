import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sql } from "kysely";

import { createContentCipher, createIndexRepository, createLibraryRepository, createQueryRepository } from "@novel-analysis/database";
import { createDisposablePostgres, type DisposablePostgres } from "../../../database/src/testing/postgres.js";

import { QueryAccessDeniedError, QueryConfigurationError, QueryIdempotencyConflictError, QueryInvalidStateError, QueryJobService, QueryScopeChangedError } from "./query-job.js";

const cipher = createContentCipher({ activeKeyVersion: "test", keys: { test: Buffer.alloc(32, 11) } });
const hmacKey = Buffer.alloc(32, 13);

describe("Query job service", () => {
  let postgres: DisposablePostgres;
  let ownerId: string;
  let bookId: string;
  let groupId: string;
  let sessionId: string;

  beforeEach(async () => {
    postgres = await createDisposablePostgres();
    ownerId = (await postgres.db.insertInto("users").values({ display_name: "Owner", role: "member", status: "active" }).returning("id").executeTakeFirstOrThrow()).id;
    const library = createLibraryRepository(postgres.db, cipher);
    const indexes = createIndexRepository(postgres.db, cipher);
    bookId = (await library.createBook({ title: "Book", createdBy: ownerId })).id;
    const prompt = await indexes.createPromptVersion({ target: "l2-index", version: "l2-v1", content: "prompt", contentHash: createHash("sha256").update("prompt").digest("hex") });
    groupId = (await indexes.createIndexGroup({ bookId, key: "people", name: "People", categoryScope: "general", promptVersionId: prompt.id, configHash: "group-v1" })).id;
    await indexes.createWorkflowVersion({ target: "analysis-summary", contractVersion: "summary-v1", dslHash: "summary-dsl-v1" });
    for (let chapterIndex = 1; chapterIndex <= 3; chapterIndex += 1) {
      const chapter = await library.insertChapter({ bookId, chapterIndex, title: `Chapter ${chapterIndex}`, plaintext: `chapter-${chapterIndex}`, contentHmac: `chapter-hmac-${chapterIndex}`, sourceVersion: "source-v1" });
      if (chapterIndex !== 2) await indexes.putL2ChapterStatus({ groupId, chapterId: chapter.id, inputSignature: `coverage-${chapterIndex}`, status: "fresh" });
    }
    sessionId = (await createQueryRepository(postgres.db, cipher).createSession({ bookId, groupId, createdBy: ownerId, title: "Research", defaultStartChapter: 1, defaultEndChapter: 3 })).id;
  });

  afterEach(async () => postgres.destroy());

  it.each([1, 31, 33])("rejects a %i-byte HMAC key without leaking key material", (length) => {
    const invalidKey = Buffer.alloc(length, 19);
    const error = (() => {
      try { return new QueryJobService(postgres.db, cipher, { hmacKey: invalidKey, recallPolicyVersion: "recall-v1" }); }
      catch (caught) { return caught; }
    })();
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(QueryConfigurationError);
    expect((error as Error).message).not.toContain(invalidKey.toString("base64"));
    expect((error as Error).message).not.toContain(invalidKey.toString("hex"));
  });

  async function holdAdvisoryLock(domain: string) {
    let acquired!: () => void; let release!: () => void;
    const locked = new Promise<void>((resolve) => { acquired = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const holder = postgres.db.transaction().execute(async (transaction) => {
      await sql`select pg_advisory_xact_lock(hashtext(${domain}))`.execute(transaction);
      acquired(); await gate;
    });
    await locked;
    return { release, holder };
  }

  it("previews approved scope without persisting plaintext", async () => {
    const service = new QueryJobService(postgres.db, cipher, { hmacKey, recallPolicyVersion: "recall-v1" });
    const preview = await service.preview({ bookId, sessionId, actor: { id: ownerId, role: "member" }, question: "SENTINEL_QUESTION", startChapter: 2, endChapter: 3 });
    expect(preview).toMatchObject({ book: { id: bookId, title: "Book" }, group: { id: groupId, key: "people", name: "People" }, defaultRange: { startChapter: 1, endChapter: 3 }, effectiveRange: { startChapter: 2, endChapter: 3 }, queryableChapterCount: 1, coverageGaps: [2], executionVersions: { summaryWorkflowVersion: "summary-v1", recallPolicyVersion: "recall-v1" }, estimatedQueuePosition: 1, scopeHash: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(JSON.stringify(await postgres.db.selectFrom("query_turns").selectAll().execute())).not.toContain("SENTINEL_QUESTION");
  });

  it("creates one encrypted turn, query job, step, event and interactive outbox atomically", async () => {
    const service = new QueryJobService(postgres.db, cipher, { hmacKey, recallPolicyVersion: "recall-v1" });
    const input = { bookId, sessionId, actor: { id: ownerId, role: "member" as const }, question: "SENTINEL_CREATE", startChapter: 1, endChapter: 3 };
    const preview = await service.preview(input);
    const created = await service.createTurn({ ...input, requestId: "request-1", scopeHash: preview.scopeHash });
    expect(created.turn.status).toBe("queued");
    expect(created.job.type).toBe("query");
    expect(await postgres.db.selectFrom("query_turns").select("id").execute()).toHaveLength(1);
    expect(await postgres.db.selectFrom("jobs").select("id").execute()).toHaveLength(1);
    expect(await postgres.db.selectFrom("job_steps").select(["kind", "output_ref"]).execute()).toEqual([{ kind: "l2-query", output_ref: { turnId: created.turn.id } }]);
    expect(await postgres.db.selectFrom("job_events").select("type").execute()).toEqual([{ type: "created" }]);
    expect(await postgres.db.selectFrom("job_outbox").select("topic").execute()).toEqual([{ topic: "jobs.query.wake" }]);
    expect(JSON.stringify(await postgres.db.selectFrom("jobs").selectAll().execute())).not.toContain("SENTINEL_CREATE");
  });

  it("replays an identical idempotency key and rejects a changed payload without duplicates", async () => {
    const service = new QueryJobService(postgres.db, cipher, { hmacKey, recallPolicyVersion: "recall-v1" });
    const input = { bookId, sessionId, actor: { id: ownerId, role: "member" as const }, question: "same", startChapter: 1, endChapter: 3 };
    const preview = await service.preview(input);
    const first = await service.createTurn({ ...input, requestId: "same-key", scopeHash: preview.scopeHash });
    expect((await service.createTurn({ ...input, requestId: "same-key", scopeHash: preview.scopeHash })).turn.id).toBe(first.turn.id);
    const changed = { ...input, question: "changed" };
    const changedPreview = await service.preview(changed);
    await expect(service.createTurn({ ...changed, requestId: "same-key", scopeHash: changedPreview.scopeHash })).rejects.toBeInstanceOf(QueryIdempotencyConflictError);
    expect(await postgres.db.selectFrom("query_turns").select("id").execute()).toHaveLength(1);
    expect(await postgres.db.selectFrom("jobs").select("id").execute()).toHaveLength(1);
  });

  it("treats a cross-book replay as an idempotency conflict without leaking the original resource", async () => {
    const service = new QueryJobService(postgres.db, cipher, { hmacKey, recallPolicyVersion: "recall-v1" });
    const input = { bookId, sessionId, actor: { id: ownerId, role: "member" as const }, question: "cross-book", startChapter: 1, endChapter: 3 };
    const preview = await service.preview(input);
    await service.createTurn({ ...input, requestId: "cross-book-key", scopeHash: preview.scopeHash });
    const otherBookId = (await createLibraryRepository(postgres.db, cipher).createBook({ title: "Other", createdBy: ownerId })).id;
    await expect(service.createTurn({ ...input, bookId: otherBookId, requestId: "cross-book-key", scopeHash: preview.scopeHash })).rejects.toBeInstanceOf(QueryIdempotencyConflictError);
    expect(await postgres.db.selectFrom("query_turns").select("id").execute()).toHaveLength(1);
    expect(await postgres.db.selectFrom("jobs").select("id").execute()).toHaveLength(1);
  });

  it("does not persist plaintext or the former unkeyed plaintext fingerprint", async () => {
    const service = new QueryJobService(postgres.db, cipher, { hmacKey, recallPolicyVersion: "recall-v1" });
    const input = { bookId, sessionId, actor: { id: ownerId, role: "member" as const }, question: "SENTINEL_DERIVED_QUESTION", startChapter: 1, endChapter: 3 };
    const preview = await service.preview(input);
    await service.createTurn({ ...input, requestId: "derived", scopeHash: preview.scopeHash });
    const formerFingerprint = createHash("sha256").update(JSON.stringify({ sessionId, question: input.question, startChapter: 1, endChapter: 3, scopeHash: preview.scopeHash })).digest("hex");
    const ordinary = JSON.stringify({ jobs: await postgres.db.selectFrom("jobs").selectAll().execute(), events: await postgres.db.selectFrom("job_events").selectAll().execute(), outbox: await postgres.db.selectFrom("job_outbox").selectAll().execute(), steps: await postgres.db.selectFrom("job_steps").selectAll().execute() });
    expect(ordinary).not.toContain(input.question);
    expect(ordinary).not.toContain(formerFingerprint);
  });

  it("rejects question, context, range, coverage and workflow drift before writing", async () => {
    const service = new QueryJobService(postgres.db, cipher, { hmacKey, recallPolicyVersion: "recall-v1" });
    const base = { bookId, sessionId, actor: { id: ownerId, role: "member" as const }, question: "base", startChapter: 1, endChapter: 3 };
    const preview = await service.preview(base);
    await expect(service.createTurn({ ...base, question: "changed", requestId: "question", scopeHash: preview.scopeHash })).rejects.toBeInstanceOf(QueryScopeChangedError);
    await createQueryRepository(postgres.db, cipher).createTurn({ sessionId, actor: base.actor, question: "context", questionHmac: "a".repeat(64), startChapter: 1, endChapter: 1, intentSnapshot: {}, sourceSnapshot: {}, gapSnapshot: {}, configSnapshot: {}, executionSignature: "b".repeat(64) });
    await expect(service.createTurn({ ...base, requestId: "context", scopeHash: preview.scopeHash })).rejects.toBeInstanceOf(QueryScopeChangedError);
    const fresh = await service.preview(base);
    await postgres.db.updateTable("query_sessions").set({ default_end_chapter: 2 }).where("id", "=", sessionId).execute();
    await expect(service.createTurn({ ...base, requestId: "range", scopeHash: fresh.scopeHash })).rejects.toBeInstanceOf(QueryScopeChangedError);
    await postgres.db.updateTable("query_sessions").set({ default_end_chapter: 3 }).where("id", "=", sessionId).execute();
    const coverage = await service.preview(base);
    await postgres.db.updateTable("l2_chapter_statuses").set({ input_signature: "coverage-drift" }).where("group_id", "=", groupId).where("status", "=", "fresh").execute();
    await expect(service.createTurn({ ...base, requestId: "coverage", scopeHash: coverage.scopeHash })).rejects.toBeInstanceOf(QueryScopeChangedError);
    const workflow = await service.preview(base);
    await createIndexRepository(postgres.db, cipher).createWorkflowVersion({ target: "analysis-summary", contractVersion: "summary-v2", dslHash: "summary-dsl-v2" });
    await expect(service.createTurn({ ...base, requestId: "workflow", scopeHash: workflow.scopeHash })).rejects.toBeInstanceOf(QueryScopeChangedError);
    expect(await postgres.db.selectFrom("jobs").select("id").execute()).toEqual([]);
  });

  it("serializes concurrent creates per session so only one shared context preview commits", async () => {
    const service = new QueryJobService(postgres.db, cipher, { hmacKey, recallPolicyVersion: "recall-v1" });
    const actor = { id: ownerId, role: "member" as const };
    const first = { bookId, sessionId, actor, question: "first concurrent", startChapter: 1, endChapter: 3 };
    const second = { ...first, question: "second concurrent" };
    const [firstPreview, secondPreview] = await Promise.all([service.preview(first), service.preview(second)]);
    await sql`create function block_query_job_insert() returns trigger language plpgsql as $$ begin perform pg_advisory_xact_lock(hashtext('73001')); return new; end $$`.execute(postgres.db);
    await sql`create trigger block_query_job_insert before insert on jobs for each row execute function block_query_job_insert()`.execute(postgres.db);
    const blocker = await holdAdvisoryLock("73001");
    const creating = Promise.allSettled([
      service.createTurn({ ...first, requestId: "concurrent-first", scopeHash: firstPreview.scopeHash }),
      service.createTurn({ ...second, requestId: "concurrent-second", scopeHash: secondPreview.scopeHash }),
    ]);
    const stateBeforeRelease = await Promise.race([creating.then(() => "settled"), new Promise<"blocked">((resolve) => setImmediate(() => resolve("blocked")))]);
    expect(stateBeforeRelease).toBe("blocked");
    blocker.release(); await blocker.holder;
    const results = await creating;
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
    expect(rejected?.reason).toBeInstanceOf(QueryScopeChangedError);
    expect(await postgres.db.selectFrom("query_turns").select("id").execute()).toHaveLength(1);
  });

  it("does not serialize creates across different sessions", async () => {
    const service = new QueryJobService(postgres.db, cipher, { hmacKey, recallPolicyVersion: "recall-v1" });
    const actor = { id: ownerId, role: "member" as const };
    const otherSessionId = (await createQueryRepository(postgres.db, cipher).createSession({ bookId, groupId, createdBy: ownerId, title: "Independent", defaultStartChapter: 1, defaultEndChapter: 3 })).id;
    const inputs = [sessionId, otherSessionId].map((id, index) => ({ bookId, sessionId: id, actor, question: `independent-${index}`, startChapter: 1, endChapter: 3 }));
    const previews = await Promise.all(inputs.map((input) => service.preview(input)));
    const results = await Promise.all(inputs.map((input, index) => service.createTurn({ ...input, requestId: `independent-${index}`, scopeHash: previews[index]!.scopeHash })));
    expect(new Set(results.map((result) => result.turn.sessionId))).toEqual(new Set([sessionId, otherSessionId]));
  });

  it("rolls back turn, job and step when the outbox insert fails", async () => {
    await sql`create function reject_query_outbox() returns trigger language plpgsql as $$ begin if new.topic = 'jobs.query.wake' then raise exception 'reject'; end if; return new; end $$`.execute(postgres.db);
    await sql`create trigger reject_query_outbox_insert before insert on job_outbox for each row execute function reject_query_outbox()`.execute(postgres.db);
    const service = new QueryJobService(postgres.db, cipher, { hmacKey, recallPolicyVersion: "recall-v1" });
    const input = { bookId, sessionId, actor: { id: ownerId, role: "member" as const }, question: "rollback", startChapter: 1, endChapter: 3 };
    const preview = await service.preview(input);
    await expect(service.createTurn({ ...input, requestId: "rollback", scopeHash: preview.scopeHash })).rejects.toThrow();
    expect(await postgres.db.selectFrom("query_turns").select("id").execute()).toEqual([]);
    expect(await postgres.db.selectFrom("jobs").select("id").execute()).toEqual([]);
    expect(await postgres.db.selectFrom("job_steps").select("id").execute()).toEqual([]);
  });

  it("creates one active fallback, rejects competitors, and replays after turn state changes", async () => {
    const service = new QueryJobService(postgres.db, cipher, { hmacKey, recallPolicyVersion: "recall-v1" });
    const input = { bookId, sessionId, actor: { id: ownerId, role: "member" as const }, question: "fallback", startChapter: 1, endChapter: 3 };
    const preview = await service.preview(input);
    const created = await service.createTurn({ ...input, requestId: "original", scopeHash: preview.scopeHash });
    const snapshotHash = "c".repeat(64);
    await postgres.db.updateTable("query_turns").set({ evidence_snapshot_hash: snapshotHash, status: "awaiting_fallback" }).where("id", "=", created.turn.id).execute();

    const retry = await service.retrySummary({ bookId, sessionId, turnId: created.turn.id, actor: input.actor, requestId: "retry" });
    await expect(service.requestLocalSummary({ bookId, sessionId, turnId: created.turn.id, actor: input.actor, requestId: "local" })).rejects.toBeInstanceOf(QueryInvalidStateError);
    await postgres.db.updateTable("query_turns").set({ status: "completed", completed_at: new Date() }).where("id", "=", created.turn.id).execute();
    expect((await service.retrySummary({ bookId, sessionId, turnId: created.turn.id, actor: input.actor, requestId: "retry" })).id).toBe(retry.id);
    const steps = await postgres.db.selectFrom("job_steps").select(["job_id", "kind", "output_ref"]).where("job_id", "=", retry.id).execute();
    expect(steps).toEqual([{ job_id: retry.id, kind: "query-summary-retry", output_ref: { turnId: created.turn.id, evidenceSnapshotHash: snapshotHash } }]);
    expect(await postgres.db.selectFrom("turn_evidence").select("id").where("turn_id", "=", created.turn.id).execute()).toEqual([]);
  });

  it("rechecks nested visibility and ownership before exact fallback replay", async () => {
    const memberId = (await postgres.db.insertInto("users").values({ display_name: "Member", role: "member", status: "active" }).returning("id").executeTakeFirstOrThrow()).id;
    const repository = createQueryRepository(postgres.db, cipher);
    await repository.updateSession({ sessionId, actor: { id: ownerId, role: "member" }, visibility: "team" });
    const service = new QueryJobService(postgres.db, cipher, { hmacKey, recallPolicyVersion: "recall-v1" });
    const actor = { id: memberId, role: "member" as const };
    const input = { bookId, sessionId, actor, question: "member fallback", startChapter: 1, endChapter: 3 };
    const preview = await service.preview(input);
    const created = await service.createTurn({ ...input, requestId: "member-original", scopeHash: preview.scopeHash });
    await postgres.db.updateTable("query_turns").set({ evidence_snapshot_hash: "e".repeat(64), status: "awaiting_fallback" }).where("id", "=", created.turn.id).execute();
    const fallbackInput = { bookId, sessionId, turnId: created.turn.id, actor, requestId: "member-fallback" };
    await service.retrySummary(fallbackInput);

    await repository.updateSession({ sessionId, actor: { id: ownerId, role: "member" }, visibility: "private" });
    await expect(service.retrySummary(fallbackInput)).rejects.toBeInstanceOf(QueryAccessDeniedError);
    expect(await postgres.db.selectFrom("jobs").select("id").where("request_id", "=", "member-fallback").execute()).toHaveLength(1);
  });

  it("allows only one concurrent fallback for a turn and maps a cross-operation request collision", async () => {
    const service = new QueryJobService(postgres.db, cipher, { hmacKey, recallPolicyVersion: "recall-v1" });
    const actor = { id: ownerId, role: "member" as const };
    const original = { bookId, sessionId, actor, question: "fallback race", startChapter: 1, endChapter: 3 };
    const preview = await service.preview(original);
    const created = await service.createTurn({ ...original, requestId: "race-original", scopeHash: preview.scopeHash });
    await postgres.db.updateTable("query_turns").set({ evidence_snapshot_hash: "d".repeat(64), status: "awaiting_fallback" }).where("id", "=", created.turn.id).execute();
    const fallbacks = await Promise.allSettled([
      service.retrySummary({ bookId, sessionId, turnId: created.turn.id, actor, requestId: "race-retry" }),
      service.requestLocalSummary({ bookId, sessionId, turnId: created.turn.id, actor, requestId: "race-local" }),
    ]);
    expect(fallbacks.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(fallbacks.find((result): result is PromiseRejectedResult => result.status === "rejected")?.reason).toBeInstanceOf(QueryInvalidStateError);
    await postgres.db.updateTable("jobs").set({ status: "completed" }).where(sql<boolean>`config_snapshot ->> 'operation' = 'fallback'`).execute();

    const otherSessionId = (await createQueryRepository(postgres.db, cipher).createSession({ bookId, groupId, createdBy: ownerId, title: "Other session", defaultStartChapter: 1, defaultEndChapter: 3 })).id;
    const createInput = { bookId, sessionId: otherSessionId, actor, question: "cross operation", startChapter: 1, endChapter: 3 };
    const createPreview = await service.preview(createInput);
    const cross = await Promise.allSettled([
      service.createTurn({ ...createInput, requestId: "cross-operation", scopeHash: createPreview.scopeHash }),
      service.retrySummary({ bookId, sessionId, turnId: created.turn.id, actor, requestId: "cross-operation" }),
    ]);
    expect(cross.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(cross.find((result): result is PromiseRejectedResult => result.status === "rejected")?.reason).toBeInstanceOf(QueryIdempotencyConflictError);
  });

  it("does not remap unrelated unique violations as idempotency conflicts", async () => {
    await sql`create function reject_query_step_unique() returns trigger language plpgsql as $$ begin raise unique_violation using constraint = 'other_unique_constraint'; end $$`.execute(postgres.db);
    await sql`create trigger reject_query_step_unique before insert on job_steps for each row execute function reject_query_step_unique()`.execute(postgres.db);
    const service = new QueryJobService(postgres.db, cipher, { hmacKey, recallPolicyVersion: "recall-v1" });
    const input = { bookId, sessionId, actor: { id: ownerId, role: "member" as const }, question: "other unique", startChapter: 1, endChapter: 3 };
    const preview = await service.preview(input);
    const error = await service.createTurn({ ...input, requestId: "other-unique", scopeHash: preview.scopeHash }).catch((caught: unknown) => caught);
    expect(error).not.toBeInstanceOf(QueryIdempotencyConflictError);
    expect(error).toMatchObject({ code: "23505", constraint: "other_unique_constraint" });
  });
});
