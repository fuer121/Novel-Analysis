import { sql, type ColumnDefinitionBuilder } from "kysely";
import type { Migration } from "kysely/migration";

const uuid = (column: ColumnDefinitionBuilder) => column.primaryKey().defaultTo(sql`gen_random_uuid()`);
const created = (column: ColumnDefinitionBuilder) => column.notNull().defaultTo(sql`now()`);

export const continuousQueriesMigration: Migration = {
  async up(db) {
    await sql`alter table workflow_versions drop constraint workflow_versions_target_check`.execute(db);
    await sql`alter table workflow_versions add constraint workflow_versions_target_check check (target in ('chapter-import','l1-index','l2-index','analysis-summary'))`.execute(db);

    await db.schema.createTable("query_sessions")
      .addColumn("id", "uuid", uuid)
      .addColumn("book_id", "uuid", (column) => column.notNull())
      .addColumn("group_id", "uuid", (column) => column.notNull())
      .addColumn("created_by", "uuid", (column) => column.notNull())
      .addColumn("visibility", "text", (column) => column.notNull().defaultTo("private"))
      .addColumn("default_start_chapter", "integer", (column) => column.notNull())
      .addColumn("default_end_chapter", "integer", (column) => column.notNull())
      .addColumn("title_ciphertext", "bytea", (column) => column.notNull())
      .addColumn("title_nonce", "bytea", (column) => column.notNull())
      .addColumn("title_tag", "bytea", (column) => column.notNull())
      .addColumn("title_key_version", "text", (column) => column.notNull())
      .addColumn("archived_at", "timestamptz")
      .addColumn("created_at", "timestamptz", created)
      .addColumn("updated_at", "timestamptz", created)
      .addForeignKeyConstraint("query_sessions_group_book_fk", ["group_id", "book_id"], "index_groups", ["id", "book_id"], (constraint) => constraint.onDelete("cascade"))
      .addForeignKeyConstraint("query_sessions_created_by_fk", ["created_by"], "users", ["id"])
      .addCheckConstraint("query_sessions_visibility_check", sql`visibility in ('private','team')`)
      .addCheckConstraint("query_sessions_range_check", sql`default_start_chapter > 0 and default_end_chapter >= default_start_chapter`)
      .execute();
    await db.schema.createIndex("query_sessions_book_owner_updated_idx").on("query_sessions").columns(["book_id", "created_by", "updated_at", "id"]).execute();

    await db.schema.createTable("query_turns")
      .addColumn("id", "uuid", uuid)
      .addColumn("session_id", "uuid", (column) => column.notNull())
      .addColumn("created_by", "uuid", (column) => column.notNull())
      .addColumn("question_ciphertext", "bytea", (column) => column.notNull())
      .addColumn("question_nonce", "bytea", (column) => column.notNull())
      .addColumn("question_tag", "bytea", (column) => column.notNull())
      .addColumn("question_key_version", "text", (column) => column.notNull())
      .addColumn("question_hmac", "text", (column) => column.notNull())
      .addColumn("answer_ciphertext", "bytea")
      .addColumn("answer_nonce", "bytea")
      .addColumn("answer_tag", "bytea")
      .addColumn("answer_key_version", "text")
      .addColumn("start_chapter", "integer", (column) => column.notNull())
      .addColumn("end_chapter", "integer", (column) => column.notNull())
      .addColumn("intent_snapshot", "jsonb", (column) => column.notNull())
      .addColumn("source_snapshot", "jsonb", (column) => column.notNull())
      .addColumn("gap_snapshot", "jsonb", (column) => column.notNull())
      .addColumn("config_snapshot", "jsonb", (column) => column.notNull())
      .addColumn("execution_signature", "text", (column) => column.notNull())
      .addColumn("evidence_snapshot_hash", "text")
      .addColumn("status", "text", (column) => column.notNull().defaultTo("queued"))
      .addColumn("job_id", "uuid")
      .addColumn("attempt_id", "uuid")
      .addColumn("degradation", "text")
      .addColumn("created_at", "timestamptz", created)
      .addColumn("updated_at", "timestamptz", created)
      .addColumn("completed_at", "timestamptz")
      .addForeignKeyConstraint("query_turns_session_id_fk", ["session_id"], "query_sessions", ["id"], (constraint) => constraint.onDelete("cascade"))
      .addForeignKeyConstraint("query_turns_created_by_fk", ["created_by"], "users", ["id"])
      .addForeignKeyConstraint("query_turns_job_id_fk", ["job_id"], "jobs", ["id"])
      .addForeignKeyConstraint("query_turns_attempt_id_fk", ["attempt_id"], "job_attempts", ["id"])
      .addCheckConstraint("query_turns_status_check", sql`status in ('queued','running','awaiting_fallback','completed','degraded','failed','cancelled')`)
      .addCheckConstraint("query_turns_range_check", sql`start_chapter > 0 and end_chapter >= start_chapter`)
      .addCheckConstraint("query_turns_question_hmac_check", sql`question_hmac ~ '^[0-9a-f]{64}$'`)
      .addCheckConstraint("query_turns_execution_signature_check", sql`execution_signature ~ '^[0-9a-f]{64}$'`)
      .addCheckConstraint("query_turns_degradation_check", sql`degradation is null or (length(degradation) <= 32 and degradation ~ '^[a-z][a-z0-9]*([._:-][a-z0-9]+)*$')`)
      .addCheckConstraint("query_turns_answer_encryption_check", sql`(answer_ciphertext is null and answer_nonce is null and answer_tag is null and answer_key_version is null) or (answer_ciphertext is not null and answer_nonce is not null and answer_tag is not null and answer_key_version is not null)`)
      .execute();
    await db.schema.createIndex("query_turns_session_created_idx").on("query_turns").columns(["session_id", "created_at", "id"]).execute();
    await sql`create function enforce_query_turn_range() returns trigger language plpgsql as $$
      declare session_start integer; session_end integer; session_archived timestamptz;
      begin
        select default_start_chapter, default_end_chapter, archived_at into session_start, session_end, session_archived from query_sessions where id = new.session_id;
        if session_archived is not null or new.start_chapter < session_start or new.end_chapter > session_end then raise exception 'invalid query turn' using errcode = '23514', constraint = 'query_turns_session_range_check'; end if;
        return new;
      end $$`.execute(db);
    await sql`create trigger query_turns_session_range_trigger before insert or update of session_id, start_chapter, end_chapter on query_turns for each row execute function enforce_query_turn_range()`.execute(db);

    await db.schema.createTable("turn_evidence")
      .addColumn("id", "uuid", uuid)
      .addColumn("turn_id", "uuid", (column) => column.notNull())
      .addColumn("fact_id", "uuid", (column) => column.notNull())
      .addColumn("rank", "integer", (column) => column.notNull())
      .addColumn("recall_reason", "text", (column) => column.notNull())
      .addColumn("disposition", "text", (column) => column.notNull())
      .addColumn("exclusion_reason", "text")
      .addColumn("created_at", "timestamptz", created)
      .addForeignKeyConstraint("turn_evidence_turn_id_fk", ["turn_id"], "query_turns", ["id"], (constraint) => constraint.onDelete("cascade"))
      .addForeignKeyConstraint("turn_evidence_fact_id_fk", ["fact_id"], "l2_facts", ["id"])
      .addUniqueConstraint("turn_evidence_turn_fact_unique", ["turn_id", "fact_id"])
      .addCheckConstraint("turn_evidence_rank_check", sql`rank > 0`)
      .addCheckConstraint("turn_evidence_recall_reason_check", sql`length(recall_reason) <= 32 and recall_reason ~ '^[a-z][a-z0-9]*([._:-][a-z0-9]+)*$'`)
      .addCheckConstraint("turn_evidence_exclusion_reason_code_check", sql`exclusion_reason is null or (length(exclusion_reason) <= 32 and exclusion_reason ~ '^[a-z][a-z0-9]*([._:-][a-z0-9]+)*$')`)
      .addCheckConstraint("turn_evidence_disposition_check", sql`disposition in ('used','excluded')`)
      .addCheckConstraint("turn_evidence_exclusion_check", sql`(disposition = 'used' and exclusion_reason is null) or (disposition = 'excluded' and exclusion_reason is not null)`)
      .execute();
    await db.schema.createIndex("turn_evidence_turn_disposition_rank_idx").on("turn_evidence").columns(["turn_id", "disposition", "rank"]).execute();
    await sql`create function enforce_turn_evidence_scope() returns trigger language plpgsql as $$
      declare committed_hash text;
      begin
        select evidence_snapshot_hash into committed_hash from query_turns where id = new.turn_id for update;
        if committed_hash is not null then raise exception 'turn evidence snapshot already committed' using errcode = '55000'; end if;
        if not exists (select 1 from query_turns t join query_sessions s on s.id = t.session_id join l2_facts f on f.id = new.fact_id where t.id = new.turn_id and f.group_id = s.group_id and f.book_id = s.book_id) then raise exception 'invalid turn evidence' using errcode = '23514', constraint = 'turn_evidence_scope_check'; end if;
        return new;
      end $$`.execute(db);
    await sql`create trigger turn_evidence_scope_trigger before insert on turn_evidence for each row execute function enforce_turn_evidence_scope()`.execute(db);
    await sql`create function reject_turn_evidence_mutation() returns trigger language plpgsql as $$ begin raise exception 'turn evidence is immutable' using errcode = '55000'; end $$`.execute(db);
    await sql`create trigger turn_evidence_immutable_trigger before update or delete on turn_evidence for each row execute function reject_turn_evidence_mutation()`.execute(db);
  },
  async down(db) {
    await db.schema.dropTable("turn_evidence").execute();
    await db.schema.dropTable("query_turns").execute();
    await db.schema.dropTable("query_sessions").execute();
    await sql`drop function reject_turn_evidence_mutation()`.execute(db);
    await sql`drop function enforce_turn_evidence_scope()`.execute(db);
    await sql`drop function enforce_query_turn_range()`.execute(db);
    await sql`alter table workflow_versions drop constraint workflow_versions_target_check`.execute(db);
    await sql`alter table workflow_versions add constraint workflow_versions_target_check check (target in ('chapter-import','l1-index','l2-index'))`.execute(db);
  },
};
