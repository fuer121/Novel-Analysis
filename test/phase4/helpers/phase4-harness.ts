import { createHash } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  AdvancedAnalysisExecutionSnapshotSchema,
  type AdvancedAnalysisExecutionSnapshot,
  type AnalysisMode,
} from "@novel-analysis/contracts";
import {
  createAnalysisRepository,
  createContentCipher,
  createIndexRepository,
  createLibraryRepository,
  type DatabaseConnection,
} from "@novel-analysis/database";
import {
  L1_ROUTE_SCHEMA_VERSION,
  L2_ADMISSION_VERSION,
  L2_FACT_SCHEMA_VERSION,
} from "@novel-analysis/jobs";
import { sql } from "kysely";
import {
  createDisposablePostgres,
  type DisposablePostgres,
} from "../../../packages/database/src/testing/postgres.js";
import { ANALYSIS_MODE_GOLDEN } from "../fixtures/analysis-mode-golden.js";

const CONTENT_KEY = Buffer.alloc(32, 41).toString("base64");
const HMAC_KEY = Buffer.alloc(32, 42).toString("base64");
export const PHASE4_RESULT_SENTINELS = {
  itemLabel: "PHASE4_RESULT_ITEM_LABEL_SENTINEL_9C4A",
  summary: "PHASE4_RESULT_SUMMARY_SENTINEL_7F3B",
} as const;
export const PHASE4_SUCCESS_RESULT = {
  items: [{ label: `${PHASE4_RESULT_SENTINELS.itemLabel} & <verified> "quoted"` }],
  summary: PHASE4_RESULT_SENTINELS.summary,
} as const;
const cipher = createContentCipher({
  activeKeyVersion: "phase4-test",
  keys: { "phase4-test": Buffer.from(CONTENT_KEY, "base64") },
});

type DifyCall = {
  authorization: string | undefined;
  inputs: Record<string, unknown>;
};

type V8Coverage = {
  result?: Array<{
    url: string;
    functions: Array<{
      functionName: string;
      ranges: Array<{ count: number }>;
    }>;
  }>;
};

interface ManagedChild {
  child: ChildProcess;
  logs: string[];
  stop(signal?: NodeJS.Signals): Promise<void>;
}

async function availablePort(): Promise<number> {
  const server = createNetServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not allocate a process port");
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

function startChild(entry: string, environment: NodeJS.ProcessEnv, logs: string[] = []): ManagedChild {
  const child = spawn(process.execPath, ["--import", "tsx", entry], {
    cwd: process.cwd(),
    env: { ...process.env, ...environment },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (chunk) => logs.push(String(chunk)));
  child.stderr?.on("data", (chunk) => logs.push(String(chunk)));

  return {
    child,
    logs,
    async stop(signal = "SIGTERM") {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
      child.kill(signal);
      let timeout: NodeJS.Timeout | undefined;
      try {
        await Promise.race([
          exited,
          new Promise<never>((_resolve, reject) => {
            timeout = setTimeout(() => reject(new Error(`Timed out stopping ${entry}`)), 10_000);
            timeout.unref();
          }),
        ]);
      } catch (error) {
        child.kill("SIGKILL");
        await exited;
        throw error;
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    },
  };
}

function readWorkerCoverage(directory: string): { decryptFrozenChapter: number } {
  let decryptFrozenChapter = 0;
  for (const filename of readdirSync(directory).filter((entry) => entry.endsWith(".json"))) {
    const coverage = JSON.parse(readFileSync(join(directory, filename), "utf8")) as V8Coverage;
    for (const script of coverage.result ?? []) {
      if (!script.url.endsWith("/apps/worker/src/analysis-executor.ts")) continue;
      for (const fn of script.functions) {
        if (fn.functionName === "decryptFrozenChapter") decryptFrozenChapter += fn.ranges[0]?.count ?? 0;
      }
    }
  }
  return { decryptFrozenChapter };
}

async function waitUntil(check: () => Promise<boolean>, label: string, children: ManagedChild[]): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const exited = children.find(({ child }) => child.exitCode !== null || child.signalCode !== null);
    if (exited) throw new Error(`Process exited before ${label}\n${exited.logs.join("")}`);
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${label}\n${children.flatMap(({ logs }) => logs).join("")}`);
}

async function startDifyFake(): Promise<{
  origin: string;
  server: Server;
  calls: DifyCall[];
  blockPart(position: number): { started: Promise<void>; release(): void };
  failNext(message: string, count: number): void;
  controlledErrors: string[];
}> {
  const calls: DifyCall[] = [];
  const controlledErrors: string[] = [];
  let failuresRemaining = 0;
  let failureMessage = "";
  let blocked: {
    position: number;
    started(): void;
    gate: Promise<void>;
    release(): void;
  } | undefined;
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    request.on("end", async () => {
      try {
        const payload = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { inputs?: Record<string, unknown> };
        const inputs = payload.inputs ?? {};
        calls.push({ authorization: request.headers.authorization, inputs });
        const context = JSON.parse(String(inputs.context_json ?? "{}")) as { stage?: string; position?: number; batchIndex?: number };
        if (context.stage === "part" && blocked && context.position === blocked.position) {
          const current = blocked;
          blocked = undefined;
          current.started();
          await current.gate;
        }
        if (failuresRemaining > 0) {
          failuresRemaining -= 1;
          controlledErrors.push(failureMessage);
          response.writeHead(500, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ error: failureMessage }));
          return;
        }
        const result = context.stage === "final"
          ? JSON.stringify(PHASE4_SUCCESS_RESULT)
          : `phase4-${context.stage ?? "unknown"}-${context.position ?? context.batchIndex ?? calls.length}`;
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ data: { outputs: { result } } }));
      } catch {
        response.writeHead(400, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: "invalid_fake_request" }));
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Dify fake address unavailable");
  return {
    origin: `http://127.0.0.1:${address.port}`,
    server,
    calls,
    controlledErrors,
    blockPart(position: number) {
      if (blocked) throw new Error("A Dify part gate is already active");
      let signalStarted!: () => void;
      let release!: () => void;
      const started = new Promise<void>((resolve) => { signalStarted = resolve; });
      const gate = new Promise<void>((resolve) => { release = resolve; });
      blocked = { position, started: signalStarted, gate, release };
      return { started, release };
    },
    failNext(message: string, count: number) {
      if (!Number.isSafeInteger(count) || count < 1) throw new Error("Provider failure count must be positive");
      failureMessage = message;
      failuresRemaining = count;
    },
  };
}

function closeServer(server: Server): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  });
}

export interface Phase4ProcessHarness {
  readonly database: DatabaseConnection;
  readonly databaseUrl: string;
  readonly api: { origin: string; child: ChildProcess; logs: string[] };
  readonly worker: { child: ChildProcess; logs: string[] };
  prepareGoldenFixtures(): Promise<Phase4GoldenFixture>;
  captureWorkerCoverage(): Promise<{ decryptFrozenChapter: number }>;
  killWorker(): Promise<void>;
  restartWorker(): Promise<void>;
  stop(): Promise<void>;
}

export type Phase4Actor = "owner" | "member" | "admin";

export interface Phase4GoldenFixture {
  readonly bookId: string;
  readonly groupId: string;
  requestAs(actor: Phase4Actor, path: string, init?: RequestInit): Promise<Response>;
  waitForRun(runId: string): Promise<Record<string, unknown>>;
  difyCallsSince(index: number): DifyCall[];
  difyCallCount(): number;
  executionSnapshot(runId: string): Promise<AdvancedAnalysisExecutionSnapshot>;
  expectedExecutionSnapshot(input: {
    mode: AnalysisMode;
    scopeHash: string;
    template: AdvancedAnalysisExecutionSnapshot["template"];
  }): AdvancedAnalysisExecutionSnapshot;
  blockPart(position: number): { started: Promise<void>; release(): void };
  actorId(actor: Phase4Actor): string;
  legacyRequestAs(actor: Phase4Actor, path: string, init?: RequestInit): Promise<Response>;
  failNextProvider(message: string, count?: number): void;
  controlledProviderErrors(): string[];
}

export async function startPhase4ProcessHarness(): Promise<Phase4ProcessHarness> {
  const postgres = await createDisposablePostgres();
  const children: ManagedChild[] = [];
  let dify: Awaited<ReturnType<typeof startDifyFake>> | undefined;
  try {
    dify = await startDifyFake();
    const apiPort = await availablePort();
    const sharedEnvironment = {
      DATABASE_URL: postgres.databaseUrl,
      CONTENT_ENCRYPTION_KEY: CONTENT_KEY,
      CONTENT_ENCRYPTION_KEY_VERSION: "phase4-test",
      CONTENT_HMAC_KEY: HMAC_KEY,
      ADVANCED_ANALYSIS_MODEL: "phase4-model",
      ADVANCED_ANALYSIS_REASONING_EFFORT: "medium",
      ADVANCED_ANALYSIS_EXECUTOR_VERSION: "phase4-executor-v1",
    };
    const apiLogs: string[] = [];
    const api = startChild("apps/api/src/main.ts", {
      ...sharedEnvironment,
      PORT: String(apiPort),
      APP_ORIGIN: "https://phase4.test",
      FEISHU_REDIRECT_URI: "https://phase4.test/api/auth/callback",
      FEISHU_APP_ID: "phase4-app",
      FEISHU_APP_SECRET: "phase4-feishu-secret",
    }, apiLogs);
    children.push(api);
    const workerEnvironment = {
      ...sharedEnvironment,
      NODE_V8_COVERAGE: mkdtempSync(join(tmpdir(), "phase4-task7-worker-coverage-")),
      DIFY_BASE_URL: dify.origin,
      DIFY_CHAPTER_IMPORT_KEY: "phase4-chapter-key",
      DIFY_L1_WORKFLOW_API_KEY: "phase4-l1-key",
      DIFY_L2_WORKFLOW_API_KEY: "phase4-l2-key",
      DIFY_ANALYSIS_SUMMARY_KEY: "phase4-summary-key",
      QUERY_CONCURRENCY: "2",
    };
    const workerLogs: string[] = [];
    let worker = startChild("apps/worker/src/main.ts", workerEnvironment, workerLogs);
    children.push(worker);
    const origin = `http://127.0.0.1:${apiPort}`;
    await waitUntil(async () => {
      try {
        return (await fetch(`${origin}/api/auth/me`)).status === 401;
      } catch {
        return false;
      }
    }, "API readiness", children);
    await waitUntil(async () => {
      try {
        const queues = await sql<{ name: string }>`select name from pgboss.queue where name = 'jobs.wake'`.execute(postgres.db);
        return queues.rows.length === 1;
      } catch {
        return false;
      }
    }, "Worker readiness", children);

    let stopped = false;
    let legacyApi: ManagedChild | undefined;
    return {
      database: postgres.db,
      databaseUrl: postgres.databaseUrl,
      api: { origin, child: api.child, logs: api.logs },
      worker: { child: worker.child, logs: worker.logs },
      async prepareGoldenFixtures() {
        const identities = {} as Record<Phase4Actor, { id: string; cookie: string; csrf: string }>;
        for (const [name, role] of [["owner", "member"], ["member", "member"], ["admin", "admin"]] as const) {
          const user = await postgres.db.insertInto("users").values({
            display_name: `Phase 4 ${name}`,
            role,
            status: "active",
          }).returning("id").executeTakeFirstOrThrow();
          const token = `phase4-${name}-token`;
          const csrf = `phase4-${name}-csrf`;
          await postgres.db.insertInto("sessions").values({
            user_id: user.id,
            token_hash: createHash("sha256").update(token).digest("hex"),
            csrf_token_hash: createHash("sha256").update(csrf).digest("hex"),
            expires_at: new Date(Date.now() + 5 * 60_000),
            revoked_at: null,
          }).execute();
          identities[name] = { id: user.id, cookie: `__Host-novel_session=${token}`, csrf };
        }

        const library = createLibraryRepository(postgres.db, cipher);
        const indexes = createIndexRepository(postgres.db, cipher);
        const book = await library.createBook({ title: "Phase 4 Golden Book", createdBy: identities.owner.id });
        const l1PromptContent = "phase4 l1 prompt";
        const l2PromptContent = "phase4 l2 prompt";
        const l1Prompt = await indexes.createPromptVersion({
          target: "l1-index",
          version: "phase4-l1-v1",
          content: l1PromptContent,
          contentHash: createHash("sha256").update(l1PromptContent).digest("hex"),
        });
        const l2Prompt = await indexes.createPromptVersion({
          target: "l2-index",
          version: "phase4-l2-v1",
          content: l2PromptContent,
          contentHash: createHash("sha256").update(l2PromptContent).digest("hex"),
        });
        const l1Workflow = await indexes.createWorkflowVersion({ target: "l1-index", contractVersion: "phase4-l1-v1", dslHash: "phase4-l1-dsl" });
        const summaryWorkflow = await indexes.createWorkflowVersion({ target: "analysis-summary", contractVersion: "phase4-summary-v1", dslHash: "phase4-summary-dsl" });
        const group = await indexes.createIndexGroup({
          bookId: book.id,
          key: "general",
          name: "Phase 4 General",
          categoryScope: "general",
          promptVersionId: l2Prompt.id,
          configHash: "phase4-group-v1",
        });
        await indexes.registerSubject({
          groupId: group.id,
          subjectKey: "phase4-subject",
          displayName: "Phase 4 Subject",
          aliases: [],
        });
        const risk = new Map([
          [7, { importance: 1, confidence: 0 }],
          [19, { importance: 0.95, confidence: 0.1 }],
          [31, { importance: 0.9, confidence: 0.2 }],
          [43, { importance: 0.85, confidence: 0.3 }],
          [55, { importance: 0.8, confidence: 0.4 }],
          [67, { importance: 0.7, confidence: 0.5 }],
        ]);
        const frozenChapters: AdvancedAnalysisExecutionSnapshot["chapters"] = [];
        for (let position = 1; position <= 100; position += 1) {
          const chapter = await library.insertChapter({
            bookId: book.id,
            chapterIndex: position,
            title: `Chapter ${position}`,
            plaintext: `PHASE4_CHAPTER_PLAINTEXT_${position}`,
            contentHmac: `phase4-hmac-${position}`,
            sourceVersion: "phase4-source-v1",
          });
          const route = {
            route_schema_version: L1_ROUTE_SCHEMA_VERSION,
            route_entities: [],
            route_keywords: [`chapter-${position}`],
            signals: [],
            category_scores: {},
          };
          const l1 = await indexes.putL1Index({
            chapterId: chapter.id,
            promptVersionId: l1Prompt.id,
            workflowVersionId: l1Workflow.id,
            inputSignature: `phase4-l1-${position}`,
            status: "fresh",
            route,
          });
          await indexes.putL2ChapterStatus({ groupId: group.id, chapterId: chapter.id, inputSignature: `phase4-l2-${position}`, status: "fresh" });
          const metadata = risk.get(position) ?? { importance: 0.1, confidence: 0.9 };
          const fact = await indexes.addFact({
            groupId: group.id,
            chapterId: chapter.id,
            subjectKey: "phase4-subject",
            factType: "event",
            plaintext: `PHASE4_FACT_PLAINTEXT_${position}`,
            metadata,
          });
          frozenChapters.push({
            id: chapter.id,
            position,
            contentHmac: `phase4-hmac-${position}`,
            sourceVersion: "phase4-source-v1",
            l1: {
              id: l1.id,
              promptVersionId: l1Prompt.id,
              workflowVersionId: l1Workflow.id,
              inputSignature: `phase4-l1-${position}`,
              status: "fresh",
              route,
            },
            l2: {
              inputSignature: `phase4-l2-${position}`,
              status: "fresh",
              facts: [{
                id: fact.id,
                subjectKey: "phase4-subject",
                factType: "event",
                payload: `PHASE4_FACT_PLAINTEXT_${position}`,
                metadata,
              }],
            },
          });
        }

        const requestAs = (actor: Phase4Actor, path: string, init: RequestInit = {}) => fetch(`${origin}/api${path}`, {
          ...init,
          headers: {
            Cookie: identities[actor].cookie,
            Origin: "https://phase4.test",
            "X-CSRF-Token": identities[actor].csrf,
            "Idempotency-Key": crypto.randomUUID(),
            ...init.headers,
          },
        });
        return {
          bookId: book.id,
          groupId: group.id,
          requestAs,
          async waitForRun(runId: string) {
            const deadline = Date.now() + 30_000;
            while (Date.now() < deadline) {
              const response = await requestAs("owner", `/books/${book.id}/advanced-analysis/${runId}`);
              if (response.status !== 200) throw new Error(`Run detail returned ${response.status}`);
              const detail = (await response.json() as { run: Record<string, unknown> }).run;
              if (["completed", "failed", "cancelled"].includes(String(detail.status))) return detail;
              await new Promise((resolve) => setTimeout(resolve, 25));
            }
            throw new Error(`Timed out waiting for analysis run ${runId}`);
          },
          difyCallsSince(index: number) { return dify!.calls.slice(index); },
          difyCallCount() { return dify!.calls.length; },
          async executionSnapshot(runId: string) {
            const snapshot = await createAnalysisRepository(postgres.db, cipher).getRunExecutionSnapshot({
              runId,
              actor: { id: identities.owner.id, role: "member" },
              schema: AdvancedAnalysisExecutionSnapshotSchema,
            });
            if (!snapshot) throw new Error(`Missing execution snapshot for ${runId}`);
            return snapshot;
          },
          expectedExecutionSnapshot(input) {
            const expected = ANALYSIS_MODE_GOLDEN[input.mode];
            const usesIndexes = input.mode !== "full_text";
            return AdvancedAnalysisExecutionSnapshotSchema.parse({
              bookId: book.id,
              scopeHash: input.scopeHash,
              template: input.template,
              mode: input.mode,
              range: { startChapter: 1, endChapter: 100 },
              indexGroup: {
                id: group.id,
                key: "general",
                name: "Phase 4 General",
                categoryScope: "general",
                configHash: "phase4-group-v1",
                promptVersionId: l2Prompt.id,
              },
              executionVersions: {
                workflow: {
                  target: "analysis-summary",
                  id: summaryWorkflow.id,
                  contractVersion: "phase4-summary-v1",
                  dslHash: "phase4-summary-dsl",
                },
                model: "phase4-model",
                reasoningEffort: "medium",
                executorVersion: "phase4-executor-v1",
                l1SchemaVersion: L1_ROUTE_SCHEMA_VERSION,
                l2SchemaVersion: L2_FACT_SCHEMA_VERSION,
                l2AdmissionVersion: L2_ADMISSION_VERSION,
              },
              sourcePolicy: {
                indexGroupId: group.id,
                indexGroupConfigHash: "phase4-group-v1",
                chapterSourceVersions: ["phase4-source-v1"],
                l1: { selectedCount: expected.l1, freshCount: expected.l1 },
                l2: { selectedCount: expected.l2, freshCount: expected.l2 },
                readsL1: usesIndexes,
                readsL2: usesIndexes,
                readsOriginalChapters: input.mode !== "fast_index",
                reviewedChapterBoundary: expected.reviewedPositions.length === 0 ? null : {
                  startChapter: 1,
                  endChapter: 100,
                  maximumChapterCount: expected.reviewedPositions.length,
                },
              },
              chapters: frozenChapters.map((chapter) => ({
                ...chapter,
                l2: input.mode === "full_text" && chapter.l2 ? { ...chapter.l2, facts: [] } : chapter.l2,
              })),
            });
          },
          blockPart(position: number) {
            return dify!.blockPart(position);
          },
          actorId(actor: Phase4Actor) {
            return identities[actor].id;
          },
          async legacyRequestAs(actor: Phase4Actor, path: string, init: RequestInit = {}) {
            if (!legacyApi) {
              const port = await availablePort();
              legacyApi = startChild("test/phase4/helpers/phase4-legacy-api-main.ts", {
                DATABASE_URL: postgres.databaseUrl,
                PORT: String(port),
                PHASE4_OWNER_ID: identities.owner.id,
                PHASE4_BOOK_ID: book.id,
              }, apiLogs);
              children.push(legacyApi);
              const legacyOrigin = `http://127.0.0.1:${port}`;
              await waitUntil(async () => {
                try { return (await fetch(`${legacyOrigin}/api/auth/me`)).status === 401; } catch { return false; }
              }, "legacy fixture API readiness", [legacyApi]);
              Object.assign(legacyApi, { origin: legacyOrigin });
            }
            const legacyOrigin = (legacyApi as ManagedChild & { origin: string }).origin;
            return fetch(`${legacyOrigin}/api${path}`, {
              ...init,
              headers: {
                Cookie: identities[actor].cookie,
                Origin: "https://phase4.test",
                "X-CSRF-Token": identities[actor].csrf,
                "Idempotency-Key": crypto.randomUUID(),
                ...init.headers,
              },
            });
          },
          failNextProvider(message: string, count = 3) {
            dify!.failNext(message, count);
          },
          controlledProviderErrors() {
            return [...dify!.controlledErrors];
          },
        };
      },
      async captureWorkerCoverage() {
        await worker.stop();
        return readWorkerCoverage(workerEnvironment.NODE_V8_COVERAGE);
      },
      async killWorker() {
        await worker.stop("SIGKILL");
      },
      async restartWorker() {
        if (worker.child.exitCode === null && worker.child.signalCode === null) throw new Error("Phase 4 Worker is already running");
        worker = startChild("apps/worker/src/main.ts", workerEnvironment, workerLogs);
        children.push(worker);
        await new Promise((resolve) => setTimeout(resolve, 100));
        if (worker.child.exitCode !== null || worker.child.signalCode !== null) {
          throw new Error(`Restarted Worker exited early\n${worker.logs.join("")}`);
        }
      },
      async stop() {
        if (stopped) return;
        stopped = true;
        const settled = await Promise.allSettled([
          ...children.map((child) => child.stop()),
          closeServer(dify!.server),
        ]);
        await postgres.destroy();
        const errors = settled.flatMap((result) => result.status === "rejected" ? [result.reason] : []);
        if (errors.length === 1) throw errors[0];
        if (errors.length > 1) throw new AggregateError(errors, "Phase 4 harness cleanup failed");
      },
    };
  } catch (error) {
    const cleanup = await Promise.allSettled([
      ...children.reverse().map((child) => child.stop()),
      ...(dify ? [closeServer(dify.server)] : []),
      postgres.destroy(),
    ]);
    const failures = cleanup.flatMap((result) => result.status === "rejected" ? [result.reason] : []);
    if (failures.length > 0) throw new AggregateError([error, ...failures], "Phase 4 harness startup failed", { cause: error });
    throw error;
  }
}
