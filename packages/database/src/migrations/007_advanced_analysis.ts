import { sql, type ColumnDefinitionBuilder } from "kysely";
import type { Migration } from "kysely/migration";

const uuid = (column: ColumnDefinitionBuilder) => column.primaryKey().defaultTo(sql`gen_random_uuid()`);
const created = (column: ColumnDefinitionBuilder) => column.notNull().defaultTo(sql`now()`);

export const advancedAnalysisMigration: Migration = {
  async up(db) {
    await db.schema.createTable("analysis_templates")
      .addColumn("id", "uuid", uuid).addColumn("book_id", "uuid", (c) => c.notNull()).addColumn("created_by", "uuid", (c) => c.notNull())
      .addColumn("name", "text", (c) => c.notNull()).addColumn("current_version_id", "uuid").addColumn("index_group_id", "uuid")
      .addColumn("created_at", "timestamptz", created).addColumn("updated_at", "timestamptz", created)
      .addForeignKeyConstraint("analysis_templates_book_id_fk", ["book_id"], "books", ["id"], (c) => c.onDelete("cascade"))
      .addForeignKeyConstraint("analysis_templates_created_by_fk", ["created_by"], "users", ["id"])
      .addForeignKeyConstraint("analysis_templates_index_group_book_fk", ["index_group_id", "book_id"], "index_groups", ["id", "book_id"])
      .execute();
    await db.schema.createIndex("analysis_templates_book_owner_updated_idx").on("analysis_templates").columns(["book_id", "created_by", "updated_at", "id"]).execute();

    await db.schema.createTable("analysis_template_versions")
      .addColumn("id", "uuid", uuid).addColumn("template_id", "uuid", (c) => c.notNull()).addColumn("version", "integer", (c) => c.notNull())
      .addColumn("prompt_ciphertext", "bytea", (c) => c.notNull()).addColumn("prompt_nonce", "bytea", (c) => c.notNull()).addColumn("prompt_tag", "bytea", (c) => c.notNull()).addColumn("prompt_key_version", "text", (c) => c.notNull())
      .addColumn("schema_ciphertext", "bytea", (c) => c.notNull()).addColumn("schema_nonce", "bytea", (c) => c.notNull()).addColumn("schema_tag", "bytea", (c) => c.notNull()).addColumn("schema_key_version", "text", (c) => c.notNull())
      .addColumn("content_hash", "text", (c) => c.notNull()).addColumn("created_at", "timestamptz", created)
      .addForeignKeyConstraint("analysis_template_versions_template_id_fk", ["template_id"], "analysis_templates", ["id"], (c) => c.onDelete("cascade"))
      .addUniqueConstraint("analysis_template_versions_template_version_unique", ["template_id", "version"])
      .addUniqueConstraint("analysis_template_versions_id_template_unique", ["id", "template_id"])
      .addCheckConstraint("analysis_template_versions_version_check", sql`version > 0`).execute();
    await sql`alter table analysis_templates add constraint analysis_templates_current_version_id_fk foreign key (current_version_id, id) references analysis_template_versions(id, template_id)`.execute(db);
    await sql`create function reject_analysis_template_version_mutation() returns trigger language plpgsql as $$ begin raise exception 'analysis template versions are immutable'; end $$`.execute(db);
    await sql`create trigger analysis_template_versions_immutable before update or delete on analysis_template_versions for each row execute function reject_analysis_template_version_mutation()`.execute(db);

    await db.schema.createTable("analysis_runs")
      .addColumn("id", "uuid", uuid).addColumn("book_id", "uuid", (c) => c.notNull()).addColumn("created_by", "uuid", (c) => c.notNull()).addColumn("template_version_id", "uuid", (c) => c.notNull()).addColumn("job_id", "uuid", (c) => c.notNull().unique())
      .addColumn("mode", "text", (c) => c.notNull()).addColumn("start_chapter", "integer", (c) => c.notNull()).addColumn("end_chapter", "integer", (c) => c.notNull()).addColumn("status", "text", (c) => c.notNull()).addColumn("execution_signature", "text", (c) => c.notNull())
      .addColumn("completed_parts", "integer", (c) => c.notNull().defaultTo(0)).addColumn("total_parts", "integer", (c) => c.notNull())
      .addColumn("result_ciphertext", "bytea").addColumn("result_nonce", "bytea").addColumn("result_tag", "bytea").addColumn("result_key_version", "text")
      .addColumn("diagnostics", "jsonb", (c) => c.notNull().defaultTo(sql`'[]'::jsonb`)).addColumn("error_code", "text")
      .addColumn("created_at", "timestamptz", created).addColumn("updated_at", "timestamptz", created)
      .addForeignKeyConstraint("analysis_runs_book_id_fk", ["book_id"], "books", ["id"], (c) => c.onDelete("cascade")).addForeignKeyConstraint("analysis_runs_created_by_fk", ["created_by"], "users", ["id"])
      .addForeignKeyConstraint("analysis_runs_template_version_id_fk", ["template_version_id"], "analysis_template_versions", ["id"]).addForeignKeyConstraint("analysis_runs_job_id_fk", ["job_id"], "jobs", ["id"], (c) => c.onDelete("cascade"))
      .addCheckConstraint("analysis_runs_mode_check", sql`mode in ('fast_index','balanced','precision','full_text')`).addCheckConstraint("analysis_runs_status_check", sql`status in ('queued','running','retrying','paused','completed','failed','cancelled')`)
      .addCheckConstraint("analysis_runs_range_check", sql`start_chapter > 0 and end_chapter >= start_chapter`).addCheckConstraint("analysis_runs_progress_check", sql`total_parts >= 0 and completed_parts >= 0 and completed_parts <= total_parts`)
      .addCheckConstraint("analysis_runs_execution_signature_check", sql`length(btrim(execution_signature)) > 0`)
      .addCheckConstraint("analysis_runs_result_tuple_check", sql`((result_ciphertext is null and result_nonce is null and result_tag is null and result_key_version is null) or (result_ciphertext is not null and result_nonce is not null and result_tag is not null and result_key_version is not null)) and (status <> 'completed' or result_ciphertext is not null)`).execute();
    await sql`
      create function enforce_analysis_run_identity() returns trigger language plpgsql as $$
      begin
        perform 1 from analysis_template_versions v
          join analysis_templates t on t.id = v.template_id
          where v.id = new.template_version_id
            and t.book_id = new.book_id
            and t.created_by = new.created_by
          for share of t;
        if not found then
          raise exception 'analysis run template identity mismatch'
            using errcode = '23514', constraint = 'analysis_runs_template_identity_check';
        end if;
        perform 1 from jobs j
          where j.id = new.job_id
            and j.requested_by = new.created_by
            and j.type = 'advanced-analysis'
            and j.status = 'queued'
          for share;
        if not found then
          raise exception 'analysis run job identity mismatch'
            using errcode = '23514', constraint = 'analysis_runs_job_identity_check';
        end if;
        return new;
      end $$
    `.execute(db);
    await sql`create trigger analysis_runs_identity before insert or update of book_id, created_by, template_version_id, job_id on analysis_runs for each row execute function enforce_analysis_run_identity()`.execute(db);
    await sql`
      create function preserve_analysis_template_run_identity() returns trigger language plpgsql as $$
      begin
        if exists (
          select 1 from analysis_runs r
          join analysis_template_versions v on v.id = r.template_version_id
          where v.template_id = old.id
            and (r.book_id <> new.book_id or r.created_by <> new.created_by)
        ) then
          raise exception 'analysis template update would invalidate a run'
            using errcode = '23514', constraint = 'analysis_templates_run_identity_check';
        end if;
        return new;
      end $$
    `.execute(db);
    await sql`create trigger analysis_templates_preserve_run_identity before update of book_id, created_by on analysis_templates for each row execute function preserve_analysis_template_run_identity()`.execute(db);
    await sql`
      create function preserve_analysis_job_run_identity() returns trigger language plpgsql as $$
      begin
        if exists (
          select 1 from analysis_runs r
          where r.job_id = old.id
            and (r.created_by <> new.requested_by or new.type <> 'advanced-analysis')
        ) then
          raise exception 'analysis job update would invalidate a run'
            using errcode = '23514', constraint = 'analysis_jobs_run_identity_check';
        end if;
        return new;
      end $$
    `.execute(db);
    await sql`create trigger analysis_jobs_preserve_run_identity before update of requested_by, type on jobs for each row execute function preserve_analysis_job_run_identity()`.execute(db);
    await db.schema.createIndex("analysis_runs_book_owner_updated_idx").on("analysis_runs").columns(["book_id", "created_by", "updated_at", "id"]).execute();

    await db.schema.createTable("analysis_parts")
      .addColumn("id", "uuid", uuid).addColumn("run_id", "uuid", (c) => c.notNull()).addColumn("position", "integer", (c) => c.notNull()).addColumn("kind", "text", (c) => c.notNull()).addColumn("status", "text", (c) => c.notNull()).addColumn("input_signature", "text", (c) => c.notNull())
      .addColumn("result_ciphertext", "bytea").addColumn("result_nonce", "bytea").addColumn("result_tag", "bytea").addColumn("result_key_version", "text").addColumn("error_code", "text").addColumn("output_ref", "jsonb")
      .addColumn("created_at", "timestamptz", created).addColumn("updated_at", "timestamptz", created)
      .addForeignKeyConstraint("analysis_parts_run_id_fk", ["run_id"], "analysis_runs", ["id"], (c) => c.onDelete("cascade")).addUniqueConstraint("analysis_parts_run_position_unique", ["run_id", "position"])
      .addCheckConstraint("analysis_parts_position_check", sql`position >= 0`).addCheckConstraint("analysis_parts_kind_check", sql`length(btrim(kind)) > 0`).addCheckConstraint("analysis_parts_status_check", sql`status in ('queued','running','completed','failed','cancelled')`)
      .addCheckConstraint("analysis_parts_input_signature_check", sql`length(btrim(input_signature)) > 0`)
      .addCheckConstraint("analysis_parts_result_tuple_check", sql`((result_ciphertext is null and result_nonce is null and result_tag is null and result_key_version is null) or (result_ciphertext is not null and result_nonce is not null and result_tag is not null and result_key_version is not null)) and (status <> 'completed' or result_ciphertext is not null)`).execute();
    await db.schema.createIndex("analysis_parts_run_status_position_idx").on("analysis_parts").columns(["run_id", "status", "position"]).execute();
  },
  async down(db) {
    await db.schema.dropTable("analysis_parts").execute();
    await db.schema.dropTable("analysis_runs").execute();
    await sql`drop trigger analysis_jobs_preserve_run_identity on jobs`.execute(db);
    await sql`drop function preserve_analysis_job_run_identity()`.execute(db);
    await sql`drop function enforce_analysis_run_identity()`.execute(db);
    await sql`alter table analysis_templates drop constraint analysis_templates_current_version_id_fk`.execute(db);
    await db.schema.dropTable("analysis_template_versions").execute();
    await sql`drop function reject_analysis_template_version_mutation()`.execute(db);
    await db.schema.dropTable("analysis_templates").execute();
    await sql`drop function preserve_analysis_template_run_identity()`.execute(db);
  },
};
