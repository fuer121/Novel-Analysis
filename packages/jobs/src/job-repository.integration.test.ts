import { sql } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createDisposablePostgres,
  type DisposablePostgres,
} from "../../database/src/testing/postgres.js";

import { JobRepository } from "./job-repository.js";

describe("job repository", () => {
  let postgres: DisposablePostgres;
  let userId: string;

  beforeEach(async () => {
    postgres = await createDisposablePostgres();
    userId = (await postgres.db.insertInto("users").values({
      display_name: "Owner",
      avatar_url: null,
      role: "member",
      status: "active",
    }).returning("id").executeTakeFirstOrThrow()).id;
  });

  afterEach(async () => {
    await postgres.destroy();
  });

  it("atomically creates a job, ordered steps, created event, and pending outbox", async () => {
    const job = await new JobRepository(postgres.db).createExample({
      requestedBy: userId,
      requestId: "create-1",
    });

    expect(job).toMatchObject({ type: "query", status: "queued", requestedBy: userId });
    expect(await postgres.db.selectFrom("job_steps").select(["position", "status", "kind"])
      .where("job_id", "=", job.id).orderBy("position").execute()).toEqual([
      { position: 0, status: "queued", kind: "example" },
      { position: 1, status: "queued", kind: "example" },
    ]);
    expect(await postgres.db.selectFrom("job_events").select(["type", "dedupe_key"])
      .where("job_id", "=", job.id).execute()).toEqual([
      { type: "created", dedupe_key: "created" },
    ]);
    expect(await postgres.db.selectFrom("job_outbox")
      .select(["job_id", "topic", "delivered_at"]).execute()).toEqual([
      { job_id: job.id, topic: "jobs.wake", delivered_at: null },
    ]);
  });

  it("returns the same job for a duplicate create key without duplicating effects", async () => {
    const repository = new JobRepository(postgres.db);
    const first = await repository.createExample({ requestedBy: userId, requestId: "same-key" });
    const second = await repository.createExample({ requestedBy: userId, requestId: "same-key" });

    expect(second).toEqual(first);
    expect(await postgres.db.selectFrom("jobs").selectAll().execute()).toHaveLength(1);
    expect(await postgres.db.selectFrom("job_steps").selectAll().execute()).toHaveLength(2);
    expect(await postgres.db.selectFrom("job_events").selectAll().execute()).toHaveLength(1);
    expect(await postgres.db.selectFrom("job_outbox").selectAll().execute()).toHaveLength(1);
  });

  it("serializes simultaneous duplicate creates to one set of effects", async () => {
    const repository = new JobRepository(postgres.db);
    const input = { requestedBy: userId, requestId: "concurrent-create" };
    const [first, second] = await Promise.all([
      repository.createExample(input),
      repository.createExample(input),
    ]);

    expect(second).toEqual(first);
    expect(await postgres.db.selectFrom("jobs").selectAll().execute()).toHaveLength(1);
    expect(await postgres.db.selectFrom("job_steps").selectAll().execute()).toHaveLength(2);
    expect(await postgres.db.selectFrom("job_events").selectAll().execute()).toHaveLength(1);
    expect(await postgres.db.selectFrom("job_outbox").selectAll().execute()).toHaveLength(1);
  });

  it("rolls back all creation effects when the outbox insert fails", async () => {
    await sql`
      create function reject_job_outbox_insert() returns trigger language plpgsql as $$
      begin
        raise exception 'forced outbox failure';
      end
      $$
    `.execute(postgres.db);
    await sql`
      create trigger reject_job_outbox before insert on job_outbox
      for each statement execute function reject_job_outbox_insert()
    `.execute(postgres.db);

    await expect(new JobRepository(postgres.db).createExample({
      requestedBy: userId,
      requestId: "rollback-key",
    })).rejects.toThrow();
    expect(await postgres.db.selectFrom("jobs").selectAll().execute()).toEqual([]);
    expect(await postgres.db.selectFrom("job_steps").selectAll().execute()).toEqual([]);
    expect(await postgres.db.selectFrom("job_events").selectAll().execute()).toEqual([]);
    expect(await postgres.db.selectFrom("job_outbox").selectAll().execute()).toEqual([]);
  });

  it("queries persisted jobs after repository recreation and paginates with a cursor", async () => {
    const firstRepository = new JobRepository(postgres.db);
    const first = await firstRepository.createExample({ requestedBy: userId, requestId: "first" });
    await firstRepository.createExample({ requestedBy: userId, requestId: "second" });

    const recreated = new JobRepository(postgres.db);
    expect(await recreated.getById(first.id)).toEqual(first);
    const pageOne = await recreated.list({ limit: 1 });
    expect(pageOne.jobs).toHaveLength(1);
    expect(pageOne.nextCursor).toEqual(expect.any(String));
    const pageTwo = await recreated.list({ limit: 1, cursor: pageOne.nextCursor! });
    expect(pageTwo.jobs).toHaveLength(1);
    expect(pageTwo.jobs[0]?.id).not.toBe(pageOne.jobs[0]?.id);
  });

  it("paginates distinct PostgreSQL microseconds without skipping or duplicating rows", async () => {
    const repository = new JobRepository(postgres.db);
    const newest = await repository.createExample({ requestedBy: userId, requestId: "micro-newest" });
    const middle = await repository.createExample({ requestedBy: userId, requestId: "micro-middle" });
    const oldest = await repository.createExample({ requestedBy: userId, requestId: "micro-oldest" });
    await sql`
      update jobs set created_at = case id
        when ${newest.id} then '2026-07-19 00:00:00.000900+00'::timestamptz
        when ${middle.id} then '2026-07-19 00:00:00.000800+00'::timestamptz
        when ${oldest.id} then '2026-07-19 00:00:00.000700+00'::timestamptz
      end
      where id in (${newest.id}, ${middle.id}, ${oldest.id})
    `.execute(postgres.db);

    const seen: string[] = [];
    let cursor: string | undefined;
    for (let pageNumber = 0; pageNumber < 4; pageNumber += 1) {
      const page = await repository.list({ limit: 1, cursor });
      seen.push(...page.jobs.map((job) => job.id));
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }

    expect(seen).toEqual([newest.id, middle.id, oldest.id]);
    expect(new Set(seen).size).toBe(3);
  });
});
