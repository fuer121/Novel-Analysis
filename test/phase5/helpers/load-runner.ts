import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { performance } from "node:perf_hooks";

export function nearestRankP95(samples: readonly number[]): number {
  if (samples.length === 0) throw new Error("p95 requires at least one sample");
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * 0.95) - 1]!;
}

type Check = "PASS" | "FAIL";

export type Phase5LoadProfile = Readonly<{
  dataset: Readonly<{ books: number; chapters: number; facts: number }>;
  warmupIterations: number;
  browseUsers: 20;
  submitUsers: 10;
  thresholds: Readonly<{
    browseP95Ms: number;
    submitP95Ms: number;
    statusPropagationP95Ms: number;
  }>;
}>;

export type Phase5LoadReport = Readonly<{
  schemaVersion: "phase5-load-report-v1";
  benchmarkContractVersion: "phase5-local-idle-v1";
  isolation: Readonly<{
    mode: "local-idle-host";
    lockAcquired: true;
  }>;
  status: Check;
  server: Readonly<{
    cpu: string;
    memoryBytes: number;
    node: string;
    postgres: string;
  }>;
  dataset: Readonly<{ books: number; chapters: number; facts: number }>;
  warmupSeconds: number;
  durationSeconds: number;
  browse: Readonly<{ users: 20; p95Ms: number }>;
  submit: Readonly<{ users: 10; p95Ms: number }>;
  statusPropagationP95Ms: number;
  rawSamplesMs: Readonly<{
    browse: readonly number[];
    submit: readonly number[];
    statusPropagation: readonly number[];
  }>;
  thresholdsMs: Readonly<{
    browseP95: number;
    submitP95: number;
    statusPropagationP95: number;
  }>;
  priority: Readonly<{
    interactiveAheadOfQueuedBackground: boolean;
    runningStepUninterrupted: boolean;
  }>;
  checks: Readonly<{
    browse: Check;
    submit: Check;
    statusPropagation: Check;
    interactivePriority: Check;
  }>;
}>;

export interface Phase5LoadHarness {
  serverProfile(): Promise<Phase5LoadReport["server"]>;
  datasetCounts(): Promise<Phase5LoadReport["dataset"]>;
  warmup(): Promise<void>;
  browse(userIndex: number): Promise<void>;
  startBackgroundRebuild(): Promise<void>;
  submit(userIndex: number): Promise<{
    submitMs: number;
    statusPropagationMs: number;
  }>;
  priorityEvidence(): Promise<Phase5LoadReport["priority"]>;
  releaseBackground(): void;
}

function check(value: boolean): Check {
  return value ? "PASS" : "FAIL";
}

export async function runPhase5Load(
  harness: Phase5LoadHarness,
  profile: Phase5LoadProfile,
): Promise<Phase5LoadReport> {
  const [server, dataset] = await Promise.all([
    harness.serverProfile(),
    harness.datasetCounts(),
  ]);
  const warmupStarted = performance.now();
  for (let iteration = 0; iteration < profile.warmupIterations; iteration += 1) {
    await harness.warmup();
  }
  const warmupSeconds = (performance.now() - warmupStarted) / 1_000;

  const runStarted = performance.now();
  const browseSamples = await Promise.all(
    Array.from({ length: profile.browseUsers }, async (_, userIndex) => {
      const started = performance.now();
      await harness.browse(userIndex);
      return performance.now() - started;
    }),
  );

  await harness.startBackgroundRebuild();
  let submissions: Array<{ submitMs: number; statusPropagationMs: number }>;
  let priority: Phase5LoadReport["priority"];
  try {
    submissions = await Promise.all(
      Array.from({ length: profile.submitUsers }, (_, userIndex) =>
        harness.submit(userIndex)),
    );
    priority = await harness.priorityEvidence();
  } finally {
    harness.releaseBackground();
  }

  const submitSamples = submissions.map((sample) => sample.submitMs);
  const statusSamples = submissions.map((sample) => sample.statusPropagationMs);
  const browseP95Ms = nearestRankP95(browseSamples);
  const submitP95Ms = nearestRankP95(submitSamples);
  const statusPropagationP95Ms = nearestRankP95(statusSamples);
  const checks = {
    browse: check(browseP95Ms < profile.thresholds.browseP95Ms),
    submit: check(submitP95Ms < profile.thresholds.submitP95Ms),
    statusPropagation: check(
      statusPropagationP95Ms < profile.thresholds.statusPropagationP95Ms,
    ),
    interactivePriority: check(
      priority.interactiveAheadOfQueuedBackground
      && priority.runningStepUninterrupted,
    ),
  } as const;

  return {
    schemaVersion: "phase5-load-report-v1",
    benchmarkContractVersion: "phase5-local-idle-v1",
    isolation: { mode: "local-idle-host", lockAcquired: true },
    status: Object.values(checks).every((value) => value === "PASS")
      ? "PASS"
      : "FAIL",
    server,
    dataset,
    warmupSeconds,
    durationSeconds: (performance.now() - runStarted) / 1_000,
    browse: { users: profile.browseUsers, p95Ms: browseP95Ms },
    submit: { users: profile.submitUsers, p95Ms: submitP95Ms },
    statusPropagationP95Ms,
    rawSamplesMs: {
      browse: browseSamples,
      submit: submitSamples,
      statusPropagation: statusSamples,
    },
    thresholdsMs: {
      browseP95: profile.thresholds.browseP95Ms,
      submitP95: profile.thresholds.submitP95Ms,
      statusPropagationP95: profile.thresholds.statusPropagationP95Ms,
    },
    priority,
    checks,
  };
}

export async function writePhase5LoadReport(
  report: Phase5LoadReport,
  path: string | undefined,
): Promise<void> {
  if (!path) return;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}
