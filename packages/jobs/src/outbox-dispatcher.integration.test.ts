import { sql } from "kysely";
import { PgBoss } from "pg-boss";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createDatabase,
  type DatabaseConnection,
} from "@novel-analysis/database";
import {
  createDisposablePostgres,
  type DisposablePostgres,
} from "../../database/src/testing/postgres.js";

import {
  createBoss,
  type BossSender,
  type WakeMessage,
} from "./boss.js";
import { JobRepository } from "./job-repository.js";
import {
  OutboxClaimLostError,
  OutboxDispatcher,
} from "./outbox-dispatcher.js";

type SendCall = {
  topic: string;
  data: WakeMessage;
  options: { singletonKey: string };
};

function recordingSender(
  calls: SendCall[],
  onSend?: (call: SendCall) => Promise<void>,
): BossSender {
  return {
    async send(topic, data, options) {
      const call = { topic, data, options };
      calls.push(call);
      await onSend?.(call);
      return `queue-${calls.length}`;
    },
  };
}

it("creates the pg-boss v12 adapter", () => {
  expect(createBoss("postgres://novel:novel_dev_only@127.0.0.1:55432/postgres"))
    .toBeInstanceOf(PgBoss);
});

describe("outbox dispatcher", () => {
  let postgres: DisposablePostgres;
  let observer: DatabaseConnection;
  let jobId: string;
  let outboxId: string;

  beforeEach(async () => {
    postgres = await createDisposablePostgres();
    observer = createDatabase(postgres.databaseUrl);
    const userId = (await postgres.db.insertInto("users").values({
      display_name: "Owner",
      avatar_url: null,
      role: "member",
      status: "active",
    }).returning("id").executeTakeFirstOrThrow()).id;
    jobId = (await new JobRepository(postgres.db).createExample({
      requestedBy: userId,
      requestId: "dispatch-test",
    })).id;
    const outbox = await postgres.db.selectFrom("job_outbox")
      .select("id")
      .executeTakeFirstOrThrow();
    outboxId = outbox.id;
  });

  afterEach(async () => {
    await observer.destroy();
    await postgres.destroy();
  });

  it("sends the row topic and public wake payload, then marks it delivered", async () => {
    await postgres.db.updateTable("job_outbox").set({
      topic: "jobs.custom-wake",
      payload: { jobId, internalSecret: "do-not-send" },
    }).where("id", "=", outboxId).execute();
    const calls: SendCall[] = [];
    const statusBefore = await postgres.db.selectFrom("jobs")
      .select("status").where("id", "=", jobId).executeTakeFirstOrThrow();

    const dispatched = await new OutboxDispatcher({
      database: postgres.db,
      boss: recordingSender(calls),
      dispatcherId: "dispatcher-a",
    }).dispatchNext();

    expect(dispatched).toBe(true);
    expect(calls).toEqual([{
      topic: "jobs.custom-wake",
      data: { jobId, outboxId },
      options: { singletonKey: `outbox:${outboxId}` },
    }]);
    const outbox = await postgres.db.selectFrom("job_outbox")
      .select(["delivered_at", "claimed_by", "claim_expires_at"])
      .where("id", "=", outboxId).executeTakeFirstOrThrow();
    expect(outbox.delivered_at).toBeInstanceOf(Date);
    expect(outbox.claimed_by).toBeNull();
    expect(outbox.claim_expires_at).toBeNull();
    expect(await postgres.db.selectFrom("jobs").select("status")
      .where("id", "=", jobId).executeTakeFirstOrThrow()).toEqual(statusBefore);
  });

  it("lets concurrent dispatchers claim and send an eligible row only once", async () => {
    const calls: SendCall[] = [];
    const sender = recordingSender(calls, async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    const first = new OutboxDispatcher({
      database: postgres.db,
      boss: sender,
      dispatcherId: "dispatcher-a",
    });
    const second = new OutboxDispatcher({
      database: postgres.db,
      boss: sender,
      dispatcherId: "dispatcher-b",
    });

    const results = await Promise.all([first.dispatchNext(), second.dispatchNext()]);

    expect(results.sort()).toEqual([false, true]);
    expect(calls).toHaveLength(1);
  });

  it("releases its claim after send failure so the row can be retried", async () => {
    const failedCalls: SendCall[] = [];
    const failingBoss = recordingSender(failedCalls, async () => {
      throw new Error("queue unavailable");
    });
    const dispatcher = new OutboxDispatcher({
      database: postgres.db,
      boss: failingBoss,
      dispatcherId: "dispatcher-a",
    });

    await expect(dispatcher.dispatchNext()).rejects.toThrow("queue unavailable");
    expect(await postgres.db.selectFrom("job_outbox")
      .select(["delivered_at", "claimed_by", "claim_expires_at"])
      .where("id", "=", outboxId).executeTakeFirstOrThrow()).toEqual({
      delivered_at: null,
      claimed_by: null,
      claim_expires_at: null,
    });

    const retryCalls: SendCall[] = [];
    await expect(new OutboxDispatcher({
      database: postgres.db,
      boss: recordingSender(retryCalls),
      dispatcherId: "dispatcher-b",
    }).dispatchNext()).resolves.toBe(true);
    expect(retryCalls[0]?.options.singletonKey).toBe(`outbox:${outboxId}`);
  });

  it("retries a send-before-mark failure with the same logical message key", async () => {
    await sql`
      create function reject_outbox_delivery() returns trigger language plpgsql as $$
      begin
        if new.delivered_at is not null then
          raise exception 'simulated crash before mark';
        end if;
        return new;
      end
      $$
    `.execute(postgres.db);
    await sql`
      create trigger reject_outbox_delivery before update on job_outbox
      for each row execute function reject_outbox_delivery()
    `.execute(postgres.db);
    const calls: SendCall[] = [];
    const dispatcher = new OutboxDispatcher({
      database: postgres.db,
      boss: recordingSender(calls),
      dispatcherId: "dispatcher-a",
    });

    await expect(dispatcher.dispatchNext()).rejects.toThrow("simulated crash before mark");
    expect((await postgres.db.selectFrom("job_outbox").select("delivered_at")
      .where("id", "=", outboxId).executeTakeFirstOrThrow()).delivered_at).toBeNull();
    await sql`drop trigger reject_outbox_delivery on job_outbox`.execute(postgres.db);
    await sql`drop function reject_outbox_delivery()`.execute(postgres.db);
    await postgres.db.updateTable("job_outbox")
      .set({ claim_expires_at: new Date(Date.now() - 1_000) })
      .where("id", "=", outboxId).execute();

    await expect(dispatcher.dispatchNext()).resolves.toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual(calls[0]);
  });

  it("recovers an expired claim", async () => {
    await postgres.db.updateTable("job_outbox").set({
      claimed_by: "dead-dispatcher:old-claim",
      claim_expires_at: new Date(Date.now() - 1_000),
    }).where("id", "=", outboxId).execute();
    const calls: SendCall[] = [];

    await expect(new OutboxDispatcher({
      database: postgres.db,
      boss: recordingSender(calls),
      dispatcherId: "dispatcher-a",
    }).dispatchNext()).resolves.toBe(true);

    expect(calls).toHaveLength(1);
  });

  it("does nothing when no row is eligible", async () => {
    const calls: SendCall[] = [];
    const dispatcher = new OutboxDispatcher({
      database: postgres.db,
      boss: recordingSender(calls),
      dispatcherId: "dispatcher-a",
    });

    await postgres.db.updateTable("job_outbox")
      .set({ available_at: new Date(Date.now() + 60_000) })
      .where("id", "=", outboxId).execute();
    await expect(dispatcher.dispatchNext()).resolves.toBe(false);
    await postgres.db.updateTable("job_outbox").set({
      available_at: new Date(Date.now() - 1_000),
      claimed_by: "live-dispatcher:claim",
      claim_expires_at: new Date(Date.now() + 60_000),
    }).where("id", "=", outboxId).execute();
    await expect(dispatcher.dispatchNext()).resolves.toBe(false);
    await postgres.db.updateTable("job_outbox").set({
      delivered_at: new Date(),
    }).where("id", "=", outboxId).execute();
    await expect(dispatcher.dispatchNext()).resolves.toBe(false);
    expect(calls).toEqual([]);
  });

  it("commits the product claim before invoking the sender", async () => {
    let observedClaim: { claimed_by: string | null; claim_expires_at: Date | null } | undefined;
    const sender = recordingSender([], async () => {
      observedClaim = await observer.selectFrom("job_outbox")
        .select(["claimed_by", "claim_expires_at"])
        .where("id", "=", outboxId).executeTakeFirstOrThrow();
    });

    await new OutboxDispatcher({
      database: postgres.db,
      boss: sender,
      dispatcherId: "dispatcher-a",
    }).dispatchNext();

    expect(observedClaim?.claimed_by).toMatch(/^dispatcher-a:/);
    expect(observedClaim?.claim_expires_at).toBeInstanceOf(Date);
  });

  it("does not let a stale claimant mark a row after the claim changes", async () => {
    const sender = recordingSender([], async () => {
      await observer.updateTable("job_outbox").set({
        claimed_by: "dispatcher-b:new-claim",
        claim_expires_at: new Date(Date.now() + 60_000),
      }).where("id", "=", outboxId).execute();
    });

    await expect(new OutboxDispatcher({
      database: postgres.db,
      boss: sender,
      dispatcherId: "dispatcher-a",
    }).dispatchNext()).rejects.toBeInstanceOf(OutboxClaimLostError);
    expect((await postgres.db.selectFrom("job_outbox").select("delivered_at")
      .where("id", "=", outboxId).executeTakeFirstOrThrow()).delivered_at).toBeNull();
  });
});
