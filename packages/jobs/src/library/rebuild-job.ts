import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { sql } from "kysely";

import {
  PublicJobSchema,
  RebuildStepRefSchema,
  type PublicJob,
  type RebuildStepRef,
} from "@novel-analysis/contracts";
import type {
  DatabaseConnection,
  DatabaseExecutor,
} from "@novel-analysis/database";

import { jobRowToPublic, PUBLIC_JOB_COLUMNS } from "../job-repository.js";

const ACTIVE_KEY = "library-rebuild:all";
const POSTGRES_INTEGER_MAX = 2_147_483_647;
const BASELINE_URL = new URL("../../../../config/indexing-baseline.json", import.meta.url);
const L1_PROMPT = "请为当前小说章节建立轻量 L1 章节路由/信号索引。\n定位：L1 只判断本章有哪些可召回信号，服务后续按章节命中后读取 L2 专项事实；不要写长摘要，不要沉淀事实卡，不要替代 L2。\n要求：只依据本章原文；不要输出 Markdown；不要引用长段原文；主体、别名、关键词和分类信号要稳定、短句化、便于检索。";
const L2_PROMPT = "请为当前小说章节建立 L2 类型化事实索引。\n目标：提取可复用、可检索、可追溯的事实单元，不要写长摘要，不要输出 Markdown。\n分类只能使用：character、relationship、cultivation、force、event、item、magical_creature、location、foreshadowing、other、organization、power、mystery。\n每条事实必须短而明确，保留主体、相关主体、事实类型、重要度、置信度和少量证据摘记。\n不要补充本章原文之外的信息；如果本章没有可复用事实，facts 输出空数组。";

export type ApprovedIndexingBaseline = Readonly<{
  version: "phase5-indexing-v1";
  l1: {
    promptVersion: "phase5-l1-v1";
    prompt: string;
    promptSha256: string;
    adapterContractVersion: "l1-route-v1";
    dslSha256: string;
  };
  l2: {
    promptVersion: "phase5-l2-v1";
    prompt: string;
    promptSha256: string;
    adapterContractVersion: "l2-fact-v1";
    dslSha256: string;
    baseGroup: { key: "base"; name: "基础事实"; categoryScope: "general" };
  };
}>;

export type LibraryRebuildStep = {
  id: string;
  position: number;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  attemptCount: number;
  bookTitle: string;
  ref: RebuildStepRef;
  failureCode: string | null;
};

export type LibraryRebuildDetail = {
  job: PublicJob;
  steps: LibraryRebuildStep[];
};

export class LibraryRebuildConflictError extends Error {}
export class LibraryRebuildNotFoundError extends Error {}
export class LibraryRebuildPositionOverflowError extends Error {}
export class IndexingBaselineConflictError extends Error {}

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

function exactKeys(value: unknown, keys: string[]): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === keys.length
    && keys.every((key) => Object.hasOwn(value, key));
}

export async function loadApprovedIndexingBaseline(): Promise<ApprovedIndexingBaseline> {
  const value: unknown = JSON.parse(await readFile(BASELINE_URL, "utf8"));
  if (!exactKeys(value, ["version", "l1", "l2"])
    || !exactKeys(value.l1, ["promptVersion", "prompt", "adapterContractVersion", "dslSha256"])
    || !exactKeys(value.l2, ["promptVersion", "prompt", "adapterContractVersion", "dslSha256", "baseGroup"])
    || !exactKeys(value.l2.baseGroup, ["key", "name", "categoryScope"])
    || value.version !== "phase5-indexing-v1"
    || value.l1.promptVersion !== "phase5-l1-v1"
    || value.l1.prompt !== L1_PROMPT
    || value.l1.adapterContractVersion !== "l1-route-v1"
    || value.l1.dslSha256 !== "ebd3d3b403e9dd10bc6f5f0a2a16e94c7cfe94dc5c83ed766b34ba9f00190bf9"
    || value.l2.promptVersion !== "phase5-l2-v1"
    || value.l2.prompt !== L2_PROMPT
    || value.l2.adapterContractVersion !== "l2-fact-v1"
    || value.l2.dslSha256 !== "b8003c60302c80d017eb00eac16ed18b0d4dba6df6073c6eb1735a2139ae4894"
    || value.l2.baseGroup.key !== "base"
    || value.l2.baseGroup.name !== "基础事实"
    || value.l2.baseGroup.categoryScope !== "general") {
    throw new IndexingBaselineConflictError("Invalid approved indexing baseline");
  }
  return {
    version: value.version,
    l1: { ...value.l1, promptSha256: sha256(value.l1.prompt) } as ApprovedIndexingBaseline["l1"],
    l2: { ...value.l2, promptSha256: sha256(value.l2.prompt) } as ApprovedIndexingBaseline["l2"],
  };
}

export async function seedIndexingBaseline(
  database: DatabaseExecutor,
  baseline: ApprovedIndexingBaseline,
): Promise<{ l1PromptId: string; l2PromptId: string; l1WorkflowId: string; l2WorkflowId: string }> {
  const prompt = async (target: "l1-index" | "l2-index", input: ApprovedIndexingBaseline["l1"] | ApprovedIndexingBaseline["l2"]) => {
    await database.insertInto("prompt_versions").values({
      target,
      version: input.promptVersion,
      content: input.prompt,
      content_hash: input.promptSha256,
    }).onConflict((conflict) => conflict.columns(["target", "version"]).doNothing()).execute();
    const row = await database.selectFrom("prompt_versions").selectAll()
      .where("target", "=", target).where("version", "=", input.promptVersion)
      .executeTakeFirstOrThrow();
    if (row.content !== input.prompt || row.content_hash !== input.promptSha256) {
      throw new IndexingBaselineConflictError(`Stored ${target} Prompt conflicts with baseline`);
    }
    return row.id;
  };
  const workflow = async (target: "l1-index" | "l2-index", contractVersion: string, dslHash: string) => {
    await database.insertInto("workflow_versions").values({
      target,
      contract_version: contractVersion,
      dsl_hash: dslHash,
      enabled: true,
    }).onConflict((conflict) => conflict
      .columns(["target", "contract_version", "dsl_hash"]).doNothing()).execute();
    return (await database.selectFrom("workflow_versions").select("id")
      .where("target", "=", target).where("contract_version", "=", contractVersion)
      .where("dsl_hash", "=", dslHash).executeTakeFirstOrThrow()).id;
  };
  const [l1PromptId, l2PromptId, l1WorkflowId, l2WorkflowId] = await Promise.all([
    prompt("l1-index", baseline.l1),
    prompt("l2-index", baseline.l2),
    workflow("l1-index", baseline.l1.adapterContractVersion, baseline.l1.dslSha256),
    workflow("l2-index", baseline.l2.adapterContractVersion, baseline.l2.dslSha256),
  ]);
  return { l1PromptId, l2PromptId, l1WorkflowId, l2WorkflowId };
}

export async function ensureBaselineBaseGroup(
  database: DatabaseExecutor,
  input: { bookId: string; baseline: ApprovedIndexingBaseline },
): Promise<string> {
  const seeded = await seedIndexingBaseline(database, input.baseline);
  const configHash = sha256(JSON.stringify({
    ...input.baseline.l2.baseGroup,
    promptSha256: input.baseline.l2.promptSha256,
    adapterContractVersion: input.baseline.l2.adapterContractVersion,
  }));
  await database.insertInto("index_groups").values({
    book_id: input.bookId,
    key: input.baseline.l2.baseGroup.key,
    name: input.baseline.l2.baseGroup.name,
    category_scope: input.baseline.l2.baseGroup.categoryScope,
    prompt_version_id: seeded.l2PromptId,
    config_hash: configHash,
    status: "active",
  }).onConflict((conflict) => conflict.columns(["book_id", "key"]).doNothing()).execute();
  const group = await database.selectFrom("index_groups").selectAll()
    .where("book_id", "=", input.bookId).where("key", "=", "base").executeTakeFirstOrThrow();
  if (group.name !== "基础事实" || group.category_scope !== "general"
    || group.prompt_version_id !== seeded.l2PromptId || group.config_hash !== configHash) {
    throw new IndexingBaselineConflictError("Stored base group conflicts with baseline");
  }
  return group.id;
}

async function detail(database: DatabaseExecutor, jobId: string): Promise<LibraryRebuildDetail | null> {
  const row = await database.selectFrom("jobs").select(PUBLIC_JOB_COLUMNS)
    .where("id", "=", jobId).where("type", "=", "library-rebuild").executeTakeFirst();
  if (!row) return null;
  const rawSteps = await database.selectFrom("job_steps").selectAll()
    .where("job_id", "=", jobId).orderBy("position").execute();
  const attempts = await database.selectFrom("job_attempts")
    .select(["step_id", "attempt_no", "error_code"]).where("step_id", "in", rawSteps.map((step) => step.id))
    .orderBy("attempt_no", "desc").execute();
  const failureByStep = new Map<string, string | null>();
  for (const attempt of attempts) if (!failureByStep.has(attempt.step_id)) failureByStep.set(attempt.step_id, attempt.error_code);
  const refs = rawSteps.map((step) => RebuildStepRefSchema.parse(step.output_ref));
  const books = refs.length === 0 ? [] : await database.selectFrom("books").select(["id", "title"])
    .where("id", "in", refs.map((ref) => ref.bookId)).execute();
  const titleById = new Map(books.map((book) => [book.id, book.title]));
  return {
    job: PublicJobSchema.parse(jobRowToPublic(row)),
    steps: rawSteps.map((step, index) => ({
      id: step.id,
      position: step.position,
      status: step.status,
      attemptCount: step.attempt_count,
      bookTitle: titleById.get(refs[index]!.bookId) ?? "",
      ref: refs[index]!,
      failureCode: failureByStep.get(step.id) ?? null,
    })),
  };
}

export class LibraryRebuildJobService {
  constructor(private readonly database: DatabaseConnection) {}

  async create(input: { requestedBy: string; requestId: string }): Promise<PublicJob> {
    const baseline = await loadApprovedIndexingBaseline();
    return this.database.transaction().execute(async (transaction) => {
      await sql`select pg_advisory_xact_lock(hashtext(${ACTIVE_KEY}))`.execute(transaction);
      const storedRequestId = `library-rebuild:${input.requestId}`;
      const replay = await transaction.selectFrom("jobs").select(PUBLIC_JOB_COLUMNS)
        .where("requested_by", "=", input.requestedBy).where("request_id", "=", storedRequestId)
        .executeTakeFirst();
      if (replay) {
        if (replay.type !== "library-rebuild") throw new LibraryRebuildConflictError();
        return jobRowToPublic(replay);
      }
      const active = await transaction.selectFrom("jobs").select(PUBLIC_JOB_COLUMNS)
        .where("concurrency_key", "=", ACTIVE_KEY)
        .where("status", "in", ["queued", "running", "retrying", "paused"])
        .executeTakeFirst();
      if (active) return jobRowToPublic(active);
      await seedIndexingBaseline(transaction, baseline);
      const books = await transaction.selectFrom("books").select(["id", "updated_at"])
        .where("status", "=", "active").orderBy("updated_at", "desc").orderBy("id").execute();
      const inserted = await transaction.insertInto("jobs").values({
        type: "library-rebuild",
        status: books.length === 0 ? "completed" : "queued",
        requested_by: input.requestedBy,
        request_id: storedRequestId,
        scope: { target: "all" },
        config_snapshot: {
          baselineVersion: baseline.version,
          l1PromptSha256: baseline.l1.promptSha256,
          l1DslSha256: baseline.l1.dslSha256,
          l2PromptSha256: baseline.l2.promptSha256,
          l2DslSha256: baseline.l2.dslSha256,
        },
        concurrency_key: ACTIVE_KEY,
        progress: { total: books.length, completed: 0, failed: 0, skipped: 0, current: "" },
      }).returning(PUBLIC_JOB_COLUMNS).executeTakeFirstOrThrow();
      if (books.length > 0) {
        await transaction.insertInto("job_steps").values(books.map((book, position) => ({
          job_id: inserted.id,
          position,
          kind: "library-rebuild-book",
          status: "queued" as const,
          input_signature: `library-rebuild:${baseline.version}:${book.id}`,
          idempotency_key: `${inserted.id}:book:${book.id}`,
          output_ref: { bookId: book.id, stage: "waiting" },
          lease_owner: null,
          lease_expires_at: null,
        }))).execute();
        await transaction.insertInto("job_outbox").values({
          job_id: inserted.id,
          topic: "jobs.wake",
          payload: { jobId: inserted.id },
          claimed_by: null,
          claim_expires_at: null,
          delivered_at: null,
        }).execute();
      }
      await transaction.insertInto("job_events").values({
        job_id: inserted.id,
        type: "created",
        dedupe_key: "created",
        payload: { status: inserted.status },
      }).execute();
      return jobRowToPublic(inserted);
    });
  }

  get(jobId: string): Promise<LibraryRebuildDetail | null> {
    return detail(this.database, jobId);
  }

  reorder(input: {
    jobId: string;
    orderedStepIds: string[];
    actorUserId: string;
  }): Promise<LibraryRebuildDetail> {
    return this.database.transaction().execute(async (transaction) => {
      const parent = await transaction.selectFrom("jobs").select(["id", "type", "status"])
        .where("id", "=", input.jobId).forUpdate().executeTakeFirst();
      if (!parent || parent.type !== "library-rebuild") throw new LibraryRebuildNotFoundError();
      if (!["queued", "running"].includes(parent.status)) throw new LibraryRebuildConflictError();
      const steps = await transaction.selectFrom("job_steps").selectAll()
        .where("job_id", "=", input.jobId).orderBy("position").forUpdate().execute();
      const supplied = new Set(input.orderedStepIds);
      if (input.orderedStepIds.length !== steps.length || supplied.size !== steps.length
        || steps.some((step) => !supplied.has(step.id) || step.status !== "queued" || step.attempt_count !== 0)) {
        throw new LibraryRebuildConflictError();
      }
      const maxPosition = Math.max(-1, ...steps.map((step) => step.position));
      if (maxPosition > POSTGRES_INTEGER_MAX - steps.length) {
        throw new LibraryRebuildPositionOverflowError();
      }
      for (let index = 0; index < steps.length; index += 1) {
        await transaction.updateTable("job_steps")
          .set({ position: maxPosition + index + 1 })
          .where("id", "=", steps[index]!.id).executeTakeFirstOrThrow();
      }
      for (let position = 0; position < input.orderedStepIds.length; position += 1) {
        await transaction.updateTable("job_steps").set({ position })
          .where("id", "=", input.orderedStepIds[position]!).executeTakeFirstOrThrow();
      }
      await transaction.insertInto("audit_logs").values({
        actor_user_id: input.actorUserId,
        action: "library_rebuild.reorder",
        target_type: "job",
        target_id: input.jobId,
        metadata: { orderedStepIds: input.orderedStepIds },
      }).execute();
      const result = await detail(transaction, input.jobId);
      if (!result) throw new LibraryRebuildNotFoundError();
      return result;
    });
  }
}
