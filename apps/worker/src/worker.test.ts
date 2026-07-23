import { describe, expect, it } from "vitest";

import {
  BACKGROUND_WAKE_QUEUE,
  INTERACTIVE_WAKE_QUEUE,
  JobWorker,
  createWorkerStepExecutor,
  parseAnalysisRuntimeConfig,
  parseQueryRuntimeConfig,
  type WorkerBoss,
} from "./worker.js";

describe("interactive Worker queues", () => {
  it("registers independent background and interactive consumers with bounded team sizes", async () => {
    const registrations: Array<{ name: string; teamSize: number }> = [];
    const boss: WorkerBoss = {
      async start() {}, async stop() {}, async createQueue() {}, async offWork() {}, async send() { return "id"; },
      async work(name, options) { registrations.push({ name, teamSize: options.localConcurrency }); return "id"; },
    };
    const worker = new JobWorker({ database: {} as never, workerId: "worker", boss, queryConcurrency: 7, pollIntervalMs: 60_000 });
    await worker.start();
    worker.stopAtBoundary();
    await worker.stop();
    expect(registrations).toEqual([
      { name: BACKGROUND_WAKE_QUEUE, teamSize: 1 },
      { name: INTERACTIVE_WAKE_QUEUE, teamSize: 7 },
    ]);
  });

  it("defaults Query concurrency to 10 and accepts only safe integers from 1 through 20", () => {
    expect(parseQueryRuntimeConfig({})).toEqual({ queryConcurrency: 10, analysisSummaryKey: undefined });
    expect(parseQueryRuntimeConfig({ QUERY_CONCURRENCY: "20", DIFY_ANALYSIS_SUMMARY_KEY: "summary-key" })).toEqual({ queryConcurrency: 20, analysisSummaryKey: "summary-key" });
    for (const value of ["0", "21", "1.5", "NaN", "9007199254740992"]) {
      expect(() => parseQueryRuntimeConfig({ QUERY_CONCURRENCY: value })).toThrow("QUERY_CONCURRENCY");
    }
  });

  it("routes Query steps to the Query executor without changing background routing", async () => {
    const calls: string[] = [];
    const executor = createWorkerStepExecutor({
      database: {} as never,
      queryExecutor: { async execute(claim) { calls.push(claim.kind); return { disposition: "completed" as const }; } },
    });
    const claim = { jobId: "job", stepId: "step", attemptId: "attempt", attemptNo: 1, position: 1, kind: "l2-query", workerId: "worker", leaseExpiresAt: new Date() };
    await expect(executor.execute(claim)).resolves.toEqual({ disposition: "completed" });
    expect(calls).toEqual(["l2-query"]);
  });

  it("requires an explicit advanced analysis runtime contract", () => {
    expect(() => parseAnalysisRuntimeConfig({})).toThrow("advanced analysis runtime configuration");
    expect(parseAnalysisRuntimeConfig({ ADVANCED_ANALYSIS_MODEL: "model", ADVANCED_ANALYSIS_REASONING_EFFORT: "high", ADVANCED_ANALYSIS_EXECUTOR_VERSION: "v1" })).toEqual({ model: "model", reasoningEffort: "high", executorVersion: "v1" });
    expect(() => parseAnalysisRuntimeConfig({ ADVANCED_ANALYSIS_MODEL: "model" })).toThrow("advanced analysis runtime configuration");
    expect(() => parseAnalysisRuntimeConfig({ ADVANCED_ANALYSIS_MODEL: "", ADVANCED_ANALYSIS_REASONING_EFFORT: "high", ADVANCED_ANALYSIS_EXECUTOR_VERSION: "v1" })).toThrow("advanced analysis runtime configuration");
  });

  it("routes advanced analysis only to its configured executor", async () => {
    const calls: string[] = [];
    const executor = createWorkerStepExecutor({ database: {} as never, analysisExecutor: { async execute(claim) { calls.push(claim.kind); return { disposition: "completed" as const }; } } });
    const claim = { jobId: "job", stepId: "step", attemptId: "attempt", attemptNo: 1, position: 1, kind: "advanced-analysis", workerId: "worker", leaseExpiresAt: new Date() };
    await expect(executor.execute(claim)).resolves.toEqual({ disposition: "completed" });
    expect(calls).toEqual(["advanced-analysis"]);
  });

  it("routes rebuild parent steps only to the rebuild executor", async () => {
    const calls: string[] = [];
    const executor = createWorkerStepExecutor({
      database: {} as never,
      rebuildExecutor: {
        async execute(claim) {
          calls.push(claim.kind);
          return { disposition: "deferred" as const };
        },
      },
    });
    const claim = { jobId: "job", stepId: "step", attemptId: "attempt", attemptNo: 1, position: 1, kind: "library-rebuild-book", workerId: "worker", leaseExpiresAt: new Date() };
    await expect(executor.execute(claim)).resolves.toEqual({ disposition: "deferred" });
    expect(calls).toEqual(["library-rebuild-book"]);
  });
});
