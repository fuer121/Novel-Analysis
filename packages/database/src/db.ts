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
