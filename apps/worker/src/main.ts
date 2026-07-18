import { createDatabase, destroyDatabase } from "@novel-analysis/database";
import { createBoss, type ExecutionBarrier } from "@novel-analysis/jobs";

import {
  JobWorker,
  createCoordinatedShutdown,
  installBossErrorShutdown,
} from "./worker.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const database = createDatabase(databaseUrl);
const boss = createBoss(databaseUrl);
const productionBarrier: ExecutionBarrier = {
  async afterAttemptStarted() {},
};
const worker = new JobWorker({
  database,
  boss,
  workerId: `worker-${process.pid}`,
  barrier: productionBarrier,
});

const shutdown = createCoordinatedShutdown({
  stopWorker: () => worker.stop(),
  destroyDatabase: () => destroyDatabase(database),
});

function handleShutdownSignal(): void {
  void shutdown().catch((error: unknown) => {
    console.error("Worker shutdown failed", error);
    process.exitCode = 1;
  });
}

process.once("SIGTERM", handleShutdownSignal);
process.once("SIGINT", handleShutdownSignal);

installBossErrorShutdown({
  boss,
  shutdown,
  report(message, error) {
    console.error(message, error);
  },
});

try {
  await worker.start();
} catch (startupError) {
  try {
    await shutdown();
  } catch (cleanupError) {
    throw new AggregateError(
      [startupError, cleanupError],
      "Worker startup and cleanup failed",
      { cause: cleanupError },
    );
  }
  throw startupError;
}
