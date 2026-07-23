import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";

import { QueryTurnDetailSchema, QueryTurnHistoryPageSchema } from "@novel-analysis/contracts";
import { createContentCipher, createIndexRepository, createLibraryRepository, createQueryRepository, L1_ROUTE_SCHEMA_VERSION, L2_ADMISSION_VERSION, L2_FACT_SCHEMA_VERSION } from "@novel-analysis/database";
import { buildL1Signature, buildL2Signature } from "@novel-analysis/domain";
import { createDisposablePostgres, type DisposablePostgres } from "../../../../packages/database/src/testing/postgres.js";

import { createApp } from "../app.js";
import { FakeFeishuOAuthAdapter } from "../auth/feishu-fake.js";
import type { ApiConfig } from "../config.js";

const cipher = createContentCipher({ activeKeyVersion: "test", keys: { test: Buffer.alloc(32, 12) } });
const config: ApiConfig = { appOrigin: "http://query.test", oauthRedirectUri: "http://query.test/api/auth/callback", sessionCookieName: "query_session", oauthCorrelationCookieName: "query_oauth", sessionCookieSecure: false, sessionTtlMs: 60_000 };

describe("query session routes", () => {
  let postgres: DisposablePostgres;
  let bookId: string;
  let groupId: string;
  let factId: string;
  const identities: Record<string, { id: string; cookie: string; csrf: string }> = {};

  beforeEach(async () => {
    postgres = await createDisposablePostgres();
    for (const [name, role] of [["owner", "member"], ["member", "member"], ["admin", "admin"]] as const) {
      const user = await postgres.db.insertInto("users").values({ display_name: name, role, status: "active" }).returning("id").executeTakeFirstOrThrow();
      const token = `${name}-token`; const csrf = `${name}-csrf`;
      await postgres.db.insertInto("sessions").values({ user_id: user.id, token_hash: createHash("sha256").update(token).digest("hex"), csrf_token_hash: createHash("sha256").update(csrf).digest("hex"), expires_at: new Date(Date.now() + 60_000), revoked_at: null }).execute();
      identities[name] = { id: user.id, cookie: `query_session=${token}`, csrf };
    }
    const library = createLibraryRepository(postgres.db, cipher);
    const indexes = createIndexRepository(postgres.db, cipher);
    bookId = (await library.createBook({ title: "Book", createdBy: identities.owner!.id })).id;
    const prompt = await indexes.createPromptVersion({ target: "l2-index", version: "v1", content: "prompt", contentHash: createHash("sha256").update("prompt").digest("hex") });
    const l1Prompt = await indexes.createPromptVersion({ target: "l1-index", version: "v1", content: "route", contentHash: createHash("sha256").update("route").digest("hex") });
    const l1Workflow = await indexes.createWorkflowVersion({ target: "l1-index", contractVersion: "l1-v1", dslHash: "l1-dsl-v1" });
    const l2Workflow = await indexes.createWorkflowVersion({ target: "l2-index", contractVersion: "l2-v1", dslHash: "l2-dsl-v1" });
    groupId = (await indexes.createIndexGroup({ bookId, key: "base", name: "People", categoryScope: "general", promptVersionId: prompt.id, configHash: "group-v1" })).id;
    await indexes.createWorkflowVersion({ target: "analysis-summary", contractVersion: "summary-v1", dslHash: "summary-dsl-v1" });
    let firstChapterId = "";
    for (let chapterIndex = 1; chapterIndex <= 2; chapterIndex += 1) {
      const chapter = await library.insertChapter({ bookId, chapterIndex, title: `C${chapterIndex}`, plaintext: `body-${chapterIndex}`, contentHmac: `h-${chapterIndex}`, sourceVersion: "source" });
      if (chapterIndex === 1) firstChapterId = chapter.id;
      const l1Signature = buildL1Signature({ sourceVersion: chapter.source_version, chapterHmac: `h-${chapterIndex}`, promptHash: l1Prompt.content_hash, workflowDslHash: l1Workflow.dsl_hash, adapterContractVersion: l1Workflow.contract_version, schemaVersion: L1_ROUTE_SCHEMA_VERSION });
      const l2Signature = buildL2Signature({ sourceVersion: chapter.source_version, chapterHmac: `h-${chapterIndex}`, promptHash: prompt.content_hash, workflowDslHash: l2Workflow.dsl_hash, adapterContractVersion: l2Workflow.contract_version, schemaVersion: L2_FACT_SCHEMA_VERSION, admissionVersion: L2_ADMISSION_VERSION, indexGroupConfigHash: "group-v1", l1Signature });
      await indexes.putL1Index({ chapterId: chapter.id, promptVersionId: l1Prompt.id, workflowVersionId: l1Workflow.id, inputSignature: l1Signature, status: "fresh", route: { route_schema_version: L1_ROUTE_SCHEMA_VERSION, route_entities: [], route_keywords: [], signals: [], category_scores: {} } });
      await indexes.putL2ChapterStatus({ groupId, chapterId: chapter.id, inputSignature: l2Signature, status: "fresh" });
    }
    await indexes.registerSubject({ groupId, subjectKey: "hero", displayName: "Hero", aliases: [] });
    factId = (await indexes.addFact({ groupId, chapterId: firstChapterId, subjectKey: "hero", factType: "event", plaintext: "EVIDENCE_BODY_SENTINEL", metadata: {} })).id;
  });

  afterEach(async () => postgres.destroy());

  const app = () => createApp({ database: postgres.db, config, feishu: new FakeFeishuOAuthAdapter(), contentCipher: cipher, queryHmacKey: Buffer.alloc(32, 14) });
  const auth = (name: string) => ({ Cookie: identities[name]!.cookie });
  const write = (name: string, key: string = crypto.randomUUID()) => ({ ...auth(name), Origin: config.appOrigin, "X-CSRF-Token": identities[name]!.csrf, "Idempotency-Key": key });

  async function createSession(visibility: "private" | "team" = "private") {
    const response = await request(app()).post(`/api/books/${bookId}/query-sessions`).set(write("owner")).send({ groupId, title: "Research", visibility, defaultStartChapter: 1, defaultEndChapter: 2 });
    expect(response.status).toBe(201);
    return response.body.session.id as string;
  }

  async function createTurn(sessionId: string, question: string, name = "owner") {
    const preview = await request(app()).post(`/api/books/${bookId}/query-sessions/${sessionId}/turn-preview`).set(write(name)).send({ question, startChapter: 1, endChapter: 2 });
    const created = await request(app()).post(`/api/books/${bookId}/query-sessions/${sessionId}/turns`).set(write(name)).send({ question, startChapter: 1, endChapter: 2, scopeHash: preview.body.scopeHash });
    expect(created.status).toBe(201);
    return created.body.turn.id as string;
  }

  it("hides private sessions from members while owner and admin can read", async () => {
    const sessionId = await createSession();
    expect((await request(app()).get(`/api/books/${bookId}/query-sessions/${sessionId}`).set(auth("owner"))).status).toBe(200);
    expect((await request(app()).get(`/api/books/${bookId}/query-sessions/${sessionId}`).set(auth("admin"))).status).toBe(200);
    expect((await request(app()).get(`/api/books/${bookId}/query-sessions/${sessionId}`).set(auth("member"))).status).toBe(404);
  });

  it("rejects turn creation when the server-side readiness recheck is incomplete", async () => {
    const sessionId = await createSession();
    await postgres.db.updateTable("l2_chapter_statuses").set({ status: "stale" }).where("group_id", "=", groupId).execute();
    const created = await request(app()).post(`/api/books/${bookId}/query-sessions/${sessionId}/turns`).set(write("owner", "locked-turn")).send({ question: "Locked?", startChapter: 1, endChapter: 2, scopeHash: "0".repeat(64) });
    expect(created.status).toBe(409);
    expect(created.body).toEqual({ error: "analysis_rebuild_incomplete" });
    expect(await postgres.db.selectFrom("query_turns").select("id").execute()).toEqual([]);
  });

  it("allows shared members to read and create their own turn but not manage sessions or another turn", async () => {
    const sessionId = await createSession("team");
    expect((await request(app()).get(`/api/books/${bookId}/query-sessions/${sessionId}`).set(auth("member"))).status).toBe(200);
    expect((await request(app()).patch(`/api/books/${bookId}/query-sessions/${sessionId}`).set(write("member")).send({ title: "stolen" })).status).toBe(403);
    const preview = await request(app()).post(`/api/books/${bookId}/query-sessions/${sessionId}/turn-preview`).set(write("owner")).send({ question: "owner question", startChapter: 1, endChapter: 2 });
    const created = await request(app()).post(`/api/books/${bookId}/query-sessions/${sessionId}/turns`).set(write("owner", "owner-turn")).send({ question: "owner question", startChapter: 1, endChapter: 2, scopeHash: preview.body.scopeHash });
    expect(created.status).toBe(201);
    expect((await request(app()).post(`/api/books/${bookId}/query-sessions/${sessionId}/turns/${created.body.turn.id}/retry-summary`).set(write("member")).send({})).status).toBe(403);
    const memberPreview = await request(app()).post(`/api/books/${bookId}/query-sessions/${sessionId}/turn-preview`).set(write("member")).send({ question: "member question", startChapter: 1, endChapter: 1 });
    const memberCreated = await request(app()).post(`/api/books/${bookId}/query-sessions/${sessionId}/turns`).set(write("member", "member-turn")).send({ question: "member question", startChapter: 1, endChapter: 1, scopeHash: memberPreview.body.scopeHash });
    expect(memberCreated.status).toBe(201);
  });

  it("rejects expanded ranges, stale previews, missing CSRF and missing idempotency keys with stable errors", async () => {
    const sessionId = await createSession("team");
    const expanded = await request(app()).post(`/api/books/${bookId}/query-sessions/${sessionId}/turn-preview`).set(write("member")).send({ question: "range", startChapter: 1, endChapter: 3 });
    expect(expanded.status).toBe(400); expect(expanded.body).toEqual({ error: "invalid_request" });
    const preview = await request(app()).post(`/api/books/${bookId}/query-sessions/${sessionId}/turn-preview`).set(write("member")).send({ question: "old", startChapter: 1, endChapter: 2 });
    const stale = await request(app()).post(`/api/books/${bookId}/query-sessions/${sessionId}/turns`).set(write("member", "stale")).send({ question: "changed", startChapter: 1, endChapter: 2, scopeHash: preview.body.scopeHash });
    expect(stale.status).toBe(409); expect(stale.body).toEqual({ error: "scope_changed" });
    expect((await request(app()).post(`/api/books/${bookId}/query-sessions/${sessionId}/turns`).set(auth("member")).send({})).body).toEqual({ error: "forbidden" });
    const noKey = await request(app()).post(`/api/books/${bookId}/query-sessions/${sessionId}/turns`).set({ ...write("member"), "Idempotency-Key": "" }).send({});
    expect(noKey.status).toBe(400); expect(noKey.body).toEqual({ error: "invalid_request" });
  });

  it("keeps existing book and job routes mounted", async () => {
    expect((await request(app()).get(`/api/books/${bookId}`).set(auth("owner"))).status).toBe(200);
    expect((await request(app()).get("/api/jobs").set(auth("owner"))).status).toBe(200);
  });

  it("returns bounded opaque turn history without evidence or unsafe trace fields", async () => {
    const sessionId = await createSession("team");
    const turnIds = [
      await createTurn(sessionId, "one"),
      await createTurn(sessionId, "two"),
      await createTurn(sessionId, "three"),
    ];
    const tiedAt = new Date("2026-07-21T08:00:00.000Z");
    await postgres.db.updateTable("query_turns").set({ created_at: tiedAt }).where("id", "in", turnIds).execute();
    const tracedId = turnIds[0]!;
    await postgres.db.updateTable("query_turns").set({
      intent_snapshot: { kind: "single-target", target: "Hero", aliases: ["H"], referents: ["he"], categories: ["character"], keywords: ["return"], rawSnapshot: "RAW_SENTINEL" },
      source_snapshot: { candidates: 7, used: 3, excluded: 4, gaps: 2, providerError: "PROVIDER_SENTINEL" },
      gap_snapshot: { count: 2, credential: "CREDENTIAL_SENTINEL" },
      config_snapshot: { recallPolicyVersion: "query-recall-v1", summaryWorkflowVersion: "summary-v1", maxCandidates: 50, executionSignature: "SIGNATURE_SENTINEL" },
      status: "completed",
      completed_at: tiedAt,
    }).where("id", "=", tracedId).execute();

    const firstResponse = await request(app()).get(`/api/books/${bookId}/query-sessions/${sessionId}/turns?limit=2`).set(auth("member"));
    expect(firstResponse.status).toBe(200);
    const first = QueryTurnHistoryPageSchema.parse(firstResponse.body);
    expect(first.turns).toHaveLength(2);
    expect(first.nextCursor).not.toContain(first.turns[1]!.id);
    expect(JSON.stringify(first)).not.toContain("EVIDENCE_BODY_SENTINEL");
    expect(JSON.stringify(first)).not.toMatch(/RAW_SENTINEL|PROVIDER_SENTINEL|CREDENTIAL_SENTINEL|SIGNATURE_SENTINEL/);

    const secondResponse = await request(app()).get(`/api/books/${bookId}/query-sessions/${sessionId}/turns?limit=2&cursor=${encodeURIComponent(first.nextCursor!)}`).set(auth("member"));
    expect(secondResponse.status).toBe(200);
    const second = QueryTurnHistoryPageSchema.parse(secondResponse.body);
    expect(second.turns).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    expect(new Set([...first.turns, ...second.turns].map((turn) => turn.id))).toEqual(new Set(turnIds));
    const allTurns = [...first.turns, ...second.turns];
    expect(allTurns.find((turn) => turn.id === tracedId)!.trace).toEqual({
      kind: "single-target", target: "Hero", aliases: ["H"], referents: ["he"], categories: ["character"], keywords: ["return"],
      sourceCounts: { candidates: 7, used: 3, excluded: 4 }, gapCount: 2,
      recallPolicyVersion: "query-recall-v1", summaryWorkflowVersion: "summary-v1",
    });
    expect(allTurns.find((turn) => turn.id !== tracedId)!.trace).toMatchObject({ kind: null, target: null, recallPolicyVersion: "query-recall-v1", summaryWorkflowVersion: "summary-v1" });

    expect((await request(app()).get(`/api/books/${bookId}/query-sessions/${sessionId}/turns?limit=101`).set(auth("owner"))).status).toBe(400);
    expect((await request(app()).get(`/api/books/${bookId}/query-sessions/${sessionId}/turns?cursor=not-opaque`).set(auth("owner"))).status).toBe(400);
  });

  it("reuses history authorization and keeps selected-turn evidence with the same safe trace", async () => {
    const privateSessionId = await createSession();
    const privateTurnId = await createTurn(privateSessionId, "private");
    expect((await request(app()).get(`/api/books/${bookId}/query-sessions/${privateSessionId}/turns`).set(auth("member"))).status).toBe(404);
    expect((await request(app()).get(`/api/books/${bookId}/query-sessions/${privateSessionId}/turns`).set(auth("admin"))).status).toBe(200);

    const teamSessionId = await createSession("team");
    const teamTurnId = await createTurn(teamSessionId, "detail");
    const repository = createQueryRepository(postgres.db, cipher);
    await repository.commitEvidence({ turnId: teamTurnId, actor: { id: identities.owner!.id, role: "member" }, evidence: [{ factId, rank: 1, recallReason: "subject", disposition: "used" }] });
    const detailResponse = await request(app()).get(`/api/books/${bookId}/query-sessions/${teamSessionId}/turns/${teamTurnId}`).set(auth("member"));
    expect(detailResponse.status).toBe(200);
    const detail = QueryTurnDetailSchema.parse(detailResponse.body.turn);
    expect(detail.evidence[0]!.body).toBe("EVIDENCE_BODY_SENTINEL");

    const cursor = Buffer.from(privateTurnId, "utf8").toString("base64url");
    expect((await request(app()).get(`/api/books/${bookId}/query-sessions/${teamSessionId}/turns?cursor=${cursor}`).set(auth("member"))).status).toBe(404);
    const otherBookId = (await createLibraryRepository(postgres.db, cipher).createBook({ title: "Other history", createdBy: identities.owner!.id })).id;
    expect((await request(app()).get(`/api/books/${otherBookId}/query-sessions/${teamSessionId}/turns`).set(auth("owner"))).status).toBe(404);
  });

  it("defaults history pages to twenty turns", async () => {
    const sessionId = await createSession("team");
    const repository = createQueryRepository(postgres.db, cipher);
    for (let index = 0; index < 21; index += 1) {
      await repository.createTurn({ sessionId, actor: { id: identities.owner!.id, role: "member" }, question: `history-${index}`, questionHmac: "a".repeat(64), startChapter: 1, endChapter: 1, intentSnapshot: {}, sourceSnapshot: {}, gapSnapshot: {}, configSnapshot: {}, executionSignature: "b".repeat(64) });
    }
    const response = await request(app()).get(`/api/books/${bookId}/query-sessions/${sessionId}/turns`).set(auth("owner"));
    expect(response.status).toBe(200);
    const page = QueryTurnHistoryPageSchema.parse(response.body);
    expect(page.turns).toHaveLength(20);
    expect(page.nextCursor).not.toBeNull();
  });

  it("normalizes legacy snapshots safely in history and selected-turn detail", async () => {
    const sessionId = await createSession("team");
    const turnId = await createTurn(sessionId, "legacy snapshot");
    const aliases = Array.from({ length: 24 }, (_, index) => ` alias-${index} `);
    const keywords = Array.from({ length: 54 }, (_, index) => ` keyword-${index} `);
    await postgres.db.updateTable("query_turns").set({
      intent_snapshot: {
        kind: "unsupported",
        target: "  Hero  ",
        aliases: [...aliases, "   ", 42],
        referents: ["  he  ", "", false],
        categories: [...aliases, { unsafe: "CATEGORY_SENTINEL" }],
        keywords: [...keywords, "   ", null],
        rawSnapshot: "RAW_SNAPSHOT_SENTINEL",
      },
      source_snapshot: { candidates: "7", used: 3, excluded: -1, gaps: 2, providerError: "PROVIDER_ERROR_SENTINEL" },
      gap_snapshot: { count: 2, credential: "CREDENTIAL_SENTINEL" },
      config_snapshot: { recallPolicyVersion: "  recall-v1  ", summaryWorkflowVersion: "   ", executionSignature: "EXECUTION_SIGNATURE_SENTINEL" },
    }).where("id", "=", turnId).execute();

    const historyResponse = await request(app()).get(`/api/books/${bookId}/query-sessions/${sessionId}/turns`).set(auth("member"));
    expect(historyResponse.status).toBe(200);
    const history = QueryTurnHistoryPageSchema.parse(historyResponse.body);
    const item = history.turns.find((turn) => turn.id === turnId)!;
    expect(item.trace).toMatchObject({
      kind: null,
      target: "Hero",
      aliases: aliases.slice(0, 20).map((value) => value.trim()),
      referents: ["he"],
      categories: aliases.slice(0, 20).map((value) => value.trim()),
      keywords: keywords.slice(0, 50).map((value) => value.trim()),
      sourceCounts: { candidates: 0, used: 3, excluded: 0 },
      gapCount: 2,
      recallPolicyVersion: "recall-v1",
      summaryWorkflowVersion: null,
    });

    const detailResponse = await request(app()).get(`/api/books/${bookId}/query-sessions/${sessionId}/turns/${turnId}`).set(auth("member"));
    expect(detailResponse.status).toBe(200);
    const detail = QueryTurnDetailSchema.parse(detailResponse.body.turn);
    expect(detail.trace).toEqual(item.trace);
    expect(JSON.stringify({ history: historyResponse.body, detail: detailResponse.body })).not.toMatch(/RAW_SNAPSHOT_SENTINEL|PROVIDER_ERROR_SENTINEL|CREDENTIAL_SENTINEL|EXECUTION_SIGNATURE_SENTINEL|CATEGORY_SENTINEL/);
  });

  it("returns idempotency conflict for cross-book session replay and stores no plaintext-derived audit fingerprint", async () => {
    const key = "session-cross-book";
    const body = { groupId, title: "SENTINEL_SESSION_TITLE", visibility: "private", defaultStartChapter: 1, defaultEndChapter: 2 } as const;
    const first = await request(app()).post(`/api/books/${bookId}/query-sessions`).set(write("owner", key)).send(body);
    expect(first.status).toBe(201);
    const otherBookId = (await createLibraryRepository(postgres.db, cipher).createBook({ title: "Other", createdBy: identities.owner!.id })).id;
    const replay = await request(app()).post(`/api/books/${otherBookId}/query-sessions`).set(write("owner", key)).send(body);
    expect(replay.status).toBe(409); expect(replay.body).toEqual({ error: "idempotency_conflict" });
    const formerFingerprint = createHash("sha256").update(JSON.stringify(body)).digest("hex");
    const audits = JSON.stringify(await postgres.db.selectFrom("audit_logs").selectAll().where("action", "=", "query_session.create").execute());
    expect(audits).not.toContain(body.title);
    expect(audits).not.toContain(formerFingerprint);
    expect(await postgres.db.selectFrom("query_sessions").select("id").execute()).toHaveLength(1);
  });
});
