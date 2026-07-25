import { timingSafeEqual } from "node:crypto";
import {
  createContentCipher,
  createDatabase,
  destroyDatabase,
} from "@novel-analysis/database";
import { runMigration, type MigrationRunResult } from "./run.js";

export type MigrationVerifiedInput = Readonly<{
  sourcePath: string;
  databaseUrl: string;
  oldMasterKey: Buffer;
  targetKey: Buffer;
  targetHmacKey: Buffer;
  manifestPath: string;
}>;

const sameKey = (left: Buffer, right: Buffer): boolean =>
  left.length === right.length && timingSafeEqual(left, right);

export async function runMigrationFromVerifiedInput(
  args: MigrationVerifiedInput,
): Promise<MigrationRunResult> {
  const { oldMasterKey, targetKey, targetHmacKey } = args;
  if ([oldMasterKey, targetKey, targetHmacKey].some((key) => key.length !== 32)) {
    throw new Error("invalid_key_file");
  }
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
