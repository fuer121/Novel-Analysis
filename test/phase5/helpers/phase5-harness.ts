import { createHash } from "node:crypto";
import type { Server } from "node:http";
import { cpus, totalmem } from "node:os";
import { performance } from "node:perf_hooks";

import { sql } from "kysely";

import {
  createContentCipher,
  createIndexRepository,
  createLibraryRepository,
  createQueryRepository,
  L1_ROUTE_SCHEMA_VERSION,
  L2_ADMISSION_VERSION,
  L2_FACT_SCHEMA_VERSION,
  type DatabaseConnection,
} from "@novel-analysis/database";
import {
  FakeDifyAdapter,
  type AnalysisSummaryInput,
  type ChapterImportInput,
  type DifyAdapter,
  type FakeDifyScript,
  type L1IndexInput,
  type L2IndexInput,
} from "@novel-analysis/dify";
import { buildL1Signature, buildL2Signature } from "@novel-analysis/domain";
import {
  createBoss,
  type ExecutionBarrier,
  LibraryRebuildJobService,
  PostgresStepLeaseService,
  type ClaimedStep,
} from "@novel-analysis/jobs";
import { createApp } from "../../../apps/api/src/app.js";
import { FakeFeishuOAuthAdapter } from "../../../apps/api/src/auth/feishu-fake.js";
import type { ApiConfig } from "../../../apps/api/src/config.js";
import {
  createDisposablePostgres,
  type DisposablePostgres,
} from "../../../packages/database/src/testing/postgres.js";
import { LibraryImportExecutor } from "../../../apps/worker/src/library-executor.js";
import { QueryExecutor } from "../../../apps/worker/src/query-executor.js";
import { RebuildExecutor } from "../../../apps/worker/src/rebuild-executor.js";
import {
  createWorkerStepExecutor,
  JobWorker,
  type WorkerBoss,
} from "../../../apps/worker/src/worker.js";

import { REBUILD_GOLDEN } from "../fixtures/golden-query.js";
import type {
  Phase5LoadHarness,
  Phase5LoadProfile,
  Phase5LoadReport,
} from "./load-runner.js";

export async function createPhase5Harness() {
  const postgres: DisposablePostgres = await createDisposablePostgres();
  const cipher = createContentCipher({
    activeKeyVersion: "phase5-test",
    keys: { "phase5-test": Buffer.alloc(32, 12) },
  });
  const adminId = (await postgres.db.insertInto("users").values({
    display_name: "Phase 5 Admin",
    role: "admin",
    status: "active",
  }).returning("id").executeTakeFirstOrThrow()).id;
  const library = createLibraryRepository(postgres.db, cipher);
  const bookId = (await library.createBook({
    title: "Phase 5 Recovery",
    createdBy: adminId,
  })).id;
  await library.insertChapter({
    bookId,
    chapterIndex: REBUILD_GOLDEN.chapterIndex,
    title: "白鹿回返",
    plaintext: "受控测试章节正文",
    contentHmac: "phase5-controlled-hmac",
    sourceVersion: "phase5-source-v1",
  });
  const parentJobId = (await new LibraryRebuildJobService(postgres.db).create({
    requestedBy: adminId,
    requestId: "phase5-recovery",
  })).id;

  const leases = () => new PostgresStepLeaseService({
    database: postgres.db,
    leaseDurationMs: 60_000,
  });
  const executor = () => new RebuildExecutor({ database: postgres.db, deferDelayMs: 0 });

  async function claimParent(workerId: string = crypto.randomUUID()) {
    return leases().claimNext(parentJobId, workerId, new Date());
  }

  async function expire(claim: ClaimedStep) {
    await postgres.db.updateTable("job_steps").set({
      lease_expires_at: sql<Date>`clock_timestamp() - interval '1 second'`,
    }).where("id", "=", claim.stepId).execute();
  }

  async function runChild(jobId: string, target: "l1-index" | "l2-index") {
    const claim = await leases().claimNext(jobId, `${target}-worker`, new Date());
    if (!claim) throw new Error(`${target} child claim missing`);
    let script: FakeDifyScript;
    if (target === "l1-index") {
      script = { target, invocationKey: claim.stepId, output: {
          route_schema_version: "l1-route-v1",
          route_entities: [{ name: "白鹿", type: "character", aliases: [], role: "signal", note: "回返" }],
          route_keywords: ["白鹿", "回返"],
          signals: [],
          category_scores: { event: 1 },
        } };
    } else {
      script = { target, invocationKey: claim.stepId, output: {
          chapter_index: REBUILD_GOLDEN.chapterIndex,
          chapter_title: "白鹿回返",
          facts: [{
            category: "event",
            entity: "白鹿",
            aliases: [],
            tags: ["回返"],
            related_entities: [],
            fact_type: "event",
            fact: REBUILD_GOLDEN.fact,
            evidence: ["山门前留下信号"],
            importance: 0.8,
            confidence: 0.9,
            scope_eligible: true,
            scope_basis: "章节明确陈述",
            transformation_eligible: false,
            scope_fields_complete: true,
            creature_type: "",
            original_form: "",
            qualification_evidence: [],
            subject_key: REBUILD_GOLDEN.subjectKey,
            identity_basis: "明确命名",
          }],
        } };
    }
    return new LibraryImportExecutor({
      database: postgres.db,
      adapter: new FakeDifyAdapter([script]),
      cipher,
      hmacKey: Buffer.from("phase5-hmac"),
    }).execute(claim);
  }

  return {
    postgres,
    cipher,
    bookId,
    parentJobId,
    claimParent,
    expire,
    executor,
    runChild,
    detail: () => new LibraryRebuildJobService(postgres.db).get(parentJobId),
    destroy: () => postgres.destroy(),
  };
}

const scaleConfig: ApiConfig = {
  appOrigin: "http://127.0.0.1",
  oauthRedirectUri: "http://127.0.0.1/api/auth/callback",
  sessionCookieName: "phase5_scale_session",
  oauthCorrelationCookieName: "phase5_scale_oauth",
  sessionCookieSecure: false,
  sessionTtlMs: 10 * 60_000,
};

type ScaleIdentity = Readonly<{
  userId: string;
  cookie: string;
  csrf: string;
}>;

class ControlledPhase5Provider implements DifyAdapter {
  async runAnalysisSummary(_input: AnalysisSummaryInput) {
    return { text: "PHASE5_CONTROLLED_SUMMARY" };
  }

  async runChapterImport(_input: ChapterImportInput): Promise<never> {
    throw new Error("unexpected chapter import in scale harness");
  }

  async runL1Index(_input: L1IndexInput): Promise<never> {
    throw new Error("unexpected L1 index in scale harness");
  }

  async runL2Index(_input: L2IndexInput): Promise<never> {
    throw new Error("unexpected L2 index in scale harness");
  }
}

class RebuildBarrier implements ExecutionBarrier {
  private startedResolve!: () => void;
  private releaseResolve!: () => void;
  private blocked = false;
  private released = false;
  private readonly releaseGate = new Promise<void>((resolve) => {
    this.releaseResolve = resolve;
  });
  readonly started = new Promise<void>((resolve) => {
    this.startedResolve = resolve;
  });
  claim: { stepId: string; attemptId: string } | undefined;

  constructor(private readonly database: DatabaseConnection) {}

  async afterAttemptStarted(input: {
    stepId: string;
    attemptId: string;
  }): Promise<void> {
    const step = await this.database.selectFrom("job_steps")
      .select("kind")
      .where("id", "=", input.stepId)
      .executeTakeFirstOrThrow();
    if (step.kind !== "library-rebuild-book" || this.blocked) return;
    this.blocked = true;
    this.claim = { stepId: input.stepId, attemptId: input.attemptId };
    this.startedResolve();
    await this.releaseGate;
  }

  release(): void {
    if (this.released) return;
    this.released = true;
    this.releaseResolve();
  }
}

async function responseJson(
  response: Response,
  expectedStatus = 200,
): Promise<Record<string, any>> {
  const body = await response.json() as Record<string, any>;
  if (response.status !== expectedStatus) {
    throw new Error(
      `Expected ${expectedStatus}, received ${response.status}: ${JSON.stringify(body)}`,
    );
  }
  return body;
}

async function waitUntil(
  check: () => Promise<boolean>,
  label: string,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function createFastTestBoss(databaseUrl: string): WorkerBoss {
  const boss = createBoss(databaseUrl);
  return new Proxy(boss, {
    get(target, property) {
      if (property === "work") {
        return (
          name: string,
          options: { localConcurrency: number },
          handler: (jobs: Array<{ data: unknown }>) => Promise<unknown>,
        ) => target.work(name, {
          ...options,
          pollingIntervalSeconds: 0.5,
        }, handler);
      }
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as unknown as WorkerBoss;
}

async function startScaleApi(database: DatabaseConnection, cipher: ReturnType<typeof createContentCipher>) {
  const app = createApp({
    database,
    config: scaleConfig,
    feishu: new FakeFeishuOAuthAdapter(),
    contentCipher: cipher,
    queryHmacKey: Buffer.alloc(32, 44),
  });
  const server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Phase 5 scale API address unavailable");
  }
  return { server, origin: `http://127.0.0.1:${address.port}` };
}

async function seedScaleDataset(
  postgres: DisposablePostgres,
  profile: Phase5LoadProfile,
  adminId: string,
  cipher: ReturnType<typeof createContentCipher>,
) {
  const library = createLibraryRepository(postgres.db, cipher);
  const primary = await library.createBook({
    title: "Phase 5 Scale Primary",
    createdBy: adminId,
  });
  for (let index = 1; index < profile.dataset.books; index += 1) {
    await library.createBook({
      title: `Phase 5 Scale Extra ${index}`,
      createdBy: adminId,
    });
  }

  const indexes = createIndexRepository(postgres.db, cipher);
  const l1PromptContent = "phase5 scale l1 prompt";
  const l2PromptContent = "phase5 scale l2 prompt";
  const l1Prompt = await indexes.createPromptVersion({
    target: "l1-index",
    version: "phase5-scale-l1",
    content: l1PromptContent,
    contentHash: createHash("sha256").update(l1PromptContent).digest("hex"),
  });
  const l2Prompt = await indexes.createPromptVersion({
    target: "l2-index",
    version: "phase5-scale-l2",
    content: l2PromptContent,
    contentHash: createHash("sha256").update(l2PromptContent).digest("hex"),
  });
  const l1Workflow = await indexes.createWorkflowVersion({
    target: "l1-index",
    contractVersion: "phase5-scale-l1-v1",
    dslHash: "phase5-scale-l1-dsl",
  });
  const l2Workflow = await indexes.createWorkflowVersion({
    target: "l2-index",
    contractVersion: "phase5-scale-l2-v1",
    dslHash: "phase5-scale-l2-dsl",
  });
  await indexes.createWorkflowVersion({
    target: "analysis-summary",
    contractVersion: "phase5-scale-summary-v1",
    dslHash: "phase5-scale-summary-dsl",
  });
  const group = await indexes.createIndexGroup({
    bookId: primary.id,
    key: "base",
    name: "Phase 5 Scale Base",
    categoryScope: "general",
    promptVersionId: l2Prompt.id,
    configHash: "phase5-scale-group-v1",
  });
  await indexes.registerSubject({
    groupId: group.id,
    subjectKey: "scale-subject",
    displayName: "Scale Subject",
    aliases: [],
  });

  const encryptedChapter = cipher.encrypt("synthetic scale chapter");
  const chapters = await sql<{ id: string; chapter_index: number }>`
    insert into chapters (
      book_id, chapter_index, title, content_hmac, content_ciphertext,
      content_nonce, content_tag, content_key_version, source_version
    )
    select ${primary.id}, value, 'Chapter ' || value, 'phase5-hmac-' || value,
      ${encryptedChapter.ciphertext}, ${encryptedChapter.nonce},
      ${encryptedChapter.tag}, ${encryptedChapter.keyVersion}, 'phase5-scale-source'
    from generate_series(1, ${profile.dataset.chapters}) value
    returning id, chapter_index
  `.execute(postgres.db);

  const l1Rows = chapters.rows.map((chapter) => {
    const chapterHmac = `phase5-hmac-${chapter.chapter_index}`;
    const l1Signature = buildL1Signature({
      sourceVersion: "phase5-scale-source",
      chapterHmac,
      promptHash: l1Prompt.content_hash,
      workflowDslHash: l1Workflow.dsl_hash,
      adapterContractVersion: l1Workflow.contract_version,
      schemaVersion: L1_ROUTE_SCHEMA_VERSION,
    });
    return {
      chapter,
      l1Signature,
      l2Signature: buildL2Signature({
        sourceVersion: "phase5-scale-source",
        chapterHmac,
        promptHash: l2Prompt.content_hash,
        workflowDslHash: l2Workflow.dsl_hash,
        adapterContractVersion: l2Workflow.contract_version,
        schemaVersion: L2_FACT_SCHEMA_VERSION,
        admissionVersion: L2_ADMISSION_VERSION,
        indexGroupConfigHash: "phase5-scale-group-v1",
        l1Signature,
      }),
    };
  });
  for (let offset = 0; offset < l1Rows.length; offset += 500) {
    const batch = l1Rows.slice(offset, offset + 500);
    await postgres.db.insertInto("l1_indexes").values(batch.map(({ chapter, l1Signature }) => ({
      chapter_id: chapter.id,
      prompt_version_id: l1Prompt.id,
      workflow_version_id: l1Workflow.id,
      input_signature: l1Signature,
      status: "fresh" as const,
      is_current: true,
      route: {
        route_schema_version: L1_ROUTE_SCHEMA_VERSION,
        route_entities: [],
        route_keywords: [],
        signals: [],
        category_scores: {},
      },
    }))).execute();
    await postgres.db.insertInto("l2_chapter_statuses").values(batch.map(({ chapter, l2Signature }) => ({
      group_id: group.id,
      chapter_id: chapter.id,
      book_id: primary.id,
      input_signature: l2Signature,
      status: "fresh" as const,
      failure_code: null,
    }))).execute();
  }

  const encryptedFact = cipher.encrypt("synthetic scale fact");
  await sql`
    with fact_rows as (
      select chapter.id as chapter_id,
        row_number() over (order by chapter.chapter_index, copy.value) as fact_no
      from chapters chapter
      cross join generate_series(1, 24) copy(value)
      where chapter.book_id = ${primary.id}
    )
    insert into l2_facts (
      group_id, chapter_id, book_id, subject_key, fact_type,
      fact_ciphertext, fact_nonce, fact_tag, fact_key_version, metadata
    )
    select ${group.id}, chapter_id, ${primary.id}, 'scale-subject', 'event',
      ${encryptedFact.ciphertext}, ${encryptedFact.nonce}, ${encryptedFact.tag},
      ${encryptedFact.keyVersion},
      jsonb_build_object('category', 'event', 'scopeEligible', true)
    from fact_rows where fact_no <= ${profile.dataset.facts}
  `.execute(postgres.db);

  return { bookId: primary.id, groupId: group.id };
}

export class Phase5ScaleHarness implements Phase5LoadHarness {
  private stopped = false;
  private rebuildJobId: string | undefined;
  private readonly submittedJobIds: string[] = [];

  constructor(
    private readonly postgres: DisposablePostgres,
    private readonly server: Server,
    private readonly worker: JobWorker,
    private readonly origin: string,
    private readonly identities: readonly ScaleIdentity[],
    private readonly sessionIds: readonly string[],
    private readonly bookId: string,
    private readonly groupId: string,
    private readonly barrier: RebuildBarrier,
  ) {}

  private requestAs(
    identity: ScaleIdentity,
    path: string,
    init: RequestInit = {},
  ): Promise<Response> {
    return fetch(`${this.origin}/api${path}`, {
      ...init,
      headers: {
        Cookie: identity.cookie,
        Origin: scaleConfig.appOrigin,
        "X-CSRF-Token": identity.csrf,
        "Idempotency-Key": crypto.randomUUID(),
        ...init.headers,
      },
    });
  }

  async serverProfile(): Promise<Phase5LoadReport["server"]> {
    const version = await sql<{ server_version: string }>`show server_version`
      .execute(this.postgres.db);
    const processors = cpus();
    return {
      cpu: `${processors[0]?.model ?? "unknown"} (${processors.length} logical CPUs)`,
      memoryBytes: totalmem(),
      node: process.version,
      postgres: version.rows[0]!.server_version,
    };
  }

  async datasetCounts(): Promise<Phase5LoadReport["dataset"]> {
    const [books, chapters, facts] = await Promise.all([
      this.postgres.db.selectFrom("books").select(({ fn }) => fn.countAll<string>().as("count")).executeTakeFirstOrThrow(),
      this.postgres.db.selectFrom("chapters").select(({ fn }) => fn.countAll<string>().as("count")).executeTakeFirstOrThrow(),
      this.postgres.db.selectFrom("l2_facts").select(({ fn }) => fn.countAll<string>().as("count")).executeTakeFirstOrThrow(),
    ]);
    return {
      books: Number(books.count),
      chapters: Number(chapters.count),
      facts: Number(facts.count),
    };
  }

  warmup(): Promise<void> {
    return this.browse(0);
  }

  async browse(userIndex: number): Promise<void> {
    const identity = this.identities[userIndex]!;
    const paths = [
      "/books",
      `/books/${this.bookId}`,
      `/books/${this.bookId}/index-groups`,
      `/books/${this.bookId}/index-groups/${this.groupId}/facts?limit=20`,
      `/books/${this.bookId}/analysis-readiness`,
    ];
    for (const path of paths) {
      await responseJson(await this.requestAs(identity, path));
    }
  }

  async startBackgroundRebuild(): Promise<void> {
    const books = await this.postgres.db.selectFrom("books")
      .select("id")
      .orderBy("created_at", "desc")
      .orderBy("id")
      .execute();
    const job = await this.postgres.db.insertInto("jobs").values({
      type: "library-rebuild",
      status: "queued",
      requested_by: this.identities[0]!.userId,
      request_id: "phase5-scale-controlled-rebuild",
      scope: { target: "all" },
      config_snapshot: { source: "phase5-scale-controlled" },
      concurrency_key: "library-rebuild:phase5-scale-controlled",
      progress: {
        total: books.length,
        completed: 0,
        failed: 0,
        skipped: 0,
        current: "",
      },
    }).returning("id").executeTakeFirstOrThrow();
    await this.postgres.db.insertInto("job_steps").values(
      books.map((book, position) => ({
        job_id: job.id,
        position,
        kind: "library-rebuild-book",
        status: "queued" as const,
        input_signature: `phase5-scale-rebuild:${book.id}`,
        idempotency_key: `${job.id}:book:${book.id}`,
        output_ref: { bookId: book.id, stage: "waiting" },
        lease_owner: null,
        lease_expires_at: null,
      })),
    ).execute();
    await this.postgres.db.insertInto("job_events").values({
      job_id: job.id,
      type: "created",
      dedupe_key: "created",
      payload: { status: "queued" },
    }).execute();
    await this.postgres.db.insertInto("job_outbox").values({
      job_id: job.id,
      topic: "jobs.wake",
      payload: { jobId: job.id },
      claimed_by: null,
      claim_expires_at: null,
      delivered_at: null,
    }).execute();
    this.rebuildJobId = job.id;
    await Promise.race([
      this.barrier.started,
      new Promise<never>((_, reject) => setTimeout(
        () => reject(new Error("Timed out waiting for running rebuild step")),
        10_000,
      )),
    ]);
  }

  async submit(userIndex: number): Promise<{
    submitMs: number;
    statusPropagationMs: number;
  }> {
    const identity = this.identities[userIndex]!;
    const sessionId = this.sessionIds[userIndex]!;
    const payload = {
      question: `Phase 5 concurrent question ${userIndex}`,
      startChapter: 1,
      endChapter: 3_000,
    };
    const preview = await responseJson(await this.requestAs(
      identity,
      `/books/${this.bookId}/query-sessions/${sessionId}/turn-preview`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    ));
    const started = performance.now();
    const created = await responseJson(await this.requestAs(
      identity,
      `/books/${this.bookId}/query-sessions/${sessionId}/turns`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, scopeHash: preview.scopeHash }),
      },
    ), 201);
    const submitMs = performance.now() - started;
    const jobId = created.job.id as string;
    this.submittedJobIds.push(jobId);
    await waitUntil(async () => {
      const jobs = await responseJson(await this.requestAs(identity, "/jobs?limit=100"));
      return (jobs.jobs as Array<{ id: string }>).some((job) => job.id === jobId);
    }, `query job ${jobId} propagation`, 2_500);
    return {
      submitMs,
      statusPropagationMs: performance.now() - started,
    };
  }

  async priorityEvidence(): Promise<Phase5LoadReport["priority"]> {
    if (!this.rebuildJobId || !this.barrier.claim) {
      throw new Error("Background rebuild was not started");
    }
    await waitUntil(async () => {
      const attempts = await this.postgres.db.selectFrom("job_attempts as a")
        .innerJoin("job_steps as s", "s.id", "a.step_id")
        .select(({ fn }) => fn.countAll<string>().as("count"))
        .where("s.job_id", "in", this.submittedJobIds)
        .executeTakeFirstOrThrow();
      return Number(attempts.count) === this.submittedJobIds.length;
    }, "all interactive attempts");

    const queuedBackground = await this.postgres.db.selectFrom("job_steps")
      .select(({ fn }) => fn.countAll<string>().as("count"))
      .where("job_id", "=", this.rebuildJobId)
      .where("status", "=", "queued")
      .where("attempt_count", "=", 0)
      .executeTakeFirstOrThrow();
    const runningStep = await this.postgres.db.selectFrom("job_steps")
      .select(["status", "attempt_count"])
      .where("id", "=", this.barrier.claim.stepId)
      .executeTakeFirstOrThrow();
    const runningAttempt = await this.postgres.db.selectFrom("job_attempts")
      .select("status")
      .where("id", "=", this.barrier.claim.attemptId)
      .executeTakeFirstOrThrow();
    const interactiveAttempts = await this.postgres.db.selectFrom("job_attempts as a")
      .innerJoin("job_steps as s", "s.id", "a.step_id")
      .select(({ fn }) => fn.countAll<string>().as("count"))
      .where("s.job_id", "in", this.submittedJobIds)
      .executeTakeFirstOrThrow();

    return {
      interactiveAheadOfQueuedBackground:
        Number(interactiveAttempts.count) === this.submittedJobIds.length
        && Number(queuedBackground.count) >= 1,
      runningStepUninterrupted:
        runningStep.status === "running"
        && runningStep.attempt_count === 1
        && runningAttempt.status === "running",
    };
  }

  releaseBackground(): void {
    this.barrier.release();
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    this.releaseBackground();
    const errors: unknown[] = [];
    await new Promise<void>((resolve) => this.server.close((error) => {
      if (error) errors.push(error);
      resolve();
    }));
    try {
      await this.worker.stop();
    } catch (error) {
      errors.push(error);
    }
    try {
      await this.postgres.destroy();
    } catch (error) {
      errors.push(error);
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, "Failed to stop Phase 5 scale harness");
    }
  }
}

export async function createPhase5ScaleHarness(
  profile: Phase5LoadProfile,
): Promise<Phase5ScaleHarness> {
  const postgres = await createDisposablePostgres();
  let server: Server | undefined;
  let worker: JobWorker | undefined;
  try {
    const cipher = createContentCipher({
      activeKeyVersion: "phase5-scale",
      keys: { "phase5-scale": Buffer.alloc(32, 55) },
    });
    const adminUser = await postgres.db.insertInto("users").values({
      display_name: "Phase 5 Scale Admin",
      role: "admin",
      status: "active",
    }).returning("id").executeTakeFirstOrThrow();
    const members: ScaleIdentity[] = [];
    for (let index = 0; index < profile.browseUsers; index += 1) {
      const user = await postgres.db.insertInto("users").values({
        display_name: `Phase 5 Scale Member ${index}`,
        role: "member",
        status: "active",
      }).returning("id").executeTakeFirstOrThrow();
      members.push({
        userId: user.id,
        cookie: `${scaleConfig.sessionCookieName}=phase5-member-token-${index}`,
        csrf: `phase5-member-csrf-${index}`,
      });
    }
    const admin: ScaleIdentity = {
      userId: adminUser.id,
      cookie: `${scaleConfig.sessionCookieName}=phase5-admin-token`,
      csrf: "phase5-admin-csrf",
    };
    await postgres.db.insertInto("sessions").values([
      ...members.map((identity, index) => ({
        user_id: identity.userId,
        token_hash: createHash("sha256").update(`phase5-member-token-${index}`).digest("hex"),
        csrf_token_hash: createHash("sha256").update(identity.csrf).digest("hex"),
        expires_at: new Date(Date.now() + 10 * 60_000),
        revoked_at: null,
      })),
      {
        user_id: admin.userId,
        token_hash: createHash("sha256").update("phase5-admin-token").digest("hex"),
        csrf_token_hash: createHash("sha256").update(admin.csrf).digest("hex"),
        expires_at: new Date(Date.now() + 10 * 60_000),
        revoked_at: null,
      },
    ]).execute();

    const dataset = await seedScaleDataset(postgres, profile, admin.userId, cipher);
    const sessions = createQueryRepository(postgres.db, cipher);
    const sessionIds: string[] = [];
    for (let index = 0; index < profile.submitUsers; index += 1) {
      const session = await sessions.createSession({
        bookId: dataset.bookId,
        groupId: dataset.groupId,
        createdBy: members[index]!.userId,
        title: `Phase 5 Scale Session ${index}`,
        visibility: "private",
        defaultStartChapter: 1,
        defaultEndChapter: profile.dataset.chapters,
      });
      sessionIds.push(session.id);
    }

    const barrier = new RebuildBarrier(postgres.db);
    worker = new JobWorker({
      database: postgres.db,
      boss: createFastTestBoss(postgres.databaseUrl),
      workerId: `phase5-scale-worker-${crypto.randomUUID()}`,
      pollIntervalMs: 20,
      queryConcurrency: profile.submitUsers,
      barrier,
      executor: createWorkerStepExecutor({
        database: postgres.db,
        rebuildExecutor: new RebuildExecutor({
          database: postgres.db,
          deferDelayMs: 1_000,
        }),
        queryExecutor: new QueryExecutor({
          database: postgres.db,
          cipher,
          dify: new ControlledPhase5Provider(),
        }),
      }),
    });
    await worker.start();
    const runtime = await startScaleApi(postgres.db, cipher);
    server = runtime.server;
    return new Phase5ScaleHarness(
      postgres,
      server,
      worker,
      runtime.origin,
      members,
      sessionIds,
      dataset.bookId,
      dataset.groupId,
      barrier,
    );
  } catch (error) {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    if (worker) await worker.stop().catch(() => undefined);
    await postgres.destroy().catch(() => undefined);
    throw error;
  }
}
