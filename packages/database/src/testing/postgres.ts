import { randomUUID } from "node:crypto";

import { sql } from "kysely";

import {
  createDatabase,
  destroyDatabase,
  type DatabaseConnection,
} from "../db.js";
import { migrateToLatest } from "../migrate.js";

export interface DisposablePostgres {
  db: DatabaseConnection;
  databaseName: string;
  databaseUrl: string;
  destroy(): Promise<void>;
}

function readAdminUrl(): URL {
  const value = process.env.TEST_DATABASE_URL;
  if (!value) {
    throw new Error("TEST_DATABASE_URL is required");
  }

  const url = new URL(value);
  if (
    (url.protocol !== "postgres:" && url.protocol !== "postgresql:")
    || url.pathname !== "/postgres"
  ) {
    throw new Error("TEST_DATABASE_URL must be a PostgreSQL URL ending in /postgres");
  }

  return url;
}

export async function createDisposablePostgres(): Promise<DisposablePostgres> {
  const adminUrl = readAdminUrl();
  let admin: DatabaseConnection | undefined = createDatabase(adminUrl.toString());
  const databaseName = `novel_test_${randomUUID().replaceAll("-", "")}`;
  const databaseUrl = new URL(adminUrl);
  databaseUrl.pathname = `/${databaseName}`;
  let db: DatabaseConnection | undefined;
  let databaseDropped = true;
  let dbDestroyed = true;
  let destroyed = false;

  async function destroy() {
    if (destroyed) {
      return;
    }

    const errors: unknown[] = [];
    try {
      if (!dbDestroyed && db) {
        try {
          await destroyDatabase(db);
          dbDestroyed = true;
        } catch (error) {
          errors.push(error);
        }
      }

      if (!databaseDropped) {
        admin ??= createDatabase(adminUrl.toString());
        try {
          await sql`
            select pg_terminate_backend(pid)
            from pg_stat_activity
            where datname = ${databaseName} and pid <> pg_backend_pid()
          `.execute(admin);
          await sql`drop database if exists ${sql.id(databaseName)}`.execute(admin);
          databaseDropped = true;
        } catch (error) {
          errors.push(error);
        }
      }
    } finally {
      if (admin) {
        try {
          await destroyDatabase(admin);
          admin = undefined;
        } catch (error) {
          errors.push(error);
        }
      }
    }

    if (errors.length > 0) {
      throw new AggregateError(errors, "Failed to destroy disposable PostgreSQL database");
    }

    destroyed = dbDestroyed && databaseDropped && admin === undefined;
  }

  try {
    await sql`create database ${sql.id(databaseName)}`.execute(admin);
    databaseDropped = false;
    db = createDatabase(databaseUrl.toString());
    dbDestroyed = false;

    const migration = await migrateToLatest(db);
    if (migration.error) {
      throw migration.error;
    }
  } catch (error) {
    try {
      await destroy();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "Failed to create disposable PostgreSQL database",
        { cause: cleanupError },
      );
    }
    throw error;
  }

  return {
    db: db!,
    databaseName,
    databaseUrl: databaseUrl.toString(),
    destroy,
  };
}
