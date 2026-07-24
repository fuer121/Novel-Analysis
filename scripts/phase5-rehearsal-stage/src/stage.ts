import { link, lstat, open, readFile, unlink } from "node:fs/promises";
import { basename, dirname, isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  createDatabase,
  destroyDatabase,
  migrateToLatest,
} from "../../../packages/database/src/index.js";
import {
  runMigrationFromCli,
  type MigrationCliArgs,
} from "../../../packages/migration/src/cli.js";
import { PHASE5_SCALE_PROFILE } from "../../../test/phase5/fixtures/scale-profile.js";
import {
  runPhase5Load,
  type Phase5LoadReport,
} from "../../../test/phase5/helpers/load-runner.js";
import { createPhase5ScaleHarness } from "../../../test/phase5/helpers/phase5-harness.js";

const MODES = ["initialize", "migrate", "capacity"] as const;
type StageMode = typeof MODES[number];

type StageResult = Readonly<{
  schemaVersion: "phase5-rehearsal-stage-result-v1";
  mode: StageMode;
  status: "passed" | "failed";
  code?: string;
  details?: unknown;
}>;

type InitializeRequest = Readonly<{ databaseUrlFile: string }>;
type MigrateRequest = Readonly<{
  sourceFile: string;
  databaseUrlFile: string;
  oldKeyFile: string;
  targetKeyFile: string;
  targetHmacKeyFile: string;
  manifestFile: string;
}>;
type CapacityRequest = Readonly<{ databaseUrlFile: string }>;
type StageRequest = InitializeRequest | MigrateRequest | CapacityRequest;

const INLINE_SECRET_OPTIONS = new Set([
  "--database-url", "--old-key", "--target-key", "--target-hmac-key",
  "--old-master-key", "--content-key", "--hmac-key", "--snapshot-fingerprint",
]);

class StageFailure extends Error {
  constructor(readonly code: string, readonly exitCode: number) {
    super(code);
  }
}

type StageDependencies = Readonly<{
  initialize(request: InitializeRequest): Promise<unknown>;
  migrate(request: MigrateRequest): Promise<unknown>;
  capacity(request: CapacityRequest): Promise<unknown>;
  readRequest(path: string): Promise<unknown>;
  writeResult(path: string, result: StageResult): Promise<void>;
}>;

function parseArguments(argv: readonly string[]): {
  mode: StageMode;
  requestFile: string;
  resultFile: string;
} {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const option = argv[index];
    const value = argv[index + 1];
    if (!option?.startsWith("--")) throw new StageFailure("unknown_argument", 64);
    if (INLINE_SECRET_OPTIONS.has(option)) throw new StageFailure("inline_secret_forbidden", 64);
    if (!["--mode", "--request-file", "--result-file"].includes(option)) {
      throw new StageFailure("unknown_argument", 64);
    }
    if (values.has(option)) throw new StageFailure("duplicate_argument", 64);
    if (!value || value.startsWith("--")) throw new StageFailure("missing_argument", 64);
    values.set(option, value);
  }
  const mode = values.get("--mode");
  if (!MODES.includes(mode as StageMode)) throw new StageFailure("unknown_mode", 64);
  const requestFile = values.get("--request-file");
  const resultFile = values.get("--result-file");
  if (!requestFile || !resultFile) throw new StageFailure("missing_argument", 64);
  if (!isAbsolute(requestFile) || !isAbsolute(resultFile)) {
    throw new StageFailure("absolute_path_required", 64);
  }
  return { mode: mode as StageMode, requestFile, resultFile };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function exactStringRecord(
  value: unknown,
  keys: readonly string[],
): Record<string, string> {
  if (!isRecord(value) || Object.keys(value).length !== keys.length) {
    throw new StageFailure("invalid_request", 65);
  }
  const result: Record<string, string> = {};
  for (const key of keys) {
    if (typeof value[key] !== "string" || value[key].length === 0) {
      throw new StageFailure("invalid_request", 65);
    }
    if (!isAbsolute(value[key])) throw new StageFailure("invalid_request", 65);
    result[key] = value[key];
  }
  return result;
}

function validateRequest(mode: StageMode, value: unknown): StageRequest {
  if (mode === "initialize" || mode === "capacity") {
    return exactStringRecord(value, ["databaseUrlFile"]) as InitializeRequest;
  }
  return exactStringRecord(value, [
    "sourceFile", "databaseUrlFile", "oldKeyFile", "targetKeyFile",
    "targetHmacKeyFile", "manifestFile",
  ]) as unknown as MigrateRequest;
}

async function assertPrivateRegularFile(path: string): Promise<void> {
  const stat = await lstat(path).catch(() => {
    throw new StageFailure("invalid_private_file", 65);
  });
  if (!stat.isFile() || stat.isSymbolicLink()
    || (typeof process.getuid === "function" && stat.uid !== process.getuid())
    || (stat.mode & 0o777) !== 0o600) {
    throw new StageFailure("invalid_private_file", 65);
  }
}

async function readPrivateText(path: string): Promise<string> {
  await assertPrivateRegularFile(path);
  const value = (await readFile(path, "utf8")).trim();
  if (!value) throw new StageFailure("invalid_private_file", 65);
  return value;
}

async function initializeDatabase(request: InitializeRequest): Promise<unknown> {
  const databaseUrl = await readPrivateText(request.databaseUrlFile);
  const database = createDatabase(databaseUrl);
  try {
    const result = await migrateToLatest(database);
    if (result.error) throw result.error;
    return { migrations: result.results?.filter((item) => item.status === "Success").length ?? 0 };
  } finally {
    await destroyDatabase(database);
  }
}

async function migrateDatabase(request: MigrateRequest): Promise<unknown> {
  for (const path of [request.sourceFile, request.oldKeyFile, request.targetKeyFile, request.targetHmacKeyFile]) {
    await assertPrivateRegularFile(path);
  }
  const args: MigrationCliArgs = {
    sourcePath: request.sourceFile,
    databaseUrl: await readPrivateText(request.databaseUrlFile),
    oldKeyFile: request.oldKeyFile,
    targetKeyFile: request.targetKeyFile,
    targetHmacKeyFile: request.targetHmacKeyFile,
    manifestPath: request.manifestFile,
  };
  return runMigrationFromCli(args);
}

async function runCapacity(request: CapacityRequest): Promise<Phase5LoadReport> {
  process.env.TEST_DATABASE_URL = await readPrivateText(request.databaseUrlFile);
  let harness: Awaited<ReturnType<typeof createPhase5ScaleHarness>> | undefined;
  try {
    harness = await createPhase5ScaleHarness(PHASE5_SCALE_PROFILE);
    const report = await runPhase5Load(harness, PHASE5_SCALE_PROFILE);
    if (report.status !== "PASS") throw new StageFailure("capacity_contract_failed", 1);
    return report;
  } finally {
    delete process.env.TEST_DATABASE_URL;
    if (harness) await harness.stop();
  }
}

async function readRequest(path: string): Promise<unknown> {
  await assertPrivateRegularFile(path);
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    throw new StageFailure("invalid_request", 65);
  }
}

async function writeResult(path: string, result: StageResult): Promise<void> {
  const temporary = join(dirname(path), `.${basename(path)}.${process.pid}.tmp`);
  let temporaryCreated = false;
  try {
    const handle = await open(temporary, "wx", 0o600);
    temporaryCreated = true;
    try {
      await handle.writeFile(`${JSON.stringify(result)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await link(temporary, path);
    await unlink(temporary);
    temporaryCreated = false;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new StageFailure("result_exists", 73);
    }
    throw error;
  } finally {
    if (temporaryCreated) await unlink(temporary).catch(() => undefined);
  }
}

const defaults: StageDependencies = {
  initialize: initializeDatabase,
  migrate: migrateDatabase,
  capacity: runCapacity,
  readRequest,
  writeResult,
};

function safeFailure(error: unknown): StageFailure {
  if (error instanceof StageFailure) return error;
  return new StageFailure("stage_failed", 1);
}

export async function executeStage(
  argv: readonly string[],
  dependencies: StageDependencies = defaults,
): Promise<number> {
  let parsed: ReturnType<typeof parseArguments> | undefined;
  try {
    parsed = parseArguments(argv);
    const request = validateRequest(parsed.mode, await dependencies.readRequest(parsed.requestFile));
    const details = parsed.mode === "initialize"
      ? await dependencies.initialize(request as InitializeRequest)
      : parsed.mode === "migrate"
        ? await dependencies.migrate(request as MigrateRequest)
        : await dependencies.capacity(request as CapacityRequest);
    await dependencies.writeResult(parsed.resultFile, {
      schemaVersion: "phase5-rehearsal-stage-result-v1",
      mode: parsed.mode,
      status: "passed",
      details,
    });
    return 0;
  } catch (error) {
    const failure = safeFailure(error);
    if (parsed) {
      await dependencies.writeResult(parsed.resultFile, {
        schemaVersion: "phase5-rehearsal-stage-result-v1",
        mode: parsed.mode,
        status: "failed",
        code: failure.code,
      }).catch(() => undefined);
    }
    process.stderr.write(`phase5_stage_failed:${failure.code}\n`);
    return failure.exitCode;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await executeStage(process.argv.slice(2));
}
