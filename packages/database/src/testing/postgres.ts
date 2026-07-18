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
  const admin = createDatabase(adminUrl.toString());
  const databaseName = `novel_test_${randomUUID().replaceAll("-", "")}`;
  const databaseUrl = new URL(adminUrl);
  databaseUrl.pathname = `/${databaseName}`;

  await sql`create database ${sql.id(databaseName)}`.execute(admin);
  const db = createDatabase(databaseUrl.toString());
  let destroyed = false;

  async function destroy() {
    if (destroyed) {
      return;
    }
    destroyed = true;

    await destroyDatabase(db);
    await sql`
      select pg_terminate_backend(pid)
      from pg_stat_activity
      where datname = ${databaseName} and pid <> pg_backend_pid()
    `.execute(admin);
    await sql`drop database if exists ${sql.id(databaseName)}`.execute(admin);
    await destroyDatabase(admin);
  }

  try {
    const migration = await migrateToLatest(db);
    if (migration.error) {
      throw migration.error;
    }
  } catch (error) {
    await destroy();
    throw error;
  }

  return {
    db,
    databaseName,
    databaseUrl: databaseUrl.toString(),
    destroy,
  };
}
