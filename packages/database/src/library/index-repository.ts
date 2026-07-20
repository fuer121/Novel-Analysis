import { createHash } from "node:crypto";
import { sql } from "kysely";
import type { ContentCipher } from "./content-encryption.js";
import type { DatabaseExecutor, FactCategory, FactRetrievalMetadata } from "../db.js";

type Coverage = { total: number; fresh: number; missing: number; failed: number; stale: number };
const FACT_CATEGORIES = new Set<FactCategory>(["character", "relationship", "cultivation", "force", "event", "item", "magical_creature", "location", "foreshadowing", "other", "organization", "power", "mystery"]);
const METADATA_KEYS = new Set(["category", "importance", "confidence", "scopeEligible", "transformationEligible", "scopeFieldsComplete"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const coverage = (row: Record<string, string | number | bigint | null>): Coverage => ({ total: Number(row.total), fresh: Number(row.fresh), missing: Number(row.missing), failed: Number(row.failed), stale: Number(row.stale) });

function validateMetadata(value: FactRetrievalMetadata): void {
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !METADATA_KEYS.has(key))) throw new Error("Invalid fact retrieval metadata");
  if (record.category !== undefined && (typeof record.category !== "string" || !FACT_CATEGORIES.has(record.category as FactCategory))) throw new Error("Invalid fact retrieval metadata");
  for (const key of ["importance", "confidence"] as const) if (record[key] !== undefined && (typeof record[key] !== "number" || !Number.isFinite(record[key]) || record[key] < 0 || record[key] > 1)) throw new Error("Invalid fact retrieval metadata");
  for (const key of ["scopeEligible", "transformationEligible", "scopeFieldsComplete"] as const) if (record[key] !== undefined && typeof record[key] !== "boolean") throw new Error("Invalid fact retrieval metadata");
}

export function createIndexRepository(db: DatabaseExecutor, cipher: ContentCipher) {
  return {
    async createPromptVersion(input: { target: "l1-index" | "l2-index"; version: string; content: string; contentHash: string }) {
      if (!input.content.trim() || createHash("sha256").update(input.content).digest("hex") !== input.contentHash) throw new Error("Prompt content hash mismatch");
      return db.insertInto("prompt_versions").values({ target: input.target, version: input.version, content: input.content, content_hash: input.contentHash }).returningAll().executeTakeFirstOrThrow();
    },
    createWorkflowVersion(input: { target: "chapter-import" | "l1-index" | "l2-index"; contractVersion: string; dslHash: string }) { return db.insertInto("workflow_versions").values({ target: input.target, contract_version: input.contractVersion, dsl_hash: input.dslHash }).returningAll().executeTakeFirstOrThrow(); },
    createIndexGroup(input: { bookId: string; key: string; name: string; promptVersionId: string; configHash: string }) { return db.insertInto("index_groups").values({ book_id: input.bookId, key: input.key, name: input.name, prompt_version_id: input.promptVersionId, config_hash: input.configHash }).returningAll().executeTakeFirstOrThrow(); },
    async putL1Index(input: { chapterId: string; promptVersionId: string; workflowVersionId: string; inputSignature: string; status: "fresh" | "failed" | "stale"; route: Record<string, unknown> }) {
      const replace = async (executor: DatabaseExecutor) => {
        await sql`select id from chapters where id = ${input.chapterId} for update`.execute(executor);
        await executor.updateTable("l1_indexes").set({ is_current: false, status: "stale" }).where("chapter_id", "=", input.chapterId).where("is_current", "=", true).execute();
        return executor.insertInto("l1_indexes").values({ chapter_id: input.chapterId, prompt_version_id: input.promptVersionId, workflow_version_id: input.workflowVersionId, input_signature: input.inputSignature, status: input.status, is_current: true, route: input.route }).returning("id").executeTakeFirstOrThrow();
      };
      if (db.isTransaction) return replace(db);
      return db.transaction().execute(replace);
    },
    async getL1Coverage(bookId: string) { const result = await sql<Record<string, number>>`select count(*)::int total, count(*) filter (where l.status = 'fresh')::int fresh, count(*) filter (where l.id is null)::int missing, count(*) filter (where l.status = 'failed')::int failed, count(*) filter (where l.status = 'stale')::int stale from chapters c left join l1_indexes l on l.chapter_id = c.id and l.is_current where c.book_id = ${bookId}`.execute(db); return coverage(result.rows[0]!); },
    async putL2ChapterStatus(input: { groupId: string; chapterId: string; inputSignature: string; status: "fresh" | "failed" | "stale"; failureCode?: string }) {
      const result = await sql`insert into l2_chapter_statuses (group_id, chapter_id, book_id, input_signature, status, failure_code)
        select g.id, c.id, g.book_id, ${input.inputSignature}, ${input.status}, ${input.failureCode ?? null}
        from index_groups g join chapters c on c.book_id = g.book_id
        where g.id = ${input.groupId} and c.id = ${input.chapterId}
        on conflict (group_id, chapter_id) do update set input_signature = excluded.input_signature, status = excluded.status, failure_code = excluded.failure_code, updated_at = now()`.execute(db);
      if (result.numAffectedRows === 0n) throw new Error("Index group and chapter must belong to the same book");
    },
    async getL2Coverage(groupId: string) { const result = await sql<Record<string, number>>`select count(*)::int total, count(*) filter (where s.status = 'fresh')::int fresh, count(*) filter (where s.id is null)::int missing, count(*) filter (where s.status = 'failed')::int failed, count(*) filter (where s.status = 'stale')::int stale from index_groups g join chapters c on c.book_id = g.book_id left join l2_chapter_statuses s on s.group_id = g.id and s.chapter_id = c.id where g.id = ${groupId}`.execute(db); return coverage(result.rows[0]!); },
    registerSubject(input: { groupId: string; subjectKey: string; displayName: string; aliases: string[] }) {
      return sql`insert into l2_subjects (group_id, subject_key, display_name, aliases) values (${input.groupId}, ${input.subjectKey}, ${input.displayName}, ${JSON.stringify(input.aliases)}::jsonb)
        on conflict (group_id, subject_key) do update set display_name = excluded.display_name, aliases = excluded.aliases`.execute(db);
    },
    async listVerifiedSubjects(groupId: string) {
      const result = await sql<{ subject_key: string; display_name: string; aliases: unknown }>`select distinct s.subject_key, s.display_name, s.aliases
        from l2_subjects s join l2_facts f on f.group_id = s.group_id and f.subject_key = s.subject_key
        where s.group_id = ${groupId} and (f.metadata ->> 'scopeEligible')::boolean is true
        order by s.subject_key`.execute(db);
      return result.rows.map((row) => ({ subjectKey: row.subject_key, displayName: row.display_name, aliases: Array.isArray(row.aliases) ? row.aliases.map(String) : [] }));
    },
    async replaceL2ChapterResult(input: {
      groupId: string;
      chapterId: string;
      inputSignature: string;
      acceptedCount: number;
      candidateCount: number;
      rejectedCount: number;
      facts: Array<{ subjectKey: string; displayName: string; aliases: string[]; factType: string; plaintext: string; metadata: FactRetrievalMetadata }>;
    }) {
      if (!db.isTransaction) throw new Error("L2 chapter replacement requires a caller transaction");
      for (const fact of input.facts) {
        if (!fact.subjectKey.trim() || !fact.displayName.trim() || !fact.factType.trim() || !fact.plaintext.trim()) throw new Error("Invalid L2 chapter result");
        validateMetadata(fact.metadata);
      }
      if ([input.acceptedCount, input.candidateCount, input.rejectedCount].some((count) => !Number.isSafeInteger(count) || count < 0)
        || input.acceptedCount + input.candidateCount !== input.facts.length) throw new Error("Invalid L2 admission counts");
      const encrypted = input.facts.map((fact) => ({ ...fact, encrypted: cipher.encrypt(fact.plaintext) }));
      const locked = await sql<{ book_id: string }>`select c.book_id from chapters c join index_groups g on g.book_id = c.book_id
        where c.id = ${input.chapterId} and g.id = ${input.groupId} for update of c, g`.execute(db);
      const bookId = locked.rows[0]?.book_id;
      if (!bookId) throw new Error("Index group and chapter must belong to the same book");
      for (const fact of encrypted) {
        await sql`insert into l2_subjects (group_id, subject_key, display_name, aliases) values (${input.groupId}, ${fact.subjectKey}, ${fact.displayName}, ${JSON.stringify(fact.aliases)}::jsonb)
          on conflict (group_id, subject_key) do update set display_name = excluded.display_name, aliases = excluded.aliases`.execute(db);
      }
      await db.deleteFrom("l2_facts").where("group_id", "=", input.groupId).where("chapter_id", "=", input.chapterId).execute();
      for (const fact of encrypted) {
        await db.insertInto("l2_facts").values({
          group_id: input.groupId, chapter_id: input.chapterId, book_id: bookId, subject_key: fact.subjectKey, fact_type: fact.factType,
          fact_ciphertext: fact.encrypted.ciphertext, fact_nonce: fact.encrypted.nonce, fact_tag: fact.encrypted.tag,
          fact_key_version: fact.encrypted.keyVersion, metadata: fact.metadata,
        }).execute();
      }
      await sql`insert into l2_chapter_statuses (group_id, chapter_id, book_id, input_signature, status, failure_code)
        values (${input.groupId}, ${input.chapterId}, ${bookId}, ${input.inputSignature}, 'fresh', null)
        on conflict (group_id, chapter_id) do update set input_signature = excluded.input_signature, status = 'fresh', failure_code = null, updated_at = now()`.execute(db);
      return { acceptedCount: input.acceptedCount, candidateCount: input.candidateCount, rejectedCount: input.rejectedCount, factCount: input.facts.length };
    },
    async addFact(input: { groupId: string; chapterId: string; subjectKey: string; factType: string; plaintext: string; metadata: FactRetrievalMetadata }) {
      validateMetadata(input.metadata);
      const encrypted = cipher.encrypt(input.plaintext);
      const result = await sql<{ id: string }>`insert into l2_facts (group_id, chapter_id, book_id, subject_key, fact_type, fact_ciphertext, fact_nonce, fact_tag, fact_key_version, metadata)
        select g.id, c.id, g.book_id, ${input.subjectKey}, ${input.factType}, ${encrypted.ciphertext}, ${encrypted.nonce}, ${encrypted.tag}, ${encrypted.keyVersion}, ${JSON.stringify(input.metadata)}::jsonb
        from index_groups g join chapters c on c.book_id = g.book_id
        where g.id = ${input.groupId} and c.id = ${input.chapterId}
        returning id`.execute(db);
      if (!result.rows[0]) throw new Error("Index group and chapter must belong to the same book");
      return result.rows[0];
    },
    async listFactReviews(input: { groupId: string; limit: number; cursor?: string }) {
      if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) throw new Error("Fact review limit must be an integer from 1 to 100");
      if (input.cursor && !UUID_PATTERN.test(input.cursor)) throw new Error("Invalid fact review cursor");
      if (input.cursor) {
        const cursorExists = await db.selectFrom("l2_facts").select("id").where("group_id", "=", input.groupId).where("id", "=", input.cursor).executeTakeFirst();
        if (!cursorExists) return { facts: [], nextCursor: null };
      }
      let query = db.selectFrom("l2_facts as f").innerJoin("chapters as c", "c.id", "f.chapter_id").select(["f.id", "f.chapter_id", "c.chapter_index", "f.subject_key", "f.fact_type", "f.fact_ciphertext", "f.fact_nonce", "f.fact_tag", "f.fact_key_version", "f.metadata", "f.created_at"]).where("f.group_id", "=", input.groupId).orderBy("f.id").limit(input.limit + 1);
      if (input.cursor) query = query.where("f.id", ">", input.cursor);
      const rows = await query.execute(); const page = rows.slice(0, input.limit); const hasMore = rows.length > input.limit;
      return { facts: page.map(row => ({ id: row.id, chapterId: row.chapter_id, chapterIndex: row.chapter_index, subjectKey: row.subject_key, factType: row.fact_type, body: cipher.decrypt({ ciphertext: row.fact_ciphertext, nonce: row.fact_nonce, tag: row.fact_tag, keyVersion: row.fact_key_version }), metadata: row.metadata, createdAt: row.created_at })), nextCursor: hasMore ? page.at(-1)!.id : null };
    },
  };
}
