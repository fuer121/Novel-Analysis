import { sql, type Kysely } from "kysely";
import type { Migration } from "kysely/migration";

export const collaborationMigration: Migration = {
  async up(database: Kysely<unknown>) {
    await database.schema
      .createTable("users")
      .addColumn("id", "uuid", (column) =>
        column.primaryKey().defaultTo(sql`gen_random_uuid()`),
      )
      .addColumn("display_name", "text", (column) => column.notNull())
      .addColumn("avatar_url", "text")
      .addColumn("role", "text", (column) => column.notNull())
      .addColumn("status", "text", (column) => column.notNull())
      .addColumn("created_at", "timestamptz", (column) =>
        column.notNull().defaultTo(sql`now()`),
      )
      .addColumn("updated_at", "timestamptz", (column) =>
        column.notNull().defaultTo(sql`now()`),
      )
      .addCheckConstraint("users_role_check", sql`role in ('admin', 'member')`)
      .addCheckConstraint(
        "users_status_check",
        sql`status in ('active', 'disabled')`,
      )
      .execute();

    await database.schema
      .createTable("auth_identities")
      .addColumn("id", "uuid", (column) =>
        column.primaryKey().defaultTo(sql`gen_random_uuid()`),
      )
      .addColumn("user_id", "uuid", (column) => column.notNull())
      .addColumn("provider", "text", (column) => column.notNull())
      .addColumn("subject", "text", (column) => column.notNull())
      .addColumn("created_at", "timestamptz", (column) =>
        column.notNull().defaultTo(sql`now()`),
      )
      .addForeignKeyConstraint(
        "auth_identities_user_id_fk",
        ["user_id"],
        "users",
        ["id"],
        (constraint) => constraint.onDelete("cascade"),
      )
      .addUniqueConstraint("auth_identities_provider_subject_unique", [
        "provider",
        "subject",
      ])
      .execute();

    await database.schema
      .createTable("oauth_states")
      .addColumn("id", "uuid", (column) =>
        column.primaryKey().defaultTo(sql`gen_random_uuid()`),
      )
      .addColumn("state_hash", "text", (column) => column.notNull())
      .addColumn("return_to", "text", (column) => column.notNull())
      .addColumn("expires_at", "timestamptz", (column) => column.notNull())
      .addColumn("consumed_at", "timestamptz")
      .addColumn("created_at", "timestamptz", (column) =>
        column.notNull().defaultTo(sql`now()`),
      )
      .addUniqueConstraint("oauth_states_state_hash_unique", ["state_hash"])
      .execute();

    await database.schema
      .createIndex("oauth_states_expires_at_idx")
      .on("oauth_states")
      .column("expires_at")
      .execute();

    await database.schema
      .createTable("sessions")
      .addColumn("id", "uuid", (column) =>
        column.primaryKey().defaultTo(sql`gen_random_uuid()`),
      )
      .addColumn("user_id", "uuid", (column) => column.notNull())
      .addColumn("token_hash", "text", (column) => column.notNull())
      .addColumn("csrf_token_hash", "text")
      .addColumn("expires_at", "timestamptz", (column) => column.notNull())
      .addColumn("revoked_at", "timestamptz")
      .addColumn("created_at", "timestamptz", (column) =>
        column.notNull().defaultTo(sql`now()`),
      )
      .addColumn("last_seen_at", "timestamptz", (column) =>
        column.notNull().defaultTo(sql`now()`),
      )
      .addForeignKeyConstraint("sessions_user_id_fk", ["user_id"], "users", ["id"],
        (constraint) => constraint.onDelete("cascade"),
      )
      .addUniqueConstraint("sessions_token_hash_unique", ["token_hash"])
      .execute();

    await sql`
      create index sessions_active_user_idx
      on sessions (user_id, expires_at)
      where revoked_at is null
    `.execute(database);

    await database.schema
      .createTable("audit_logs")
      .addColumn("id", "bigint", (column) =>
        column.primaryKey().generatedAlwaysAsIdentity(),
      )
      .addColumn("actor_user_id", "uuid")
      .addColumn("action", "text", (column) => column.notNull())
      .addColumn("target_type", "text", (column) => column.notNull())
      .addColumn("target_id", "text", (column) => column.notNull())
      .addColumn("metadata", "jsonb", (column) =>
        column.notNull().defaultTo(sql`'{}'::jsonb`),
      )
      .addColumn("created_at", "timestamptz", (column) =>
        column.notNull().defaultTo(sql`now()`),
      )
      .addForeignKeyConstraint(
        "audit_logs_actor_user_id_fk",
        ["actor_user_id"],
        "users",
        ["id"],
        (constraint) => constraint.onDelete("set null"),
      )
      .execute();
  },

  async down(database: Kysely<unknown>) {
    await database.schema.dropTable("audit_logs").execute();
    await database.schema.dropTable("sessions").execute();
    await database.schema.dropTable("oauth_states").execute();
    await database.schema.dropTable("auth_identities").execute();
    await database.schema.dropTable("users").execute();
  },
};
