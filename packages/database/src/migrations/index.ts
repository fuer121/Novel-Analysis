import type { Migration, MigrationProvider } from "kysely/migration";

import { collaborationMigration } from "./001_collaboration.js";
import { jobsMigration } from "./002_jobs.js";
import { libraryIndexingMigration } from "./003_library_indexing.js";
import { promptContentMigration } from "./004_prompt_content.js";
import { indexGroupCategoryScopeMigration } from "./005_index_group_category_scope.js";
import { continuousQueriesMigration } from "./006_continuous_queries.js";
import { advancedAnalysisMigration } from "./007_advanced_analysis.js";
import { analysisExecutionSnapshotMigration } from "./008_analysis_execution_snapshot.js";

const migrations: Record<string, Migration> = {
  "001_collaboration": collaborationMigration,
  "002_jobs": jobsMigration,
  "003_library_indexing": libraryIndexingMigration,
  "004_prompt_content": promptContentMigration,
  "005_index_group_category_scope": indexGroupCategoryScopeMigration,
  "006_continuous_queries": continuousQueriesMigration,
  "007_advanced_analysis": advancedAnalysisMigration,
  "008_analysis_execution_snapshot": analysisExecutionSnapshotMigration,
};

export const migrationProvider: MigrationProvider = {
  async getMigrations() {
    return migrations;
  },
};
