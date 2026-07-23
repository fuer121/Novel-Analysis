import { createHash } from "node:crypto";
import type { Server } from "node:http";
import { performance } from "node:perf_hooks";

import { sql } from "kysely";

import {
  createContentCipher,
  createIndexRepository,
  createLibraryRepository,
  L1_ROUTE_SCHEMA_VERSION,
  L2_ADMISSION_VERSION,
  L2_FACT_SCHEMA_VERSION,
  type DatabaseConnection,
} from "@novel-analysis/database";
import { buildL1Signature, buildL2Signature } from "@novel-analysis/domain";
import type {
  AnalysisSummaryInput,
  ChapterImportInput,
  DifyAdapter,
  L1IndexInput,
  L2IndexInput,
} from "@novel-analysis/dify";
import { DifyAdapterError } from "@novel-analysis/dify";
import { createBoss, type ExecutionBarrier } from "@novel-analysis/jobs";
import { createApp } from "../../../apps/api/src/app.js";
import { FakeFeishuOAuthAdapter } from "../../../apps/api/src/auth/feishu-fake.js";
import type { ApiConfig } from "../../../apps/api/src/config.js";
import { QueryExecutor } from "../../../apps/worker/src/query-executor.js";
import { JobWorker, createWorkerStepExecutor, type WorkerBoss } from "../../../apps/worker/src/worker.js";
import {
  createDisposablePostgres,
  type DisposablePostgres,
} from "../../../packages/database/src/testing/postgres.js";

const cipher = createContentCipher({
  activeKeyVersion: "phase3-test",
  keys: { "phase3-test": Buffer.alloc(32, 31) },
});

const config: ApiConfig = {
  appOrigin: "http://127.0.0.1",
  oauthRedirectUri: "http://127.0.0.1/api/auth/callback",
  sessionCookieName: "phase3_session",
  oauthCorrelationCookieName: "phase3_oauth",
  sessionCookieSecure: false,
  sessionTtlMs: 60_000,
};

const SENTINELS = {
  chapter: "PHASE3_CHAPTER_SENTINEL",
  fact: "PHASE3_FACT_SENTINEL",
  question: "PHASE3_QUESTION_SENTINEL",
  answer: "PHASE3_ANSWER_SENTINEL",
  sessionTitle: "PHASE3_SESSION_TITLE_SENTINEL",
  credential: "PHASE3_CREDENTIAL_SENTINEL",
} as const;

export type Phase3Turn = {
  id: string;
  answer: string | null;
  status: string;
  intent: { target?: string };
  evidenceVersion: string;
  evidence: Array<{ turnId: string; factId: string; disposition: string; body: string }>;
  evidenceRecordIds: string[];
  sourceStats: { candidates: number; used: number; excluded: number; gaps: number };
  trace: { kind: string | null; target: string | null };
};

class Phase3DifyFake implements DifyAdapter {
  readonly credential = SENTINELS.credential;
  readonly summaryInputs: string[] = [];
  rawErrorMessage: string | null = null;
  private failuresRemaining = 0;
  private failureMessage: string | undefined;
  private delayedSummary: { answer: string; started: () => void; gate: Promise<void> } | undefined;

  failNextSummary(message?: string): void {
    this.failuresRemaining += 1;
    this.failureMessage = message;
  }

  delayNextSummary(answer: string): { started: Promise<void>; release(): void } {
    let signalStarted!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => { signalStarted = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    this.delayedSummary = { answer, started: signalStarted, gate };
    return { started, release };
  }

  async runAnalysisSummary(input: AnalysisSummaryInput) {
    this.summaryInputs.push(input.contextJson);
    if (this.delayedSummary) {
      const delayed = this.delayedSummary;
      this.delayedSummary = undefined;
      delayed.started();
      await delayed.gate;
      return { text: delayed.answer };
    }
    if (this.failuresRemaining > 0) {
      this.failuresRemaining -= 1;
      const error = new DifyAdapterError("provider_unavailable");
      if (this.failureMessage) error.message = this.failureMessage;
      this.rawErrorMessage = error.message;
      this.failureMessage = undefined;
      throw error;
    }
    return { text: `${SENTINELS.answer}_${this.summaryInputs.length}` };
  }

  async runChapterImport(_input: ChapterImportInput): Promise<never> {
    throw new Error("unexpected chapter import");
  }

  async runL1Index(_input: L1IndexInput): Promise<never> {
    throw new Error("unexpected L1 index");
  }

  async runL2Index(_input: L2IndexInput): Promise<never> {
    throw new Error("unexpected L2 index");
  }
}

class BackgroundBarrier implements ExecutionBarrier {
  private signalStarted!: () => void;
  private releaseBlocked!: () => void;
  readonly started = new Promise<void>((resolve) => { this.signalStarted = resolve; });
  private readonly released = new Promise<void>((resolve) => { this.releaseBlocked = resolve; });

  constructor(private readonly database: DatabaseConnection) {}

  async afterAttemptStarted(input: { stepId: string }): Promise<void> {
    const step = await this.database.selectFrom("job_steps").select("kind").where("id", "=", input.stepId).executeTakeFirstOrThrow();
    if (step.kind === "l2-index") {
      this.signalStarted();
      await this.released;
      return;
    }
  }

  release(): void {
    this.releaseBlocked();
  }

}

async function waitUntil(check: () => Promise<boolean>, label: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function responseJson(response: Response, expectedStatus = 200): Promise<Record<string, any>> {
  const body = await response.json() as Record<string, any>;
  if (response.status !== expectedStatus) {
    throw new Error(`Expected ${expectedStatus}, received ${response.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

export class Phase3Harness {
  readonly summaryInputs: string[];
  readonly database: DatabaseConnection;
  readonly bookId: string;
  readonly groupId: string;
  readonly userId: string;

  private stopped = false;

  constructor(
    private readonly postgres: DisposablePostgres,
    private server: Server,
    private worker: JobWorker,
    private origin: string,
    private readonly cookie: string,
    private readonly csrf: string,
    private readonly dify: Phase3DifyFake,
    private readonly backgroundBarrier: BackgroundBarrier,
    values: { bookId: string; groupId: string; userId: string; summaryInputs: string[] },
  ) {
    this.database = postgres.db;
    this.bookId = values.bookId;
    this.groupId = values.groupId;
    this.userId = values.userId;
    this.summaryInputs = values.summaryInputs;
  }

  async request(path: string, init: RequestInit = {}): Promise<Response> {
    return fetch(`${this.origin}/api${path}`, {
      ...init,
      headers: {
        Cookie: this.cookie,
        Origin: config.appOrigin,
        "X-CSRF-Token": this.csrf,
        "Idempotency-Key": crypto.randomUUID(),
        ...init.headers,
      },
    });
  }

  async createSession(title: string): Promise<string> {
    const result = await responseJson(await this.request(`/books/${this.bookId}/query-sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        groupId: this.groupId,
        title,
        visibility: "private",
        defaultStartChapter: 1,
        defaultEndChapter: 101,
      }),
    }), 201);
    return result.session.id as string;
  }

  async runConcurrentAcceptance(count: number): Promise<{
    completionP95Ms: number;
    readP95Ms: number;
    principalCount: number;
    authorityMatches: boolean;
    turns: Array<{ id: string; answerCount: number; evidenceSnapshotCount: number }>;
  }> {
    const backgroundJob = await this.database.insertInto("jobs").values({
      type: "l2-index", status: "queued", requested_by: this.userId, request_id: crypto.randomUUID(), scope: { bookId: this.bookId }, config_snapshot: {}, concurrency_key: null,
      progress: { total: 1, completed: 0, failed: 0, skipped: 0, current: "" },
    }).returning("id").executeTakeFirstOrThrow();
    await this.database.insertInto("job_steps").values({ job_id: backgroundJob.id, position: 1, kind: "l2-index", status: "queued", input_signature: "phase3-background", idempotency_key: crypto.randomUUID(), output_ref: null, lease_owner: null, lease_expires_at: null }).execute();
    await this.database.insertInto("job_outbox").values({ job_id: backgroundJob.id, topic: "jobs.wake", payload: { jobId: backgroundJob.id }, claimed_by: null, claim_expires_at: null, delivered_at: null }).execute();
    await this.backgroundBarrier.started;
    const identities = await Promise.all(Array.from({ length: count }, (_, index) => this.createIdentity(index)));
    const sessions = await Promise.all(identities.map((identity, index) => this.createSessionAs(identity, `Phase 3 concurrent query ${index}`)));
    const created = await Promise.all(identities.map(async (identity, index) => {
      const sessionId = sessions[index]!;
      const payload = { question: `陈平安并发问题 ${index}`, startChapter: 1, endChapter: 101 };
      const preview = await responseJson(await this.requestAs(identity, `/books/${this.bookId}/query-sessions/${sessionId}/turn-preview`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      }));
      const submittedAt = performance.now();
      const result = await responseJson(await this.requestAs(identity, `/books/${this.bookId}/query-sessions/${sessionId}/turns`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, scopeHash: preview.scopeHash }),
      }), 201);
      return { id: result.turn.id as string, identity, sessionId, submittedAt };
    }));
    const completedAt: number[] = [];
    await Promise.all(created.map(async ({ id, submittedAt }) => {
      await waitUntil(async () => {
        const row = await this.database.selectFrom("query_turns").select("status").where("id", "=", id).executeTakeFirst();
        const terminal = Boolean(row && ["completed", "degraded", "awaiting_fallback", "failed", "cancelled"].includes(row.status));
        if (terminal) completedAt.push(performance.now() - submittedAt);
        return terminal;
      }, `concurrent turn ${id}`);
    }));
    this.backgroundBarrier.release();
    const readSamples: number[] = [];
    for (const { id, identity, sessionId } of created) {
      for (const path of [
        `/books/${this.bookId}/query-sessions/${sessionId}`,
        `/books/${this.bookId}/query-sessions/${sessionId}/turns/${id}`,
      ]) {
        const readStarted = performance.now();
        const response = await this.requestAs(identity, path);
        await responseJson(response);
        readSamples.push(performance.now() - readStarted);
      }
    }
    const rows = await this.database.selectFrom("query_turns as t")
      .innerJoin("jobs as j", "j.id", "t.job_id")
      .select(["t.id", "t.created_by", "t.answer_ciphertext", "t.evidence_snapshot_hash", "j.requested_by"])
      .select((expression) => [
        expression.selectFrom("job_steps as s").innerJoin("job_attempts as a", "a.step_id", "s.id").select(({ fn }) => fn.countAll<number>().as("count")).where(sql<boolean>`s.output_ref ->> 'turnId' = t.id::text`).as("attempt_count"),
        expression.selectFrom("turn_evidence as e").select(({ fn }) => fn.countAll<number>().as("count")).whereRef("e.turn_id", "=", "t.id").as("evidence_count"),
      ]).where("t.id", "in", created.map((item) => item.id)).execute();
    const result = {
      completionP95Ms: percentile95(completedAt),
      readP95Ms: percentile95(readSamples),
      principalCount: new Set(rows.map((row) => row.created_by)).size,
      authorityMatches: rows.every((row) => {
        const expected = created.find((item) => item.id === row.id)?.identity.userId;
        return row.created_by === expected && row.requested_by === expected;
      }),
      turns: rows.map((row) => ({ id: row.id, answerCount: row.answer_ciphertext ? 1 : 0, evidenceSnapshotCount: row.evidence_snapshot_hash && Number(row.attempt_count) === 1 && Number(row.evidence_count) === 22 ? 1 : 0 })),
    };
    return result;
  }

  async runSentinelAudit(): Promise<{
    rawProviderErrorContainsEverySentinel: boolean;
    persistedLeaks: string[];
    publicLeaks: string[];
    applicationLogLeaks: string[];
    stableErrorCode: string | null;
  }> {
    const values = Object.values(SENTINELS);
    const rawErrorMarker = "PHASE3_RAW_PROVIDER_ERROR";
    const rawError = `${rawErrorMarker}:${values.join(":")}`;
    const forbidden = [...values, rawErrorMarker];
    const sessionId = await this.createSession(SENTINELS.sessionTitle);
    this.dify.failNextSummary(rawError);
    const capturedLogs: string[] = [];
    const originalConsole = { log: console.log, warn: console.warn, error: console.error };
    console.log = (...parts: unknown[]) => { capturedLogs.push(parts.map(String).join(" ")); };
    console.warn = (...parts: unknown[]) => { capturedLogs.push(parts.map(String).join(" ")); };
    console.error = (...parts: unknown[]) => { capturedLogs.push(parts.map(String).join(" ")); };
    let turn: Phase3Turn;
    try {
      turn = await this.ask(sessionId, `${SENTINELS.question} 陈平安`);
      await this.ask(sessionId, "陈平安成功回答");
    } finally {
      Object.assign(console, originalConsole);
    }
    const persisted = await sql<{ table_name: string; row_json: string }>`
      select table_name, row_json::text from (
        select 'jobs' table_name, row_to_json(t) row_json from jobs t
        union all select 'job_steps', row_to_json(t) from job_steps t
        union all select 'job_events', row_to_json(t) from job_events t
        union all select 'job_outbox', row_to_json(t) from job_outbox t
        union all select 'job_attempts', row_to_json(t) from job_attempts t
        union all select 'audit_logs', row_to_json(t) from audit_logs t
        union all select 'query_sessions', row_to_json(t) from query_sessions t
        union all select 'query_turns', row_to_json(t) from query_turns t
        union all select 'turn_evidence', row_to_json(t) from turn_evidence t
        union all select 'chapters', row_to_json(t) from chapters t
        union all select 'l2_facts', row_to_json(t) from l2_facts t
      ) rows
    `.execute(this.database);
    const persistedLeaks = persisted.rows.flatMap((row) => forbidden.filter((value) => row.row_json.includes(value)).map((value) => `${row.table_name}:${value}`));
    const publicBodies = await Promise.all([
      this.request(`/books/${this.bookId}/query-sessions`),
      this.request(`/books/${this.bookId}/query-sessions/${sessionId}`),
      this.request(`/books/${this.bookId}/query-sessions/${sessionId}/turns`),
      this.request(`/books/${this.bookId}/query-sessions/${sessionId}/turns/${turn.id}`),
      this.request(`/books/${this.bookId}/query-sessions/${sessionId}/turn-preview`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: "安全预览", startChapter: 1, endChapter: 101 }) }),
      this.request(`/books/${this.bookId}/query-sessions/${sessionId}/turns/${turn.id}/retry-summary`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }),
    ]).then((responses) => Promise.all(responses.map((response) => responseJson(response, response.status))));
    const publicErrorProjection = JSON.stringify(publicBodies);
    const failedTurn = publicBodies[3]!.turn;
    return {
      rawProviderErrorContainsEverySentinel: values.every((value) => this.dify.rawErrorMessage?.includes(value)),
      persistedLeaks,
      publicLeaks: [rawErrorMarker, SENTINELS.credential].filter((value) => publicErrorProjection.includes(value)),
      applicationLogLeaks: forbidden.filter((value) => capturedLogs.some((line) => line.includes(value))),
      stableErrorCode: typeof failedTurn.degradation === "string" ? failedTurn.degradation : null,
    };
  }

  async ask(sessionId: string, question: string): Promise<Phase3Turn> {
    const payload = { question, startChapter: 1, endChapter: 101 };
    const preview = await responseJson(await this.request(`/books/${this.bookId}/query-sessions/${sessionId}/turn-preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }));
    const created = await responseJson(await this.request(`/books/${this.bookId}/query-sessions/${sessionId}/turns`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, scopeHash: preview.scopeHash }),
    }), 201);
    const turnId = created.turn.id as string;
    return this.readTurn(sessionId, turnId);
  }

  failNextSummary(): void {
    this.dify.failNextSummary();
  }

  async askWithLateResult(sessionId: string, question: string): Promise<Phase3Turn> {
    await this.worker.stop();
    this.worker = createPhase3Worker(this.postgres, this.dify, this.backgroundBarrier, 200);
    await this.worker.start();
    const late = this.dify.delayNextSummary("PHASE3_LATE_PROVIDER_ANSWER");
    const payload = { question, startChapter: 1, endChapter: 101 };
    const preview = await responseJson(await this.request(`/books/${this.bookId}/query-sessions/${sessionId}/turn-preview`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    }));
    const created = await responseJson(await this.request(`/books/${this.bookId}/query-sessions/${sessionId}/turns`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, scopeHash: preview.scopeHash }),
    }), 201);
    const turnId = created.turn.id as string;
    await late.started;
    await waitUntil(async () => {
      const row = await this.database.selectFrom("query_turns").select("status").where("id", "=", turnId).executeTakeFirst();
      return row?.status === "completed";
    }, `recovered turn ${turnId}`);
    late.release();
    await waitUntil(async () => {
      const statuses = await this.attemptStatuses(turnId);
      return statuses.includes("abandoned") && statuses.includes("completed");
    }, `late attempt settlement for ${turnId}`);
    return this.readTurn(sessionId, turnId);
  }

  async restartRuntime(): Promise<void> {
    await this.worker.stop();
    await new Promise<void>((resolve, reject) => this.server.close((error) => error ? reject(error) : resolve()));
    this.worker = createPhase3Worker(this.postgres, this.dify, this.backgroundBarrier);
    await this.worker.start();
    const runtime = await startPhase3Api(this.postgres.db);
    this.server = runtime.server;
    this.origin = runtime.origin;
  }

  async fallback(sessionId: string, turnId: string, kind: "retry-summary" | "local-summary"): Promise<Phase3Turn> {
    const idempotencyKey = `phase3-${kind}-${turnId}`;
    const created = await responseJson(await this.request(`/books/${this.bookId}/query-sessions/${sessionId}/turns/${turnId}/${kind}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
      body: "{}",
    }), 201);
    await waitUntil(async () => {
      const row = await this.database.selectFrom("query_turns").select("status").where("id", "=", turnId).executeTakeFirst();
      return Boolean(row && ["completed", "degraded", "failed", "cancelled"].includes(row.status));
    }, `fallback for turn ${turnId}`);
    const replayed = await responseJson(await this.request(`/books/${this.bookId}/query-sessions/${sessionId}/turns/${turnId}/${kind}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
      body: "{}",
    }), 201);
    if (replayed.job.id !== created.job.id) throw new Error("Fallback replay created a second job");
    await this.worker.processJob(created.job.id as string);
    await this.worker.processJob(created.job.id as string);
    return this.readTurn(sessionId, turnId);
  }

  evidenceRowCount(turnId: string): Promise<number> {
    return this.database.selectFrom("turn_evidence").select("id").where("turn_id", "=", turnId).execute().then((rows) => rows.length);
  }

  async authoritativeResultCounts(turnId: string): Promise<{ attempts: number; evidence: number; answers: number }> {
    const result = await sql<{ attempts: string; evidence: string; answers: string }>`
      select
        (select count(*) from job_attempts a join job_steps s on s.id = a.step_id where s.output_ref ->> 'turnId' = ${turnId}) attempts,
        (select count(*) from turn_evidence where turn_id = ${turnId}) evidence,
        (select count(*) from query_turns where id = ${turnId} and answer_ciphertext is not null) answers
    `.execute(this.database);
    const row = result.rows[0]!;
    return { attempts: Number(row.attempts), evidence: Number(row.evidence), answers: Number(row.answers) };
  }

  async attemptStatuses(turnId: string): Promise<string[]> {
    const rows = await this.database.selectFrom("job_steps as s").innerJoin("job_attempts as a", "a.step_id", "s.id").select("a.status").where(sql<boolean>`s.output_ref ->> 'turnId' = ${turnId}`).orderBy("a.attempt_no").execute();
    return rows.map((row) => row.status);
  }

  private async readTurn(sessionId: string, turnId: string): Promise<Phase3Turn> {
    await waitUntil(async () => {
      const row = await this.database.selectFrom("query_turns").select("status").where("id", "=", turnId).executeTakeFirst();
      return Boolean(row && ["completed", "degraded", "awaiting_fallback", "failed", "cancelled"].includes(row.status));
    }, `turn ${turnId}`);
    const detail = (await responseJson(await this.request(`/books/${this.bookId}/query-sessions/${sessionId}/turns/${turnId}`))).turn;
    const evidenceHash = await this.database.selectFrom("query_turns").select("evidence_snapshot_hash").where("id", "=", turnId).executeTakeFirstOrThrow();
    const evidenceRecords = await this.database.selectFrom("turn_evidence").select("id").where("turn_id", "=", turnId).orderBy("rank").execute();
    return {
      id: detail.id,
      answer: detail.answer,
      status: detail.status,
      intent: detail.trace,
      evidenceVersion: `${detail.id}:${evidenceHash.evidence_snapshot_hash}`,
      evidence: detail.evidence,
      evidenceRecordIds: evidenceRecords.map((row) => row.id),
      sourceStats: detail.sourceStats,
      trace: detail.trace,
    };
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    this.backgroundBarrier.release();
    await this.worker.stop();
    await new Promise<void>((resolve, reject) => this.server.close((error) => error ? reject(error) : resolve()));
    await this.postgres.destroy();
  }

  private async createIdentity(index: number): Promise<{ userId: string; cookie: string; csrf: string }> {
    const user = await this.database.insertInto("users").values({ display_name: `Phase 3 member ${index}`, role: "member", status: "active" }).returning("id").executeTakeFirstOrThrow();
    const token = `phase3-member-token-${index}`;
    const csrf = `phase3-member-csrf-${index}`;
    await this.database.insertInto("sessions").values({ user_id: user.id, token_hash: createHash("sha256").update(token).digest("hex"), csrf_token_hash: createHash("sha256").update(csrf).digest("hex"), expires_at: new Date(Date.now() + 60_000), revoked_at: null }).execute();
    return { userId: user.id, cookie: `phase3_session=${token}`, csrf };
  }

  private requestAs(identity: { cookie: string; csrf: string }, path: string, init: RequestInit = {}): Promise<Response> {
    return fetch(`${this.origin}/api${path}`, { ...init, headers: { Cookie: identity.cookie, Origin: config.appOrigin, "X-CSRF-Token": identity.csrf, "Idempotency-Key": crypto.randomUUID(), ...init.headers } });
  }

  private async createSessionAs(identity: { cookie: string; csrf: string }, title: string): Promise<string> {
    const result = await responseJson(await this.requestAs(identity, `/books/${this.bookId}/query-sessions`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ groupId: this.groupId, title, visibility: "private", defaultStartChapter: 1, defaultEndChapter: 101 }),
    }), 201);
    return result.session.id as string;
  }
}

function percentile95(samples: number[]): number {
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? Number.POSITIVE_INFINITY;
}

export async function startPhase3Harness(): Promise<Phase3Harness> {
  const postgres = await createDisposablePostgres();
  try {
    const user = await postgres.db.insertInto("users").values({ display_name: "Phase 3 owner", role: "member", status: "active" }).returning("id").executeTakeFirstOrThrow();
    const token = "phase3-owner-token";
    const csrf = "phase3-owner-csrf";
    await postgres.db.insertInto("sessions").values({
      user_id: user.id,
      token_hash: createHash("sha256").update(token).digest("hex"),
      csrf_token_hash: createHash("sha256").update(csrf).digest("hex"),
      expires_at: new Date(Date.now() + 60_000),
      revoked_at: null,
    }).execute();

    const library = createLibraryRepository(postgres.db, cipher);
    const indexes = createIndexRepository(postgres.db, cipher);
    const book = await library.createBook({ title: "Phase 3 Book", createdBy: user.id });
    const l1PromptContent = "phase3 l1 prompt";
    const l1Prompt = await indexes.createPromptVersion({ target: "l1-index", version: "phase3-l1", content: l1PromptContent, contentHash: createHash("sha256").update(l1PromptContent).digest("hex") });
    const prompt = await indexes.createPromptVersion({ target: "l2-index", version: "phase3-l2", content: "phase3 prompt", contentHash: createHash("sha256").update("phase3 prompt").digest("hex") });
    const l1Workflow = await indexes.createWorkflowVersion({ target: "l1-index", contractVersion: "phase3-l1-v1", dslHash: "phase3-l1-dsl-v1" });
    const l2Workflow = await indexes.createWorkflowVersion({ target: "l2-index", contractVersion: "phase3-l2-v1", dslHash: "phase3-l2-dsl-v1" });
    const group = await indexes.createIndexGroup({ bookId: book.id, key: "base", name: "人物事实", categoryScope: "general", promptVersionId: prompt.id, configHash: "phase3-group-v1" });
    await indexes.createWorkflowVersion({ target: "analysis-summary", contractVersion: "phase3-summary-v1", dslHash: "phase3-summary-dsl-v1" });
    await indexes.registerSubject({ groupId: group.id, subjectKey: "chen-ping-an", displayName: "陈平安", aliases: ["平安"] });
    for (const chapterIndex of [1, 2, 3, 101]) {
      const chapter = await library.insertChapter({ bookId: book.id, chapterIndex, title: `第 ${chapterIndex} 章`, plaintext: `${SENTINELS.chapter}_${chapterIndex}`, contentHmac: `phase3-hmac-${chapterIndex}`, sourceVersion: "phase3-source" });
      const l1Signature = buildL1Signature({ sourceVersion: "phase3-source", chapterHmac: `phase3-hmac-${chapterIndex}`, promptHash: l1Prompt.content_hash, workflowDslHash: l1Workflow.dsl_hash, adapterContractVersion: l1Workflow.contract_version, schemaVersion: L1_ROUTE_SCHEMA_VERSION });
      await indexes.putL1Index({ chapterId: chapter.id, promptVersionId: l1Prompt.id, workflowVersionId: l1Workflow.id, inputSignature: l1Signature, status: "fresh", route: { route_schema_version: L1_ROUTE_SCHEMA_VERSION, route_entities: [], route_keywords: [], signals: [], category_scores: {} } });
      const l2Signature = buildL2Signature({ sourceVersion: "phase3-source", chapterHmac: `phase3-hmac-${chapterIndex}`, promptHash: prompt.content_hash, workflowDslHash: l2Workflow.dsl_hash, adapterContractVersion: l2Workflow.contract_version, schemaVersion: L2_FACT_SCHEMA_VERSION, admissionVersion: L2_ADMISSION_VERSION, indexGroupConfigHash: "phase3-group-v1", l1Signature });
      await indexes.putL2ChapterStatus({ groupId: group.id, chapterId: chapter.id, inputSignature: l2Signature, status: "fresh" });
      if (chapterIndex < 3) {
        for (let factIndex = 1; factIndex <= 11; factIndex += 1) {
          await indexes.addFact({ groupId: group.id, chapterId: chapter.id, subjectKey: "chen-ping-an", factType: "event", plaintext: `${SENTINELS.fact}_${chapterIndex}_${factIndex}`, metadata: { category: "event", scopeEligible: true } });
        }
      }
    }

    const dify = new Phase3DifyFake();
    const backgroundBarrier = new BackgroundBarrier(postgres.db);
    const worker = createPhase3Worker(postgres, dify, backgroundBarrier);
    await worker.start();
    const runtime = await startPhase3Api(postgres.db);
    return new Phase3Harness(postgres, runtime.server, worker, runtime.origin, `phase3_session=${token}`, csrf, dify, backgroundBarrier, { bookId: book.id, groupId: group.id, userId: user.id, summaryInputs: dify.summaryInputs });
  } catch (error) {
    await postgres.destroy();
    throw error;
  }
}

function createPhase3Worker(postgres: DisposablePostgres, dify: Phase3DifyFake, barrier: BackgroundBarrier, leaseDurationMs?: number): JobWorker {
  const queryExecutor = new QueryExecutor({ database: postgres.db, cipher, dify });
  return new JobWorker({ database: postgres.db, boss: createFastTestBoss(postgres.databaseUrl), workerId: `phase3-worker-${crypto.randomUUID()}`, ...(leaseDurationMs ? { leaseDurationMs } : {}), pollIntervalMs: 20, queryConcurrency: 10, barrier, executor: createWorkerStepExecutor({ database: postgres.db, queryExecutor }) });
}

function createFastTestBoss(databaseUrl: string): WorkerBoss {
  const boss = createBoss(databaseUrl);
  return new Proxy(boss, {
    get(target, property) {
      if (property === "work") {
        return (name: string, options: { localConcurrency: number }, handler: (jobs: Array<{ data: unknown }>) => Promise<unknown>) =>
          target.work(name, { ...options, pollingIntervalSeconds: 0.5 }, handler);
      }
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as unknown as WorkerBoss;
}

async function startPhase3Api(database: DatabaseConnection): Promise<{ server: Server; origin: string }> {
  const queryHmacKey = Buffer.concat([Buffer.from(SENTINELS.credential), Buffer.alloc(32)]).subarray(0, 32);
  const app = createApp({ database, config, feishu: new FakeFeishuOAuthAdapter(), contentCipher: cipher, queryHmacKey });
  const server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Phase 3 API address unavailable");
  return { server, origin: `http://127.0.0.1:${address.port}` };
}
