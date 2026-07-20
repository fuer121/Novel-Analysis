import { createContentCipher, createDatabase, destroyDatabase } from "@novel-analysis/database";
import { HttpDifyAdapter } from "@novel-analysis/dify";
import { createBoss, type ExecutionBarrier } from "@novel-analysis/jobs";

import {
  JobWorker,
  createWorkerStepExecutor,
  parseLibraryRuntimeConfig,
  createCoordinatedShutdown,
  installBossErrorShutdown,
} from "./worker.js";
import { LibraryImportExecutor } from "./library-executor.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const database = createDatabase(databaseUrl);
const boss = createBoss(databaseUrl);
const libraryConfig = parseLibraryRuntimeConfig(process.env);
const libraryExecutor = libraryConfig
  ? new LibraryImportExecutor({
      database,
      adapter: new HttpDifyAdapter({ fetch: globalThis.fetch, baseUrl: libraryConfig.baseUrl, credentials: { "chapter-import": libraryConfig.chapterImportKey, "l1-index": libraryConfig.l1WorkflowKey, "l2-index": libraryConfig.l2WorkflowKey }, timeoutMs: 60_000 }),
      cipher: createContentCipher({ activeKeyVersion: libraryConfig.contentKeyVersion, keys: { [libraryConfig.contentKeyVersion]: libraryConfig.contentKey } }),
      hmacKey: libraryConfig.hmacKey,
    })
  : undefined;
const executor = createWorkerStepExecutor({ database, libraryExecutor });
const productionBarrier: ExecutionBarrier = {
  async afterAttemptStarted() {},
};
const worker = new JobWorker({
  database,
  boss,
  workerId: `worker-${process.pid}`,
  barrier: productionBarrier,
  executor,
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
