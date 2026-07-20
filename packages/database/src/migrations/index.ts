import type { Migration, MigrationProvider } from "kysely/migration";

import { collaborationMigration } from "./001_collaboration.js";
import { jobsMigration } from "./002_jobs.js";
import { libraryIndexingMigration } from "./003_library_indexing.js";
import { promptContentMigration } from "./004_prompt_content.js";

const migrations: Record<string, Migration> = {
  "001_collaboration": collaborationMigration,
  "002_jobs": jobsMigration,
  "003_library_indexing": libraryIndexingMigration,
  "004_prompt_content": promptContentMigration,
};

export const migrationProvider: MigrationProvider = {
  async getMigrations() {
    return migrations;
  },
};
