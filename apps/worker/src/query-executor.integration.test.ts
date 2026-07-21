import { createHash } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createContentCipher,
  createIndexRepository,
  createLibraryRepository,
  createQueryRepository,
} from "@novel-analysis/database";
import {
  createDisposablePostgres,
  type DisposablePostgres,
} from "../../../packages/database/src/testing/postgres.js";
import { DifyAdapterError, FakeDifyAdapter } from "@novel-analysis/dify";
import { PostgresStepLeaseService, QueryJobService } from "@novel-analysis/jobs";

import { QueryExecutor } from "./query-executor.js";

const cipher = createContentCipher({ activeKeyVersion: "test", keys: { test: Buffer.alloc(32, 21) } });
const actor = { id: "", role: "member" as const };

describe("Query executor", () => {
  let postgres: DisposablePostgres;
  let ownerId: string;
  let bookId: string;
  let groupId: string;
  let sessionId: string;

  beforeEach(async () => {
    postgres = await createDisposablePostgres();
    ownerId = (await postgres.db.insertInto("users").values({ display_name: "Owner", role: "member", status: "active" }).returning("id").executeTakeFirstOrThrow()).id;
    actor.id = ownerId;
    const library = createLibraryRepository(postgres.db, cipher);
    const indexes = createIndexRepository(postgres.db, cipher);
    bookId = (await library.createBook({ title: "Book", createdBy: ownerId })).id;
    const prompt = await indexes.createPromptVersion({ target: "l2-index", version: "v1", content: "prompt", contentHash: createHash("sha256").update("prompt").digest("hex") });
    groupId = (await indexes.createIndexGroup({ bookId, key: "people", name: "People", categoryScope: "general", promptVersionId: prompt.id, configHash: "group-v1" })).id;
    await indexes.createWorkflowVersion({ target: "analysis-summary", contractVersion: "summary-v1", dslHash: "summary-dsl-v1" });
    const repository = createQueryRepository(postgres.db, cipher);
    sessionId = (await repository.createSession({ bookId, groupId, createdBy: ownerId, title: "Research", defaultStartChapter: 1, defaultEndChapter: 3 })).id;
    for (let chapterIndex = 1; chapterIndex <= 3; chapterIndex += 1) {
      const chapter = await library.insertChapter({ bookId, chapterIndex, title: `Chapter ${chapterIndex}`, plaintext: `chapter-${chapterIndex}`, contentHmac: `hmac-${chapterIndex}`, sourceVersion: "v1" });
      await indexes.putL2ChapterStatus({ groupId, chapterId: chapter.id, inputSignature: `coverage-${chapterIndex}`, status: "fresh" });
      if (chapterIndex !== 2) {
        await indexes.registerSubject({ groupId, subjectKey: "chen", displayName: "陈平安", aliases: ["平安"] });
        await indexes.addFact({ groupId, chapterId: chapter.id, subjectKey: "chen", factType: "event", plaintext: `SENTINEL_FACT_${chapterIndex}`, metadata: { category: "event", scopeEligible: true } });
      }
    }
  });

  afterEach(async () => postgres.destroy());

  async function createClaim(question: string, workerId = "worker-a", leaseDurationMs = 30_000) {
    const service = new QueryJobService(postgres.db, cipher, { hmacKey: Buffer.alloc(32, 22), recallPolicyVersion: "recall-v1" });
    const input = { bookId, sessionId, actor, question, startChapter: 1, endChapter: 3 };
    const preview = await service.preview(input);
    const created = await service.createTurn({ ...input, requestId: `${workerId}-${question}`, scopeHash: preview.scopeHash });
    const claim = await new PostgresStepLeaseService({ database: postgres.db, leaseDurationMs }).claimNext(created.job.id, workerId, new Date());
    return { ...created, claim: claim! };
  }

  it("commits all evidence and one encrypted answer once", async () => {
    const { turn, claim } = await createClaim("陈平安后来发生了什么");
    const dify = new FakeDifyAdapter([{ target: "analysis-summary", invocationKey: `${turn.id}:${claim.attemptId}`, output: { text: "SENTINEL_ANSWER" } }]);
    const executor = new QueryExecutor({ database: postgres.db, cipher, dify });

    await expect(executor.execute(claim)).resolves.toEqual({ disposition: "completed" });
    await expect(executor.execute(claim)).resolves.toMatchObject({ disposition: expect.stringMatching(/already-completed|terminal-noop/) });

    const detail = await createQueryRepository(postgres.db, cipher).getTurn({ turnId: turn.id, actor });
    expect(detail.answer).toBe("SENTINEL_ANSWER");
    expect(detail.evidence).toHaveLength(2);
    expect(detail.evidence.filter((item) => item.disposition === "used")).not.toHaveLength(0);
    expect(await postgres.db.selectFrom("query_turns").select("id").where("answer_ciphertext", "is not", null).execute()).toHaveLength(1);
    expect(dify.calls).toHaveLength(1);
  });

  it("completes with explicit no evidence without calling Dify", async () => {
    const { turn, claim } = await createClaim("一个完全无关的问题");
    await postgres.db.deleteFrom("l2_facts").execute();
    const dify = new FakeDifyAdapter([]);
    const executor = new QueryExecutor({ database: postgres.db, cipher, dify });

    await expect(executor.execute(claim)).resolves.toEqual({ disposition: "completed" });
    const detail = await createQueryRepository(postgres.db, cipher).getTurn({ turnId: turn.id, actor });
    expect(detail.answer).toContain("没有可用证据");
    expect(detail.evidence).toEqual([]);
    expect(detail.gapSnapshot).toEqual({ count: 1 });
    expect(dify.calls).toEqual([]);
  });

  it("uses only recent user questions and never propagates an old answer sentinel", async () => {
    const repository = createQueryRepository(postgres.db, cipher);
    const prior = await repository.createTurn({ sessionId, actor, question: "陈平安第一次出现在哪里", questionHmac: "a".repeat(64), startChapter: 1, endChapter: 3, intentSnapshot: {}, sourceSnapshot: {}, gapSnapshot: {}, configSnapshot: {}, executionSignature: "b".repeat(64) });
    await repository.commitEvidence({ turnId: prior.id, actor, evidence: [] });
    const priorHash = (await postgres.db.selectFrom("query_turns").select("evidence_snapshot_hash").where("id", "=", prior.id).executeTakeFirstOrThrow()).evidence_snapshot_hash!;
    await repository.completeTurn({ turnId: prior.id, actor, answer: "OLD_ANSWER_SENTINEL", status: "completed", evidenceSnapshotHash: priorHash, sourceSnapshot: { candidates: 0, used: 0, excluded: 0, gaps: 1 }, gapSnapshot: { count: 1 }, degradation: null });
    const { turn, claim } = await createClaim("他后来发生了什么");
    const dify = new FakeDifyAdapter([{ target: "analysis-summary", invocationKey: `${turn.id}:${claim.attemptId}`, output: { text: "fresh" } }]);

    await new QueryExecutor({ database: postgres.db, cipher, dify }).execute(claim);

    expect(JSON.stringify(dify.calls)).not.toContain("OLD_ANSWER_SENTINEL");
    const ordinary = JSON.stringify({
      evidence: await postgres.db.selectFrom("turn_evidence").selectAll().where("turn_id", "=", turn.id).execute(),
      events: await postgres.db.selectFrom("job_events").selectAll().where("job_id", "=", claim.jobId).execute(),
      outbox: await postgres.db.selectFrom("job_outbox").selectAll().where("job_id", "=", claim.jobId).execute(),
      attempts: await postgres.db.selectFrom("job_attempts").select(["error_code", "error_message"]).where("step_id", "=", claim.stepId).execute(),
    });
    expect(ordinary).not.toContain("OLD_ANSWER_SENTINEL");
    expect((await repository.getTurn({ turnId: turn.id, actor })).intentSnapshot).toMatchObject({ target: "chen" });
  });

  it("keeps evidence and awaits fallback after provider retry exhaustion", async () => {
    const { turn, claim } = await createClaim("陈平安后来发生了什么");
    const dify = new FakeDifyAdapter([{ target: "analysis-summary", invocationKey: `${turn.id}:${claim.attemptId}`, error: new DifyAdapterError("provider_unavailable") }]);
    const executor = new QueryExecutor({ database: postgres.db, cipher, dify });

    await expect(executor.execute(claim)).resolves.toEqual({ disposition: "failed" });
    const detail = await createQueryRepository(postgres.db, cipher).getTurn({ turnId: turn.id, actor });
    expect(detail.status).toBe("awaiting_fallback");
    expect(detail.degradation).toBe("provider_unavailable");
    expect(detail.evidence).toHaveLength(2);
    expect((await postgres.db.selectFrom("job_attempts").select(["error_code", "error_message"]).where("id", "=", claim.attemptId).executeTakeFirstOrThrow())).toEqual({ error_code: "provider_unavailable", error_message: "provider_unavailable" });
  });

  it("reuses the exact evidence snapshot for provider retry and local Markdown", async () => {
    const original = await createClaim("陈平安后来发生了什么");
    await new QueryExecutor({ database: postgres.db, cipher, dify: new FakeDifyAdapter([{ target: "analysis-summary", invocationKey: `${original.turn.id}:${original.claim.attemptId}`, error: new DifyAdapterError("provider_timeout") }]) }).execute(original.claim);
    const originalDetail = await createQueryRepository(postgres.db, cipher).getTurn({ turnId: original.turn.id, actor });
    const service = new QueryJobService(postgres.db, cipher, { hmacKey: Buffer.alloc(32, 22), recallPolicyVersion: "recall-v1" });
    const fallback = await service.requestLocalSummary({ bookId, sessionId, turnId: original.turn.id, actor, requestId: "local-fallback" });
    const fallbackClaim = (await new PostgresStepLeaseService({ database: postgres.db }).claimNext(fallback.id, "worker-b", new Date()))!;

    await expect(new QueryExecutor({ database: postgres.db, cipher, dify: new FakeDifyAdapter([]) }).execute(fallbackClaim)).resolves.toEqual({ disposition: "completed" });

    const completed = await createQueryRepository(postgres.db, cipher).getTurn({ turnId: original.turn.id, actor });
    expect(completed.status).toBe("degraded");
    expect(completed.degradation).toBe("local_summary");
    expect(completed.answer).toContain("SENTINEL_FACT_1");
    expect(completed.evidenceSnapshotHash).toBe(originalDetail.evidenceSnapshotHash);
    expect(await postgres.db.selectFrom("turn_evidence").select("id").where("turn_id", "=", original.turn.id).execute()).toHaveLength(2);
  });

  it("lets Worker B recover an expired Dify lease and rejects Worker A's late answer", async () => {
    const { turn, claim: claimA } = await createClaim("陈平安后来发生了什么", "worker-a", 20);
    const adapterA = new FakeDifyAdapter([{ target: "analysis-summary", invocationKey: `${turn.id}:${claimA.attemptId}`, output: { text: "LATE_SENTINEL" }, delayMs: 80 }]);
    const runningA = new QueryExecutor({ database: postgres.db, cipher, dify: adapterA }).execute(claimA);
    await new Promise((resolve) => setTimeout(resolve, 30));
    const claimB = (await new PostgresStepLeaseService({ database: postgres.db, leaseDurationMs: 1_000 }).claimNext(claimA.jobId, "worker-b", new Date()))!;
    const adapterB = new FakeDifyAdapter([{ target: "analysis-summary", invocationKey: `${turn.id}:${claimB.attemptId}`, output: { text: "AUTHORITATIVE_ANSWER" } }]);

    await expect(new QueryExecutor({ database: postgres.db, cipher, dify: adapterB }).execute(claimB)).resolves.toEqual({ disposition: "completed" });
    await expect(runningA).resolves.toMatchObject({ disposition: expect.stringMatching(/already-completed|terminal-noop/) });

    const detail = await createQueryRepository(postgres.db, cipher).getTurn({ turnId: turn.id, actor });
    expect(detail.answer).toBe("AUTHORITATIVE_ANSWER");
    expect(await postgres.db.selectFrom("turn_evidence").select("id").where("turn_id", "=", turn.id).execute()).toHaveLength(2);
    expect((await postgres.db.selectFrom("job_attempts").select("status").where("step_id", "=", claimA.stepId).orderBy("attempt_no").execute()).map((row) => row.status)).toEqual(["abandoned", "completed"]);
    expect(await postgres.db.selectFrom("job_events").select("id").where("job_id", "=", claimA.jobId).where("type", "=", "completed").execute()).toHaveLength(1);
  });
});
