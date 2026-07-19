import {
  Kysely,
  PostgresDialect,
  sql,
  type ColumnType,
  type Generated,
  type Transaction,
} from "kysely";
import { Pool } from "pg";

type Timestamp = ColumnType<Date, Date | string, Date | string>;
type GeneratedTimestamp = ColumnType<
  Date,
  Date | string | undefined,
  Date | string
>;
type JsonObject = Record<string, unknown>;
type Json = ColumnType<JsonObject, JsonObject, JsonObject>;
export type FactCategory = "character" | "relationship" | "cultivation" | "force" | "event" | "item" | "magical_creature" | "location" | "foreshadowing" | "other" | "organization" | "power" | "mystery";
export interface FactRetrievalMetadata { category?: FactCategory; importance?: number; confidence?: number; scopeEligible?: boolean; transformationEligible?: boolean; scopeFieldsComplete?: boolean }
type FactMetadataJson = ColumnType<FactRetrievalMetadata, FactRetrievalMetadata, FactRetrievalMetadata>;

export interface UsersTable {
  id: Generated<string>;
  display_name: string;
  avatar_url: string | null;
  role: "admin" | "member";
  status: "active" | "disabled";
  created_at: GeneratedTimestamp;
  updated_at: GeneratedTimestamp;
}

export interface AuthIdentitiesTable {
  id: Generated<string>;
  user_id: string;
  provider: string;
  subject: string;
  created_at: GeneratedTimestamp;
}

export interface OAuthStatesTable {
  id: Generated<string>;
  state_hash: string;
  return_to: string;
  expires_at: Timestamp;
  consumed_at: Timestamp | null;
  created_at: GeneratedTimestamp;
}

export interface SessionsTable {
  id: Generated<string>;
  user_id: string;
  token_hash: string;
  csrf_token_hash: string | null;
  expires_at: Timestamp;
  revoked_at: Timestamp | null;
  created_at: GeneratedTimestamp;
  last_seen_at: GeneratedTimestamp;
}

export interface AuditLogsTable {
  id: Generated<string>;
  actor_user_id: string | null;
  action: string;
  target_type: string;
  target_id: string;
  metadata: Json;
  created_at: GeneratedTimestamp;
}

export interface JobsTable {
  id: Generated<string>;
  type: string;
  status:
    | "queued"
    | "running"
    | "retrying"
    | "paused"
    | "completed"
    | "failed"
    | "cancelled";
  requested_by: string;
  request_id: string;
  scope: Json;
  config_snapshot: Json;
  concurrency_key: string | null;
  progress: Json;
  created_at: GeneratedTimestamp;
  updated_at: GeneratedTimestamp;
}

export interface JobStepsTable {
  id: Generated<string>;
  job_id: string;
  position: number;
  kind: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  input_signature: string;
  idempotency_key: string;
  output_ref: Json | null;
  lease_owner: string | null;
  lease_expires_at: Timestamp | null;
  attempt_count: Generated<number>;
  created_at: GeneratedTimestamp;
  updated_at: GeneratedTimestamp;
}

export interface JobAttemptsTable {
  id: Generated<string>;
  step_id: string;
  attempt_no: number;
  worker_id: string;
  status: "running" | "completed" | "failed" | "abandoned" | "cancelled";
  error_code: string | null;
  error_message: string | null;
  started_at: Timestamp;
  finished_at: Timestamp | null;
}

export interface JobEventsTable {
  id: Generated<string>;
  job_id: string;
  type: string;
  dedupe_key: string;
  payload: Json;
  created_at: GeneratedTimestamp;
}

export interface JobOutboxTable {
  id: Generated<string>;
  job_id: string;
  topic: string;
  payload: Json;
  available_at: GeneratedTimestamp;
  claimed_by: string | null;
  claim_expires_at: Timestamp | null;
  delivered_at: Timestamp | null;
  created_at: GeneratedTimestamp;
}

interface BooksTable { id: Generated<string>; title: string; status: "active" | "archived"; created_by: string; created_at: GeneratedTimestamp; updated_at: GeneratedTimestamp }
interface BookSourcesTable { id: Generated<string>; book_id: string; provider: string; source_id: string; start_chapter: number; end_chapter: number; created_at: GeneratedTimestamp; updated_at: GeneratedTimestamp }
interface ChaptersTable { id: Generated<string>; book_id: string; chapter_index: number; title: string; content_hmac: string; content_ciphertext: Buffer; content_nonce: Buffer; content_tag: Buffer; content_key_version: string; source_version: string; created_at: GeneratedTimestamp; updated_at: GeneratedTimestamp }
interface PromptVersionsTable { id: Generated<string>; target: "l1-index" | "l2-index"; version: string; content_hash: string; created_at: GeneratedTimestamp }
interface WorkflowVersionsTable { id: Generated<string>; target: "chapter-import" | "l1-index" | "l2-index"; contract_version: string; dsl_hash: string; enabled: Generated<boolean>; created_at: GeneratedTimestamp }
interface IndexGroupsTable { id: Generated<string>; book_id: string; key: string; name: string; prompt_version_id: string; config_hash: string; status: Generated<"active" | "archived">; created_at: GeneratedTimestamp }
interface L1IndexesTable { id: Generated<string>; chapter_id: string; prompt_version_id: string; workflow_version_id: string; input_signature: string; status: "fresh" | "failed" | "stale"; is_current: Generated<boolean>; route: Json; created_at: GeneratedTimestamp }
interface L2ChapterStatusesTable { id: Generated<string>; group_id: string; chapter_id: string; book_id: string; input_signature: string; status: "fresh" | "failed" | "stale"; failure_code: string | null; updated_at: GeneratedTimestamp }
interface L2FactsTable { id: Generated<string>; group_id: string; chapter_id: string; book_id: string; subject_key: string; fact_type: string; fact_ciphertext: Buffer; fact_nonce: Buffer; fact_tag: Buffer; fact_key_version: string; metadata: FactMetadataJson; created_at: GeneratedTimestamp }
interface L2SubjectsTable { id: Generated<string>; group_id: string; subject_key: string; display_name: string; aliases: Json; created_at: GeneratedTimestamp }

export interface Database {
  users: UsersTable;
  auth_identities: AuthIdentitiesTable;
  oauth_states: OAuthStatesTable;
  sessions: SessionsTable;
  audit_logs: AuditLogsTable;
  jobs: JobsTable;
  job_steps: JobStepsTable;
  job_attempts: JobAttemptsTable;
  job_events: JobEventsTable;
  job_outbox: JobOutboxTable;
  books: BooksTable;
  book_sources: BookSourcesTable;
  chapters: ChaptersTable;
  prompt_versions: PromptVersionsTable;
  workflow_versions: WorkflowVersionsTable;
  index_groups: IndexGroupsTable;
  l1_indexes: L1IndexesTable;
  l2_chapter_statuses: L2ChapterStatusesTable;
  l2_facts: L2FactsTable;
  l2_subjects: L2SubjectsTable;
}

export type DatabaseConnection = Kysely<Database>;
export type DatabaseExecutor = DatabaseConnection | Transaction<Database>;

export function createDatabase(url: string): DatabaseConnection {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error("createDatabase requires a PostgreSQL URL");
  }

  if (parsedUrl.protocol !== "postgres:" && parsedUrl.protocol !== "postgresql:") {
    throw new Error("createDatabase requires a PostgreSQL URL");
  }

  return new Kysely<Database>({
    dialect: new PostgresDialect({
      pool: new Pool({ connectionString: parsedUrl.toString() }),
    }),
  });
}

export async function destroyDatabase(database: DatabaseConnection): Promise<void> {
  await database.destroy();
}

export async function consumeOAuthState(
  database: DatabaseConnection,
  stateHash: string,
): Promise<string | null> {
  return database.transaction().execute(async (transaction) => {
    const state = await transaction
      .updateTable("oauth_states")
      .set({ consumed_at: sql`now()` })
      .where("state_hash", "=", stateHash)
      .where("consumed_at", "is", null)
      .where("expires_at", ">", sql<Date>`now()`)
      .returning("return_to")
      .executeTakeFirst();

    return state?.return_to ?? null;
  });
}
