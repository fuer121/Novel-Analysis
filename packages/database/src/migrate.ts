import process from "node:process";
import { pathToFileURL } from "node:url";

import { Migrator, type MigrationResultSet } from "kysely/migration";

import { createDatabase, destroyDatabase, type DatabaseConnection } from "./db.js";
import { migrationProvider } from "./migrations/index.js";

function createMigrator(database: DatabaseConnection) {
  return new Migrator({ db: database, provider: migrationProvider });
}

export function migrateToLatest(database: DatabaseConnection): Promise<MigrationResultSet> {
  return createMigrator(database).migrateToLatest();
}

export function migrateDown(database: DatabaseConnection): Promise<MigrationResultSet> {
  return createMigrator(database).migrateDown();
}

export async function runMigrations(url: string): Promise<void> {
  const database = createDatabase(url);
  try {
    const result = await migrateToLatest(database);
    if (result.error) {
      throw result.error;
    }

    const completed = result.results?.filter((migration) => migration.status === "Success") ?? [];
    if (completed.length === 0) {
      console.log("No pending migrations");
      return;
    }

    for (const migration of completed) {
      console.log(`Migrated ${migration.migrationName}`);
    }
  } finally {
    await destroyDatabase(database);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required");
    process.exitCode = 1;
  } else {
    runMigrations(url).catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
  }
}
