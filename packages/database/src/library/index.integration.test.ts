import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { sql } from "kysely";

import { createContentCipher } from "./content-encryption.js";
import { createIndexRepository } from "./index-repository.js";
import { createLibraryRepository } from "./library-repository.js";
import { createDisposablePostgres, type DisposablePostgres } from "../testing/postgres.js";

describe("index persistence", () => {
  let postgres: DisposablePostgres;
  beforeAll(async () => { postgres = await createDisposablePostgres(); });
  afterAll(async () => { await postgres?.destroy(); });

  test("enforces uniqueness and reports L1/L2 coverage with fact pagination", async () => {
    const cipher = createContentCipher({ activeKeyVersion: "v1", keys: { v1: randomBytes(32) } });
    const library = createLibraryRepository(postgres.db, cipher);
    const indexes = createIndexRepository(postgres.db, cipher);
    const actor = await postgres.db.insertInto("users").values({ display_name: "Owner", role: "member", status: "active" }).returning("id").executeTakeFirstOrThrow();
    const book = await library.createBook({ title: "Novel", createdBy: actor.id });
    const chapter = await library.insertChapter({ bookId: book.id, chapterIndex: 1, title: "One", plaintext: "chapter-secret", contentHmac: "h1", sourceVersion: "v1" });
    await expect(library.insertChapter({ bookId: book.id, chapterIndex: 1, title: "Again", plaintext: "x", contentHmac: "h2", sourceVersion: "v2" })).rejects.toMatchObject({ constraint: "chapters_book_id_chapter_index_unique" });
    const prompt = await indexes.createPromptVersion({ target: "l1-index", version: "p1", content: "prompt one", contentHash: createHash("sha256").update("prompt one").digest("hex") });
    const workflow = await indexes.createWorkflowVersion({ target: "l1-index", contractVersion: "1", dslHash: "dh" });
    await indexes.putL1Index({ chapterId: chapter.id, promptVersionId: prompt.id, workflowVersionId: workflow.id, inputSignature: "sig", status: "fresh", route: { people: ["A"] } });
    expect(await indexes.getL1Coverage(book.id)).toEqual({ total: 1, fresh: 1, missing: 0, failed: 0, stale: 0 });
    const nextPrompt = await indexes.createPromptVersion({ target: "l1-index", version: "p1-next", content: "prompt two", contentHash: createHash("sha256").update("prompt two").digest("hex") });
    const nextWorkflow = await indexes.createWorkflowVersion({ target: "l1-index", contractVersion: "2", dslHash: "dh-next" });
    await indexes.putL1Index({ chapterId: chapter.id, promptVersionId: nextPrompt.id, workflowVersionId: nextWorkflow.id, inputSignature: "sig-next", status: "fresh", route: { people: ["B"] } });
    const versions = await sql<{ input_signature: string; route: unknown; prompt_version_id: string; workflow_version_id: string; status: string; is_current: boolean }>`select input_signature, route, prompt_version_id, workflow_version_id, status, is_current from l1_indexes where chapter_id = ${chapter.id} order by created_at, id`.execute(postgres.db);
    expect(versions.rows).toEqual([
      expect.objectContaining({ input_signature: "sig", route: { people: ["A"] }, prompt_version_id: prompt.id, workflow_version_id: workflow.id, status: "stale", is_current: false }),
      expect.objectContaining({ input_signature: "sig-next", route: { people: ["B"] }, prompt_version_id: nextPrompt.id, workflow_version_id: nextWorkflow.id, status: "fresh", is_current: true }),
    ]);
    expect(await indexes.getL1Coverage(book.id)).toEqual({ total: 1, fresh: 1, missing: 0, failed: 0, stale: 0 });
    await expect(indexes.putL1Index({ chapterId: chapter.id, promptVersionId: nextPrompt.id, workflowVersionId: crypto.randomUUID(), inputSignature: "invalid", status: "fresh", route: {} })).rejects.toMatchObject({ constraint: "l1_indexes_workflow_version_id_fk" });
    const currentAfterFailure = await sql<{ input_signature: string }>`select input_signature from l1_indexes where chapter_id = ${chapter.id} and is_current`.execute(postgres.db);
    expect(currentAfterFailure.rows).toEqual([{ input_signature: "sig-next" }]);
    await postgres.db.transaction().execute(async (transaction) => {
      await createIndexRepository(transaction, cipher).putL1Index({ chapterId: chapter.id, promptVersionId: nextPrompt.id, workflowVersionId: nextWorkflow.id, inputSignature: "sig-outer", status: "fresh", route: { people: ["C"] } });
    });
    const beforeOuterRollback = await sql<{ input_signature: string; status: string; is_current: boolean }>`select input_signature, status, is_current from l1_indexes where chapter_id = ${chapter.id} order by created_at, id`.execute(postgres.db);
    expect(beforeOuterRollback.rows.find((row) => row.is_current)?.input_signature).toBe("sig-outer");
    await expect(postgres.db.transaction().execute(async (transaction) => {
      await createIndexRepository(transaction, cipher).putL1Index({ chapterId: chapter.id, promptVersionId: nextPrompt.id, workflowVersionId: nextWorkflow.id, inputSignature: "sig-rolled-back", status: "fresh", route: { people: ["D"] } });
      throw new Error("rollback outer transaction");
    })).rejects.toThrow("rollback outer transaction");
    const afterOuterRollback = await sql<{ input_signature: string; status: string; is_current: boolean }>`select input_signature, status, is_current from l1_indexes where chapter_id = ${chapter.id} order by created_at, id`.execute(postgres.db);
    expect(afterOuterRollback.rows).toEqual(beforeOuterRollback.rows);
    await Promise.all([
      indexes.putL1Index({ chapterId: chapter.id, promptVersionId: nextPrompt.id, workflowVersionId: nextWorkflow.id, inputSignature: "sig-concurrent-a", status: "fresh", route: { people: ["E"] } }),
      indexes.putL1Index({ chapterId: chapter.id, promptVersionId: nextPrompt.id, workflowVersionId: nextWorkflow.id, inputSignature: "sig-concurrent-b", status: "fresh", route: { people: ["F"] } }),
    ]);
    const afterConcurrent = await sql<{ input_signature: string; is_current: boolean }>`select input_signature, is_current from l1_indexes where chapter_id = ${chapter.id}`.execute(postgres.db);
    expect(afterConcurrent.rows.filter((row) => row.is_current)).toHaveLength(1);
    expect(afterConcurrent.rows.map((row) => row.input_signature)).toEqual(expect.arrayContaining(["sig-concurrent-a", "sig-concurrent-b"]));

    const l2Prompt = await indexes.createPromptVersion({ target: "l2-index", version: "p2", content: "l2 prompt", contentHash: createHash("sha256").update("l2 prompt").digest("hex") });
    const group = await indexes.createIndexGroup({ bookId: book.id, key: "people", name: "People", promptVersionId: l2Prompt.id, configHash: "cfg" });
    await indexes.putL2ChapterStatus({ groupId: group.id, chapterId: chapter.id, inputSignature: "l2sig", status: "fresh" });
    await indexes.registerSubject({ groupId: group.id, subjectKey: "alice", displayName: "Alice", aliases: [] });
    await indexes.registerSubject({ groupId: group.id, subjectKey: "bob", displayName: "Bob", aliases: [] });
    const factSentinel = "fact-secret";
    await indexes.addFact({ groupId: group.id, chapterId: chapter.id, subjectKey: "alice", factType: "appearance", plaintext: factSentinel, metadata: { confidence: 1 } });
    await indexes.addFact({ groupId: group.id, chapterId: chapter.id, subjectKey: "bob", factType: "action", plaintext: "second-secret", metadata: {} });
    expect(await indexes.getL2Coverage(group.id)).toEqual({ total: 1, fresh: 1, missing: 0, failed: 0, stale: 0 });
    const first = await indexes.listFactReviews({ groupId: group.id, limit: 1 });
    expect(first.facts).toHaveLength(1); expect(first.nextCursor).toBeTruthy();
    const second = await indexes.listFactReviews({ groupId: group.id, limit: 1, cursor: first.nextCursor! });
    expect(second.facts).toHaveLength(1); expect(second.facts[0]?.body).not.toBe(first.facts[0]?.body); expect(second.nextCursor).toBeNull();
    expect((await indexes.listFactReviews({ groupId: group.id, limit: 100 })).facts).toHaveLength(2);
    for (const limit of [0, -1, 1.5, 101]) await expect(indexes.listFactReviews({ groupId: group.id, limit })).rejects.toThrow("Fact review limit must be an integer from 1 to 100");
    await expect(indexes.listFactReviews({ groupId: group.id, limit: 1, cursor: "bad" })).rejects.toThrow("Invalid fact review cursor");
    expect(await indexes.listFactReviews({ groupId: group.id, limit: 1, cursor: crypto.randomUUID() })).toEqual({ facts: [], nextCursor: null });
    expect(await indexes.listFactReviews({ groupId: crypto.randomUUID(), limit: 1 })).toEqual({ facts: [], nextCursor: null });
    const sentinel = "metadata-plaintext-sentinel";
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await expect(indexes.addFact({ groupId: group.id, chapterId: chapter.id, subjectKey: "alice", factType: "bad", plaintext: "body", metadata: { evidence: sentinel } as never })).rejects.toThrow("Invalid fact retrieval metadata");
    const beforeBadMetadata = await sql<{ count: number }>`select count(*)::int count from l2_facts where group_id = ${group.id}`.execute(postgres.db);
    expect(beforeBadMetadata.rows[0]?.count).toBe(2);
    const rawFacts = await sql<Record<string, unknown>>`select * from l2_facts where group_id = ${group.id}`.execute(postgres.db);
    expect(JSON.stringify(rawFacts.rows)).not.toContain(factSentinel);
    expect(JSON.stringify(rawFacts.rows)).not.toContain(sentinel);
    expect(JSON.stringify(log.mock.calls)).not.toContain(sentinel);
    log.mockRestore();
    await sql`update l2_facts set fact_tag = 'tampered-tag-123'::bytea where id = ${rawFacts.rows[0]!.id as string}`.execute(postgres.db);
    await expect(indexes.listFactReviews({ groupId: group.id, limit: 100 })).rejects.toThrow();
  });

  test("stores immutable Prompt content with a matching hash and keeps legacy empty rows compatible", async () => {
    const indexes = createIndexRepository(postgres.db, createContentCipher({ activeKeyVersion: "v1", keys: { v1: randomBytes(32) } }));
    const content = "immutable prompt content";
    const contentHash = createHash("sha256").update(content).digest("hex");
    const prompt = await indexes.createPromptVersion({ target: "l1-index", version: "content-v1", content, contentHash });
    expect(prompt).toMatchObject({ content, content_hash: contentHash });
    await expect(indexes.createPromptVersion({ target: "l1-index", version: "bad-hash", content, contentHash: "wrong" })).rejects.toThrow("Prompt content hash mismatch");
    await expect(indexes.createPromptVersion({ target: "l1-index", version: "blank", content: "   ", contentHash: createHash("sha256").update("   ").digest("hex") })).rejects.toThrow("Prompt content hash mismatch");
    await postgres.db.insertInto("prompt_versions").values({ target: "l1-index", version: "legacy-empty", content: "", content_hash: "legacy" }).execute();
    expect((await postgres.db.selectFrom("prompt_versions").select("content").where("version", "=", "legacy-empty").executeTakeFirstOrThrow()).content).toBe("");
  });

  test("atomically replaces one group chapter and derives verified subjects only from admitted facts", async () => {
    const cipher = createContentCipher({ activeKeyVersion: "v1", keys: { v1: randomBytes(32) } });
    const actor = await postgres.db.insertInto("users").values({ display_name: "L2", role: "member", status: "active" }).returning("id").executeTakeFirstOrThrow();
    const book = await postgres.db.insertInto("books").values({ title: "L2", created_by: actor.id, status: "active" }).returning("id").executeTakeFirstOrThrow();
    const chapter = await createLibraryRepository(postgres.db, cipher).insertChapter({ bookId: book.id, chapterIndex: 1, title: "One", plaintext: "chapter", contentHmac: "h", sourceVersion: "v1" });
    const prompt = await postgres.db.insertInto("prompt_versions").values({ target: "l2-index", version: "replace", content_hash: "hash" }).returning("id").executeTakeFirstOrThrow();
    const [group, otherGroup] = await Promise.all([
      postgres.db.insertInto("index_groups").values({ book_id: book.id, key: "magical-creatures", name: "Magical", prompt_version_id: prompt.id, config_hash: "a" }).returning("id").executeTakeFirstOrThrow(),
      postgres.db.insertInto("index_groups").values({ book_id: book.id, key: "other", name: "Other", prompt_version_id: prompt.id, config_hash: "b" }).returning("id").executeTakeFirstOrThrow(),
    ]);
    const secret = "verified-secret";
    await postgres.db.transaction().execute(async (transaction) => {
      await createIndexRepository(transaction, cipher).replaceL2ChapterResult({
        groupId: group.id,
        chapterId: chapter.id,
        inputSignature: "sig-1",
        acceptedCount: 1,
        candidateCount: 1,
        rejectedCount: 2,
        facts: [
          { subjectKey: "white-deer", displayName: "白鹿", aliases: ["瑞兽"], factType: "classification", plaintext: secret, metadata: { category: "magical_creature", scopeEligible: true } },
          { subjectKey: "little-jiao", displayName: "小蛟", aliases: [], factType: "identity_clue", plaintext: "candidate-secret", metadata: { category: "other", scopeEligible: false } },
        ],
      });
    });
    expect(await createIndexRepository(postgres.db, cipher).listVerifiedSubjects(group.id)).toEqual([{ subjectKey: "white-deer", displayName: "白鹿", aliases: ["瑞兽"] }]);
    expect(await createIndexRepository(postgres.db, cipher).listVerifiedSubjects(otherGroup.id)).toEqual([]);
    const raw = await postgres.db.selectFrom("l2_facts").selectAll().where("group_id", "=", group.id).execute();
    expect(raw).toHaveLength(2);
    expect(JSON.stringify(raw)).not.toContain(secret);
    expect((await postgres.db.selectFrom("l2_chapter_statuses").selectAll().where("group_id", "=", group.id).executeTakeFirstOrThrow())).toMatchObject({ status: "fresh", input_signature: "sig-1" });

    await postgres.db.transaction().execute(async (transaction) => {
      await createIndexRepository(transaction, cipher).replaceL2ChapterResult({ groupId: group.id, chapterId: chapter.id, inputSignature: "sig-2", acceptedCount: 0, candidateCount: 0, rejectedCount: 1, facts: [] });
    });
    expect(await postgres.db.selectFrom("l2_facts").select("id").where("group_id", "=", group.id).where("chapter_id", "=", chapter.id).execute()).toEqual([]);
    expect((await postgres.db.selectFrom("l2_chapter_statuses").selectAll().where("group_id", "=", group.id).executeTakeFirstOrThrow())).toMatchObject({ status: "fresh", input_signature: "sig-2" });
    await expect(createIndexRepository(postgres.db, cipher).replaceL2ChapterResult({ groupId: group.id, chapterId: chapter.id, inputSignature: "bad", acceptedCount: 0, candidateCount: 0, rejectedCount: 0, facts: [] })).rejects.toThrow("transaction");
  });

  test("enforces foreign keys and status checks", async () => {
    await expect(postgres.db.insertInto("chapters").values({ book_id: crypto.randomUUID(), chapter_index: 1, title: "Missing", content_hmac: "h", content_ciphertext: Buffer.from("x"), content_nonce: Buffer.alloc(12), content_tag: Buffer.alloc(16), content_key_version: "v1", source_version: "v1" }).execute()).rejects.toMatchObject({ constraint: "chapters_book_id_fk" });
    const actor = await postgres.db.insertInto("users").values({ display_name: "Checks", role: "member", status: "active" }).returning("id").executeTakeFirstOrThrow();
    const book = await postgres.db.insertInto("books").values({ title: "Checks", created_by: actor.id, status: "active" }).returning("id").executeTakeFirstOrThrow();
    await expect(sql`insert into books (title, status, created_by) values ('Bad', 'pending', ${actor.id})`.execute(postgres.db)).rejects.toMatchObject({ constraint: "books_status_check" });
    await expect(sql`insert into book_sources (book_id, provider, source_id, start_chapter, end_chapter) values (${book.id}, 'dify', 's', 2, 1)`.execute(postgres.db)).rejects.toMatchObject({ constraint: "book_sources_range_check" });
  });

  test("rejects cross-book L2 rows and facts without a subject in the same group", async () => {
    const actor = await postgres.db.insertInto("users").values({ display_name: "Integrity", role: "member", status: "active" }).returning("id").executeTakeFirstOrThrow();
    const [bookA, bookB] = await Promise.all([
      postgres.db.insertInto("books").values({ title: "A", created_by: actor.id, status: "active" }).returning("id").executeTakeFirstOrThrow(),
      postgres.db.insertInto("books").values({ title: "B", created_by: actor.id, status: "active" }).returning("id").executeTakeFirstOrThrow(),
    ]);
    const chapterB = await postgres.db.insertInto("chapters").values({ book_id: bookB.id, chapter_index: 1, title: "B1", content_hmac: "h", content_ciphertext: Buffer.from("x"), content_nonce: Buffer.alloc(12), content_tag: Buffer.alloc(16), content_key_version: "v1", source_version: "v1" }).returning("id").executeTakeFirstOrThrow();
    const prompt = await postgres.db.insertInto("prompt_versions").values({ target: "l2-index", version: "integrity", content_hash: "h" }).returning("id").executeTakeFirstOrThrow();
    const [groupA, groupB] = await Promise.all([
      postgres.db.insertInto("index_groups").values({ book_id: bookA.id, key: "a", name: "A", prompt_version_id: prompt.id, config_hash: "a" }).returning("id").executeTakeFirstOrThrow(),
      postgres.db.insertInto("index_groups").values({ book_id: bookB.id, key: "b", name: "B", prompt_version_id: prompt.id, config_hash: "b" }).returning("id").executeTakeFirstOrThrow(),
    ]);
    await expect(sql`insert into l2_chapter_statuses (group_id, chapter_id, book_id, input_signature, status) values (${groupA.id}, ${chapterB.id}, ${bookA.id}, 'x', 'fresh')`.execute(postgres.db)).rejects.toMatchObject({ constraint: "l2_chapter_statuses_chapter_book_fk" });
    await sql`insert into l2_subjects (group_id, subject_key, display_name) values (${groupB.id}, 'alice', 'Alice')`.execute(postgres.db);
    await expect(sql`insert into l2_facts (group_id, chapter_id, book_id, subject_key, fact_type, fact_ciphertext, fact_nonce, fact_tag, fact_key_version, metadata) values (${groupA.id}, ${chapterB.id}, ${bookA.id}, 'alice', 'type', 'x'::bytea, '123456789012'::bytea, '1234567890123456'::bytea, 'v1', '{}'::jsonb)`.execute(postgres.db)).rejects.toMatchObject({ constraint: "l2_facts_chapter_book_fk" });
    const chapterA = await postgres.db.insertInto("chapters").values({ book_id: bookA.id, chapter_index: 1, title: "A1", content_hmac: "h", content_ciphertext: Buffer.from("x"), content_nonce: Buffer.alloc(12), content_tag: Buffer.alloc(16), content_key_version: "v1", source_version: "v1" }).returning("id").executeTakeFirstOrThrow();
    await expect(sql`insert into l2_facts (group_id, chapter_id, book_id, subject_key, fact_type, fact_ciphertext, fact_nonce, fact_tag, fact_key_version, metadata) values (${groupA.id}, ${chapterA.id}, ${bookA.id}, 'alice', 'type', 'x'::bytea, '123456789012'::bytea, '1234567890123456'::bytea, 'v1', '{}'::jsonb)`.execute(postgres.db)).rejects.toMatchObject({ constraint: "l2_facts_group_subject_fk" });
  });
});
