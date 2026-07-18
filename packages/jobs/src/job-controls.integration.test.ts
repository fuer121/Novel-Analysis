import { sql } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createDisposablePostgres,
  type DisposablePostgres,
} from "../../database/src/testing/postgres.js";

import { JobControls, JobControlForbiddenError } from "./job-controls.js";
import { JobRepository } from "./job-repository.js";

describe("job controls", () => {
  let postgres: DisposablePostgres;
  let ownerId: string;
  let otherId: string;
  let adminId: string;

  beforeEach(async () => {
    postgres = await createDisposablePostgres();
    async function addUser(name: string, role: "admin" | "member") {
      return (await postgres.db.insertInto("users").values({
        display_name: name,
        avatar_url: null,
        role,
        status: "active",
      }).returning("id").executeTakeFirstOrThrow()).id;
    }
    ownerId = await addUser("Owner", "member");
    otherId = await addUser("Other", "member");
    adminId = await addUser("Admin", "admin");
  });

  afterEach(async () => {
    await postgres.destroy();
  });

  async function createJob(requestId: string) {
    return new JobRepository(postgres.db).createExample({ requestedBy: ownerId, requestId });
  }

  it("allows the owner and admin but rejects another member without effects", async () => {
    const first = await createJob("matrix-owner");
    const controls = new JobControls(postgres.db);
    await expect(controls.control({
      jobId: first.id,
      actor: { userId: otherId, role: "member" },
      action: "pause",
      requestId: "other-pause",
    })).rejects.toBeInstanceOf(JobControlForbiddenError);
    expect((await new JobRepository(postgres.db).getById(first.id))?.status).toBe("queued");
    expect(await postgres.db.selectFrom("audit_logs").selectAll().execute()).toEqual([]);

    expect((await controls.control({
      jobId: first.id,
      actor: { userId: ownerId, role: "member" },
      action: "pause",
      requestId: "owner-pause",
    })).status).toBe("paused");
    expect((await controls.control({
      jobId: first.id,
      actor: { userId: adminId, role: "admin" },
      action: "resume",
      requestId: "admin-resume",
    })).status).toBe("queued");
  });

  it("applies pause, resume, and cancel transitions with one event and audit each", async () => {
    const job = await createJob("transitions");
    const controls = new JobControls(postgres.db);
    expect((await controls.control({ jobId: job.id, actor: { userId: ownerId, role: "member" }, action: "pause", requestId: "pause" })).status).toBe("paused");
    expect((await controls.control({ jobId: job.id, actor: { userId: ownerId, role: "member" }, action: "resume", requestId: "resume" })).status).toBe("queued");
    expect((await controls.control({ jobId: job.id, actor: { userId: ownerId, role: "member" }, action: "cancel", requestId: "cancel" })).status).toBe("cancelled");

    expect(await postgres.db.selectFrom("job_events").selectAll().where("job_id", "=", job.id).execute()).toHaveLength(4);
    expect(await postgres.db.selectFrom("audit_logs").selectAll().where("target_id", "=", job.id).execute()).toHaveLength(3);
    expect(await postgres.db.selectFrom("job_outbox").selectAll().where("job_id", "=", job.id).execute()).toHaveLength(2);
    expect(await postgres.db.selectFrom("audit_logs").select(["action", "actor_user_id", "metadata"])
      .where("target_id", "=", job.id).orderBy("id").execute()).toEqual([
      { action: "job.paused", actor_user_id: ownerId, metadata: { from: "queued", to: "paused", request_id: "pause" } },
      { action: "job.resumed", actor_user_id: ownerId, metadata: { from: "paused", to: "queued", request_id: "resume" } },
      { action: "job.cancelled", actor_user_id: ownerId, metadata: { from: "queued", to: "cancelled", request_id: "cancel" } },
    ]);
  });

  it("replays the first control result without duplicating effects", async () => {
    const job = await createJob("idempotent-control");
    const controls = new JobControls(postgres.db);
    const firstPause = await controls.control({ jobId: job.id, actor: { userId: ownerId, role: "member" }, action: "pause", requestId: "same-control" });
    await controls.control({ jobId: job.id, actor: { userId: ownerId, role: "member" }, action: "resume", requestId: "resume-control" });
    const replay = await controls.control({ jobId: job.id, actor: { userId: ownerId, role: "member" }, action: "pause", requestId: "same-control" });

    expect(replay).toEqual(firstPause);
    expect(replay.status).toBe("paused");
    expect((await new JobRepository(postgres.db).getById(job.id))?.status).toBe("queued");
    expect(await postgres.db.selectFrom("job_events").selectAll().where("job_id", "=", job.id).execute()).toHaveLength(3);
    expect(await postgres.db.selectFrom("audit_logs").selectAll().where("target_id", "=", job.id).execute()).toHaveLength(2);
  });

  it("treats the same key on different actions as distinct controls", async () => {
    const job = await createJob("action-fingerprint");
    const controls = new JobControls(postgres.db);
    const paused = await controls.control({
      jobId: job.id,
      actor: { userId: ownerId, role: "member" },
      action: "pause",
      requestId: "shared-key",
    });
    const resumed = await controls.control({
      jobId: job.id,
      actor: { userId: ownerId, role: "member" },
      action: "resume",
      requestId: "shared-key",
    });

    expect(paused.status).toBe("paused");
    expect(resumed.status).toBe("queued");
    expect((await new JobRepository(postgres.db).getById(job.id))?.status).toBe("queued");
    expect(await postgres.db.selectFrom("job_events").selectAll().where("job_id", "=", job.id).execute()).toHaveLength(3);
    expect(await postgres.db.selectFrom("audit_logs").selectAll().where("target_id", "=", job.id).execute()).toHaveLength(2);
    expect(await postgres.db.selectFrom("job_outbox").selectAll().where("job_id", "=", job.id).execute()).toHaveLength(2);
  });

  it("treats the same action and key from different authorized actors as distinct controls", async () => {
    const job = await createJob("actor-fingerprint");
    const controls = new JobControls(postgres.db);
    await controls.control({
      jobId: job.id,
      actor: { userId: ownerId, role: "member" },
      action: "pause",
      requestId: "shared-key",
    });
    await controls.control({
      jobId: job.id,
      actor: { userId: ownerId, role: "member" },
      action: "resume",
      requestId: "owner-resume",
    });
    const adminPause = await controls.control({
      jobId: job.id,
      actor: { userId: adminId, role: "admin" },
      action: "pause",
      requestId: "shared-key",
    });

    expect(adminPause.status).toBe("paused");
    expect((await new JobRepository(postgres.db).getById(job.id))?.status).toBe("paused");
    expect(await postgres.db.selectFrom("job_events").selectAll().where("job_id", "=", job.id).execute()).toHaveLength(4);
    expect(await postgres.db.selectFrom("audit_logs").select("actor_user_id")
      .where("target_id", "=", job.id).orderBy("id").execute()).toEqual([
      { actor_user_id: ownerId },
      { actor_user_id: ownerId },
      { actor_user_id: adminId },
    ]);
  });

  it("serializes concurrent exact replays to one control effect", async () => {
    const job = await createJob("concurrent-control");
    const controls = new JobControls(postgres.db);
    const input = {
      jobId: job.id,
      actor: { userId: ownerId, role: "member" as const },
      action: "pause" as const,
      requestId: "concurrent-pause",
    };
    const [first, second] = await Promise.all([
      controls.control(input),
      controls.control(input),
    ]);

    expect(second).toEqual(first);
    expect(first.status).toBe("paused");
    expect(await postgres.db.selectFrom("job_events").selectAll().where("job_id", "=", job.id).execute()).toHaveLength(2);
    expect(await postgres.db.selectFrom("audit_logs").selectAll().where("target_id", "=", job.id).execute()).toHaveLength(1);
    expect(await postgres.db.selectFrom("job_outbox").selectAll().where("job_id", "=", job.id).execute()).toHaveLength(1);
  });

  it("cancels unfinished steps and an open attempt in the same transaction", async () => {
    const job = await createJob("cancel-steps");
    const steps = await postgres.db.selectFrom("job_steps").select("id")
      .where("job_id", "=", job.id).orderBy("position").execute();
    await postgres.db.updateTable("job_steps").set({ status: "completed" }).where("id", "=", steps[0]!.id).execute();
    await postgres.db.updateTable("job_steps").set({ status: "running", lease_owner: "worker-private" }).where("id", "=", steps[1]!.id).execute();
    await postgres.db.insertInto("job_attempts").values({
      step_id: steps[1]!.id,
      attempt_no: 1,
      worker_id: "worker-private",
      status: "running",
      error_code: null,
      error_message: "internal stack",
      started_at: new Date(),
      finished_at: null,
    }).execute();

    await new JobControls(postgres.db).control({ jobId: job.id, actor: { userId: ownerId, role: "member" }, action: "cancel", requestId: "cancel-open" });
    expect(await postgres.db.selectFrom("job_steps").select(["position", "status"])
      .where("job_id", "=", job.id).orderBy("position").execute()).toEqual([
      { position: 0, status: "completed" },
      { position: 1, status: "cancelled" },
    ]);
    expect(await postgres.db.selectFrom("job_attempts").select(["status", "finished_at"]).executeTakeFirstOrThrow())
      .toMatchObject({ status: "cancelled", finished_at: expect.any(Date) });
  });

  it("leaves terminal or invalid transitions unchanged with no audit", async () => {
    const job = await createJob("terminal");
    await postgres.db.updateTable("jobs").set({ status: "completed" }).where("id", "=", job.id).execute();
    const controls = new JobControls(postgres.db);
    await expect(controls.control({ jobId: job.id, actor: { userId: ownerId, role: "member" }, action: "pause", requestId: "invalid" }))
      .rejects.toMatchObject({ name: "InvalidJobTransitionError", from: "completed", to: "paused" });
    expect((await new JobRepository(postgres.db).getById(job.id))?.status).toBe("completed");
    expect(await postgres.db.selectFrom("job_events").selectAll().where("job_id", "=", job.id).execute()).toHaveLength(1);
    expect(await postgres.db.selectFrom("audit_logs").selectAll().execute()).toEqual([]);
  });

  it("rolls back job, event, and resume outbox when audit insertion fails", async () => {
    const job = await createJob("audit-rollback");
    await new JobControls(postgres.db).control({ jobId: job.id, actor: { userId: ownerId, role: "member" }, action: "pause", requestId: "setup-pause" });
    await sql`
      create function reject_job_audit_insert() returns trigger language plpgsql as $$
      begin
        raise exception 'forced audit failure';
      end
      $$
    `.execute(postgres.db);
    await sql`
      create trigger reject_job_audit before insert on audit_logs
      for each statement execute function reject_job_audit_insert()
    `.execute(postgres.db);

    await expect(new JobControls(postgres.db).control({ jobId: job.id, actor: { userId: ownerId, role: "member" }, action: "resume", requestId: "failed-resume" })).rejects.toThrow();
    expect((await new JobRepository(postgres.db).getById(job.id))?.status).toBe("paused");
    expect(await postgres.db.selectFrom("job_events").selectAll().where("job_id", "=", job.id).execute()).toHaveLength(2);
    expect(await postgres.db.selectFrom("job_outbox").selectAll().where("job_id", "=", job.id).execute()).toHaveLength(1);
    expect(await postgres.db.selectFrom("audit_logs").selectAll().where("target_id", "=", job.id).execute()).toHaveLength(1);
  });
});
