import { performance } from "node:perf_hooks";
import { createHash } from "node:crypto";

import { sql } from "kysely";
import { afterEach, describe, expect, it } from "vitest";

import { createContentCipher, createIndexRepository, createLibraryRepository } from "@novel-analysis/database";
import { L2JobService } from "@novel-analysis/jobs";
import { createDisposablePostgres, type DisposablePostgres } from "../../packages/database/src/testing/postgres.js";
import { startPhase2TestApi } from "./helpers/test-api.js";

function p95(samples: number[]): number {
  return [...samples].sort((left, right) => left - right)[18]!;
}

describe("Phase 2 library indexing scale", () => {
  let postgres: DisposablePostgres | undefined;
  let stopApi: (() => Promise<void>) | undefined;

  afterEach(async () => { await stopApi?.(); await postgres?.destroy(); });

  it("keeps 3000 chapters and 70000 encrypted facts within accepted read thresholds", async () => {
    postgres = await createDisposablePostgres();
    const user = await postgres.db.insertInto("users").values({ display_name: "Scale member", avatar_url: null, role: "member", status: "active" }).returning("id").executeTakeFirstOrThrow();
    const cipher = createContentCipher({ activeKeyVersion: "scale", keys: { scale: Buffer.alloc(32, 9) } });
    const book = await createLibraryRepository(postgres.db, cipher).createBook({ title: "Scale Book", createdBy: user.id });
    const indexes = createIndexRepository(postgres.db, cipher);
    const promptContent = "scale prompt";
    const prompt = await indexes.createPromptVersion({ target: "l2-index", version: "scale", content: promptContent, contentHash: createHash("sha256").update(promptContent).digest("hex") });
    await indexes.createWorkflowVersion({ target: "l2-index", contractVersion: "scale", dslHash: "scale-dsl" });
    const group = await indexes.createIndexGroup({ bookId: book.id, key: "scale", name: "Scale", categoryScope: "general", promptVersionId: prompt.id, configHash: "scale-config" });
    await postgres.db.insertInto("l2_subjects").values({ group_id: group.id, subject_key: "scale-subject", display_name: "Scale Subject", aliases: {} }).execute();
    const encryptedChapter = cipher.encrypt("synthetic chapter");
    const encryptedFact = cipher.encrypt("synthetic fact");

    const setupStarted = performance.now();
    await sql`
      insert into chapters (book_id, chapter_index, title, content_hmac, content_ciphertext, content_nonce, content_tag, content_key_version, source_version)
      select ${book.id}, value, 'Chapter ' || value, 'hmac-' || value, ${encryptedChapter.ciphertext}, ${encryptedChapter.nonce}, ${encryptedChapter.tag}, ${encryptedChapter.keyVersion}, 'scale-source'
      from generate_series(1, 3000) value
    `.execute(postgres.db);
    await sql`
      insert into l2_chapter_statuses (group_id, chapter_id, book_id, input_signature, status, failure_code)
      select ${group.id}, id, ${book.id}, 'scale-signature-' || chapter_index, 'fresh', null
      from chapters where book_id = ${book.id}
    `.execute(postgres.db);
    await sql`
      with fact_rows as (
        select chapter.id as chapter_id, row_number() over (order by chapter.chapter_index, copy.value) as fact_no
        from chapters chapter cross join generate_series(1, 24) copy(value)
        where chapter.book_id = ${book.id}
      )
      insert into l2_facts (group_id, chapter_id, book_id, subject_key, fact_type, fact_ciphertext, fact_nonce, fact_tag, fact_key_version, metadata)
      select ${group.id}, chapter_id, ${book.id}, 'scale-subject', 'event', ${encryptedFact.ciphertext}, ${encryptedFact.nonce}, ${encryptedFact.tag}, ${encryptedFact.keyVersion}, jsonb_build_object('category', 'event', 'factNo', fact_no)
      from fact_rows where fact_no <= 70000
    `.execute(postgres.db);
    const job = await postgres.db.insertInto("jobs").values({ type: "l2-index", status: "completed", requested_by: user.id, request_id: "scale-job", scope: { bookId: book.id }, config_snapshot: {}, concurrency_key: null, progress: { total: 3000, completed: 3000, failed: 0, skipped: 0, current: "" } }).returning("id").executeTakeFirstOrThrow();
    await sql`
      insert into job_steps (job_id, position, kind, status, input_signature, idempotency_key, output_ref, lease_owner, lease_expires_at)
      select ${job.id}, value, 'l2-index', 'completed', 'scale-step-' || value, ${job.id}::text || ':scale:' || value, null, null, null
      from generate_series(1, 3000) value
    `.execute(postgres.db);
    expect(performance.now() - setupStarted).toBeLessThan(5000);
    const api = await startPhase2TestApi(postgres.db, user.id);
    stopApi = api.stop;

    const samples = { overview: [] as number[], coverage: [] as number[], facts: [] as number[], detail: [] as number[] };
    for (let iteration = 0; iteration < 20; iteration += 1) {
      let started = performance.now();
      const overview = await api.request(`/books/${book.id}`);
      expect(overview.status).toBe(200);
      await overview.json();
      samples.overview.push(performance.now() - started);
      started = performance.now();
      await new L2JobService(postgres.db).coverage({ bookId: book.id, groupId: group.id });
      samples.coverage.push(performance.now() - started);
      started = performance.now();
      await indexes.listFactReviews({ groupId: group.id, limit: 20 });
      samples.facts.push(performance.now() - started);
      started = performance.now();
      const detail = await api.request(`/jobs/${job.id}`);
      expect(detail.status).toBe(200);
      await detail.json();
      samples.detail.push(performance.now() - started);
    }

    expect(await postgres.db.selectFrom("chapters").select(({ fn }) => fn.countAll<string>().as("count")).executeTakeFirstOrThrow()).toEqual({ count: "3000" });
    expect(await postgres.db.selectFrom("l2_facts").select(({ fn }) => fn.countAll<string>().as("count")).executeTakeFirstOrThrow()).toEqual({ count: "70000" });
    for (const values of Object.values(samples)) expect(p95(values)).toBeLessThan(500);
  });
});
