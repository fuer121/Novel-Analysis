import { createHash } from "node:crypto";

import { createContentCipher, createIndexRepository, createLibraryRepository, type DatabaseConnection } from "@novel-analysis/database";
import type { ChapterImportInput, DifyAdapter, L1IndexInput, L2IndexInput } from "@novel-analysis/dify";
import { ImportJobService, L1JobService, L1_ROUTE_SCHEMA_VERSION, L2JobService, PostgresStepLeaseService } from "@novel-analysis/jobs";
import { LibraryImportExecutor } from "../../../apps/worker/src/library-executor.js";

export interface VerticalWorkflowEvidence {
  completed: boolean;
  chapterCount: number;
  l1Fresh: number;
  l2Fresh: number;
  factCount: number;
  leakageSafe: boolean;
  userId: string;
  bookId: string;
  l2JobId: string;
  groupId: string;
}

export interface LeaseRecoveryEvidence {
  chapterCount: number;
  attemptStatuses: string[];
  lateDisposition: string;
}

class Phase2DifyFake implements DifyAdapter {
  async runChapterImport(input: ChapterImportInput) {
    return { chapters: [{ book_id: String(input.bookId), chapter_index: input.startChapter, chapter_title: `Chapter ${input.startChapter}`, content: `encrypted chapter ${input.startChapter}`, fetch_status: "ok" as const }] };
  }

  async runL1Index(input: L1IndexInput) {
    return { route_schema_version: L1_ROUTE_SCHEMA_VERSION, route_entities: [{ name: `entity-${input.chapterIndex}`, type: "character", aliases: [], role: "subject", note: "phase2 test" }], route_keywords: [`keyword-${input.chapterIndex}`], signals: [], category_scores: {} };
  }

  async runL2Index(input: L2IndexInput) {
    return { chapter_index: input.chapterIndex, chapter_title: input.chapterTitle, facts: [{ category: "event" as const, entity: `entity-${input.chapterIndex}`, aliases: [], tags: [], related_entities: [], fact_type: "event", fact: `encrypted fact ${input.chapterIndex}`, evidence: [`chapter ${input.chapterIndex}`], importance: 0.8, confidence: 0.9, scope_eligible: true, scope_basis: "explicit_event", transformation_eligible: false, scope_fields_complete: true, creature_type: "", original_form: "", qualification_evidence: [], subject_key: `entity-${input.chapterIndex}`, identity_basis: "explicit" }] };
  }
}

export function createPhase2LibraryExecutor(database: DatabaseConnection): LibraryImportExecutor {
  return new LibraryImportExecutor({ database, adapter: new Phase2DifyFake(), cipher: createContentCipher({ activeKeyVersion: "phase2-test", keys: { "phase2-test": Buffer.alloc(32, 8) } }), hmacKey: Buffer.from("phase2-hmac") });
}

async function executeJob(database: DatabaseConnection, jobId: string, executor: LibraryImportExecutor): Promise<void> {
  const leases = new PostgresStepLeaseService({ database, leaseDurationMs: 60_000 });
  while (true) {
    const claim = await leases.claimNext(jobId, "phase2-test-worker", new Date());
    if (!claim) return;
    const result = await executor.execute(claim);
    if (result.disposition !== "completed") throw new Error(`Unexpected ${claim.kind} disposition: ${result.disposition}`);
  }
}

export async function runVerticalWorkflow(database: DatabaseConnection): Promise<VerticalWorkflowEvidence> {
  const user = await database.insertInto("users").values({ display_name: "Phase 2 member", avatar_url: null, role: "member", status: "active" }).returning("id").executeTakeFirstOrThrow();
  const cipher = createContentCipher({ activeKeyVersion: "phase2-test", keys: { "phase2-test": Buffer.alloc(32, 8) } });
  const library = createLibraryRepository(database, cipher);
  const indexes = createIndexRepository(database, cipher);
  const book = await library.createBook({ title: "Three Chapters", createdBy: user.id });
  await library.upsertSource({ bookId: book.id, provider: "dify", sourceId: "42", startChapter: 1, endChapter: 3 });

  const l1Prompt = "phase2 l1 prompt";
  await indexes.createPromptVersion({ target: "l1-index", version: "phase2-l1", content: l1Prompt, contentHash: createHash("sha256").update(l1Prompt).digest("hex") });
  await indexes.createWorkflowVersion({ target: "l1-index", contractVersion: "phase2-l1", dslHash: "phase2-l1-dsl" });
  const l2Prompt = "phase2 l2 prompt";
  const l2PromptVersion = await indexes.createPromptVersion({ target: "l2-index", version: "phase2-l2", content: l2Prompt, contentHash: createHash("sha256").update(l2Prompt).digest("hex") });
  await indexes.createWorkflowVersion({ target: "l2-index", contractVersion: "phase2-l2", dslHash: "phase2-l2-dsl" });

  const executor = createPhase2LibraryExecutor(database);
  const imports = new ImportJobService(database);
  const importPreview = await imports.preview({ bookId: book.id });
  const importJob = await imports.create({ bookId: book.id, requestedBy: user.id, requestId: "phase2-import", scopeHash: importPreview.scopeHash, autoStartL1: true });
  await executeJob(database, importJob.id, executor);

  const l1Job = await database.selectFrom("jobs").select("id").where("type", "=", "l1-index").executeTakeFirstOrThrow();
  await executeJob(database, l1Job.id, executor);

  const group = await indexes.createIndexGroup({ bookId: book.id, key: "events", name: "Events", categoryScope: "general", promptVersionId: l2PromptVersion.id, configHash: "phase2-events" });
  const l2 = new L2JobService(database);
  const l2Scope = { bookId: book.id, groupId: group.id, startChapter: 1, endChapter: 3, mode: "missing" as const, force: false };
  const l2Preview = await l2.preview(l2Scope);
  const l2Job = await l2.create({ ...l2Scope, requestedBy: user.id, requestId: "phase2-l2", scopeHash: l2Preview.scopeHash });
  await executeJob(database, l2Job.id, executor);

  const [chapters, l1Fresh, l2Fresh, facts] = await Promise.all([
    database.selectFrom("chapters").select("id").where("book_id", "=", book.id).execute(),
    database.selectFrom("l1_indexes").select("id").where("status", "=", "fresh").where("is_current", "=", true).execute(),
    database.selectFrom("l2_chapter_statuses").select("chapter_id").where("group_id", "=", group.id).where("status", "=", "fresh").execute(),
    database.selectFrom("l2_facts").select("id").where("group_id", "=", group.id).execute(),
  ]);
  const plaintextEffects = JSON.stringify({
    jobs: await database.selectFrom("jobs").select(["scope", "config_snapshot", "progress"]).execute(),
    steps: await database.selectFrom("job_steps").select("output_ref").execute(),
    events: await database.selectFrom("job_events").select("payload").execute(),
    outbox: await database.selectFrom("job_outbox").select("payload").execute(),
    attempts: await database.selectFrom("job_attempts").select(["error_code", "error_message"]).execute(),
  });
  return { completed: true, chapterCount: chapters.length, l1Fresh: l1Fresh.length, l2Fresh: l2Fresh.length, factCount: facts.length, leakageSafe: !["encrypted chapter", "encrypted fact", "phase2-hmac"].some((secret) => plaintextEffects.includes(secret)), userId: user.id, bookId: book.id, l2JobId: l2Job.id, groupId: group.id };
}

export async function runLeaseRecovery(database: DatabaseConnection): Promise<LeaseRecoveryEvidence> {
  const user = await database.insertInto("users").values({ display_name: "Recovery member", avatar_url: null, role: "member", status: "active" }).returning("id").executeTakeFirstOrThrow();
  const cipher = createContentCipher({ activeKeyVersion: "phase2-recovery", keys: { "phase2-recovery": Buffer.alloc(32, 6) } });
  const library = createLibraryRepository(database, cipher);
  const book = await library.createBook({ title: "Recovery Book", createdBy: user.id });
  await library.upsertSource({ bookId: book.id, provider: "dify", sourceId: "7", startChapter: 1, endChapter: 1 });
  const imports = new ImportJobService(database);
  const preview = await imports.preview({ bookId: book.id });
  const job = await imports.create({ bookId: book.id, requestedBy: user.id, requestId: "recovery", scopeHash: preview.scopeHash, autoStartL1: false });
  const leases = new PostgresStepLeaseService({ database, leaseDurationMs: 60_000 });
  const first = await leases.claimNext(job.id, "worker-a", new Date());
  if (!first) throw new Error("Worker A claim missing");
  await database.updateTable("job_steps").set({ lease_expires_at: new Date(0) }).where("id", "=", first.stepId).execute();
  const second = await leases.claimNext(job.id, "worker-b", new Date());
  if (!second) throw new Error("Worker B recovery claim missing");
  const executor = new LibraryImportExecutor({ database, adapter: new Phase2DifyFake(), cipher, hmacKey: Buffer.from("recovery-hmac") });
  const completed = await executor.execute(second);
  if (completed.disposition !== "completed") throw new Error(`Recovery failed: ${completed.disposition}`);
  const late = await executor.execute(first);
  const attempts = await database.selectFrom("job_attempts").select("status").where("step_id", "=", first.stepId).orderBy("attempt_no").execute();
  const chapters = await database.selectFrom("chapters").select("id").where("book_id", "=", book.id).execute();
  return { chapterCount: chapters.length, attemptStatuses: attempts.map((attempt) => attempt.status), lateDisposition: late.disposition };
}
