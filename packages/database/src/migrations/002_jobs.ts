import { sql, type Kysely } from "kysely";
import type { Migration } from "kysely/migration";

export const jobsMigration: Migration = {
  async up(database: Kysely<unknown>) {
    await database.schema
      .createTable("jobs")
      .addColumn("id", "uuid", (column) =>
        column.primaryKey().defaultTo(sql`gen_random_uuid()`),
      )
      .addColumn("type", "text", (column) => column.notNull())
      .addColumn("status", "text", (column) => column.notNull())
      .addColumn("requested_by", "uuid", (column) => column.notNull())
      .addColumn("request_id", "text", (column) => column.notNull())
      .addColumn("scope", "jsonb", (column) => column.notNull())
      .addColumn("config_snapshot", "jsonb", (column) => column.notNull())
      .addColumn("concurrency_key", "text")
      .addColumn("progress", "jsonb", (column) => column.notNull())
      .addColumn("created_at", "timestamptz", (column) =>
        column.notNull().defaultTo(sql`now()`),
      )
      .addColumn("updated_at", "timestamptz", (column) =>
        column.notNull().defaultTo(sql`now()`),
      )
      .addForeignKeyConstraint("jobs_requested_by_fk", ["requested_by"], "users", ["id"])
      .addUniqueConstraint("jobs_requested_by_request_id_unique", [
        "requested_by",
        "request_id",
      ])
      .addCheckConstraint(
        "jobs_status_check",
        sql`status in (
          'queued', 'running', 'retrying', 'paused',
          'completed', 'failed', 'cancelled'
        )`,
      )
      .execute();

    await sql`
      create unique index jobs_active_concurrency_unique
      on jobs (concurrency_key)
      where concurrency_key is not null
        and status in ('queued', 'running', 'retrying', 'paused')
    `.execute(database);

    await database.schema
      .createTable("job_steps")
      .addColumn("id", "uuid", (column) =>
        column.primaryKey().defaultTo(sql`gen_random_uuid()`),
      )
      .addColumn("job_id", "uuid", (column) => column.notNull())
      .addColumn("position", "integer", (column) => column.notNull())
      .addColumn("kind", "text", (column) => column.notNull())
      .addColumn("status", "text", (column) => column.notNull())
      .addColumn("input_signature", "text", (column) => column.notNull())
      .addColumn("idempotency_key", "text", (column) => column.notNull())
      .addColumn("output_ref", "jsonb")
      .addColumn("lease_owner", "text")
      .addColumn("lease_expires_at", "timestamptz")
      .addColumn("attempt_count", "integer", (column) =>
        column.notNull().defaultTo(0),
      )
      .addColumn("created_at", "timestamptz", (column) =>
        column.notNull().defaultTo(sql`now()`),
      )
      .addColumn("updated_at", "timestamptz", (column) =>
        column.notNull().defaultTo(sql`now()`),
      )
      .addForeignKeyConstraint("job_steps_job_id_fk", ["job_id"], "jobs", ["id"],
        (constraint) => constraint.onDelete("cascade"),
      )
      .addUniqueConstraint("job_steps_job_id_position_unique", ["job_id", "position"])
      .addUniqueConstraint("job_steps_idempotency_key_unique", ["idempotency_key"])
      .addCheckConstraint(
        "job_steps_status_check",
        sql`status in ('queued', 'running', 'completed', 'failed', 'cancelled')`,
      )
      .addCheckConstraint("job_steps_position_check", sql`position >= 0`)
      .addCheckConstraint("job_steps_attempt_count_check", sql`attempt_count >= 0`)
      .execute();

    await sql`
      create index job_steps_claim_idx
      on job_steps (status, lease_expires_at, job_id, position)
      where status in ('queued', 'running')
    `.execute(database);

    await database.schema
      .createTable("job_attempts")
      .addColumn("id", "uuid", (column) =>
        column.primaryKey().defaultTo(sql`gen_random_uuid()`),
      )
      .addColumn("step_id", "uuid", (column) => column.notNull())
      .addColumn("attempt_no", "integer", (column) => column.notNull())
      .addColumn("worker_id", "text", (column) => column.notNull())
      .addColumn("status", "text", (column) => column.notNull())
      .addColumn("error_code", "text")
      .addColumn("error_message", "text")
      .addColumn("started_at", "timestamptz", (column) => column.notNull())
      .addColumn("finished_at", "timestamptz")
      .addForeignKeyConstraint(
        "job_attempts_step_id_fk",
        ["step_id"],
        "job_steps",
        ["id"],
        (constraint) => constraint.onDelete("cascade"),
      )
      .addUniqueConstraint("job_attempts_step_id_attempt_no_unique", [
        "step_id",
        "attempt_no",
      ])
      .addCheckConstraint("job_attempts_attempt_no_check", sql`attempt_no > 0`)
      .addCheckConstraint(
        "job_attempts_status_check",
        sql`status in ('running', 'completed', 'failed', 'abandoned', 'cancelled')`,
      )
      .execute();

    await database.schema
      .createTable("job_events")
      .addColumn("id", "bigint", (column) =>
        column.primaryKey().generatedAlwaysAsIdentity(),
      )
      .addColumn("job_id", "uuid", (column) => column.notNull())
      .addColumn("type", "text", (column) => column.notNull())
      .addColumn("dedupe_key", "text", (column) => column.notNull())
      .addColumn("payload", "jsonb", (column) => column.notNull())
      .addColumn("created_at", "timestamptz", (column) =>
        column.notNull().defaultTo(sql`now()`),
      )
      .addForeignKeyConstraint("job_events_job_id_fk", ["job_id"], "jobs", ["id"],
        (constraint) => constraint.onDelete("cascade"),
      )
      .addUniqueConstraint("job_events_job_id_dedupe_key_unique", ["job_id", "dedupe_key"])
      .execute();

    await database.schema
      .createIndex("job_events_job_cursor_idx")
      .on("job_events")
      .columns(["job_id", "id"])
      .execute();

    await database.schema
      .createTable("job_outbox")
      .addColumn("id", "uuid", (column) =>
        column.primaryKey().defaultTo(sql`gen_random_uuid()`),
      )
      .addColumn("job_id", "uuid", (column) => column.notNull())
      .addColumn("topic", "text", (column) => column.notNull())
      .addColumn("payload", "jsonb", (column) => column.notNull())
      .addColumn("available_at", "timestamptz", (column) =>
        column.notNull().defaultTo(sql`now()`),
      )
      .addColumn("claimed_by", "text")
      .addColumn("claim_expires_at", "timestamptz")
      .addColumn("delivered_at", "timestamptz")
      .addColumn("created_at", "timestamptz", (column) =>
        column.notNull().defaultTo(sql`now()`),
      )
      .addForeignKeyConstraint("job_outbox_job_id_fk", ["job_id"], "jobs", ["id"],
        (constraint) => constraint.onDelete("cascade"),
      )
      .execute();

    await sql`
      create index job_outbox_pending_idx
      on job_outbox (available_at, claim_expires_at)
      where delivered_at is null
    `.execute(database);
  },

  async down(database: Kysely<unknown>) {
    await database.schema.dropTable("job_outbox").execute();
    await database.schema.dropTable("job_events").execute();
    await database.schema.dropTable("job_attempts").execute();
    await database.schema.dropTable("job_steps").execute();
    await database.schema.dropTable("jobs").execute();
  },
};
