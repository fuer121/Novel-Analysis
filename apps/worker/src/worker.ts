import { sql } from "kysely";

import type { DatabaseConnection } from "@novel-analysis/database";
import {
  ExampleExecutor,
  OutboxDispatcher,
  PostgresStepLeaseService,
  type BossSender,
  type ExecutionBarrier,
  type StepExecutor,
} from "@novel-analysis/jobs";
import { failImportClaim, type LibraryImportExecutor } from "./library-executor.js";

const WAKE_QUEUE = "jobs.wake";
const DEFAULT_POLL_INTERVAL_MS = 1_000;

type WakePayload = { jobId: string };

export interface WorkerBoss extends BossSender {
  start(): Promise<unknown>;
  stop(options?: { graceful?: boolean; timeout?: number }): Promise<void>;
  createQueue(name: string, options: { policy: "exclusive" }): Promise<void>;
  work<T>(name: string, handler: (jobs: Array<{ data: T }>) => Promise<unknown>): Promise<string>;
  offWork(name: string, options?: { wait?: boolean }): Promise<void>;
}

export async function createWakeQueue(boss: Pick<WorkerBoss, "createQueue">): Promise<void> {
  await boss.createQueue(WAKE_QUEUE, { policy: "exclusive" });
}

export function installBossErrorShutdown(options: {
  boss: { on(event: "error", listener: (error: Error) => void): unknown };
  shutdown(): Promise<void>;
  report(message: string, error: unknown): void;
}): void {
  let shutdownPromise: Promise<void> | undefined;
  options.boss.on("error", (error) => {
    options.report("pg-boss error", error);
    process.exitCode = 1;
    if (!shutdownPromise) {
      shutdownPromise = options.shutdown();
      void shutdownPromise.catch((shutdownError: unknown) => {
        options.report("Worker shutdown failed", shutdownError);
      });
    }
  });
}

export function createCoordinatedShutdown(options: {
  stopWorker(): Promise<void>;
  destroyDatabase(): Promise<void>;
}): () => Promise<void> {
  let shutdownPromise: Promise<void> | undefined;
  return () => {
    shutdownPromise ??= (async () => {
      const errors: unknown[] = [];
      try {
        await options.stopWorker();
      } catch (error) {
        errors.push(error);
      }
      try {
        await options.destroyDatabase();
      } catch (error) {
        errors.push(error);
      }
      throwCollected(errors, "Worker and database shutdown failed");
    })();
    return shutdownPromise;
  };
}

const NOOP_BARRIER: ExecutionBarrier = {
  async afterAttemptStarted() {},
};

const LIBRARY_CONFIG_FIELDS = ["DIFY_BASE_URL", "DIFY_CHAPTER_IMPORT_KEY", "DIFY_L1_WORKFLOW_API_KEY", "DIFY_L2_WORKFLOW_API_KEY", "CONTENT_ENCRYPTION_KEY", "CONTENT_ENCRYPTION_KEY_VERSION", "CONTENT_HMAC_KEY"] as const;

export type LibraryRuntimeConfig = { baseUrl: string; chapterImportKey: string; l1WorkflowKey: string; l2WorkflowKey: string; contentKey: Buffer; contentKeyVersion: string; hmacKey: Buffer };

function decodeBase64(value: string): Buffer | null {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) return null;
  const decoded = Buffer.from(value, "base64");
  return decoded.toString("base64") === value ? decoded : null;
}

export function parseLibraryRuntimeConfig(environment: Record<string, string | undefined>): LibraryRuntimeConfig | undefined {
  const present = LIBRARY_CONFIG_FIELDS.filter((field) => environment[field] !== undefined);
  if (present.length === 0) return undefined;
  const missing = LIBRARY_CONFIG_FIELDS.filter((field) => environment[field] === undefined);
  if (missing.length > 0) throw new Error(`Invalid library runtime configuration fields: ${missing.join(",")}`);
  const invalid: string[] = [];
  let url: URL | undefined;
  try { url = new URL(environment.DIFY_BASE_URL!); } catch { invalid.push("DIFY_BASE_URL"); }
  if (url && !["http:", "https:"].includes(url.protocol)) invalid.push("DIFY_BASE_URL");
  if (!environment.DIFY_CHAPTER_IMPORT_KEY!.trim()) invalid.push("DIFY_CHAPTER_IMPORT_KEY");
  if (!environment.DIFY_L1_WORKFLOW_API_KEY!.trim()) invalid.push("DIFY_L1_WORKFLOW_API_KEY");
  if (!environment.DIFY_L2_WORKFLOW_API_KEY!.trim()) invalid.push("DIFY_L2_WORKFLOW_API_KEY");
  if (!environment.CONTENT_ENCRYPTION_KEY_VERSION!.trim()) invalid.push("CONTENT_ENCRYPTION_KEY_VERSION");
  const contentKey = decodeBase64(environment.CONTENT_ENCRYPTION_KEY!);
  if (contentKey?.length !== 32) invalid.push("CONTENT_ENCRYPTION_KEY");
  const hmacKey = decodeBase64(environment.CONTENT_HMAC_KEY!);
  if (!hmacKey?.length) invalid.push("CONTENT_HMAC_KEY");
  if (invalid.length > 0) throw new Error(`Invalid library runtime configuration fields: ${[...new Set(invalid)].join(",")}`);
  return { baseUrl: url!.toString().replace(/\/$/, ""), chapterImportKey: environment.DIFY_CHAPTER_IMPORT_KEY!, l1WorkflowKey: environment.DIFY_L1_WORKFLOW_API_KEY!, l2WorkflowKey: environment.DIFY_L2_WORKFLOW_API_KEY!, contentKey: contentKey!, contentKeyVersion: environment.CONTENT_ENCRYPTION_KEY_VERSION!, hmacKey: hmacKey! };
}

export function createWorkerStepExecutor(options: { database: DatabaseConnection; libraryExecutor?: LibraryImportExecutor }): StepExecutor {
  const example = new ExampleExecutor();
  return {
    execute(claim) {
      if (claim.kind === "chapter-import" || claim.kind === "l1-index" || claim.kind === "l2-index") {
        return options.libraryExecutor
          ? options.libraryExecutor.execute(claim)
          : failImportClaim(options.database, claim, "configuration_error");
      }
      return example.execute(claim);
    },
  };
}

function throwCollected(errors: unknown[], message: string): void {
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, message);
}

export class JobWorker {
  private readonly leases: PostgresStepLeaseService;
  private readonly executor: StepExecutor;
  private readonly barrier: ExecutionBarrier;
  private acceptingClaims = true;
  private dispatcherTimer: NodeJS.Timeout | undefined;
  private recoveryTimer: NodeJS.Timeout | undefined;
  private readonly active = new Set<Promise<void>>();
  private startPromise: Promise<void> | undefined;
  private stopPromise: Promise<void> | undefined;
  private shutdownRequested = false;
  private bossStarted = false;
  private consumerRegistered = false;

  constructor(private readonly options: {
    database: DatabaseConnection;
    workerId: string;
    boss?: WorkerBoss;
    barrier?: ExecutionBarrier;
    executor?: StepExecutor;
    leaseDurationMs?: number;
    pollIntervalMs?: number;
    onBackgroundError?: (error: unknown) => void;
  }) {
    this.leases = new PostgresStepLeaseService({
      database: options.database,
      leaseDurationMs: options.leaseDurationMs,
    });
    this.executor = options.executor ?? new ExampleExecutor();
    this.barrier = options.barrier ?? NOOP_BARRIER;
  }

  start(): Promise<void> {
    if (this.shutdownRequested) {
      return Promise.reject(new Error("JobWorker cannot start after shutdown"));
    }
    this.startPromise ??= this.startOnce();
    return this.startPromise;
  }

  private async startOnce(): Promise<void> {
    const boss = this.options.boss;
    if (!boss) throw new Error("JobWorker.start requires pg-boss");
    this.acceptingClaims = true;
    this.bossStarted = true;
    try {
      await boss.start();
      await createWakeQueue(boss);
      await boss.work<WakePayload>(WAKE_QUEUE, async (jobs) => {
        await Promise.all(jobs.map((job) => this.track(this.processJob(job.data.jobId))));
      });
      this.consumerRegistered = true;
    } catch (startupError) {
      this.stopAtBoundary();
      const errors = [startupError];
      try {
        await boss.stop({ graceful: true, timeout: 30_000 });
      } catch (cleanupError) {
        errors.push(cleanupError);
      } finally {
        this.bossStarted = false;
      }
      throwCollected(errors, "Worker startup and rollback failed");
      return;
    }
    if (this.shutdownRequested) return;

    const dispatcher = new OutboxDispatcher({
      database: this.options.database,
      boss,
      dispatcherId: this.options.workerId,
    });
    const pollIntervalMs = this.options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    const dispatch = () => {
      if (!this.acceptingClaims) return;
      this.runBackground(dispatcher.dispatchNext().then(() => undefined));
    };
    const recover = () => {
      if (!this.acceptingClaims) return;
      this.runBackground(this.recoverExpiredLeases());
    };
    dispatch();
    recover();
    this.dispatcherTimer = setInterval(dispatch, pollIntervalMs);
    this.recoveryTimer = setInterval(recover, pollIntervalMs);
  }

  stopAtBoundary(): void {
    this.shutdownRequested = true;
    this.acceptingClaims = false;
    if (this.dispatcherTimer) {
      clearInterval(this.dispatcherTimer);
      this.dispatcherTimer = undefined;
    }
    if (this.recoveryTimer) {
      clearInterval(this.recoveryTimer);
      this.recoveryTimer = undefined;
    }
  }

  stop(): Promise<void> {
    this.stopAtBoundary();
    this.stopPromise ??= this.stopOnce();
    return this.stopPromise;
  }

  private async stopOnce(): Promise<void> {
    const errors: unknown[] = [];
    if (this.startPromise) {
      await this.startPromise.catch(() => undefined);
    }
    if (this.options.boss && this.consumerRegistered) {
      try {
        await this.options.boss.offWork(WAKE_QUEUE, { wait: true });
        this.consumerRegistered = false;
      } catch (error) {
        errors.push(error);
      }
    }
    const activeResults = await Promise.allSettled([...this.active]);
    for (const result of activeResults) {
      if (result.status === "rejected") errors.push(result.reason);
    }
    if (this.options.boss && this.bossStarted) {
      try {
        await this.options.boss.stop({ graceful: true, timeout: 30_000 });
        this.bossStarted = false;
      } catch (error) {
        errors.push(error);
      }
    }
    throwCollected(errors, "Worker shutdown failed");
  }

  async processJob(jobId: string): Promise<void> {
    while (this.acceptingClaims) {
      const claim = await this.leases.claimNext(jobId, this.options.workerId, new Date());
      if (!claim) return;
      await this.barrier.afterAttemptStarted({
        jobId: claim.jobId,
        stepId: claim.stepId,
        attemptId: claim.attemptId,
        attemptNo: claim.attemptNo,
      });
      const output = await this.executor.execute(claim);
      if (claim.kind === "chapter-import" && output && typeof output === "object" && "disposition" in output) {
        const disposition = (output as { disposition?: string }).disposition;
        if (disposition !== "completed") return;
        continue;
      }
      const result = await this.leases.completeStep(claim, output);
      if (result.disposition !== "completed") return;
    }
  }

  private async recoverExpiredLeases(): Promise<void> {
    const rows = await this.options.database.selectFrom("job_steps")
      .select("job_id")
      .distinct()
      .where("status", "=", "running")
      .where("lease_expires_at", "<=", sql<Date>`now()`)
      .execute();
    await Promise.all(rows.map((row) => this.processJob(row.job_id)));
  }

  private track(promise: Promise<void>): Promise<void> {
    this.active.add(promise);
    void promise.then(
      () => this.active.delete(promise),
      () => this.active.delete(promise),
    );
    return promise;
  }

  private runBackground(promise: Promise<void>): void {
    void this.track(promise).catch((error: unknown) => {
      try {
        if (this.options.onBackgroundError) this.options.onBackgroundError(error);
        else console.error("Worker background operation failed", error);
      } catch (reportError) {
        console.error("Worker background error reporter failed", reportError);
      }
    });
  }
}
