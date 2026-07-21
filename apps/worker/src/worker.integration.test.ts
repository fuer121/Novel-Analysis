import {
  execFile,
  spawn,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import { EventEmitter } from "node:events";

import { sql } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createDisposablePostgres,
  type DisposablePostgres,
} from "../../../packages/database/src/testing/postgres.js";
import { JobRepository } from "../../../packages/jobs/src/job-repository.js";
import { createBoss } from "../../../packages/jobs/src/boss.js";

import {
  JobWorker,
  createCoordinatedShutdown,
  createWakeQueue,
  installBossErrorShutdown,
  type WorkerBoss,
} from "./worker.js";

function fakeBoss(overrides: Partial<WorkerBoss> = {}): WorkerBoss {
  return {
    async start() {},
    async stop() {},
    async createQueue() {},
    async work() { return "work-id"; },
    async offWork() {},
    async send() { return "queue-id"; },
    ...overrides,
  };
}

async function waitForProductionStart(
  child: ChildProcessWithoutNullStreams,
  postgres: DisposablePostgres,
): Promise<void> {
  const deadline = Date.now() + 10_000;
  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`Worker exited before startup: ${stderr}`);
    }
    try {
      const result = await sql<{ policy: string }>`
        select policy from pgboss.queue where name = 'jobs.wake'
      `.execute(postgres.db);
      if (result.rows[0]?.policy === "exclusive") return;
    } catch (error) {
      if ((error as { code?: string }).code !== "42P01") throw error;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for Worker startup: ${stderr}`);
}

function waitForExit(child: ChildProcessWithoutNullStreams): Promise<{
  code: number | null;
  signal: NodeJS.Signals | null;
}> {
  return new Promise((resolve) => {
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
}

function killProcess(pid: number | undefined, signal: NodeJS.Signals): void {
  if (pid === undefined) return;
  try {
    process.kill(pid, signal);
  } catch (error) {
    if ((error as { code?: string }).code !== "ESRCH") throw error;
  }
}

async function awaitCleanup(
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>,
): Promise<void> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      exited,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("Timed out cleaning up Worker subprocess")), 2_000);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function findWorkerProcess(rootPid: number): Promise<number> {
  const output = await new Promise<string>((resolve, reject) => {
    execFile("ps", ["-axo", "pid=,ppid=,command="], (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
  const processes = new Map<number, { parent: number; command: string }>();
  for (const line of output.split("\n")) {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/);
    if (!match) continue;
    processes.set(Number(match[1]), { parent: Number(match[2]), command: match[3]! });
  }
  const candidates: Array<{ pid: number; depth: number }> = [];
  for (const [pid, processInfo] of processes) {
    if (!processInfo.command.includes("src/main.ts")) continue;
    let current = pid;
    let depth = 0;
    while (current !== rootPid && processes.has(current)) {
      current = processes.get(current)!.parent;
      depth += 1;
    }
    if (current === rootPid) candidates.push({ pid, depth });
  }
  candidates.sort((left, right) => right.depth - left.depth);
  if (!candidates[0]) throw new Error("Could not find the Worker entry process");
  return candidates[0].pid;
}

describe("worker runtime", () => {
  let postgres: DisposablePostgres;

  beforeEach(async () => {
    postgres = await createDisposablePostgres();
  });

  afterEach(async () => {
    await postgres.destroy();
  });

  it("starts the declared production entrypoint and shuts down on SIGTERM", async () => {
    const child = spawn("npm", ["start", "-w", "apps/worker"], {
      cwd: process.cwd(),
      detached: true,
      env: { ...process.env, DATABASE_URL: postgres.databaseUrl },
    });
    const exited = waitForExit(child);
    let workerPid: number | undefined;
    try {
      await waitForProductionStart(child, postgres);
      workerPid = await findWorkerProcess(child.pid!);
      expect(workerPid).not.toBe(child.pid);
      process.kill(workerPid, "SIGTERM");
      await expect(exited).resolves.toEqual({ code: 0, signal: null });
    } finally {
      if (workerPid === undefined && child.pid !== undefined) {
        try {
          workerPid = await findWorkerProcess(child.pid);
        } catch {
          // The process may have exited before its descendant could be inspected
        }
      }
      killProcess(workerPid, "SIGKILL");
      killProcess(child.pid === undefined ? undefined : -child.pid, "SIGKILL");
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      await awaitCleanup(exited);
    }
  });

  it("waits for active boundaries and stops pg-boss when offWork rejects", async () => {
    const userId = (await postgres.db.insertInto("users").values({
      display_name: "Owner",
      avatar_url: null,
      role: "member",
      status: "active",
    }).returning("id").executeTakeFirstOrThrow()).id;
    const jobId = (await new JobRepository(postgres.db).createExample({
      requestedBy: userId,
      requestId: "shutdown-failure",
    })).id;
    const offWorkFailure = new Error("offWork failed");
    const calls: string[] = [];
    let handler!: (jobs: Array<{ data: { jobId: string } }>) => Promise<unknown>;
    let notifyStarted!: () => void;
    const started = new Promise<void>((resolve) => { notifyStarted = resolve; });
    let release!: () => void;
    const boundary = new Promise<void>((resolve) => { release = resolve; });
    const boss = fakeBoss({
      async work(_name, _options, registered) {
        handler = registered as typeof handler;
        return "work-id";
      },
      async offWork() {
        calls.push("offWork");
        throw offWorkFailure;
      },
      async stop() {
        calls.push("boss.stop");
      },
    });
    const worker = new JobWorker({
      database: postgres.db,
      workerId: "shutdown-worker",
      boss,
      pollIntervalMs: 60_000,
      barrier: {
        async afterAttemptStarted() {
          notifyStarted();
          await boundary;
        },
      },
    });
    const unhandled: unknown[] = [];
    const observeUnhandled = (error: unknown) => { unhandled.push(error); };
    process.on("unhandledRejection", observeUnhandled);
    try {
      await worker.start();
      const active = handler([{ data: { jobId } }]);
      await started;
      let stopSettled = false;
      const stopped = worker.stop().finally(() => { stopSettled = true; });
      const observedStop = stopped.catch(() => undefined);
      await new Promise<void>((resolve) => setImmediate(resolve));

      expect(stopSettled).toBe(false);
      expect(calls).toEqual(["offWork", "offWork"]);

      release();
      await active;
      await expect(stopped).rejects.toEqual(expect.objectContaining({
        name: "AggregateError",
        errors: [offWorkFailure, offWorkFailure],
      }));
      await observedStop;
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(calls).toEqual(["offWork", "offWork", "boss.stop"]);
      expect(unhandled).toEqual([]);
    } finally {
      release();
      worker.stopAtBoundary();
      process.off("unhandledRejection", observeUnhandled);
    }
  });

  it.each(["createQueue", "work"] as const)(
    "stops a started boss when %s registration rejects",
    async (stage) => {
      const startupFailure = new Error(`${stage} failed`);
      const calls: string[] = [];
      const boss = fakeBoss({
        async start() {
          calls.push("start");
        },
        async createQueue() {
          calls.push("createQueue");
          if (stage === "createQueue") throw startupFailure;
        },
        async work() {
          calls.push("work");
          if (stage === "work") throw startupFailure;
          return "work-id";
        },
        async stop() {
          calls.push("boss.stop");
        },
      });
      const worker = new JobWorker({ database: postgres.db, workerId: "startup-worker", boss });

      await expect(worker.start()).rejects.toBe(startupFailure);
      expect(calls.at(-1)).toBe("boss.stop");
    },
  );

  it("rolls back the background consumer when interactive registration fails", async () => {
    const startupFailure = new Error("interactive work failed");
    const calls: string[] = [];
    let workCalls = 0;
    let bossStopped = false;
    const boss = fakeBoss({
      async start() { calls.push("start"); },
      async createQueue(name) { calls.push(`createQueue:${name}`); },
      async work(name) {
        workCalls += 1;
        calls.push(`work:${name}`);
        if (workCalls === 2) throw startupFailure;
        return "work-id";
      },
      async offWork(name) {
        calls.push(`offWork:${name}`);
        if (bossStopped) throw new Error("offWork called after boss stopped");
      },
      async stop() {
        calls.push("boss.stop");
        bossStopped = true;
      },
    });
    const worker = new JobWorker({ database: postgres.db, workerId: "partial-registration-worker", boss });

    await expect(worker.start()).rejects.toBe(startupFailure);
    expect(calls).toEqual([
      "start",
      "createQueue:jobs.wake",
      "createQueue:jobs.query.wake",
      "work:jobs.wake",
      "work:jobs.query.wake",
      "offWork:jobs.wake",
      "boss.stop",
    ]);

    await worker.stop();
    await worker.stop();
    expect(calls).toHaveLength(7);
  });

  it("stops a partially initialized boss when start rejects", async () => {
    const startupFailure = new Error("boss start failed after partial initialization");
    const calls: string[] = [];
    const boss = fakeBoss({
      async start() {
        calls.push("start:partially-initialized");
        throw startupFailure;
      },
      async stop() {
        calls.push("boss.stop");
      },
    });
    const worker = new JobWorker({ database: postgres.db, workerId: "startup-worker", boss });

    await expect(worker.start()).rejects.toBe(startupFailure);
    expect(calls).toEqual(["start:partially-initialized", "boss.stop"]);

    await worker.stop();
    expect(calls).toEqual(["start:partially-initialized", "boss.stop"]);
  });

  it("preserves start and rollback failures", async () => {
    const startupFailure = new Error("boss start failed after partial initialization");
    const rollbackFailure = new Error("boss stop failed");
    const boss = fakeBoss({
      async start() {
        throw startupFailure;
      },
      async stop() {
        throw rollbackFailure;
      },
    });
    const worker = new JobWorker({ database: postgres.db, workerId: "startup-worker", boss });

    await expect(worker.start()).rejects.toEqual(expect.objectContaining({
      name: "AggregateError",
      errors: [startupFailure, rollbackFailure],
    }));
  });

  it("preserves startup and rollback failures", async () => {
    const startupFailure = new Error("queue registration failed");
    const rollbackFailure = new Error("boss stop failed");
    const boss = fakeBoss({
      async createQueue() {
        throw startupFailure;
      },
      async stop() {
        throw rollbackFailure;
      },
    });
    const worker = new JobWorker({ database: postgres.db, workerId: "startup-worker", boss });

    await expect(worker.start()).rejects.toEqual(expect.objectContaining({
      name: "AggregateError",
      errors: [startupFailure, rollbackFailure],
    }));
  });

  it("serializes stop behind in-flight startup and leaves no timers", async () => {
    const calls: string[] = [];
    let notifyWorkEntered!: () => void;
    const workEntered = new Promise<void>((resolve) => { notifyWorkEntered = resolve; });
    let releaseWork!: () => void;
    const workGate = new Promise<void>((resolve) => { releaseWork = resolve; });
    const boss = fakeBoss({
      async start() {
        calls.push("start");
      },
      async createQueue() {
        calls.push("createQueue");
      },
      async work() {
        calls.push("work");
        notifyWorkEntered();
        await workGate;
        return "work-id";
      },
      async offWork() {
        calls.push("offWork");
      },
      async stop() {
        calls.push("boss.stop");
      },
    });
    const worker = new JobWorker({
      database: postgres.db,
      workerId: "serialized-worker",
      boss,
      pollIntervalMs: 5,
    });
    const starting = worker.start();
    await workEntered;
    let stopSettled = false;
    const stopping = worker.stop().finally(() => { stopSettled = true; });
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(stopSettled).toBe(false);
    expect(calls).toEqual(["start", "createQueue", "createQueue", "work"]);

    releaseWork();
    await starting;
    await stopping;

    expect(calls).toEqual(["start", "createQueue", "createQueue", "work", "work", "offWork", "offWork", "boss.stop"]);
    const timers = worker as unknown as {
      dispatcherTimer?: NodeJS.Timeout;
      recoveryTimer?: NodeJS.Timeout;
    };
    expect(timers.dispatcherTimer).toBeUndefined();
    expect(timers.recoveryTimer).toBeUndefined();
  });

  it("coalesces concurrent and repeated start calls", async () => {
    const calls: string[] = [];
    let notifyWorkEntered!: () => void;
    const workEntered = new Promise<void>((resolve) => { notifyWorkEntered = resolve; });
    let releaseWork!: () => void;
    const workGate = new Promise<void>((resolve) => { releaseWork = resolve; });
    const boss = fakeBoss({
      async start() {
        calls.push("start");
      },
      async createQueue() {
        calls.push("createQueue");
      },
      async work() {
        calls.push("work");
        notifyWorkEntered();
        await workGate;
        return "work-id";
      },
      async offWork() {
        calls.push("offWork");
      },
      async stop() {
        calls.push("boss.stop");
      },
    });
    const worker = new JobWorker({
      database: postgres.db,
      workerId: "coalesced-worker",
      boss,
      pollIntervalMs: 60_000,
    });
    const first = worker.start();
    await workEntered;
    const concurrent = worker.start();
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(calls).toEqual(["start", "createQueue", "createQueue", "work"]);

    releaseWork();
    await Promise.all([first, concurrent]);
    await worker.start();
    expect(calls).toEqual(["start", "createQueue", "createQueue", "work", "work"]);
    await worker.stop();
  });

  it("reports pg-boss errors and coordinates one observed shutdown", async () => {
    const boss = new EventEmitter();
    const firstError = new Error("pg-boss maintenance failed");
    const secondError = new Error("pg-boss database failed");
    const shutdownError = new Error("coordinated shutdown failed");
    const reported: Array<{ message: string; error: unknown }> = [];
    const unhandled: unknown[] = [];
    let shutdownCalls = 0;
    let releaseShutdown!: () => void;
    const shutdownBoundary = new Promise<void>((resolve) => { releaseShutdown = resolve; });
    const previousExitCode = process.exitCode;
    const observeUnhandled = (error: unknown) => { unhandled.push(error); };
    process.on("unhandledRejection", observeUnhandled);
    try {
      process.exitCode = undefined;
      installBossErrorShutdown({
        boss,
        async shutdown() {
          shutdownCalls += 1;
          await shutdownBoundary;
          throw shutdownError;
        },
        report(message, error) {
          reported.push({ message, error });
        },
      });

      boss.emit("error", firstError);
      boss.emit("error", secondError);

      expect(process.exitCode).toBe(1);
      expect(shutdownCalls).toBe(1);
      expect(reported).toEqual([
        { message: "pg-boss error", error: firstError },
        { message: "pg-boss error", error: secondError },
      ]);

      releaseShutdown();
      await new Promise<void>((resolve) => setImmediate(resolve));
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(reported).toEqual([
        { message: "pg-boss error", error: firstError },
        { message: "pg-boss error", error: secondError },
        { message: "Worker shutdown failed", error: shutdownError },
      ]);
      expect(unhandled).toEqual([]);
    } finally {
      releaseShutdown();
      process.exitCode = previousExitCode;
      process.off("unhandledRejection", observeUnhandled);
    }
  });

  it("coalesces shutdown and preserves worker and database cleanup failures", async () => {
    const workerFailure = new Error("worker stop failed");
    const databaseFailure = new Error("database destroy failed");
    const calls: string[] = [];
    const shutdown = createCoordinatedShutdown({
      async stopWorker() {
        calls.push("worker.stop");
        throw workerFailure;
      },
      async destroyDatabase() {
        calls.push("destroyDatabase");
        throw databaseFailure;
      },
    });

    const first = shutdown();
    const duplicate = shutdown();

    expect(duplicate).toBe(first);
    await expect(first).rejects.toEqual(expect.objectContaining({
      name: "AggregateError",
      errors: [workerFailure, databaseFailure],
    }));
    expect(calls).toEqual(["worker.stop", "destroyDatabase"]);
  });

  it("uses a queue policy that physically deduplicates stable singleton keys", async () => {
    const boss = createBoss(postgres.databaseUrl);
    await boss.start();
    try {
      await createWakeQueue(boss);
      const key = "outbox:stable-key";
      const first = await boss.send("jobs.wake", { jobId: "one" }, { singletonKey: key });
      const second = await boss.send("jobs.wake", { jobId: "one" }, { singletonKey: key });

      expect(first).toEqual(expect.any(String));
      expect(second).toBeNull();
      expect(await boss.findJobs("jobs.wake", { key })).toHaveLength(1);
    } finally {
      await boss.stop();
    }
  });

  it("observes a background dispatch failure, drains it, and continues polling", async () => {
    const userId = (await postgres.db.insertInto("users").values({
      display_name: "Owner",
      avatar_url: null,
      role: "member",
      status: "active",
    }).returning("id").executeTakeFirstOrThrow()).id;
    await new JobRepository(postgres.db).createExample({
      requestedBy: userId,
      requestId: "background-retry",
    });
    const failure = new Error("first dispatch failed");
    const reported: unknown[] = [];
    const unhandled: unknown[] = [];
    let sendCount = 0;
    let notifyRetry!: () => void;
    const retried = new Promise<void>((resolve) => { notifyRetry = resolve; });
    const boss: WorkerBoss = {
      async start() {},
      async stop() {},
      async createQueue() {},
      async work() { return "work-id"; },
      async offWork() {},
      async send() {
        sendCount += 1;
        if (sendCount === 1) throw failure;
        notifyRetry();
        return "queue-id";
      },
    };
    const observeUnhandled = (error: unknown) => { unhandled.push(error); };
    process.on("unhandledRejection", observeUnhandled);
    const worker = new JobWorker({
      database: postgres.db,
      workerId: "background-worker",
      boss,
      pollIntervalMs: 5,
      onBackgroundError(error) {
        reported.push(error);
      },
    });
    try {
      await worker.start();
      await retried;
      await new Promise<void>((resolve) => setImmediate(resolve));
      await worker.stop();

      expect(reported).toEqual([failure]);
      expect(unhandled).toEqual([]);
      expect(sendCount).toBeGreaterThanOrEqual(2);
      expect((await postgres.db.selectFrom("job_outbox").select("delivered_at")
        .executeTakeFirstOrThrow()).delivered_at).toBeInstanceOf(Date);
    } finally {
      worker.stopAtBoundary();
      process.off("unhandledRejection", observeUnhandled);
    }
  });

  it("persists attempt one before the execution barrier and restarts without duplicate effects", async () => {
    const userId = (await postgres.db.insertInto("users").values({
      display_name: "Owner",
      avatar_url: null,
      role: "member",
      status: "active",
    }).returning("id").executeTakeFirstOrThrow()).id;
    const jobId = (await new JobRepository(postgres.db).createExample({
      requestedBy: userId,
      requestId: "worker-restart",
    })).id;
    let notifyStarted!: () => void;
    const started = new Promise<void>((resolve) => { notifyStarted = resolve; });
    let releaseBarrier!: () => void;
    const blocked = new Promise<void>((resolve) => { releaseBarrier = resolve; });
    const first = new JobWorker({
      database: postgres.db,
      workerId: "worker-a",
      barrier: {
        async afterAttemptStarted() {
          notifyStarted();
          await blocked;
        },
      },
      leaseDurationMs: 1,
    });
    const interrupted = first.processJob(jobId);
    await started;

    expect(await postgres.db.selectFrom("job_attempts").select(["attempt_no", "status"])
      .execute()).toEqual([{ attempt_no: 1, status: "running" }]);
    first.stopAtBoundary();
    await postgres.db.updateTable("job_steps").set({ lease_expires_at: new Date(0) })
      .where("job_id", "=", jobId).where("status", "=", "running").execute();

    const restarted = new JobWorker({ database: postgres.db, workerId: "worker-b" });
    await restarted.processJob(jobId);
    await restarted.processJob(jobId);
    releaseBarrier();
    await interrupted;

    expect((await new JobRepository(postgres.db).getById(jobId))?.status).toBe("completed");
    expect(await postgres.db.selectFrom("job_attempts").select(["attempt_no", "status"])
      .where("step_id", "=", (query) => query.selectFrom("job_steps").select("id")
        .where("job_id", "=", jobId).where("position", "=", 0))
      .orderBy("attempt_no").execute()).toEqual([
      { attempt_no: 1, status: "abandoned" },
      { attempt_no: 2, status: "completed" },
    ]);
    expect(await postgres.db.selectFrom("job_events").selectAll()
      .where("job_id", "=", jobId).where("type", "=", "progress").execute()).toHaveLength(2);
    expect(await postgres.db.selectFrom("job_events").selectAll()
      .where("job_id", "=", jobId).where("type", "=", "completed").execute()).toHaveLength(1);
    expect(await postgres.db.selectFrom("job_steps").select("output_ref")
      .where("job_id", "=", jobId).where("output_ref", "is not", null).execute()).toHaveLength(2);
    expect(await postgres.db.selectFrom("job_outbox").selectAll()
      .where("job_id", "=", jobId).execute()).toHaveLength(2);
  });
});
