import { sql } from "kysely";
import type { Migration } from "kysely/migration";

export const analysisExecutionSnapshotMigration: Migration = {
  async up(db) {
    await db.schema.alterTable("analysis_runs").addColumn("execution_snapshot_ciphertext", "bytea").execute();
    await db.schema.alterTable("analysis_runs").addColumn("execution_snapshot_nonce", "bytea").execute();
    await db.schema.alterTable("analysis_runs").addColumn("execution_snapshot_auth_tag", "bytea").execute();
    await db.schema.alterTable("analysis_runs").addColumn("execution_snapshot_key_version", "text").execute();
    await db.schema.alterTable("analysis_runs").addCheckConstraint("analysis_runs_execution_snapshot_tuple_check", sql`(execution_snapshot_ciphertext is null and execution_snapshot_nonce is null and execution_snapshot_auth_tag is null and execution_snapshot_key_version is null) or (execution_snapshot_ciphertext is not null and execution_snapshot_nonce is not null and execution_snapshot_auth_tag is not null and execution_snapshot_key_version is not null)`).execute();
  },
  async down(db) {
    await db.schema.alterTable("analysis_runs").dropConstraint("analysis_runs_execution_snapshot_tuple_check").execute();
    await db.schema.alterTable("analysis_runs").dropColumn("execution_snapshot_key_version").execute();
    await db.schema.alterTable("analysis_runs").dropColumn("execution_snapshot_auth_tag").execute();
    await db.schema.alterTable("analysis_runs").dropColumn("execution_snapshot_nonce").execute();
    await db.schema.alterTable("analysis_runs").dropColumn("execution_snapshot_ciphertext").execute();
  },
};
