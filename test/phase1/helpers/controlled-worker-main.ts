import { createDatabase, destroyDatabase } from "@novel-analysis/database";
import { createBoss } from "@novel-analysis/jobs";
import { JobWorker, type WorkerBoss } from "../../../apps/worker/src/worker.js";

const databaseUrl = process.env.DATABASE_URL;
const mode = process.env.WORKER_MODE;
if (!databaseUrl || !process.send || (mode !== "controlled" && mode !== "recovery")) {
  throw new Error("Controlled Worker requires DATABASE_URL, WORKER_MODE and IPC");
}

const database = createDatabase(databaseUrl);
const boss = createBoss(databaseUrl);
const replayOutboxIds = new Set<string>();
const workerBoss = new Proxy(boss, {
  get(target, property) {
    if (property === "work") {
      return async (
        name: string,
        handler: (jobs: Array<{ data: { outboxId: string } }>) => Promise<unknown>,
      ) => target.work(name, async (jobs) => {
        await handler(jobs as Array<{ data: { outboxId: string } }>);
        for (const job of jobs) {
          const data = job.data as { outboxId?: unknown };
          if (typeof data.outboxId === "string" && replayOutboxIds.delete(data.outboxId)) {
            process.send!({ type: "replay-consumed", outboxId: data.outboxId });
          }
        }
      });
    }
    const value = Reflect.get(target, property, target) as unknown;
    return typeof value === "function" ? value.bind(target) : value;
  },
}) as unknown as WorkerBoss;
let releaseBarrier: (() => void) | undefined;
const barrier = mode === "controlled" ? {
  async afterAttemptStarted(input: { jobId: string; stepId: string; attemptId: string; attemptNo: number }) {
    process.send!({ type: "started", ...input });
    await new Promise<void>((resolve) => { releaseBarrier = resolve; });
  },
} : undefined;
const worker = new JobWorker({
  database,
  boss: workerBoss,
  workerId: mode === "controlled" ? "phase1-worker-a" : "phase1-worker-b",
  barrier,
  leaseDurationMs: 250,
  pollIntervalMs: 20,
});

await worker.start();
console.log("phase1-worker-ready");
if (process.env.TEST_SUPPRESS_READY !== "true") process.send({ type: "ready" });
process.on("message", (raw) => {
  const message = raw as { type?: string; jobId?: string; outboxId?: string };
  if (message.type === "replay-wake" && message.jobId && message.outboxId) {
    replayOutboxIds.add(message.outboxId);
    void boss.send(
      "jobs.wake",
      { jobId: message.jobId, outboxId: message.outboxId },
      { singletonKey: `phase1-replay:${message.outboxId}` },
    );
  }
  if (message.type === "stop") {
    releaseBarrier?.();
    void worker.stop()
      .then(() => destroyDatabase(database))
      .then(() => process.exit(0));
  }
});
