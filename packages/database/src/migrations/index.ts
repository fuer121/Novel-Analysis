import type { Migration, MigrationProvider } from "kysely/migration";

import { collaborationMigration } from "./001_collaboration.js";
import { jobsMigration } from "./002_jobs.js";

const migrations: Record<string, Migration> = {
  "001_collaboration": collaborationMigration,
  "002_jobs": jobsMigration,
};

export const migrationProvider: MigrationProvider = {
  async getMigrations() {
    return migrations;
  },
};
