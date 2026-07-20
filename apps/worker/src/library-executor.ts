import { createHash, createHmac } from "node:crypto";
import { sql, type Transaction } from "kysely";

import { ChapterImportOutputSchema, L1IndexOutputSchema, L2IndexOutputSchema } from "@novel-analysis/contracts";
import { createIndexRepository, createLibraryRepository, type ContentCipher, type Database, type DatabaseConnection } from "@novel-analysis/database";
import { DifyAdapterError, type DifyAdapter } from "@novel-analysis/dify";
import { admitL2FactsForIndexGroup } from "@novel-analysis/domain";
import { createImportL1Handoff, L2_ADMISSION_VERSION, L2_FACT_SCHEMA_VERSION, type ClaimedStep, type CompletionDisposition } from "@novel-analysis/jobs";

type JobConfig = {
  source: { sourceId: string; startChapter: number; endChapter: number };
  sourceVersion: string;
  autoStartL1: boolean;
};

type L1JobConfig = {
  prompt: { id: string; content: string; contentHash: string };
  workflow: { id: string };
  schemaVersion: string;
  chapters: Array<{ chapterId: string; chapterIndex: number; chapterTitle: string; sourceVersion: string; chapterHmac: string; inputSignature: string }>;
};

type L2JobConfig = {
  prompt: { id: string; content: string; contentHash: string };
  workflow: { id: string; dslHash: string; contractVersion: string; adapterContractVersion: string };
  schemaVersion: string;
  admissionVersion: string;
  indexGroup: { id: string; key: string; categoryScope: "general" | "magical_creature"; configHash: string };
  chapters: Array<{ chapterId: string; chapterIndex: number; chapterTitle: string; sourceVersion: string; chapterHmac: string; l1Signature: string; inputSignature: string }>;
};

function readConfig(value: Record<string, unknown>): JobConfig {
  const source = value.source;
  if (!source || typeof source !== "object" || Array.isArray(source)
    || typeof (source as Record<string, unknown>).sourceId !== "string"
    || typeof (source as Record<string, unknown>).startChapter !== "number"
    || typeof (source as Record<string, unknown>).endChapter !== "number"
    || typeof value.sourceVersion !== "string" || typeof value.autoStartL1 !== "boolean") {
    throw new Error("Invalid import job configuration");
  }
  return { source: source as JobConfig["source"], sourceVersion: value.sourceVersion, autoStartL1: value.autoStartL1 };
}

function readL1Config(value: Record<string, unknown>): L1JobConfig {
  const prompt = value.prompt as Record<string, unknown> | undefined;
  const workflow = value.workflow as Record<string, unknown> | undefined;
  const chapters = value.chapters;
  if (!prompt || !workflow || !Array.isArray(chapters)
    || typeof prompt.id !== "string" || typeof prompt.content !== "string" || !prompt.content.trim()
    || typeof prompt.contentHash !== "string" || createHash("sha256").update(prompt.content).digest("hex") !== prompt.contentHash
    || typeof workflow.id !== "string" || typeof value.schemaVersion !== "string") throw new Error("Invalid L1 job configuration");
  const parsed = chapters.map((chapter) => {
    if (!chapter || typeof chapter !== "object" || Array.isArray(chapter)) throw new Error("Invalid L1 job configuration");
    const row = chapter as Record<string, unknown>;
    if (typeof row.chapterId !== "string" || typeof row.chapterIndex !== "number" || typeof row.chapterTitle !== "string"
      || typeof row.sourceVersion !== "string" || typeof row.chapterHmac !== "string" || typeof row.inputSignature !== "string") throw new Error("Invalid L1 job configuration");
    return row as L1JobConfig["chapters"][number];
  });
  return { prompt: prompt as L1JobConfig["prompt"], workflow: workflow as L1JobConfig["workflow"], schemaVersion: value.schemaVersion, chapters: parsed };
}

function readL2Config(value: Record<string, unknown>): L2JobConfig {
  const prompt = value.prompt as Record<string, unknown> | undefined;
  const workflow = value.workflow as Record<string, unknown> | undefined;
  const indexGroup = value.indexGroup as Record<string, unknown> | undefined;
  if (!prompt || !workflow || !indexGroup || !Array.isArray(value.chapters)
    || typeof prompt.id !== "string" || typeof prompt.content !== "string" || !prompt.content.trim()
    || typeof prompt.contentHash !== "string" || createHash("sha256").update(prompt.content).digest("hex") !== prompt.contentHash
    || typeof workflow.id !== "string" || typeof workflow.dslHash !== "string" || typeof workflow.contractVersion !== "string"
    || workflow.adapterContractVersion !== workflow.contractVersion
    || value.schemaVersion !== L2_FACT_SCHEMA_VERSION || value.admissionVersion !== L2_ADMISSION_VERSION
    || typeof indexGroup.id !== "string" || typeof indexGroup.key !== "string" || !["general", "magical_creature"].includes(String(indexGroup.categoryScope)) || typeof indexGroup.configHash !== "string") throw new Error("Invalid L2 job configuration");
  const chapters = value.chapters.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("Invalid L2 job configuration");
    const chapter = item as Record<string, unknown>;
    for (const field of ["chapterId", "chapterTitle", "sourceVersion", "chapterHmac", "l1Signature", "inputSignature"] as const) if (typeof chapter[field] !== "string") throw new Error("Invalid L2 job configuration");
    if (typeof chapter.chapterIndex !== "number") throw new Error("Invalid L2 job configuration");
    return chapter as L2JobConfig["chapters"][number];
  });
  return { prompt: prompt as L2JobConfig["prompt"], workflow: workflow as L2JobConfig["workflow"], schemaVersion: value.schemaVersion, admissionVersion: value.admissionVersion, indexGroup: indexGroup as L2JobConfig["indexGroup"], chapters };
}

export class LibraryImportExecutor {
  constructor(private readonly options: {
    database: DatabaseConnection;
    adapter: DifyAdapter;
    cipher: ContentCipher;
    hmacKey: Buffer;
  }) {
    if (options.hmacKey.length === 0) throw new Error("Chapter HMAC key is required");
  }

  async execute(claim: ClaimedStep): Promise<{ disposition: CompletionDisposition | "failed" }> {
    try {
      return await this.executeClaim(claim);
    } catch (error) {
      const errorCode = error instanceof DifyAdapterError ? error.code : "provider_invalid_response";
      if (claim.kind === "l1-index") return this.failL1Claim(claim, errorCode);
      if (claim.kind === "l2-index") return this.failL2Claim(claim, errorCode);
      return failImportClaim(this.options.database, claim, errorCode);
    }
  }

  private async executeClaim(claim: ClaimedStep): Promise<{ disposition: CompletionDisposition }> {
    const context = await this.options.database.selectFrom("jobs")
      .innerJoin("job_steps", "job_steps.job_id", "jobs.id")
      .select(["jobs.type", "jobs.scope", "jobs.config_snapshot", "job_steps.position", "job_steps.input_signature"])
      .where("jobs.id", "=", claim.jobId).where("job_steps.id", "=", claim.stepId).executeTakeFirstOrThrow();
    if (context.type === "l1-index") return this.executeL1Claim(claim, context.scope, context.config_snapshot, context.position);
    if (context.type === "l2-index") return this.executeL2Claim(claim, context.scope, context.config_snapshot, context.position, context.input_signature);
    if (context.type !== "import") throw new Error("LibraryImportExecutor only accepts import jobs");
    const bookId = context.scope.bookId;
    if (typeof bookId !== "string") throw new Error("Invalid import job scope");
    const config = readConfig(context.config_snapshot);
    const sourceBookId = Number(config.source.sourceId);
    if (!Number.isSafeInteger(sourceBookId) || sourceBookId <= 0) throw new Error("Invalid import source configuration");
    const existing = await this.options.database.selectFrom("chapters").select(["id", "source_version"])
      .where("book_id", "=", bookId).where("chapter_index", "=", context.position).executeTakeFirst();
    if (existing?.source_version === config.sourceVersion) {
      return this.commit(claim, { chapterId: existing.id, chapterIndex: context.position }, true);
    }

    const raw = await this.options.adapter.runChapterImport({
      invocationKey: claim.stepId,
      bookId: sourceBookId,
      startChapter: context.position,
      endChapter: context.position,
    });
    const parsed = ChapterImportOutputSchema.safeParse(raw);
    const chapter = parsed.success && parsed.data.chapters.length === 1 ? parsed.data.chapters[0] : undefined;
    if (!chapter || chapter.chapter_index !== context.position || chapter.book_id !== config.source.sourceId) {
      throw new Error("Invalid chapter import output");
    }
    const contentHmac = createHmac("sha256", this.options.hmacKey).update(chapter.content).digest("hex");
    return this.options.database.transaction().execute(async (transaction) => {
      const disposition = await validateImportClaim(transaction, claim);
      if (disposition) return { disposition };
      const lockedBook = await transaction.selectFrom("books").select("id").where("id", "=", bookId).forUpdate().executeTakeFirst();
      if (!lockedBook) return { disposition: "terminal-noop" as const };
      const current = await transaction.selectFrom("chapters").select(["id", "source_version"]).where("book_id", "=", bookId).where("chapter_index", "=", context.position).forUpdate().executeTakeFirst();
      if (current?.source_version === config.sourceVersion) {
        return this.finish(transaction, claim, { chapterId: current.id, chapterIndex: context.position }, true, config.autoStartL1, bookId);
      }
      let chapterId: string;
      if (current) {
        const encrypted = this.options.cipher.encrypt(chapter.content);
        await transaction.updateTable("chapters").set({ title: chapter.chapter_title, content_hmac: contentHmac, content_ciphertext: encrypted.ciphertext, content_nonce: encrypted.nonce, content_tag: encrypted.tag, content_key_version: encrypted.keyVersion, source_version: config.sourceVersion, updated_at: new Date() }).where("id", "=", current.id).execute();
        await transaction.updateTable("l1_indexes").set({ status: "stale" }).where("chapter_id", "=", current.id).where("is_current", "=", true).execute();
        await transaction.updateTable("l2_chapter_statuses").set({ status: "stale", failure_code: null, updated_at: new Date() }).where("chapter_id", "=", current.id).execute();
        chapterId = current.id;
      } else {
        const inserted = await createLibraryRepository(transaction, this.options.cipher).insertChapter({ bookId, chapterIndex: chapter.chapter_index, title: chapter.chapter_title, plaintext: chapter.content, contentHmac, sourceVersion: config.sourceVersion });
        chapterId = inserted.id;
      }
      return this.finish(transaction, claim, { chapterId, chapterIndex: chapter.chapter_index }, false, config.autoStartL1, bookId);
    });
  }

  private async executeL2Claim(claim: ClaimedStep, scope: Record<string, unknown>, snapshot: Record<string, unknown>, position: number, stepSignature: string): Promise<{ disposition: CompletionDisposition }> {
    const bookId = scope.bookId;
    const groupIds = scope.indexGroupKeys;
    if (typeof bookId !== "string" || !Array.isArray(groupIds) || groupIds.length !== 1 || typeof groupIds[0] !== "string") throw new Error("Invalid L2 job scope");
    const config = readL2Config(snapshot);
    if (config.indexGroup.id !== groupIds[0]) throw new Error("Invalid L2 job configuration");
    const chapterConfig = config.chapters.find((chapter) => chapter.chapterIndex === position);
    if (!chapterConfig || chapterConfig.inputSignature !== stepSignature) throw new Error("Invalid L2 job configuration");
    const frozen = await this.loadL2FrozenState(bookId, config, chapterConfig);
    const status = await this.options.database.selectFrom("l2_chapter_statuses").select(["input_signature", "status"]).where("group_id", "=", config.indexGroup.id).where("chapter_id", "=", chapterConfig.chapterId).executeTakeFirst();
    if (status?.status === "fresh" && status.input_signature === chapterConfig.inputSignature) return this.commitL2Skip(claim, config, chapterConfig);
    const knownSubjects = await createIndexRepository(this.options.database, this.options.cipher).listVerifiedSubjects(config.indexGroup.id);
    const chapterContent = this.options.cipher.decrypt({ ciphertext: frozen.chapter.content_ciphertext, nonce: frozen.chapter.content_nonce, tag: frozen.chapter.content_tag, keyVersion: frozen.chapter.content_key_version });
    const l1Route = L1IndexOutputSchema.safeParse(frozen.l1.route);
    if (!l1Route.success) throw new Error("L2 frozen input changed");
    const raw = await this.options.adapter.runL2Index({ invocationKey: claim.stepId, bookId, indexGroupKey: config.indexGroup.key, chapterIndex: chapterConfig.chapterIndex, chapterTitle: chapterConfig.chapterTitle, chapterContent, l1Route: l1Route.data, indexPrompt: config.prompt.content, knownSubjects });
    const parsed = L2IndexOutputSchema.safeParse(raw);
    if (!parsed.success || parsed.data.chapter_index !== chapterConfig.chapterIndex || parsed.data.chapter_title !== chapterConfig.chapterTitle) throw new Error("Invalid L2 index output");
    const admission = admitL2FactsForIndexGroup(parsed.data.facts, { categoryScope: config.indexGroup.categoryScope }, knownSubjects);
    return this.options.database.transaction().execute(async (transaction) => {
      const disposition = await validateImportClaim(transaction, claim);
      if (disposition) return { disposition };
      await this.recheckL2FrozenState(transaction, bookId, config, chapterConfig);
      const current = await transaction.selectFrom("l2_chapter_statuses").select(["input_signature", "status"]).where("group_id", "=", config.indexGroup.id).where("chapter_id", "=", chapterConfig.chapterId).executeTakeFirst();
      if (current?.status === "fresh" && current.input_signature === chapterConfig.inputSignature) return this.finishL2(transaction, claim, config, chapterConfig, { acceptedCount: 0, candidateCount: 0, rejectedCount: 0, factCount: 0 }, true);
      const facts = [...admission.accepted, ...admission.candidates].map((fact) => ({
        subjectKey: fact.subject_key.trim() || fact.entity.trim(), displayName: fact.entity.trim(), aliases: fact.aliases,
        factType: fact.fact_type, plaintext: fact.fact, metadata: { category: fact.category, importance: fact.importance, confidence: fact.confidence, scopeEligible: fact.scope_eligible, transformationEligible: fact.transformation_eligible, scopeFieldsComplete: fact.scope_fields_complete },
      }));
      const counts = await createIndexRepository(transaction, this.options.cipher).replaceL2ChapterResult({ groupId: config.indexGroup.id, chapterId: chapterConfig.chapterId, inputSignature: chapterConfig.inputSignature, acceptedCount: admission.accepted.length, candidateCount: admission.candidates.length, rejectedCount: admission.rejectedCount, facts, verifiedSubjectKeys: admission.verifiedSubjects.map((subject) => subject.subjectKey) });
      return this.finishL2(transaction, claim, config, chapterConfig, counts, false);
    });
  }

  private async loadL2FrozenState(bookId: string, config: L2JobConfig, chapter: L2JobConfig["chapters"][number]) {
    const [storedChapter, l1, group, prompt, workflow] = await Promise.all([
      this.options.database.selectFrom("chapters").selectAll().where("id", "=", chapter.chapterId).where("book_id", "=", bookId).executeTakeFirst(),
      this.options.database.selectFrom("l1_indexes").select(["input_signature", "status", "route"]).where("chapter_id", "=", chapter.chapterId).where("is_current", "=", true).executeTakeFirst(),
      this.options.database.selectFrom("index_groups").select(["prompt_version_id", "config_hash", "key", "category_scope", "status"]).where("id", "=", config.indexGroup.id).where("book_id", "=", bookId).executeTakeFirst(),
      this.options.database.selectFrom("prompt_versions").select(["content", "content_hash", "target"]).where("id", "=", config.prompt.id).executeTakeFirst(),
      this.options.database.selectFrom("workflow_versions").select(["dsl_hash", "contract_version", "target"]).where("id", "=", config.workflow.id).executeTakeFirst(),
    ]);
    if (!storedChapter || storedChapter.chapter_index !== chapter.chapterIndex || storedChapter.title !== chapter.chapterTitle || storedChapter.source_version !== chapter.sourceVersion || storedChapter.content_hmac !== chapter.chapterHmac
      || !l1 || l1.status !== "fresh" || l1.input_signature !== chapter.l1Signature
      || !group || group.status !== "active" || group.prompt_version_id !== config.prompt.id || group.config_hash !== config.indexGroup.configHash || group.key !== config.indexGroup.key || group.category_scope !== config.indexGroup.categoryScope
      || !prompt || prompt.target !== "l2-index" || prompt.content !== config.prompt.content || prompt.content_hash !== config.prompt.contentHash
      || !workflow || workflow.target !== "l2-index" || workflow.dsl_hash !== config.workflow.dslHash || workflow.contract_version !== config.workflow.contractVersion) throw new Error("L2 frozen input changed");
    return { chapter: storedChapter, l1 };
  }

  private async recheckL2FrozenState(transaction: Transaction<Database>, bookId: string, config: L2JobConfig, chapter: L2JobConfig["chapters"][number]) {
    await transaction.selectFrom("chapters").select("id").where("id", "=", chapter.chapterId).forUpdate().executeTakeFirst();
    await transaction.selectFrom("index_groups").select("id").where("id", "=", config.indexGroup.id).forUpdate().executeTakeFirst();
    const [storedChapter, l1] = await Promise.all([
      transaction.selectFrom("chapters").select(["chapter_index", "title", "source_version", "content_hmac"]).where("id", "=", chapter.chapterId).where("book_id", "=", bookId).executeTakeFirst(),
      transaction.selectFrom("l1_indexes").select(["input_signature", "status"]).where("chapter_id", "=", chapter.chapterId).where("is_current", "=", true).executeTakeFirst(),
    ]);
    if (!storedChapter || storedChapter.chapter_index !== chapter.chapterIndex || storedChapter.title !== chapter.chapterTitle || storedChapter.source_version !== chapter.sourceVersion || storedChapter.content_hmac !== chapter.chapterHmac || !l1 || l1.status !== "fresh" || l1.input_signature !== chapter.l1Signature) throw new Error("L2 frozen input changed");
  }

  private commitL2Skip(claim: ClaimedStep, config: L2JobConfig, chapter: L2JobConfig["chapters"][number]) {
    return this.options.database.transaction().execute(async (transaction) => {
      const disposition = await validateImportClaim(transaction, claim);
      if (disposition) return { disposition };
      const job = await transaction.selectFrom("jobs").select("scope").where("id", "=", claim.jobId).executeTakeFirstOrThrow();
      await this.recheckL2FrozenState(transaction, String(job.scope.bookId), config, chapter);
      const status = await transaction.selectFrom("l2_chapter_statuses").select(["input_signature", "status"]).where("group_id", "=", config.indexGroup.id).where("chapter_id", "=", chapter.chapterId).executeTakeFirst();
      if (status?.status !== "fresh" || status.input_signature !== chapter.inputSignature) throw new Error("L2 frozen input changed");
      return this.finishL2(transaction, claim, config, chapter, { acceptedCount: 0, candidateCount: 0, rejectedCount: 0, factCount: 0 }, true);
    });
  }

  private async finishL2(transaction: Transaction<Database>, claim: ClaimedStep, config: L2JobConfig, chapter: L2JobConfig["chapters"][number], counts: { acceptedCount: number; candidateCount: number; rejectedCount: number; factCount: number }, skipped: boolean) {
    const job = await transaction.selectFrom("jobs").select(["status", "progress"]).where("id", "=", claim.jobId).executeTakeFirstOrThrow();
    const output = { groupId: config.indexGroup.id, chapterId: chapter.chapterId, chapterIndex: chapter.chapterIndex, ...counts };
    await transaction.updateTable("job_steps").set({ status: "completed", output_ref: output, lease_owner: null, lease_expires_at: null, updated_at: new Date() }).where("id", "=", claim.stepId).execute();
    await transaction.updateTable("job_attempts").set({ status: "completed", finished_at: new Date() }).where("id", "=", claim.attemptId).execute();
    const progress: Record<string, unknown> = { ...job.progress, current: "l2-index" };
    progress[skipped ? "skipped" : "completed"] = Number(progress[skipped ? "skipped" : "completed"] ?? 0) + 1;
    await transaction.updateTable("jobs").set({ progress, updated_at: new Date() }).where("id", "=", claim.jobId).execute();
    await transaction.insertInto("job_events").values({ job_id: claim.jobId, type: "progress", dedupe_key: `step:${claim.stepId}:completed`, payload: { stepId: claim.stepId, position: claim.position, progress } }).onConflict((conflict) => conflict.columns(["job_id", "dedupe_key"]).doNothing()).execute();
    if (job.status === "paused") return { disposition: "paused-boundary" as const };
    const remaining = await transaction.selectFrom("job_steps").select("id").where("job_id", "=", claim.jobId).where("status", "!=", "completed").executeTakeFirst();
    if (remaining) { await transaction.insertInto("job_outbox").values({ job_id: claim.jobId, topic: "jobs.wake", payload: { jobId: claim.jobId }, claimed_by: null, claim_expires_at: null, delivered_at: null }).execute(); return { disposition: "completed" as const }; }
    await transaction.updateTable("jobs").set({ status: "completed", updated_at: new Date() }).where("id", "=", claim.jobId).execute();
    await transaction.insertInto("job_events").values({ job_id: claim.jobId, type: "completed", dedupe_key: "completed", payload: { status: "completed", progress } }).onConflict((conflict) => conflict.columns(["job_id", "dedupe_key"]).doNothing()).execute();
    return { disposition: "completed" as const };
  }

  private failL2Claim(claim: ClaimedStep, errorCode: string): Promise<{ disposition: CompletionDisposition | "failed" }> {
    return this.options.database.transaction().execute(async (transaction) => {
      const disposition = await validateImportClaim(transaction, claim);
      if (disposition) return { disposition };
      const job = await transaction.selectFrom("jobs").select(["progress", "scope", "config_snapshot"]).where("id", "=", claim.jobId).executeTakeFirstOrThrow();
      try {
        const config = readL2Config(job.config_snapshot);
        const chapter = config.chapters.find((item) => item.chapterIndex === claim.position);
        if (chapter) {
          await this.recheckL2FrozenState(transaction, String(job.scope.bookId), config, chapter);
          await createIndexRepository(transaction, this.options.cipher).putL2ChapterStatus({ groupId: config.indexGroup.id, chapterId: chapter.chapterId, inputSignature: chapter.inputSignature, status: "failed", failureCode: errorCode });
        }
      } catch {
        // A changed or malformed snapshot cannot safely identify a current gap
      }
      const progress: Record<string, unknown> = { ...job.progress, failed: Number(job.progress.failed ?? 0) + 1, current: "l2-index" };
      await transaction.updateTable("job_attempts").set({ status: "failed", error_code: errorCode, error_message: errorCode, finished_at: new Date() }).where("id", "=", claim.attemptId).execute();
      await transaction.updateTable("job_steps").set({ status: "failed", lease_owner: null, lease_expires_at: null, updated_at: new Date() }).where("id", "=", claim.stepId).execute();
      await transaction.updateTable("jobs").set({ status: "failed", progress, updated_at: new Date() }).where("id", "=", claim.jobId).execute();
      await transaction.insertInto("job_events").values({ job_id: claim.jobId, type: "failed", dedupe_key: `step:${claim.stepId}:failed`, payload: { stepId: claim.stepId, position: claim.position, errorCode, progress } }).onConflict((conflict) => conflict.columns(["job_id", "dedupe_key"]).doNothing()).execute();
      return { disposition: "failed" as const };
    });
  }

  private async executeL1Claim(claim: ClaimedStep, scope: Record<string, unknown>, snapshot: Record<string, unknown>, position: number): Promise<{ disposition: CompletionDisposition }> {
    const bookId = scope.bookId;
    if (typeof bookId !== "string") throw new Error("Invalid L1 job scope");
    const config = readL1Config(snapshot);
    const chapterConfig = config.chapters.find((chapter) => chapter.chapterIndex === position);
    if (!chapterConfig) throw new Error("Invalid L1 job configuration");
    const chapter = await this.options.database.selectFrom("chapters").selectAll().where("id", "=", chapterConfig.chapterId).where("book_id", "=", bookId).executeTakeFirstOrThrow();
    if (chapter.source_version !== chapterConfig.sourceVersion || chapter.content_hmac !== chapterConfig.chapterHmac) throw new Error("L1 chapter freshness changed");
    const current = await this.options.database.selectFrom("l1_indexes").select(["id", "input_signature", "status"]).where("chapter_id", "=", chapter.id).where("is_current", "=", true).executeTakeFirst();
    if (current?.status === "fresh" && current.input_signature === chapterConfig.inputSignature) {
      return this.commitL1(claim, chapterConfig, current.id, true);
    }
    const chapterContent = this.options.cipher.decrypt({ ciphertext: chapter.content_ciphertext, nonce: chapter.content_nonce, tag: chapter.content_tag, keyVersion: chapter.content_key_version });
    const raw = await this.options.adapter.runL1Index({ invocationKey: claim.stepId, bookId, chapterIndex: chapterConfig.chapterIndex, chapterTitle: chapterConfig.chapterTitle, chapterContent, indexPrompt: config.prompt.content });
    const parsed = L1IndexOutputSchema.safeParse(raw);
    if (!parsed.success || parsed.data.route_schema_version !== config.schemaVersion) throw new Error("Invalid L1 index output");
    return this.options.database.transaction().execute(async (transaction) => {
      const disposition = await validateImportClaim(transaction, claim);
      if (disposition) return { disposition };
      const lockedChapter = await transaction.selectFrom("chapters").select(["id", "source_version", "content_hmac"]).where("id", "=", chapterConfig.chapterId).forUpdate().executeTakeFirst();
      if (!lockedChapter || lockedChapter.source_version !== chapterConfig.sourceVersion || lockedChapter.content_hmac !== chapterConfig.chapterHmac) throw new Error("L1 chapter freshness changed");
      const fresh = await transaction.selectFrom("l1_indexes").select(["id", "input_signature", "status"]).where("chapter_id", "=", chapterConfig.chapterId).where("is_current", "=", true).executeTakeFirst();
      if (fresh?.status === "fresh" && fresh.input_signature === chapterConfig.inputSignature) return this.finishL1(transaction, claim, chapterConfig, fresh.id, true);
      const stored = await createIndexRepository(transaction, this.options.cipher).putL1Index({ chapterId: chapterConfig.chapterId, promptVersionId: config.prompt.id, workflowVersionId: config.workflow.id, inputSignature: chapterConfig.inputSignature, status: "fresh", route: parsed.data });
      await transaction.updateTable("l2_chapter_statuses").set({ status: "stale", failure_code: null, updated_at: new Date() }).where("chapter_id", "=", chapterConfig.chapterId).execute();
      return this.finishL1(transaction, claim, chapterConfig, stored.id, false);
    });
  }

  private commitL1(claim: ClaimedStep, chapter: L1JobConfig["chapters"][number], l1IndexId: string, skipped: boolean) {
    return this.options.database.transaction().execute(async (transaction) => {
      const disposition = await validateImportClaim(transaction, claim);
      if (disposition) return { disposition };
      const currentChapter = await transaction.selectFrom("chapters").select(["source_version", "content_hmac"]).where("id", "=", chapter.chapterId).forUpdate().executeTakeFirst();
      const currentIndex = await transaction.selectFrom("l1_indexes").select(["id", "input_signature", "status"]).where("chapter_id", "=", chapter.chapterId).where("is_current", "=", true).executeTakeFirst();
      if (currentChapter?.source_version !== chapter.sourceVersion || currentChapter.content_hmac !== chapter.chapterHmac
        || currentIndex?.id !== l1IndexId || currentIndex.status !== "fresh" || currentIndex.input_signature !== chapter.inputSignature) throw new Error("L1 chapter freshness changed");
      return this.finishL1(transaction, claim, chapter, l1IndexId, skipped);
    });
  }

  private async finishL1(transaction: Transaction<Database>, claim: ClaimedStep, chapter: L1JobConfig["chapters"][number], l1IndexId: string, skipped: boolean) {
    const job = await transaction.selectFrom("jobs").select(["status", "progress"]).where("id", "=", claim.jobId).executeTakeFirstOrThrow();
    const output = { l1IndexId, chapterId: chapter.chapterId, chapterIndex: chapter.chapterIndex };
    await transaction.updateTable("job_steps").set({ status: "completed", output_ref: output, lease_owner: null, lease_expires_at: null, updated_at: new Date() }).where("id", "=", claim.stepId).execute();
    await transaction.updateTable("job_attempts").set({ status: "completed", finished_at: new Date() }).where("id", "=", claim.attemptId).execute();
    const progress: Record<string, unknown> = { ...job.progress, current: "l1-index" };
    if (skipped) progress.skipped = Number(progress.skipped ?? 0) + 1;
    else progress.completed = Number(progress.completed ?? 0) + 1;
    await transaction.updateTable("jobs").set({ progress, updated_at: new Date() }).where("id", "=", claim.jobId).execute();
    await transaction.insertInto("job_events").values({ job_id: claim.jobId, type: "progress", dedupe_key: `step:${claim.stepId}:completed`, payload: { stepId: claim.stepId, position: claim.position, progress } }).onConflict((conflict) => conflict.columns(["job_id", "dedupe_key"]).doNothing()).execute();
    if (job.status === "paused") return { disposition: "paused-boundary" as const };
    const remaining = await transaction.selectFrom("job_steps").select("id").where("job_id", "=", claim.jobId).where("status", "!=", "completed").executeTakeFirst();
    if (remaining) {
      await transaction.insertInto("job_outbox").values({ job_id: claim.jobId, topic: "jobs.wake", payload: { jobId: claim.jobId }, claimed_by: null, claim_expires_at: null, delivered_at: null }).execute();
      return { disposition: "completed" as const };
    }
    await transaction.updateTable("jobs").set({ status: "completed", updated_at: new Date() }).where("id", "=", claim.jobId).execute();
    await transaction.insertInto("job_events").values({ job_id: claim.jobId, type: "completed", dedupe_key: "completed", payload: { status: "completed", progress } }).onConflict((conflict) => conflict.columns(["job_id", "dedupe_key"]).doNothing()).execute();
    return { disposition: "completed" as const };
  }

  private failL1Claim(claim: ClaimedStep, errorCode: string): Promise<{ disposition: CompletionDisposition | "failed" }> {
    return this.options.database.transaction().execute(async (transaction) => {
      const disposition = await validateImportClaim(transaction, claim);
      if (disposition) return { disposition };
      const job = await transaction.selectFrom("jobs").select(["progress", "config_snapshot"]).where("id", "=", claim.jobId).executeTakeFirstOrThrow();
      let failedContext: { config: L1JobConfig; chapter: L1JobConfig["chapters"][number] } | undefined;
      try {
        const config = readL1Config(job.config_snapshot);
        const chapter = config.chapters.find((item) => item.chapterIndex === claim.position);
        if (chapter) failedContext = { config, chapter };
      } catch {
        // Malformed snapshots cannot safely reference an index
      }
      if (failedContext) {
        const currentChapter = await transaction.selectFrom("chapters").select(["source_version", "content_hmac"]).where("id", "=", failedContext.chapter.chapterId).executeTakeFirst();
        if (currentChapter?.source_version === failedContext.chapter.sourceVersion && currentChapter.content_hmac === failedContext.chapter.chapterHmac) {
          await createIndexRepository(transaction, this.options.cipher).putL1Index({ chapterId: failedContext.chapter.chapterId, promptVersionId: failedContext.config.prompt.id, workflowVersionId: failedContext.config.workflow.id, inputSignature: failedContext.chapter.inputSignature, status: "failed", route: {} });
          await transaction.updateTable("l2_chapter_statuses").set({ status: "stale", failure_code: null, updated_at: new Date() }).where("chapter_id", "=", failedContext.chapter.chapterId).execute();
        }
      }
      const progress: Record<string, unknown> = { ...job.progress, failed: Number(job.progress.failed ?? 0) + 1, current: "l1-index" };
      await transaction.updateTable("job_attempts").set({ status: "failed", error_code: errorCode, error_message: errorCode, finished_at: new Date() }).where("id", "=", claim.attemptId).execute();
      await transaction.updateTable("job_steps").set({ status: "failed", lease_owner: null, lease_expires_at: null, updated_at: new Date() }).where("id", "=", claim.stepId).execute();
      await transaction.updateTable("jobs").set({ status: "failed", progress, updated_at: new Date() }).where("id", "=", claim.jobId).execute();
      await transaction.insertInto("job_events").values({ job_id: claim.jobId, type: "failed", dedupe_key: `step:${claim.stepId}:failed`, payload: { stepId: claim.stepId, position: claim.position, errorCode, progress } }).onConflict((conflict) => conflict.columns(["job_id", "dedupe_key"]).doNothing()).execute();
      return { disposition: "failed" as const };
    });
  }

  private commit(claim: ClaimedStep, output: { chapterId: string; chapterIndex: number }, skipped: boolean) {
    return this.options.database.transaction().execute(async (transaction) => {
      const disposition = await validateImportClaim(transaction, claim);
      if (disposition) return { disposition };
      const job = await transaction.selectFrom("jobs").select(["config_snapshot", "scope"]).where("id", "=", claim.jobId).executeTakeFirstOrThrow();
      const config = readConfig(job.config_snapshot);
      return this.finish(transaction, claim, output, skipped, config.autoStartL1, String(job.scope.bookId));
    });
  }

  private async finish(transaction: Transaction<Database>, claim: ClaimedStep, output: { chapterId: string; chapterIndex: number }, skipped: boolean, autoStartL1: boolean, bookId: string) {
    const job = await transaction.selectFrom("jobs").select(["status", "progress", "requested_by"]).where("id", "=", claim.jobId).executeTakeFirstOrThrow();
    await transaction.updateTable("job_steps").set({ status: "completed", output_ref: output, lease_owner: null, lease_expires_at: null, updated_at: new Date() }).where("id", "=", claim.stepId).execute();
    await transaction.updateTable("job_attempts").set({ status: "completed", finished_at: new Date() }).where("id", "=", claim.attemptId).execute();
    const progress: Record<string, unknown> = { ...job.progress, current: "chapter-import" };
    if (skipped) progress.skipped = Number(progress.skipped ?? 0) + 1;
    else progress.completed = Number(progress.completed ?? 0) + 1;
    await transaction.updateTable("jobs").set({ progress, updated_at: new Date() }).where("id", "=", claim.jobId).execute();
    await transaction.insertInto("job_events").values({ job_id: claim.jobId, type: "progress", dedupe_key: `step:${claim.stepId}:completed`, payload: { stepId: claim.stepId, position: claim.position, progress } }).onConflict((conflict) => conflict.columns(["job_id", "dedupe_key"]).doNothing()).execute();
    if (job.status === "paused") return { disposition: "paused-boundary" as const };
    const remaining = await transaction.selectFrom("job_steps").select("id").where("job_id", "=", claim.jobId).where("status", "!=", "completed").executeTakeFirst();
    if (remaining) {
      await transaction.insertInto("job_outbox").values({ job_id: claim.jobId, topic: "jobs.wake", payload: { jobId: claim.jobId }, claimed_by: null, claim_expires_at: null, delivered_at: null }).execute();
      return { disposition: "completed" as const };
    }
    await transaction.updateTable("jobs").set({ status: "completed", updated_at: new Date() }).where("id", "=", claim.jobId).execute();
    await transaction.insertInto("job_events").values({ job_id: claim.jobId, type: "completed", dedupe_key: "completed", payload: { status: "completed", progress } }).onConflict((conflict) => conflict.columns(["job_id", "dedupe_key"]).doNothing()).execute();
    if (autoStartL1) await createImportL1Handoff(transaction, { importJobId: claim.jobId, bookId, requestedBy: job.requested_by });
    return { disposition: "completed" as const };
  }
}

async function validateImportClaim(transaction: Transaction<Database>, claim: ClaimedStep): Promise<CompletionDisposition | null> {
  const job = await transaction.selectFrom("jobs").select("status").where("id", "=", claim.jobId).forUpdate().executeTakeFirst();
  if (!job) return "terminal-noop";
  const step = await transaction.selectFrom("job_steps").selectAll().where("id", "=", claim.stepId).where("job_id", "=", claim.jobId).forUpdate().executeTakeFirst();
  if (!step) return "terminal-noop";
  if (step.status === "completed") return "already-completed";
  if (job.status === "cancelled") return "discarded-cancelled";
  if (job.status === "completed" || job.status === "failed") return "terminal-noop";
  const now = (await sql<{ now: Date }>`select clock_timestamp() as now`.execute(transaction)).rows[0]!.now;
  if (step.status !== "running" || step.lease_owner !== claim.workerId || step.attempt_count !== claim.attemptNo
    || step.lease_expires_at?.getTime() !== claim.leaseExpiresAt.getTime() || step.lease_expires_at.getTime() <= now.getTime()) return "terminal-noop";
  const attempt = await transaction.selectFrom("job_attempts").selectAll().where("id", "=", claim.attemptId).forUpdate().executeTakeFirst();
  if (!attempt || attempt.step_id !== claim.stepId || attempt.attempt_no !== claim.attemptNo || attempt.worker_id !== claim.workerId || attempt.status !== "running") return "terminal-noop";
  return null;
}

export function failImportClaim(database: DatabaseConnection, claim: ClaimedStep, errorCode: string): Promise<{ disposition: CompletionDisposition | "failed" }> {
  return database.transaction().execute(async (transaction) => {
    const disposition = await validateImportClaim(transaction, claim);
    if (disposition) return { disposition };
    const job = await transaction.selectFrom("jobs").select("progress").where("id", "=", claim.jobId).executeTakeFirstOrThrow();
    const progress: Record<string, unknown> = { ...job.progress, failed: Number(job.progress.failed ?? 0) + 1, current: claim.kind === "l1-index" ? "l1-index" : "chapter-import" };
    await transaction.updateTable("job_attempts").set({ status: "failed", error_code: errorCode, error_message: errorCode, finished_at: new Date() }).where("id", "=", claim.attemptId).execute();
    await transaction.updateTable("job_steps").set({ status: "failed", lease_owner: null, lease_expires_at: null, updated_at: new Date() }).where("id", "=", claim.stepId).execute();
    await transaction.updateTable("jobs").set({ status: "failed", progress, updated_at: new Date() }).where("id", "=", claim.jobId).execute();
    await transaction.insertInto("job_events").values({ job_id: claim.jobId, type: "failed", dedupe_key: `step:${claim.stepId}:failed`, payload: { stepId: claim.stepId, position: claim.position, errorCode, progress } }).onConflict((conflict) => conflict.columns(["job_id", "dedupe_key"]).doNothing()).execute();
    return { disposition: "failed" };
  });
}
