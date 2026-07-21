import { createHash, randomBytes } from "node:crypto";

import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { createContentCipher } from "../library/content-encryption.js";
import { createIndexRepository } from "../library/index-repository.js";
import { createLibraryRepository } from "../library/library-repository.js";
import { createDisposablePostgres, type DisposablePostgres } from "../testing/postgres.js";
import { createQueryRepository, type QueryActor } from "./query-repository.js";

const QUESTION_HMAC = "a".repeat(64);
const EXECUTION_SIGNATURE = "b".repeat(64);
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
};

describe("continuous query repository", () => {
  let postgres: DisposablePostgres;
  const cipher = createContentCipher({ activeKeyVersion: "query-v1", keys: { "query-v1": randomBytes(32) } });
  let owner: QueryActor;
  let member: QueryActor;
  let admin: QueryActor;
  let otherBookId: string;
  let bookId: string;
  let groupId: string;
  let otherGroupId: string;
  let factId: string;
  let otherFactId: string;

  beforeAll(async () => {
    postgres = await createDisposablePostgres();
    const users = await postgres.db.insertInto("users").values([
      { display_name: "Owner", role: "member", status: "active" },
      { display_name: "Member", role: "member", status: "active" },
      { display_name: "Admin", role: "admin", status: "active" },
    ]).returning(["id", "role"]).execute();
    owner = { id: users[0]!.id, role: users[0]!.role };
    member = { id: users[1]!.id, role: users[1]!.role };
    admin = { id: users[2]!.id, role: users[2]!.role };
    const books = await postgres.db.insertInto("books").values([
      { title: "Book", created_by: owner.id, status: "active" },
      { title: "Other", created_by: owner.id, status: "active" },
    ]).returning("id").execute();
    bookId = books[0]!.id;
    otherBookId = books[1]!.id;
    const library = createLibraryRepository(postgres.db, cipher);
    const chapters = [];
    for (let index = 1; index <= 3; index += 1) chapters.push(await library.insertChapter({ bookId, chapterIndex: index, title: `Chapter ${index}`, plaintext: `chapter-${index}`, contentHmac: `h-${index}`, sourceVersion: "v1" }));
    const otherChapter = await library.insertChapter({ bookId: otherBookId, chapterIndex: 1, title: "Other", plaintext: "other", contentHmac: "other-h", sourceVersion: "v1" });
    const prompt = await postgres.db.insertInto("prompt_versions").values({ target: "l2-index", version: "query", content_hash: "hash" }).returning("id").executeTakeFirstOrThrow();
    const groups = await postgres.db.insertInto("index_groups").values([
      { book_id: bookId, key: "query", name: "Query", prompt_version_id: prompt.id, config_hash: "one" },
      { book_id: otherBookId, key: "other", name: "Other", prompt_version_id: prompt.id, config_hash: "two" },
    ]).returning("id").execute();
    groupId = groups[0]!.id;
    otherGroupId = groups[1]!.id;
    const indexes = createIndexRepository(postgres.db, cipher);
    await indexes.registerSubject({ groupId, subjectKey: "hero", displayName: "Hero", aliases: [] });
    await indexes.registerSubject({ groupId: otherGroupId, subjectKey: "other", displayName: "Other", aliases: [] });
    factId = (await indexes.addFact({ groupId, chapterId: chapters[0]!.id, subjectKey: "hero", factType: "event", plaintext: "fact-secret", metadata: {} })).id;
    otherFactId = (await indexes.addFact({ groupId: otherGroupId, chapterId: otherChapter.id, subjectKey: "other", factType: "event", plaintext: "other-fact", metadata: {} })).id;
  });

  afterAll(async () => postgres?.destroy());

  test("encrypts session, question, and answer while roundtripping authorized content", async () => {
    const repository = createQueryRepository(postgres.db, cipher);
    const title = "query-title-plaintext-sentinel";
    const question = "query-question-plaintext-sentinel";
    const answer = "query-answer-plaintext-sentinel";
    const session = await repository.createSession({ bookId, groupId, createdBy: owner.id, title, defaultStartChapter: 1, defaultEndChapter: 3 });
    expect(session).toMatchObject({ title, visibility: "private", createdBy: owner.id });
    const turn = await repository.createTurn({ sessionId: session.id, actor: owner, question, questionHmac: createHash("sha256").update(question).digest("hex"), startChapter: 1, endChapter: 2, intentSnapshot: { kind: "single-target", target: "hero", aliases: [], referents: [], categories: [], keywords: [] }, sourceSnapshot: {}, gapSnapshot: {}, configSnapshot: {}, executionSignature: EXECUTION_SIGNATURE });
    await repository.commitEvidence({ turnId: turn.id, actor: owner, evidence: [{ factId, rank: 1, recallReason: "subject", disposition: "used" }] });
    const snapshotHash = (await postgres.db.selectFrom("query_turns").select("evidence_snapshot_hash").where("id", "=", turn.id).executeTakeFirstOrThrow()).evidence_snapshot_hash!;
    const completed = await repository.completeTurn({ turnId: turn.id, actor: owner, answer, status: "completed", evidenceSnapshotHash: snapshotHash, sourceSnapshot: { candidates: 1, used: 1, excluded: 0, gaps: 0 }, gapSnapshot: {}, degradation: null });
    expect(completed.answer).toBe(answer);
    const detail = await repository.getTurn({ turnId: turn.id, actor: owner });
    expect(detail).toMatchObject({ question, answer, evidence: [{ factId, body: "fact-secret" }] });
    const raw = await sql<Record<string, unknown>>`select * from query_sessions s join query_turns t on t.session_id = s.id where s.id = ${session.id}`.execute(postgres.db);
    expect(JSON.stringify(raw.rows)).not.toContain(title);
    expect(JSON.stringify(raw.rows)).not.toContain(question);
    expect(JSON.stringify(raw.rows)).not.toContain(answer);
    const rejectedTitle = "rejected-title-plaintext-sentinel";
    const rejected = await repository.createSession({ bookId, groupId: otherGroupId, createdBy: owner.id, title: rejectedTitle, defaultStartChapter: 1, defaultEndChapter: 1 }).catch((error: unknown) => error);
    expect(rejected).toMatchObject({ message: "Invalid query session" });
    expect(String(rejected)).not.toContain(rejectedTitle);
  });

  test("enforces group/book and chapter range constraints", async () => {
    const repository = createQueryRepository(postgres.db, cipher);
    await expect(repository.createSession({ bookId, groupId: otherGroupId, createdBy: owner.id, title: "bad", defaultStartChapter: 1, defaultEndChapter: 2 })).rejects.toThrow("Invalid query session");
    await expect(repository.createSession({ bookId, groupId, createdBy: owner.id, title: "bad", defaultStartChapter: 3, defaultEndChapter: 2 })).rejects.toThrow("Invalid query session");
    const session = await repository.createSession({ bookId, groupId, createdBy: owner.id, title: "range", defaultStartChapter: 1, defaultEndChapter: 2 });
    await expect(repository.createTurn({ sessionId: session.id, actor: owner, question: "outside", questionHmac: QUESTION_HMAC, startChapter: 1, endChapter: 3, intentSnapshot: {}, sourceSnapshot: {}, gapSnapshot: {}, configSnapshot: {}, executionSignature: EXECUTION_SIGNATURE })).rejects.toThrow("Invalid query turn");
    const snapshotSentinel = "snapshot-plaintext-sentinel";
    const rejected = await repository.createTurn({ sessionId: session.id, actor: owner, question: "valid", questionHmac: QUESTION_HMAC, startChapter: 1, endChapter: 1, intentSnapshot: { fact: snapshotSentinel }, sourceSnapshot: {}, gapSnapshot: {}, configSnapshot: {}, executionSignature: EXECUTION_SIGNATURE }).catch((error: unknown) => error);
    expect(rejected).toMatchObject({ message: "Invalid query turn" });
    expect(String(rejected)).not.toContain(snapshotSentinel);
    expect(JSON.stringify(await postgres.db.selectFrom("query_turns").select(["intent_snapshot", "source_snapshot", "gap_snapshot", "config_snapshot"]).where("session_id", "=", session.id).execute())).not.toContain(snapshotSentinel);
  });

  test("rejects sensitive content hidden under arbitrary snapshot keys", async () => {
    const repository = createQueryRepository(postgres.db, cipher);
    const title = "hidden-title-plaintext-sentinel";
    const question = "hidden-question-plaintext-sentinel";
    const answer = "hidden-answer-plaintext-sentinel";
    const factBody = "fact-secret";
    const session = await repository.createSession({ bookId, groupId, createdBy: owner.id, title, defaultStartChapter: 1, defaultEndChapter: 3 });
    for (const snapshot of [
      { configSnapshot: { note: title } },
      { configSnapshot: { payload: question } },
      { intentSnapshot: { label: answer } },
      { configSnapshot: { marker: factBody } },
      { intentSnapshot: { kind: "single-target", target: title, aliases: [], referents: [], categories: [], keywords: [] } },
      { intentSnapshot: { kind: "single-target", target: question, aliases: [], referents: [], categories: [], keywords: [] } },
      { configSnapshot: { recallPolicyVersion: title } },
      { configSnapshot: { summaryWorkflowVersion: question } },
    ]) {
      const rejected = await repository.createTurn({ sessionId: session.id, actor: owner, question, questionHmac: QUESTION_HMAC, startChapter: 1, endChapter: 1, intentSnapshot: {}, sourceSnapshot: {}, gapSnapshot: {}, configSnapshot: {}, executionSignature: EXECUTION_SIGNATURE, ...snapshot }).catch((error: unknown) => error);
      expect(rejected).toMatchObject({ message: "Invalid query turn" });
      expect(String(rejected)).not.toContain(title);
      expect(String(rejected)).not.toContain(question);
      expect(String(rejected)).not.toContain(answer);
      expect(String(rejected)).not.toContain(factBody);
    }
    const turn = await repository.createTurn({ sessionId: session.id, actor: owner, question, questionHmac: QUESTION_HMAC, startChapter: 1, endChapter: 1, intentSnapshot: {}, sourceSnapshot: {}, gapSnapshot: {}, configSnapshot: {}, executionSignature: EXECUTION_SIGNATURE });
    await repository.commitEvidence({ turnId: turn.id, actor: owner, evidence: [{ factId, rank: 1, recallReason: "match", disposition: "used" }] });
    const snapshotHash = (await postgres.db.selectFrom("query_turns").select("evidence_snapshot_hash").where("id", "=", turn.id).executeTakeFirstOrThrow()).evidence_snapshot_hash!;
    for (const gapSnapshot of [{ note: answer }, { payload: question }, { label: title }, { marker: factBody }]) {
      const rejected = await repository.completeTurn({ turnId: turn.id, actor: owner, answer, status: "completed", evidenceSnapshotHash: snapshotHash, sourceSnapshot: { candidates: 1, used: 1, excluded: 0, gaps: 0 }, gapSnapshot, degradation: null }).catch((error: unknown) => error);
      expect(rejected).toMatchObject({ message: "Invalid query turn" });
      expect(String(rejected)).not.toContain(answer);
    }
    const rows = await postgres.db.selectFrom("query_turns").select(["intent_snapshot", "source_snapshot", "gap_snapshot", "config_snapshot"]).where("session_id", "=", session.id).execute();
    expect(JSON.stringify(rows)).not.toContain(title);
    expect(JSON.stringify(rows)).not.toContain(question);
    expect(JSON.stringify(rows)).not.toContain(answer);
    expect(JSON.stringify(rows)).not.toContain(factBody);
  });

  test("rejects plaintext sentinels in ordinary query control columns", async () => {
    const repository = createQueryRepository(postgres.db, cipher);
    const title = "ordinary-title-plaintext-sentinel";
    const question = "ordinary-question-plaintext-sentinel";
    const answer = "ordinary-answer-plaintext-sentinel";
    const factBody = "fact-secret";
    const session = await repository.createSession({ bookId, groupId, createdBy: owner.id, title, defaultStartChapter: 1, defaultEndChapter: 3 });
    for (const unsafe of [title, question, answer, factBody]) {
      for (const fields of [{ questionHmac: unsafe }, { executionSignature: unsafe }]) {
        const rejected = await repository.createTurn({ sessionId: session.id, actor: owner, question, questionHmac: QUESTION_HMAC, startChapter: 1, endChapter: 1, intentSnapshot: {}, sourceSnapshot: {}, gapSnapshot: {}, configSnapshot: {}, executionSignature: EXECUTION_SIGNATURE, ...fields }).catch((error: unknown) => error);
        expect(rejected).toMatchObject({ message: "Invalid query turn" });
        expect(String(rejected)).not.toContain(unsafe);
      }
    }
    const turn = await repository.createTurn({ sessionId: session.id, actor: owner, question, questionHmac: QUESTION_HMAC, startChapter: 1, endChapter: 1, intentSnapshot: {}, sourceSnapshot: {}, gapSnapshot: {}, configSnapshot: {}, executionSignature: EXECUTION_SIGNATURE });
    await expect(postgres.db.updateTable("query_turns").set({ question_hmac: title }).where("id", "=", turn.id).execute()).rejects.toMatchObject({ constraint: "query_turns_question_hmac_check" });
    await expect(postgres.db.updateTable("query_turns").set({ execution_signature: question }).where("id", "=", turn.id).execute()).rejects.toMatchObject({ constraint: "query_turns_execution_signature_check" });
    await expect(postgres.db.updateTable("query_turns").set({ degradation: answer }).where("id", "=", turn.id).execute()).rejects.toMatchObject({ constraint: "query_turns_degradation_check" });
    await expect(postgres.db.insertInto("turn_evidence").values({ turn_id: turn.id, fact_id: factId, rank: 1, recall_reason: title, disposition: "used", exclusion_reason: null }).execute()).rejects.toMatchObject({ constraint: "turn_evidence_recall_reason_check" });
    await expect(postgres.db.insertInto("turn_evidence").values({ turn_id: turn.id, fact_id: factId, rank: 1, recall_reason: "candidate_match", disposition: "excluded", exclusion_reason: answer }).execute()).rejects.toMatchObject({ constraint: "turn_evidence_exclusion_reason_code_check" });
    for (const unsafe of [title, question, answer, factBody]) {
      for (const fields of [{ recallReason: unsafe, exclusionReason: undefined }, { recallReason: "candidate_match", exclusionReason: unsafe }]) {
        const rejected = await repository.commitEvidence({ turnId: turn.id, actor: owner, evidence: [{ factId, rank: 1, disposition: fields.exclusionReason ? "excluded" : "used", ...fields }] }).catch((error: unknown) => error);
        expect(rejected).toMatchObject({ message: "Invalid turn evidence" });
        expect(String(rejected)).not.toContain(unsafe);
      }
    }
    await repository.commitEvidence({ turnId: turn.id, actor: owner, evidence: [{ factId, rank: 1, recallReason: "candidate_match", disposition: "used" }] });
    const snapshotHash = (await postgres.db.selectFrom("query_turns").select("evidence_snapshot_hash").where("id", "=", turn.id).executeTakeFirstOrThrow()).evidence_snapshot_hash!;
    for (const degradation of [title, question, answer, factBody]) {
      const rejected = await repository.completeTurn({ turnId: turn.id, actor: owner, answer, status: "degraded", evidenceSnapshotHash: snapshotHash, sourceSnapshot: { candidates: 1, used: 1, excluded: 0, gaps: 0 }, gapSnapshot: {}, degradation }).catch((error: unknown) => error);
      expect(rejected).toMatchObject({ message: "Invalid query turn" });
      expect(String(rejected)).not.toContain(degradation);
    }
    const raw = await sql<Record<string, unknown>>`select s.*, t.*, e.* from query_sessions s left join query_turns t on t.session_id = s.id left join turn_evidence e on e.turn_id = t.id where s.id = ${session.id}`.execute(postgres.db);
    for (const sentinel of [title, question, answer, factBody]) expect(JSON.stringify(raw.rows)).not.toContain(sentinel);
  });

  test("authorizes private and team sessions before returning decrypted content", async () => {
    const repository = createQueryRepository(postgres.db, cipher);
    const privateSession = await repository.createSession({ bookId, groupId, createdBy: owner.id, title: "private-secret", defaultStartChapter: 1, defaultEndChapter: 3 });
    const privateTurn = await repository.createTurn({ sessionId: privateSession.id, actor: owner, question: "private-question", questionHmac: QUESTION_HMAC, startChapter: 1, endChapter: 1, intentSnapshot: {}, sourceSnapshot: {}, gapSnapshot: {}, configSnapshot: {}, executionSignature: EXECUTION_SIGNATURE });
    await expect(repository.getTurn({ turnId: privateTurn.id, actor: member })).rejects.toThrow("Query access denied");
    expect(await repository.listVisibleSessions({ bookId, actor: member })).not.toContainEqual(expect.objectContaining({ id: privateSession.id }));
    expect(await repository.listVisibleSessions({ bookId, actor: admin })).toContainEqual(expect.objectContaining({ id: privateSession.id, title: "private-secret" }));
    const team = await repository.updateSession({ sessionId: privateSession.id, actor: owner, visibility: "team" });
    expect(team.visibility).toBe("team");
    expect(await repository.listVisibleSessions({ bookId, actor: member })).toContainEqual(expect.objectContaining({ id: team.id, title: "private-secret" }));
    await expect(repository.updateSession({ sessionId: team.id, actor: member, title: "stolen" })).rejects.toThrow("Query access denied");
    await expect(repository.archiveSession({ sessionId: team.id, actor: member })).rejects.toThrow("Query access denied");
  });

  test("lets a member create and manage only their own turn in a team session", async () => {
    const repository = createQueryRepository(postgres.db, cipher);
    const session = await repository.createSession({ bookId, groupId, createdBy: owner.id, title: "shared", visibility: "team", defaultStartChapter: 1, defaultEndChapter: 3 });
    const turn = await repository.createTurn({ sessionId: session.id, actor: member, question: "member-question", questionHmac: QUESTION_HMAC, startChapter: 1, endChapter: 1, intentSnapshot: {}, sourceSnapshot: {}, gapSnapshot: {}, configSnapshot: {}, executionSignature: EXECUTION_SIGNATURE });
    expect(turn.createdBy).toBe(member.id);
    await repository.commitEvidence({ turnId: turn.id, actor: member, evidence: [] });
    const snapshotHash = (await postgres.db.selectFrom("query_turns").select("evidence_snapshot_hash").where("id", "=", turn.id).executeTakeFirstOrThrow()).evidence_snapshot_hash!;
    await expect(repository.completeTurn({ turnId: turn.id, actor: owner, answer: "no", status: "completed", evidenceSnapshotHash: "x", sourceSnapshot: {}, gapSnapshot: {}, degradation: null })).rejects.toThrow("Query access denied");
    await expect(repository.completeTurn({ turnId: turn.id, actor: admin, answer: "admin", status: "completed", evidenceSnapshotHash: "wrong", sourceSnapshot: {}, gapSnapshot: {}, degradation: null })).rejects.toThrow("Invalid query turn");
    await expect(repository.completeTurn({ turnId: turn.id, actor: admin, answer: "admin", status: "completed", evidenceSnapshotHash: snapshotHash, sourceSnapshot: {}, gapSnapshot: {}, degradation: null })).resolves.toMatchObject({ answer: "admin", evidenceSnapshotHash: snapshotHash });
  });

  test("rolls back a turn and evidence together", async () => {
    const repository = createQueryRepository(postgres.db, cipher);
    const session = await repository.createSession({ bookId, groupId, createdBy: owner.id, title: "rollback", defaultStartChapter: 1, defaultEndChapter: 3 });
    let turnId = "";
    await expect(postgres.db.transaction().execute(async (transaction) => {
      const transactional = createQueryRepository(transaction, cipher);
      const turn = await transactional.createTurn({ sessionId: session.id, actor: owner, question: "rollback-question", questionHmac: QUESTION_HMAC, startChapter: 1, endChapter: 1, intentSnapshot: {}, sourceSnapshot: {}, gapSnapshot: {}, configSnapshot: {}, executionSignature: EXECUTION_SIGNATURE });
      turnId = turn.id;
      await transactional.commitEvidence({ turnId, actor: owner, evidence: [{ factId, rank: 1, recallReason: "match", disposition: "used" }] });
      throw new Error("rollback");
    })).rejects.toThrow("rollback");
    expect(await postgres.db.selectFrom("query_turns").select("id").where("id", "=", turnId).execute()).toEqual([]);
    expect(await postgres.db.selectFrom("turn_evidence").select("id").where("turn_id", "=", turnId).execute()).toEqual([]);
  });

  test("commits evidence once and rejects facts outside the session group", async () => {
    const repository = createQueryRepository(postgres.db, cipher);
    const session = await repository.createSession({ bookId, groupId, createdBy: owner.id, title: "evidence", defaultStartChapter: 1, defaultEndChapter: 3 });
    const makeTurn = (question: string) => repository.createTurn({ sessionId: session.id, actor: owner, question, questionHmac: QUESTION_HMAC, startChapter: 1, endChapter: 2, intentSnapshot: {}, sourceSnapshot: {}, gapSnapshot: {}, configSnapshot: {}, executionSignature: EXECUTION_SIGNATURE });
    const turn = await makeTurn("once");
    await repository.commitEvidence({ turnId: turn.id, actor: owner, evidence: [{ factId, rank: 1, recallReason: "match", disposition: "used" }] });
    await expect(postgres.db.insertInto("turn_evidence").values({ turn_id: turn.id, fact_id: factId, rank: 2, recall_reason: "late", disposition: "excluded", exclusion_reason: "late" }).execute()).rejects.toThrow("turn evidence snapshot already committed");
    await expect(repository.commitEvidence({ turnId: turn.id, actor: owner, evidence: [{ factId, rank: 1, recallReason: "again", disposition: "used" }] })).rejects.toThrow("Evidence snapshot already committed");
    await expect(postgres.db.updateTable("turn_evidence").set({ rank: 2 }).where("turn_id", "=", turn.id).execute()).rejects.toThrow("turn evidence is immutable");
    await expect(postgres.db.deleteFrom("turn_evidence").where("turn_id", "=", turn.id).execute()).rejects.toThrow("turn evidence is immutable");
    const mismatch = await makeTurn("mismatch");
    await expect(repository.commitEvidence({ turnId: mismatch.id, actor: owner, evidence: [{ factId: otherFactId, rank: 1, recallReason: "bad", disposition: "excluded", exclusionReason: "wrong" }] })).rejects.toThrow("Invalid turn evidence");
    expect(await postgres.db.selectFrom("turn_evidence").select("id").where("turn_id", "=", mismatch.id).execute()).toEqual([]);
  });

  test("serializes concurrent evidence commits into one snapshot", async () => {
    const repository = createQueryRepository(postgres.db, cipher);
    const session = await repository.createSession({ bookId, groupId, createdBy: owner.id, title: "concurrent", defaultStartChapter: 1, defaultEndChapter: 3 });
    const turn = await repository.createTurn({ sessionId: session.id, actor: owner, question: "race", questionHmac: QUESTION_HMAC, startChapter: 1, endChapter: 2, intentSnapshot: {}, sourceSnapshot: {}, gapSnapshot: {}, configSnapshot: {}, executionSignature: EXECUTION_SIGNATURE });
    const results = await Promise.allSettled([
      repository.commitEvidence({ turnId: turn.id, actor: owner, evidence: [{ factId, rank: 1, recallReason: "first", disposition: "used" }] }),
      repository.commitEvidence({ turnId: turn.id, actor: owner, evidence: [{ factId, rank: 2, recallReason: "second", disposition: "excluded", exclusionReason: "race" }] }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected).toMatchObject({ reason: { message: "Evidence snapshot already committed" } });
    expect(await postgres.db.selectFrom("turn_evidence").selectAll().where("turn_id", "=", turn.id).execute()).toHaveLength(1);
    expect((await postgres.db.selectFrom("query_turns").select("evidence_snapshot_hash").where("id", "=", turn.id).executeTakeFirstOrThrow()).evidence_snapshot_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  test("hashes all authoritative evidence rows including pre-seal direct inserts", async () => {
    const repository = createQueryRepository(postgres.db, cipher);
    const session = await repository.createSession({ bookId, groupId, createdBy: owner.id, title: "authoritative", defaultStartChapter: 1, defaultEndChapter: 3 });
    const turn = await repository.createTurn({ sessionId: session.id, actor: owner, question: "authoritative", questionHmac: QUESTION_HMAC, startChapter: 1, endChapter: 1, intentSnapshot: {}, sourceSnapshot: {}, gapSnapshot: {}, configSnapshot: {}, executionSignature: EXECUTION_SIGNATURE });
    await postgres.db.insertInto("turn_evidence").values({ turn_id: turn.id, fact_id: factId, rank: 3, recall_reason: "direct_candidate", disposition: "excluded", exclusion_reason: "candidate_budget" }).execute();
    await repository.commitEvidence({ turnId: turn.id, actor: owner, evidence: [] });
    const rows = await postgres.db.selectFrom("turn_evidence").select(["fact_id", "rank", "recall_reason", "disposition", "exclusion_reason"]).where("turn_id", "=", turn.id).orderBy("rank").orderBy("fact_id").execute();
    const expectedHash = createHash("sha256").update(JSON.stringify(rows.map((row) => ({ factId: row.fact_id, rank: row.rank, recallReason: row.recall_reason, disposition: row.disposition, exclusionReason: row.exclusion_reason })))).digest("hex");
    expect((await postgres.db.selectFrom("query_turns").select("evidence_snapshot_hash").where("id", "=", turn.id).executeTakeFirstOrThrow()).evidence_snapshot_hash).toBe(expectedHash);
  });

  test("does not read or complete after a visibility revocation wins the session lock", async () => {
    const repository = createQueryRepository(postgres.db, cipher);
    const session = await repository.createSession({ bookId, groupId, createdBy: owner.id, title: "revoked-title", visibility: "team", defaultStartChapter: 1, defaultEndChapter: 3 });
    const turn = await repository.createTurn({ sessionId: session.id, actor: member, question: "revoked-question", questionHmac: QUESTION_HMAC, startChapter: 1, endChapter: 1, intentSnapshot: {}, sourceSnapshot: {}, gapSnapshot: {}, configSnapshot: {}, executionSignature: EXECUTION_SIGNATURE });
    await repository.commitEvidence({ turnId: turn.id, actor: member, evidence: [] });
    const hash = (await postgres.db.selectFrom("query_turns").select("evidence_snapshot_hash").where("id", "=", turn.id).executeTakeFirstOrThrow()).evidence_snapshot_hash!;
    for (const operation of [
      () => repository.getTurn({ turnId: turn.id, actor: member }),
      () => repository.completeTurn({ turnId: turn.id, actor: member, answer: "must-not-write", status: "completed", evidenceSnapshotHash: hash, sourceSnapshot: {}, gapSnapshot: {}, degradation: null }),
    ]) {
      await repository.updateSession({ sessionId: session.id, actor: owner, visibility: "team" });
      const locked = deferred(); const release = deferred();
      const revoke = postgres.db.transaction().execute(async (transaction) => {
        await sql`select id from query_sessions where id = ${session.id} for update`.execute(transaction);
        locked.resolve(); await release.promise;
        await transaction.updateTable("query_sessions").set({ visibility: "private" }).where("id", "=", session.id).execute();
      });
      await locked.promise;
      const protectedOperation = operation();
      release.resolve(); await revoke;
      await expect(protectedOperation).rejects.toThrow("Query access denied");
    }
    expect((await postgres.db.selectFrom("query_turns").select(["answer_ciphertext", "completed_at"]).where("id", "=", turn.id).executeTakeFirstOrThrow())).toMatchObject({ answer_ciphertext: null, completed_at: null });
  });

  test("does not create a turn after archival wins the session lock", async () => {
    const repository = createQueryRepository(postgres.db, cipher);
    const session = await repository.createSession({ bookId, groupId, createdBy: owner.id, title: "archive-race", visibility: "team", defaultStartChapter: 1, defaultEndChapter: 3 });
    const locked = deferred(); const release = deferred();
    const archive = postgres.db.transaction().execute(async (transaction) => {
      await sql`select id from query_sessions where id = ${session.id} for update`.execute(transaction);
      locked.resolve(); await release.promise;
      await transaction.updateTable("query_sessions").set({ archived_at: new Date() }).where("id", "=", session.id).execute();
    });
    await locked.promise;
    const create = repository.createTurn({ sessionId: session.id, actor: member, question: "too-late", questionHmac: QUESTION_HMAC, startChapter: 1, endChapter: 1, intentSnapshot: {}, sourceSnapshot: {}, gapSnapshot: {}, configSnapshot: {}, executionSignature: EXECUTION_SIGNATURE });
    release.resolve(); await archive;
    await expect(create).rejects.toThrow("Query access denied");
    expect(await postgres.db.selectFrom("query_turns").select("id").where("session_id", "=", session.id).execute()).toEqual([]);
  });

  test("allows only one terminal completion and rejects stale replay", async () => {
    const repository = createQueryRepository(postgres.db, cipher);
    const jobs = await postgres.db.insertInto("jobs").values([
      { type: "query", status: "running", requested_by: owner.id, request_id: `terminal-a-${crypto.randomUUID()}`, scope: {}, config_snapshot: {}, progress: {} },
      { type: "query", status: "running", requested_by: owner.id, request_id: `terminal-b-${crypto.randomUUID()}`, scope: {}, config_snapshot: {}, progress: {} },
    ]).returning("id").execute();
    const steps = await postgres.db.insertInto("job_steps").values(jobs.map((job, index) => ({ job_id: job.id, position: 0, kind: "query", status: "running" as const, input_signature: `${index}`, idempotency_key: `terminal-${crypto.randomUUID()}` }))).returning("id").execute();
    const attempts = await postgres.db.insertInto("job_attempts").values(steps.map((step, index) => ({ step_id: step.id, attempt_no: 1, worker_id: `worker-${index}`, status: "running" as const, started_at: new Date() }))).returning("id").execute();
    const session = await repository.createSession({ bookId, groupId, createdBy: owner.id, title: "terminal", defaultStartChapter: 1, defaultEndChapter: 3 });
    const turn = await repository.createTurn({ sessionId: session.id, actor: owner, question: "terminal", questionHmac: QUESTION_HMAC, startChapter: 1, endChapter: 1, intentSnapshot: {}, sourceSnapshot: {}, gapSnapshot: {}, configSnapshot: {}, executionSignature: EXECUTION_SIGNATURE, jobId: jobs[0]!.id, attemptId: attempts[0]!.id });
    await repository.commitEvidence({ turnId: turn.id, actor: owner, evidence: [] });
    const hash = (await postgres.db.selectFrom("query_turns").select("evidence_snapshot_hash").where("id", "=", turn.id).executeTakeFirstOrThrow()).evidence_snapshot_hash!;
    const complete = (answer: string, index = 0) => repository.completeTurn({ turnId: turn.id, actor: owner, answer, status: "completed" as const, evidenceSnapshotHash: hash, sourceSnapshot: {}, gapSnapshot: {}, degradation: null, jobId: jobs[index]!.id, attemptId: attempts[index]!.id });
    await expect(complete("wrong-attempt", 1)).rejects.toThrow("Query attempt mismatch");
    const results = await Promise.allSettled([complete("terminal-answer-one"), complete("terminal-answer-two", 1)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(["Query attempt mismatch", "Query turn already terminal"]).toContain((results.find((result) => result.status === "rejected") as PromiseRejectedResult).reason.message);
    await expect(complete("stale-replay-answer")).rejects.toThrow("Query turn already terminal");
    const raw = await postgres.db.selectFrom("query_turns").selectAll().where("id", "=", turn.id).executeTakeFirstOrThrow();
    expect(raw.completed_at).toBeInstanceOf(Date);
    expect(cipher.decrypt({ ciphertext: raw.answer_ciphertext!, nonce: raw.answer_nonce!, tag: raw.answer_tag!, keyVersion: raw.answer_key_version! })).toBe((results.find((result) => result.status === "fulfilled") as PromiseFulfilledResult<{ answer: string | null }>).value.answer);
  });

  test("rejects new turns after archival", async () => {
    const repository = createQueryRepository(postgres.db, cipher);
    const session = await repository.createSession({ bookId, groupId, createdBy: owner.id, title: "archive", defaultStartChapter: 1, defaultEndChapter: 3 });
    await repository.archiveSession({ sessionId: session.id, actor: owner });
    await expect(repository.createTurn({ sessionId: session.id, actor: owner, question: "late", questionHmac: QUESTION_HMAC, startChapter: 1, endChapter: 1, intentSnapshot: {}, sourceSnapshot: {}, gapSnapshot: {}, configSnapshot: {}, executionSignature: EXECUTION_SIGNATURE })).rejects.toThrow("Query access denied");
  });
});
