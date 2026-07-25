import { readFileSync } from "node:fs";
import {
  chmod,
  link,
  mkdtemp,
  open,
  rm,
  unlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  createDatabase,
  destroyDatabase,
  migrateToLatest,
} from "../../../packages/database/src/index.js";
import {
  runMigrationFromVerifiedInput,
  type MigrationVerifiedInput,
} from "../../../packages/migration/src/verified-input.js";
import { PHASE5_SCALE_PROFILE } from "../../../test/phase5/fixtures/scale-profile.js";
import {
  runPhase5Load,
  type Phase5LoadReport,
} from "../../../test/phase5/helpers/load-runner.js";
import { createPhase5ScaleHarness } from "../../../test/phase5/helpers/phase5-harness.js";

const MODES = ["initialize", "migrate", "capacity"] as const;
type StageMode = typeof MODES[number];

type StageResult = Readonly<{
  schemaVersion: "phase5-rehearsal-stage-result-v2";
  mode: StageMode;
  status: "passed" | "failed";
  resourceId?: string;
  code?: string;
  details?: unknown;
}>;

type InitializeDescriptorRequest = Readonly<{ databaseUrlFd: number }>;
type MigrateDescriptorRequest = Readonly<{
  sourceFd: number;
  databaseUrlFd: number;
  oldKeyFd: number;
  targetKeyFd: number;
  targetHmacKeyFd: number;
  manifestFile: string;
  resourceId: string;
}>;
type CapacityDescriptorRequest = Readonly<{
  databaseUrlFd: number;
  resourceId: string;
}>;
type DescriptorRequest =
  | InitializeDescriptorRequest
  | MigrateDescriptorRequest
  | CapacityDescriptorRequest;

type InitializeRequest = Readonly<{ databaseUrl: Buffer }>;
type MigrateRequest = Readonly<{
  source: Buffer;
  databaseUrl: Buffer;
  oldKey: Buffer;
  targetKey: Buffer;
  targetHmacKey: Buffer;
  manifestFile: string;
  resourceId: string;
}>;
type CapacityRequest = Readonly<{
  databaseUrl: Buffer;
  resourceId: string;
}>;

type ResourceBoundResult<T> = Readonly<{
  resourceId: string;
  report: T;
}>;

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
  migrate(request: MigrateRequest): Promise<ResourceBoundResult<unknown>>;
  capacity(request: CapacityRequest): Promise<ResourceBoundResult<unknown>>;
  writeResult(path: string, result: StageResult): Promise<void>;
}>;

function parseArguments(argv: readonly string[]): {
  mode: StageMode;
  requestFd: number;
  resultFile: string;
} {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const option = argv[index];
    const value = argv[index + 1];
    if (!option?.startsWith("--")) throw new StageFailure("unknown_argument", 64);
    if (INLINE_SECRET_OPTIONS.has(option)) throw new StageFailure("inline_secret_forbidden", 64);
    if (!["--mode", "--request-fd", "--result-file"].includes(option)) {
      throw new StageFailure("unknown_argument", 64);
    }
    if (values.has(option)) throw new StageFailure("duplicate_argument", 64);
    if (!value || value.startsWith("--")) throw new StageFailure("missing_argument", 64);
    values.set(option, value);
  }
  const mode = values.get("--mode");
  if (!MODES.includes(mode as StageMode)) throw new StageFailure("unknown_mode", 64);
  const requestFdValue = values.get("--request-fd");
  const resultFile = values.get("--result-file");
  if (!requestFdValue || !resultFile) throw new StageFailure("missing_argument", 64);
  const requestFd = Number(requestFdValue);
  if (!Number.isSafeInteger(requestFd) || requestFd < 3) {
    throw new StageFailure("invalid_descriptor", 64);
  }
  if (!isAbsolute(resultFile)) throw new StageFailure("absolute_path_required", 64);
  return { mode: mode as StageMode, requestFd, resultFile };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isDescriptor = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 3;

const isOpaqueResourceId = (value: unknown): value is string =>
  typeof value === "string"
  && /^rid_[A-Za-z0-9_-]{8,96}$/.test(value);

function validateRequest(mode: StageMode, value: unknown): DescriptorRequest {
  if (!isRecord(value)) throw new StageFailure("invalid_request", 65);
  if (mode === "initialize") {
    if (Object.keys(value).length !== 1 || !isDescriptor(value.databaseUrlFd)) {
      throw new StageFailure("invalid_request", 65);
    }
    return { databaseUrlFd: value.databaseUrlFd };
  }
  if (mode === "capacity") {
    if (Object.keys(value).length !== 2
      || !isDescriptor(value.databaseUrlFd)
      || !isOpaqueResourceId(value.resourceId)) {
      throw new StageFailure("invalid_request", 65);
    }
    return {
      databaseUrlFd: value.databaseUrlFd,
      resourceId: value.resourceId,
    };
  }
  const keys = [
    "sourceFd", "databaseUrlFd", "oldKeyFd", "targetKeyFd",
    "targetHmacKeyFd", "manifestFile", "resourceId",
  ];
  if (Object.keys(value).length !== keys.length
    || !isDescriptor(value.sourceFd)
    || !isDescriptor(value.databaseUrlFd)
    || !isDescriptor(value.oldKeyFd)
    || !isDescriptor(value.targetKeyFd)
    || !isDescriptor(value.targetHmacKeyFd)
    || typeof value.manifestFile !== "string"
    || !isAbsolute(value.manifestFile)
    || !isOpaqueResourceId(value.resourceId)) {
    throw new StageFailure("invalid_request", 65);
  }
  return {
    sourceFd: value.sourceFd,
    databaseUrlFd: value.databaseUrlFd,
    oldKeyFd: value.oldKeyFd,
    targetKeyFd: value.targetKeyFd,
    targetHmacKeyFd: value.targetHmacKeyFd,
    manifestFile: value.manifestFile,
    resourceId: value.resourceId,
  };
}

function readInheritedBytes(fd: number): Buffer {
  try {
    const bytes = readFileSync(fd);
    if (bytes.length === 0) throw new StageFailure("invalid_descriptor", 65);
    return bytes;
  } catch (error) {
    if (error instanceof StageFailure) throw error;
    throw new StageFailure("invalid_descriptor", 65);
  }
}

function readRequest(fd: number): unknown {
  try {
    return JSON.parse(readInheritedBytes(fd).toString("utf8"));
  } catch (error) {
    if (error instanceof StageFailure && error.code === "invalid_descriptor") throw error;
    throw new StageFailure("invalid_request", 65);
  }
}

function verifiedRequest(mode: StageMode, request: DescriptorRequest):
  InitializeRequest | MigrateRequest | CapacityRequest {
  if (mode === "initialize") {
    return {
      databaseUrl: readInheritedBytes((request as InitializeDescriptorRequest).databaseUrlFd),
    };
  }
  if (mode === "capacity") {
    const capacity = request as CapacityDescriptorRequest;
    return {
      databaseUrl: readInheritedBytes(capacity.databaseUrlFd),
      resourceId: capacity.resourceId,
    };
  }
  const migrate = request as MigrateDescriptorRequest;
  return {
    source: readInheritedBytes(migrate.sourceFd),
    databaseUrl: readInheritedBytes(migrate.databaseUrlFd),
    oldKey: readInheritedBytes(migrate.oldKeyFd),
    targetKey: readInheritedBytes(migrate.targetKeyFd),
    targetHmacKey: readInheritedBytes(migrate.targetHmacKeyFd),
    manifestFile: migrate.manifestFile,
    resourceId: migrate.resourceId,
  };
}

export async function withPrivateSnapshotCopy<T>(
  source: Buffer,
  operation: (sourcePath: string) => Promise<T>,
  parentDirectory = tmpdir(),
): Promise<T> {
  const directory = await mkdtemp(join(parentDirectory, "phase5-stage-snapshot-"));
  const sourcePath = join(directory, "snapshot.sqlite");
  try {
    await chmod(directory, 0o700);
    const handle = await open(sourcePath, "wx", 0o600);
    try {
      await handle.writeFile(source);
      await handle.sync();
    } finally {
      await handle.close();
    }
    return await operation(sourcePath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const databaseUrl = (bytes: Buffer): string => {
  const value = bytes.toString("utf8").trim();
  if (!value) throw new StageFailure("invalid_descriptor", 65);
  return value;
};

async function initializeDatabase(request: InitializeRequest): Promise<unknown> {
  const database = createDatabase(databaseUrl(request.databaseUrl));
  try {
    const result = await migrateToLatest(database);
    if (result.error) throw result.error;
    return { migrations: result.results?.filter((item) => item.status === "Success").length ?? 0 };
  } finally {
    await destroyDatabase(database);
  }
}

async function migrateDatabase(
  request: MigrateRequest,
): Promise<ResourceBoundResult<unknown>> {
  const migrationInput: Omit<MigrationVerifiedInput, "sourcePath"> = {
    databaseUrl: databaseUrl(request.databaseUrl),
    oldMasterKey: request.oldKey,
    targetKey: request.targetKey,
    targetHmacKey: request.targetHmacKey,
    manifestPath: request.manifestFile,
  };
  const report = await withPrivateSnapshotCopy(
    request.source,
    (sourcePath) => runMigrationFromVerifiedInput({ ...migrationInput, sourcePath }),
  );
  return { resourceId: request.resourceId, report };
}

async function runCapacity(
  request: CapacityRequest,
): Promise<ResourceBoundResult<Phase5LoadReport>> {
  process.env.TEST_DATABASE_URL = databaseUrl(request.databaseUrl);
  let harness: Awaited<ReturnType<typeof createPhase5ScaleHarness>> | undefined;
  try {
    harness = await createPhase5ScaleHarness(PHASE5_SCALE_PROFILE);
    const report = await runPhase5Load(harness, PHASE5_SCALE_PROFILE);
    if (report.status !== "PASS") throw new StageFailure("capacity_contract_failed", 1);
    return { resourceId: request.resourceId, report };
  } finally {
    delete process.env.TEST_DATABASE_URL;
    if (harness) await harness.stop();
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
  writeResult,
};

function safeFailure(error: unknown): StageFailure {
  if (error instanceof StageFailure) return error;
  return new StageFailure("stage_failed", 1);
}

const resultSchema = {
  schemaVersion: "phase5-rehearsal-stage-result-v2" as const,
};

export async function executeStage(
  argv: readonly string[],
  dependencies: StageDependencies = defaults,
): Promise<number> {
  let parsed: ReturnType<typeof parseArguments> | undefined;
  let expectedResourceId: string | undefined;
  try {
    parsed = parseArguments(argv);
    const descriptorRequest = validateRequest(parsed.mode, readRequest(parsed.requestFd));
    if (parsed.mode !== "initialize") {
      expectedResourceId = (descriptorRequest as MigrateDescriptorRequest | CapacityDescriptorRequest)
        .resourceId;
    }
    const request = verifiedRequest(parsed.mode, descriptorRequest);
    if (parsed.mode === "initialize") {
      const details = await dependencies.initialize(request as InitializeRequest);
      await dependencies.writeResult(parsed.resultFile, {
        ...resultSchema,
        mode: parsed.mode,
        status: "passed",
        details,
      });
    } else {
      const resourceRequest = request as MigrateRequest | CapacityRequest;
      const details = parsed.mode === "migrate"
        ? await dependencies.migrate(resourceRequest as MigrateRequest)
        : await dependencies.capacity(resourceRequest as CapacityRequest);
      if (details.resourceId !== resourceRequest.resourceId) {
        throw new StageFailure("resource_mismatch", 65);
      }
      await dependencies.writeResult(parsed.resultFile, {
        ...resultSchema,
        mode: parsed.mode,
        status: "passed",
        resourceId: resourceRequest.resourceId,
        details: details.report,
      });
    }
    return 0;
  } catch (error) {
    const failure = safeFailure(error);
    if (parsed) {
      await dependencies.writeResult(parsed.resultFile, {
        ...resultSchema,
        mode: parsed.mode,
        status: "failed",
        ...(expectedResourceId ? { resourceId: expectedResourceId } : {}),
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
