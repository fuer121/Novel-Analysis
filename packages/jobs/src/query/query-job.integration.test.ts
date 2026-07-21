import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sql } from "kysely";

import { createContentCipher, createIndexRepository, createLibraryRepository, createQueryRepository } from "@novel-analysis/database";
import { createDisposablePostgres, type DisposablePostgres } from "../../../database/src/testing/postgres.js";

import { QueryIdempotencyConflictError, QueryJobService, QueryScopeChangedError } from "./query-job.js";

const cipher = createContentCipher({ activeKeyVersion: "test", keys: { test: Buffer.alloc(32, 11) } });
const hmacKey = Buffer.from("query-hmac-test-key");

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

  it("creates only the approved fallback step and references the immutable evidence snapshot", async () => {
    const service = new QueryJobService(postgres.db, cipher, { hmacKey, recallPolicyVersion: "recall-v1" });
    const input = { bookId, sessionId, actor: { id: ownerId, role: "member" as const }, question: "fallback", startChapter: 1, endChapter: 3 };
    const preview = await service.preview(input);
    const created = await service.createTurn({ ...input, requestId: "original", scopeHash: preview.scopeHash });
    const snapshotHash = "c".repeat(64);
    await postgres.db.updateTable("query_turns").set({ evidence_snapshot_hash: snapshotHash, status: "awaiting_fallback" }).where("id", "=", created.turn.id).execute();

    const retry = await service.retrySummary({ bookId, sessionId, turnId: created.turn.id, actor: input.actor, requestId: "retry" });
    const local = await service.requestLocalSummary({ bookId, sessionId, turnId: created.turn.id, actor: input.actor, requestId: "local" });
    const steps = await postgres.db.selectFrom("job_steps").select(["job_id", "kind", "output_ref"]).where("job_id", "in", [retry.id, local.id]).orderBy("kind").execute();
    expect(steps).toEqual([
      { job_id: local.id, kind: "query-local-summary", output_ref: { turnId: created.turn.id, evidenceSnapshotHash: snapshotHash } },
      { job_id: retry.id, kind: "query-summary-retry", output_ref: { turnId: created.turn.id, evidenceSnapshotHash: snapshotHash } },
    ]);
    expect(await postgres.db.selectFrom("turn_evidence").select("id").where("turn_id", "=", created.turn.id).execute()).toEqual([]);
  });
});
