import { randomUUID } from "node:crypto";

import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import {
  consumeOAuthState,
  createDatabase,
  destroyDatabase,
  migrateDown,
  migrateToLatest,
} from "./index.js";
import {
  createDisposablePostgres,
  type DisposablePostgres,
} from "./testing/postgres.js";

const EXPECTED_COLUMNS = {
  users: [
    "id",
    "display_name",
    "avatar_url",
    "role",
    "status",
    "created_at",
    "updated_at",
  ],
  auth_identities: ["id", "user_id", "provider", "subject", "created_at"],
  oauth_states: [
    "id",
    "state_hash",
    "return_to",
    "expires_at",
    "consumed_at",
    "created_at",
  ],
  sessions: [
    "id",
    "user_id",
    "token_hash",
    "csrf_token_hash",
    "expires_at",
    "revoked_at",
    "created_at",
    "last_seen_at",
  ],
  audit_logs: [
    "id",
    "actor_user_id",
    "action",
    "target_type",
    "target_id",
    "metadata",
    "created_at",
  ],
  jobs: [
    "id",
    "type",
    "status",
    "requested_by",
    "request_id",
    "scope",
    "config_snapshot",
    "concurrency_key",
    "progress",
    "created_at",
    "updated_at",
  ],
  job_steps: [
    "id",
    "job_id",
    "position",
    "kind",
    "status",
    "input_signature",
    "idempotency_key",
    "output_ref",
    "lease_owner",
    "lease_expires_at",
    "attempt_count",
    "created_at",
    "updated_at",
  ],
  job_attempts: [
    "id",
    "step_id",
    "attempt_no",
    "worker_id",
    "status",
    "error_code",
    "error_message",
    "started_at",
    "finished_at",
  ],
  job_events: [
    "id",
    "job_id",
    "type",
    "dedupe_key",
    "payload",
    "created_at",
  ],
  job_outbox: [
    "id",
    "job_id",
    "topic",
    "payload",
    "available_at",
    "claimed_by",
    "claim_expires_at",
    "delivered_at",
    "created_at",
  ],
} as const;

const REQUIRED_INDEXES = [
  "oauth_states_expires_at_idx",
  "sessions_active_user_idx",
  "job_events_job_cursor_idx",
  "job_steps_claim_idx",
  "job_outbox_pending_idx",
  "jobs_active_concurrency_unique",
] as const;

async function tableExists(database: DisposablePostgres["db"], table: string) {
  const result = await sql<{ exists: boolean }>`
    select exists (
      select 1
      from information_schema.tables
      where table_schema = 'public' and table_name = ${table}
    ) as exists
  `.execute(database);

  return result.rows[0]?.exists ?? false;
}

async function columnExists(database: DisposablePostgres["db"], table: string, column: string) {
  const result = await sql<{ exists: boolean }>`
    select exists (
      select 1
      from information_schema.columns
      where table_schema = 'public' and table_name = ${table} and column_name = ${column}
    ) as exists
  `.execute(database);

  return result.rows[0]?.exists ?? false;
}

async function expectConstraintViolation(
  operation: Promise<unknown>,
  constraint: string,
) {
  await expect(operation).rejects.toMatchObject({ constraint });
}

async function withDisposablePostgres(
  count: number,
  operation: (disposables: DisposablePostgres[]) => Promise<void>,
): Promise<void> {
  const disposables: DisposablePostgres[] = [];
  let operationFailed = false;
  let operationError: unknown;
  let cleanupErrors: unknown[];

  try {
    for (let index = 0; index < count; index += 1) {
      disposables.push(await createDisposablePostgres());
    }
    await operation(disposables);
  } catch (error) {
    operationFailed = true;
    operationError = error;
  } finally {
    const cleanupResults = await Promise.allSettled(
      disposables.map((disposable) => disposable.destroy()),
    );
    cleanupErrors = cleanupResults.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    );
  }

  if (operationFailed && cleanupErrors.length > 0) {
    throw new AggregateError(
      [operationError, ...cleanupErrors],
      "Disposable PostgreSQL operation and cleanup failed",
    );
  }
  if (operationFailed) {
    throw operationError;
  }
  if (cleanupErrors.length > 0) {
    throw new AggregateError(cleanupErrors, "Disposable PostgreSQL cleanup failed");
  }
}

describe("phase 1 PostgreSQL schema", () => {
  let postgres: DisposablePostgres;

  beforeAll(async () => {
    postgres = await createDisposablePostgres();
  });

  afterAll(async () => {
    await postgres?.destroy();
  });

  test("creates the exact collaboration and job table columns", async () => {
    const result = await sql<{ table_name: string; column_name: string }>`
      select table_name, column_name
      from information_schema.columns
      where table_schema = 'public'
        and table_name in (${sql.join(Object.keys(EXPECTED_COLUMNS))})
      order by table_name, ordinal_position
    `.execute(postgres.db);

    const actual = Object.fromEntries(
      Object.keys(EXPECTED_COLUMNS).map((table) => [
        table,
        result.rows
          .filter((row) => row.table_name === table)
          .map((row) => row.column_name),
      ]),
    );

    expect(actual).toEqual(EXPECTED_COLUMNS);
  });

  test("typed inserts may omit generated and nullable collaboration columns", async () => {
    const user = await postgres.db
      .insertInto("users")
      .values({ display_name: "Typed user", role: "member", status: "active" })
      .returning(["id", "avatar_url", "created_at"])
      .executeTakeFirstOrThrow();
    const createdAt: Date = user.created_at;
    expect(user.avatar_url).toBeNull();
    expect(createdAt).toBeInstanceOf(Date);

    const state = await postgres.db
      .insertInto("oauth_states")
      .values({
        state_hash: `typed-${randomUUID()}`,
        return_to: "/",
        expires_at: new Date(Date.now() + 60_000),
      })
      .returning("consumed_at")
      .executeTakeFirstOrThrow();
    expect(state.consumed_at).toBeNull();
  });

  test("migrates down in foreign-key reverse order and back up from empty", async () => {
    await migrateDown(postgres.db);
    expect(await tableExists(postgres.db, "books")).toBe(true);
    expect(await columnExists(postgres.db, "index_groups", "category_scope")).toBe(false);

    await migrateDown(postgres.db);
    expect(await tableExists(postgres.db, "books")).toBe(true);
    expect(await tableExists(postgres.db, "prompt_versions")).toBe(true);
    expect(await columnExists(postgres.db, "prompt_versions", "content")).toBe(false);

    await migrateDown(postgres.db);
    expect(await tableExists(postgres.db, "books")).toBe(false);
    expect(await tableExists(postgres.db, "jobs")).toBe(true);
    expect(await tableExists(postgres.db, "users")).toBe(true);

    await migrateDown(postgres.db);
    expect(await tableExists(postgres.db, "jobs")).toBe(false);
    expect(await tableExists(postgres.db, "users")).toBe(true);

    await migrateDown(postgres.db);
    expect(await tableExists(postgres.db, "users")).toBe(false);

    const result = await migrateToLatest(postgres.db);
    expect(result.error).toBeUndefined();
    expect(await tableExists(postgres.db, "users")).toBe(true);
    expect(await tableExists(postgres.db, "jobs")).toBe(true);
    expect(await tableExists(postgres.db, "books")).toBe(true);
    expect(await columnExists(postgres.db, "prompt_versions", "content")).toBe(true);
    expect(await columnExists(postgres.db, "index_groups", "category_scope")).toBe(true);
  });

  test("enforces named role, user status, and shared job status checks", async () => {
    const userId = randomUUID();

    await expectConstraintViolation(
      sql`insert into users (id, display_name, role, status)
          values (${userId}, 'Invalid role', 'owner', 'active')`.execute(postgres.db),
      "users_role_check",
    );
    await expectConstraintViolation(
      sql`insert into users (id, display_name, role, status)
          values (${userId}, 'Invalid status', 'member', 'pending')`.execute(postgres.db),
      "users_status_check",
    );

    await sql`insert into users (id, display_name, role, status)
              values (${userId}, 'Requester', 'member', 'active')`.execute(postgres.db);
    await expectConstraintViolation(
      sql`insert into jobs (
            id, type, status, requested_by, request_id, scope,
            config_snapshot, progress
          ) values (
            ${randomUUID()}, 'query', 'waiting', ${userId}, 'invalid-status',
            '{}'::jsonb, '{}'::jsonb, '{}'::jsonb
          )`.execute(postgres.db),
      "jobs_status_check",
    );
  });

  test("enforces named unique and foreign-key constraints", async () => {
    const userId = randomUUID();
    const otherUserId = randomUUID();
    const jobId = randomUUID();
    const stepId = randomUUID();

    await sql`insert into users (id, display_name, role, status) values
      (${userId}, 'One', 'member', 'active'),
      (${otherUserId}, 'Two', 'member', 'active')`.execute(postgres.db);

    await sql`insert into auth_identities (id, user_id, provider, subject)
      values (${randomUUID()}, ${userId}, 'feishu', 'subject-1')`.execute(postgres.db);
    await expectConstraintViolation(
      sql`insert into auth_identities (id, user_id, provider, subject)
          values (${randomUUID()}, ${otherUserId}, 'feishu', 'subject-1')`.execute(postgres.db),
      "auth_identities_provider_subject_unique",
    );
    await expectConstraintViolation(
      sql`insert into auth_identities (id, user_id, provider, subject)
          values (${randomUUID()}, ${randomUUID()}, 'feishu', 'missing-user')`.execute(postgres.db),
      "auth_identities_user_id_fk",
    );

    await sql`insert into jobs (
      id, type, status, requested_by, request_id, scope, config_snapshot, progress
    ) values (
      ${jobId}, 'query', 'queued', ${userId}, 'request-1',
      '{}'::jsonb, '{}'::jsonb, '{}'::jsonb
    )`.execute(postgres.db);
    await expectConstraintViolation(
      sql`insert into jobs (
        id, type, status, requested_by, request_id, scope, config_snapshot, progress
      ) values (
        ${randomUUID()}, 'query', 'queued', ${userId}, 'request-1',
        '{}'::jsonb, '{}'::jsonb, '{}'::jsonb
      )`.execute(postgres.db),
      "jobs_requested_by_request_id_unique",
    );

    await sql`insert into job_steps (
      id, job_id, position, kind, status, input_signature, idempotency_key
    ) values (
      ${stepId}, ${jobId}, 0, 'example', 'queued', 'input-1', 'step-key-1'
    )`.execute(postgres.db);
    await expectConstraintViolation(
      sql`insert into job_steps (
        id, job_id, position, kind, status, input_signature, idempotency_key
      ) values (
        ${randomUUID()}, ${jobId}, 0, 'example', 'queued', 'input-2', 'step-key-2'
      )`.execute(postgres.db),
      "job_steps_job_id_position_unique",
    );
    await expectConstraintViolation(
      sql`insert into job_steps (
        id, job_id, position, kind, status, input_signature, idempotency_key
      ) values (
        ${randomUUID()}, ${randomUUID()}, 1, 'example', 'queued', 'input-3', 'step-key-3'
      )`.execute(postgres.db),
      "job_steps_job_id_fk",
    );

    await sql`insert into job_attempts (
      id, step_id, attempt_no, worker_id, status, started_at
    ) values (${randomUUID()}, ${stepId}, 1, 'worker-1', 'running', now())`.execute(postgres.db);
    await expectConstraintViolation(
      sql`insert into job_attempts (
        id, step_id, attempt_no, worker_id, status, started_at
      ) values (${randomUUID()}, ${stepId}, 1, 'worker-2', 'running', now())`.execute(postgres.db),
      "job_attempts_step_id_attempt_no_unique",
    );

    await sql`insert into job_events (job_id, type, dedupe_key, payload)
      values (${jobId}, 'created', 'created', '{}'::jsonb)`.execute(postgres.db);
    await expectConstraintViolation(
      sql`insert into job_events (job_id, type, dedupe_key, payload)
          values (${jobId}, 'created', 'created', '{}'::jsonb)`.execute(postgres.db),
      "job_events_job_id_dedupe_key_unique",
    );
  });

  test("allows only one active job per non-null concurrency key", async () => {
    const userId = randomUUID();
    const firstJobId = randomUUID();

    await sql`insert into users (id, display_name, role, status)
      values (${userId}, 'Concurrent requester', 'member', 'active')`.execute(postgres.db);
    await sql`insert into jobs (
      id, type, status, requested_by, request_id, scope, config_snapshot,
      concurrency_key, progress
    ) values (
      ${firstJobId}, 'query', 'queued', ${userId}, 'concurrency-1',
      '{}'::jsonb, '{}'::jsonb, 'book:1:query', '{}'::jsonb
    )`.execute(postgres.db);

    await expectConstraintViolation(
      sql`insert into jobs (
        id, type, status, requested_by, request_id, scope, config_snapshot,
        concurrency_key, progress
      ) values (
        ${randomUUID()}, 'query', 'running', ${userId}, 'concurrency-2',
        '{}'::jsonb, '{}'::jsonb, 'book:1:query', '{}'::jsonb
      )`.execute(postgres.db),
      "jobs_active_concurrency_unique",
    );

    await sql`update jobs set status = 'completed' where id = ${firstJobId}`.execute(postgres.db);
    await expect(
      sql`insert into jobs (
        id, type, status, requested_by, request_id, scope, config_snapshot,
        concurrency_key, progress
      ) values (
        ${randomUUID()}, 'query', 'paused', ${userId}, 'concurrency-3',
        '{}'::jsonb, '{}'::jsonb, 'book:1:query', '{}'::jsonb
      )`.execute(postgres.db),
    ).resolves.toBeDefined();
  });

  test("creates cleanup, session, cursor, claim, and pending outbox indexes", async () => {
    const result = await sql<{ indexname: string }>`
      select indexname
      from pg_indexes
      where schemaname = 'public'
        and indexname in (${sql.join(REQUIRED_INDEXES)})
    `.execute(postgres.db);

    expect(result.rows.map((row) => row.indexname).sort()).toEqual(
      [...REQUIRED_INDEXES].sort(),
    );
  });

  test("consumes an unexpired OAuth state exactly once and rejects expired state", async () => {
    const validHash = "valid-state-hash";
    const expiredHash = "expired-state-hash";

    await sql`insert into oauth_states (id, state_hash, return_to, expires_at) values
      (${randomUUID()}, ${validHash}, '/jobs', now() + interval '5 minutes'),
      (${randomUUID()}, ${expiredHash}, '/', now() - interval '1 second')`.execute(postgres.db);
    await expectConstraintViolation(
      sql`insert into oauth_states (id, state_hash, return_to, expires_at)
          values (${randomUUID()}, ${validHash}, '/', now() + interval '5 minutes')`.execute(postgres.db),
      "oauth_states_state_hash_unique",
    );

    await expect(consumeOAuthState(postgres.db, validHash)).resolves.toBe("/jobs");
    await expect(consumeOAuthState(postgres.db, validHash)).resolves.toBeNull();
    await expect(consumeOAuthState(postgres.db, expiredHash)).resolves.toBeNull();

    const consumed = await sql<{ consumed: boolean }>`
      select consumed_at is not null as consumed
      from oauth_states
      where state_hash = ${validHash}
    `.execute(postgres.db);
    expect(consumed.rows[0]?.consumed).toBe(true);
  });

  test("rejects non-PostgreSQL URLs and explicitly destroys pools", async () => {
    expect(() => createDatabase("sqlite:///tmp/database.sqlite")).toThrow(
      "PostgreSQL URL",
    );

    const adminUrl = process.env.TEST_DATABASE_URL!;
    process.env.TEST_DATABASE_URL = postgres.databaseUrl;
    try {
      await expect(createDisposablePostgres()).rejects.toThrow("ending in /postgres");
    } finally {
      process.env.TEST_DATABASE_URL = adminUrl;
    }

    const database = createDatabase(postgres.databaseUrl);
    await sql`select 1`.execute(database);
    await destroyDatabase(database);
    await expect(sql`select 1`.execute(database)).rejects.toThrow();
  });

  test("drops a disposable database after terminating all connections", async () => {
    const disposable = await createDisposablePostgres();
    const databaseName = disposable.databaseName;
    await createDatabase(disposable.databaseUrl).destroy();

    await disposable.destroy();

    const admin = createDatabase(process.env.TEST_DATABASE_URL!);
    try {
      const result = await sql<{ database_exists: boolean; connections: number }>`
        select
          exists(select 1 from pg_database where datname = ${databaseName}) as database_exists,
          (select count(*)::int from pg_stat_activity where datname = ${databaseName}) as connections
      `.execute(admin);
      expect(result.rows[0]).toEqual({ database_exists: false, connections: 0 });
    } finally {
      await destroyDatabase(admin);
    }
  });

  test("drops databases after concurrent multi-client pool teardown", async () => {
    let databaseNames: string[] = [];
    await withDisposablePostgres(3, async (disposables) => {
      databaseNames = disposables.map((disposable) => disposable.databaseName);
      await Promise.all(
        disposables.flatMap((disposable) =>
          Array.from({ length: 10 }, () =>
            sql`select pg_sleep(0.01)`.execute(disposable.db),
          ),
        ),
      );
    });

    const admin = createDatabase(process.env.TEST_DATABASE_URL!);
    try {
      const result = await sql<{ databases: number; connections: number }>`
        select
          (select count(*)::int from pg_database where datname in (${sql.join(databaseNames)})) as databases,
          (select count(*)::int from pg_stat_activity where datname in (${sql.join(databaseNames)})) as connections
      `.execute(admin);
      expect(result.rows[0]).toEqual({ databases: 0, connections: 0 });
    } finally {
      await destroyDatabase(admin);
    }
  });

  test("cleans up every database while preserving workload and cleanup failures", async () => {
    const workloadError = new Error("injected multi-client workload failure");
    const cleanupError = new Error("injected cleanup failure");
    let databaseNames: string[] = [];
    let caughtError: unknown;

    try {
      await withDisposablePostgres(3, async (disposables) => {
        databaseNames = disposables.map((disposable) => disposable.databaseName);
        const destroy = disposables[0]!.destroy.bind(disposables[0]);
        disposables[0]!.destroy = async () => {
          await destroy();
          throw cleanupError;
        };
        throw workloadError;
      });
    } catch (error) {
      caughtError = error;
    }

    expect(caughtError).toBeInstanceOf(AggregateError);
    expect((caughtError as AggregateError).errors).toEqual([
      workloadError,
      cleanupError,
    ]);

    const admin = createDatabase(process.env.TEST_DATABASE_URL!);
    try {
      const result = await sql<{ databases: number; connections: number }>`
        select
          (select count(*)::int from pg_database where datname in (${sql.join(databaseNames)})) as databases,
          (select count(*)::int from pg_stat_activity where datname in (${sql.join(databaseNames)})) as connections
      `.execute(admin);
      expect(result.rows[0]).toEqual({ databases: 0, connections: 0 });
    } finally {
      await destroyDatabase(admin);
    }
  });

  test("closes the admin pool when database creation fails", async () => {
    const adminUrl = process.env.TEST_DATABASE_URL!;
    const roleName = `novel_no_createdb_${randomUUID().replaceAll("-", "")}`;
    const applicationName = `novel_create_failure_${randomUUID()}`;
    const admin = createDatabase(adminUrl);

    await sql`create role ${sql.id(roleName)} login password 'test_cleanup_only'`.execute(admin);

    const restrictedUrl = new URL(adminUrl);
    restrictedUrl.username = roleName;
    restrictedUrl.password = "test_cleanup_only";
    restrictedUrl.searchParams.set("application_name", applicationName);
    process.env.TEST_DATABASE_URL = restrictedUrl.toString();

    try {
      await expect(createDisposablePostgres()).rejects.toThrow(
        "permission denied to create database",
      );

      const result = await sql<{ connections: number }>`
        select count(*)::int as connections
        from pg_stat_activity
        where application_name = ${applicationName}
      `.execute(admin);
      expect(result.rows[0]?.connections).toBe(0);
    } finally {
      process.env.TEST_DATABASE_URL = adminUrl;
      await sql`
        select pg_terminate_backend(pid)
        from pg_stat_activity
        where application_name = ${applicationName}
      `.execute(admin);
      await sql`drop role if exists ${sql.id(roleName)}`.execute(admin);
      await destroyDatabase(admin);
    }
  });
});
