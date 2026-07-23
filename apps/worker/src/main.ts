import { createContentCipher, createDatabase, destroyDatabase } from "@novel-analysis/database";
import { HttpDifyAdapter } from "@novel-analysis/dify";
import { createBoss, type ExecutionBarrier } from "@novel-analysis/jobs";

import {
  JobWorker,
  createWorkerStepExecutor,
  parseLibraryRuntimeConfig,
  parseAnalysisRuntimeConfig,
  parseQueryRuntimeConfig,
  createCoordinatedShutdown,
  installBossErrorShutdown,
} from "./worker.js";
import { LibraryImportExecutor } from "./library-executor.js";
import { AnalysisExecutor } from "./analysis-executor.js";
import { QueryExecutor } from "./query-executor.js";
import { RebuildExecutor } from "./rebuild-executor.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const database = createDatabase(databaseUrl);
const boss = createBoss(databaseUrl);
const libraryConfig = parseLibraryRuntimeConfig(process.env);
const queryConfig = parseQueryRuntimeConfig(process.env);
const analysisConfig = parseAnalysisRuntimeConfig(process.env);
const cipher = libraryConfig
  ? createContentCipher({ activeKeyVersion: libraryConfig.contentKeyVersion, keys: { [libraryConfig.contentKeyVersion]: libraryConfig.contentKey } })
  : undefined;
const adapter = libraryConfig
  ? new HttpDifyAdapter({
      fetch: globalThis.fetch,
      baseUrl: libraryConfig.baseUrl,
      credentials: {
        "chapter-import": libraryConfig.chapterImportKey,
        "l1-index": libraryConfig.l1WorkflowKey,
        "l2-index": libraryConfig.l2WorkflowKey,
        ...(queryConfig.analysisSummaryKey ? { "analysis-summary": queryConfig.analysisSummaryKey } : {}),
      },
      timeoutMs: 60_000,
    })
  : undefined;
const libraryExecutor = libraryConfig
  ? new LibraryImportExecutor({
      database,
      adapter: adapter!,
      cipher: cipher!,
      hmacKey: libraryConfig.hmacKey,
    })
  : undefined;
const queryExecutor = cipher
  ? new QueryExecutor({ database, cipher, dify: queryConfig.analysisSummaryKey ? adapter : undefined })
  : undefined;
const analysisExecutor = cipher
  ? new AnalysisExecutor({ database, cipher, dify: queryConfig.analysisSummaryKey ? adapter : undefined, executionConfig: analysisConfig })
  : undefined;
const executor = createWorkerStepExecutor({
  database,
  libraryExecutor,
  rebuildExecutor: new RebuildExecutor({ database }),
  queryExecutor,
  analysisExecutor,
});
const productionBarrier: ExecutionBarrier = {
  async afterAttemptStarted() {},
};
const worker = new JobWorker({
  database,
  boss,
  workerId: `worker-${process.pid}`,
  barrier: productionBarrier,
  executor,
  queryConcurrency: queryConfig.queryConcurrency,
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
