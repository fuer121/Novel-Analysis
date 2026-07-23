import { timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import {
  createContentCipher,
  createDatabase,
  destroyDatabase,
} from "@novel-analysis/database";
import { runMigration, type MigrationRunResult } from "./run.js";
import { MigrationHardFailure } from "./validate.js";

const REQUIRED_OPTIONS = [
  "--source",
  "--database-url",
  "--old-key-file",
  "--target-key-file",
  "--target-hmac-key-file",
  "--manifest",
] as const;

const INLINE_KEY_OPTIONS = new Set([
  "--old-key", "--target-key", "--target-hmac-key",
  "--old-master-key", "--content-key", "--hmac-key",
]);

export type MigrationCliArgs = Readonly<{
  sourcePath: string;
  databaseUrl: string;
  oldKeyFile: string;
  targetKeyFile: string;
  targetHmacKeyFile: string;
  manifestPath: string;
}>;

const propertyByOption: Record<typeof REQUIRED_OPTIONS[number], keyof MigrationCliArgs> = {
  "--source": "sourcePath",
  "--database-url": "databaseUrl",
  "--old-key-file": "oldKeyFile",
  "--target-key-file": "targetKeyFile",
  "--target-hmac-key-file": "targetHmacKeyFile",
  "--manifest": "manifestPath",
};

export function parseMigrationCliArgs(argv: readonly string[]): MigrationCliArgs {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const option = argv[index];
    const value = argv[index + 1];
    if (!option?.startsWith("--")) throw new Error("unexpected_positional_argument");
    if (INLINE_KEY_OPTIONS.has(option)) throw new Error("inline_keys_forbidden");
    if (!(REQUIRED_OPTIONS as readonly string[]).includes(option)) {
      throw new Error(`unknown_argument:${option}`);
    }
    if (values.has(option)) throw new Error(`duplicate_argument:${option}`);
    if (value === undefined || value.startsWith("--") || value.length === 0) {
      throw new Error(`missing_argument_value:${option}`);
    }
    values.set(option, value);
  }
  for (const option of REQUIRED_OPTIONS) {
    if (!values.has(option)) throw new Error(`missing_required_argument:${option}`);
  }
  return Object.freeze(Object.fromEntries(
    REQUIRED_OPTIONS.map((option) => [propertyByOption[option], values.get(option)!]),
  ) as unknown as MigrationCliArgs);
}

type ExecuteDependencies = Readonly<{
  run(args: MigrationCliArgs): Promise<MigrationRunResult>;
  stdout(value: string): void;
  stderr(value: string): void;
}>;

const safeErrorCode = (error: unknown): string => {
  if (error instanceof MigrationHardFailure) return error.message;
  if (error instanceof Error && (
    error.message.startsWith("missing_required_argument:")
    || error.message.startsWith("missing_argument_value:")
    || error.message.startsWith("unknown_argument:")
    || error.message.startsWith("duplicate_argument:")
    || [
      "unexpected_positional_argument", "inline_keys_forbidden",
      "manifest_exists", "target_not_empty", "target_book_present",
      "source_decrypt_failed", "source_hmac_mismatch",
      "target_encrypt_failed", "forced_mid_book_failure",
      "invalid_key_file", "migration_admin_required",
      "migration_keys_must_be_distinct",
    ].includes(error.message)
  )) return error.message;
  return "unexpected_error";
};

export async function executeMigrationCli(
  argv: readonly string[],
  overrides: Partial<ExecuteDependencies> = {},
): Promise<number> {
  const dependencies: ExecuteDependencies = {
    run: runFromCli,
    stdout: (value) => process.stdout.write(value),
    stderr: (value) => process.stderr.write(value),
    ...overrides,
  };
  try {
    const result = await dependencies.run(parseMigrationCliArgs(argv));
    dependencies.stdout(`${JSON.stringify(result)}\n`);
    return 0;
  } catch (error) {
    dependencies.stderr(`migration_failed:${safeErrorCode(error)}\n`);
    return 1;
  }
}

const readKey = async (filePath: string): Promise<Buffer> => {
  const value = await readFile(filePath);
  if (value.length !== 32) throw new Error("invalid_key_file");
  return value;
};

const sameKey = (left: Buffer, right: Buffer): boolean =>
  left.length === right.length && timingSafeEqual(left, right);

async function runFromCli(args: MigrationCliArgs): Promise<MigrationRunResult> {
  const [oldMasterKey, targetKey, targetHmacKey] = await Promise.all([
    readKey(args.oldKeyFile),
    readKey(args.targetKeyFile),
    readKey(args.targetHmacKeyFile),
  ]);
  if (sameKey(oldMasterKey, targetKey)
    || sameKey(oldMasterKey, targetHmacKey)
    || sameKey(targetKey, targetHmacKey)) {
    throw new Error("migration_keys_must_be_distinct");
  }
  const database = createDatabase(args.databaseUrl);
  try {
    const admins = await database.selectFrom("users")
      .select("id")
      .where("role", "=", "admin")
      .where("status", "=", "active")
      .limit(2)
      .execute();
    if (admins.length !== 1) throw new Error("migration_admin_required");
    return await runMigration({
      sourcePath: args.sourcePath,
      database,
      createdBy: admins[0]!.id,
      oldMasterKey,
      targetCipher: createContentCipher({
        activeKeyVersion: "migration-v1",
        keys: { "migration-v1": targetKey },
      }),
      targetHmacKey,
      manifestPath: args.manifestPath,
      targetSchemaVersion: "007_advanced_analysis",
    });
  } finally {
    await destroyDatabase(database);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await executeMigrationCli(process.argv.slice(2));
}
