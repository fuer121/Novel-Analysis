import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import {
  createDisposablePostgres,
  type DisposablePostgres,
} from "../../packages/database/src/testing/postgres.js";

import { FEISHU_USERS } from "./fixtures/feishu-users.js";
import {
  startTestApi,
  startWorker,
  type ManagedProcess,
} from "./helpers/processes.js";

type Login = { cookie: string; csrf: string };
const execFileAsync = promisify(execFile);

async function phase1ChildPids(): Promise<string[]> {
  const result = await execFileAsync("ps", ["-ax", "-o", "pid=,command="]);
  return result.stdout.split("\n")
    .filter((line) => line.includes("test/phase1/helpers/controlled-worker-main.ts")
      || line.includes("test/phase1/helpers/test-api-main.ts"))
    .map((line) => line.trim().split(/\s+/, 1)[0]!);
}

function firstCookie(response: Response, name: string): string {
  const value = response.headers.get("set-cookie")?.split(/,(?=\s*[^;,=]+=[^;,]*)/)
    .find((cookie) => cookie.trim().startsWith(`${name}=`));
  if (!value) throw new Error(`Missing ${name} cookie`);
  return value.trim().split(";", 1)[0]!;
}

async function login(origin: string, kind: keyof typeof FEISHU_USERS): Promise<Login> {
  const start = await fetch(`${origin}/api/auth/login?returnTo=%2Ftasks`, { redirect: "manual" });
  const state = new URL(start.headers.get("location")!).searchParams.get("state")!;
  const correlation = firstCookie(start, "phase1_oauth_correlation");
  const callback = await fetch(
    `${origin}/api/auth/callback?code=${FEISHU_USERS[kind].code}&state=${encodeURIComponent(state)}`,
    { headers: { Cookie: correlation }, redirect: "manual" },
  );
  expect(callback.status).toBe(303);
  const cookie = firstCookie(callback, "phase1_session");
  const me = await fetch(`${origin}/api/auth/me`, {
    headers: { Cookie: cookie, Origin: "http://127.0.0.1" },
  });
  expect(me.status).toBe(200);
  return { cookie, csrf: (await me.json() as { csrfToken: string }).csrfToken };
}

function writeHeaders(loginResult: Login, requestId: string): Record<string, string> {
  return {
    Cookie: loginResult.cookie,
    Origin: "http://127.0.0.1",
    "X-CSRF-Token": loginResult.csrf,
    "Idempotency-Key": requestId,
  };
}

async function postJob(origin: string, loginResult: Login, requestId: string): Promise<string> {
  const response = await fetch(`${origin}/api/jobs/example`, {
    method: "POST",
    headers: writeHeaders(loginResult, requestId),
  });
  expect(response.status).toBe(201);
  return (await response.json() as { job: { id: string } }).job.id;
}

async function control(
  origin: string,
  loginResult: Login,
  jobId: string,
  action: "pause" | "resume" | "cancel",
  requestId: string,
): Promise<Response> {
  return fetch(`${origin}/api/jobs/${jobId}/${action}`, {
    method: "POST",
    headers: writeHeaders(loginResult, requestId),
  });
}

async function waitUntil(check: () => Promise<boolean>, label: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

describe("Phase 1 independent recovery demo", () => {
  let postgres: DisposablePostgres | undefined;
  const children: ManagedProcess[] = [];

  afterEach(async () => {
    const cleanup = await Promise.allSettled(children.reverse().map((child) => child.stop()));
    await postgres?.destroy();
    const failed = cleanup.find((result) => result.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
  });

  it("owns child cleanup when readiness fails and stops without a timer tail", async () => {
    postgres = await createDisposablePostgres();
    const before = await phase1ChildPids();
    await expect(startTestApi({
      databaseUrl: postgres.databaseUrl,
      clientSecret: "startup-cleanup-secret",
      suppressReady: true,
      readyTimeoutMs: 100,
    })).rejects.toThrow("Timed out waiting for ready");
    expect(await phase1ChildPids()).toEqual(before);

    await expect(startWorker({
      databaseUrl: postgres.databaseUrl,
      mode: "recovery",
      suppressReady: true,
      readyTimeoutMs: 100,
    })).rejects.toThrow("Timed out waiting for ready");
    expect(await phase1ChildPids()).toEqual(before);
    await expect(startWorker({
      databaseUrl: "postgres://novel:novel@127.0.0.1:1/unreachable",
      mode: "recovery",
      readyTimeoutMs: 5_000,
    })).rejects.toThrow("Process exited before ready");
    expect(await phase1ChildPids()).toEqual(before);

    const worker = await startWorker({ databaseUrl: postgres.databaseUrl, mode: "recovery" });
    const startedAt = Date.now();
    await worker.stop();
    expect(Date.now() - startedAt).toBeLessThan(2_000);
    expect(await phase1ChildPids()).toEqual(before);
  });

  it("survives API and Worker process replacement without duplicate effects", async () => {
    postgres = await createDisposablePostgres();
    const users: Record<keyof typeof FEISHU_USERS, string> = { admin: "", member: "" };
    for (const [kind, fixture] of Object.entries(FEISHU_USERS) as Array<[
      keyof typeof FEISHU_USERS,
      (typeof FEISHU_USERS)[keyof typeof FEISHU_USERS],
    ]>) {
      const user = await postgres.db.insertInto("users").values({
        display_name: fixture.identity.displayName,
        avatar_url: null,
        role: fixture.role,
        status: "active",
      }).returning("id").executeTakeFirstOrThrow();
      users[kind] = user.id;
      await postgres.db.insertInto("auth_identities").values({
        user_id: user.id,
        provider: "feishu",
        subject: fixture.identity.unionId,
      }).execute();
    }

    const clientSecret = "phase1-client-secret";
    const firstApi = await startTestApi({ databaseUrl: postgres.databaseUrl, clientSecret });
    children.push(firstApi);
    const admin = await login(firstApi.origin, "admin");
    const member = await login(firstApi.origin, "member");
    const recoveryJobId = await postJob(firstApi.origin, admin, "recovery-job");
    expect((await control(firstApi.origin, admin, recoveryJobId, "pause", "pause-job")).status).toBe(200);
    expect((await control(firstApi.origin, admin, recoveryJobId, "resume", "resume-job")).status).toBe(200);
    const cancelledJobId = await postJob(firstApi.origin, admin, "cancelled-job");
    expect((await control(firstApi.origin, admin, cancelledJobId, "cancel", "cancel-job")).status).toBe(200);

    expect((await fetch(`${firstApi.origin}/api/admin/members`, {
      headers: { Cookie: member.cookie },
    })).status).toBe(403);
    expect((await control(firstApi.origin, member, recoveryJobId, "pause", "forbidden-pause")).status)
      .toBe(403);
    expect(await postgres.db.selectFrom("audit_logs").selectAll()
      .where("target_id", "=", recoveryJobId).execute()).toHaveLength(2);

    await firstApi.stop();
    const secondApi = await startTestApi({ databaseUrl: postgres.databaseUrl, clientSecret });
    children.push(secondApi);
    const restartedDetail = await fetch(`${secondApi.origin}/api/jobs/${recoveryJobId}`, {
      headers: { Cookie: admin.cookie },
    });
    expect(restartedDetail.status).toBe(200);
    expect((await restartedDetail.json() as { job: { id: string } }).job.id).toBe(recoveryJobId);

    const workerA = await startWorker({ databaseUrl: postgres.databaseUrl, mode: "controlled" });
    children.push(workerA);
    expect((await workerA.waitFor("started")).attemptNo).toBe(1);
    expect(await postgres.db.selectFrom("job_attempts").select(["attempt_no", "status"])
      .execute()).toContainEqual({ attempt_no: 1, status: "running" });
    await workerA.stop("SIGKILL");

    await postgres.db.updateTable("job_steps")
      .set({ lease_expires_at: new Date(0) })
      .where("job_id", "=", recoveryJobId)
      .where("status", "=", "running")
      .execute();
    const expiredLease = await postgres.db.selectFrom("job_steps").select("lease_expires_at")
      .where("job_id", "=", recoveryJobId).where("status", "=", "running")
      .executeTakeFirstOrThrow();
    expect(expiredLease.lease_expires_at!.getTime()).toBeLessThanOrEqual(Date.now());

    const workerB = await startWorker({ databaseUrl: postgres.databaseUrl, mode: "recovery" });
    children.push(workerB);
    await waitUntil(async () => (await postgres!.db.selectFrom("jobs").select("status")
      .where("id", "=", recoveryJobId).executeTakeFirstOrThrow()).status === "completed", "job completion");

    const steps = await postgres.db.selectFrom("job_steps")
      .select(["id", "position", "status", "output_ref", "attempt_count"])
      .where("job_id", "=", recoveryJobId).orderBy("position").execute();
    expect(steps).toHaveLength(2);
    expect(steps.every((step) => step.status === "completed" && step.output_ref !== null)).toBe(true);
    expect(steps.map((step) => step.attempt_count)).toEqual([2, 1]);

    const attempts = await postgres.db.selectFrom("job_attempts")
      .innerJoin("job_steps", "job_steps.id", "job_attempts.step_id")
      .select(["job_steps.position", "job_attempts.attempt_no", "job_attempts.status"])
      .where("job_steps.job_id", "=", recoveryJobId)
      .orderBy("job_steps.position").orderBy("job_attempts.attempt_no").execute();
    expect(attempts).toEqual([
      { position: 0, attempt_no: 1, status: "abandoned" },
      { position: 0, attempt_no: 2, status: "completed" },
      { position: 1, attempt_no: 1, status: "completed" },
    ]);

    const events = await postgres.db.selectFrom("job_events")
      .select(["id", "type", "dedupe_key", "payload"])
      .where("job_id", "=", recoveryJobId).orderBy("id").execute();
    expect(events.filter((event) => event.type === "progress")).toHaveLength(2);
    for (const step of steps) {
      expect(events.filter((event) => event.dedupe_key === `step:${step.id}:completed`)).toHaveLength(1);
    }
    expect(events.filter((event) => event.type === "completed")).toHaveLength(1);
    let outbox = await postgres.db.selectFrom("job_outbox")
      .select(["id", "job_id", "delivered_at", "claimed_by", "claim_expires_at"])
      .where("job_id", "=", recoveryJobId).orderBy("created_at").execute();
    expect(outbox).toHaveLength(3);
    expect(outbox.every((row) => row.delivered_at instanceof Date)).toBe(true);
    expect(outbox.every((row) => row.claimed_by === null && row.claim_expires_at === null)).toBe(true);
    const jobBeforeReplay = await postgres.db.selectFrom("jobs")
      .select(["id", "status", "progress"])
      .where("id", "=", recoveryJobId).executeTakeFirstOrThrow();
    const auditsBeforeReplay = await postgres.db.selectFrom("audit_logs")
      .select(["id", "action", "target_id", "metadata"])
      .where("target_id", "in", [recoveryJobId, cancelledJobId]).orderBy("id").execute();
    const replayedOutbox = outbox[0]!;
    await postgres.db.updateTable("job_outbox").set({ delivered_at: null })
      .where("id", "=", replayedOutbox.id).execute();
    await waitUntil(async () => (await postgres!.db.selectFrom("job_outbox").select("delivered_at")
      .where("id", "=", replayedOutbox.id).executeTakeFirstOrThrow()).delivered_at !== null,
    "duplicate outbox delivery");
    const wakeConsumed = workerB.waitFor("replay-consumed", 20_000);
    workerB.send({ type: "replay-wake", jobId: recoveryJobId, outboxId: replayedOutbox.id });
    await wakeConsumed;
    expect(await postgres.db.selectFrom("job_attempts")
      .innerJoin("job_steps", "job_steps.id", "job_attempts.step_id")
      .select(["job_steps.position", "job_attempts.attempt_no", "job_attempts.status"])
      .where("job_steps.job_id", "=", recoveryJobId)
      .orderBy("job_steps.position").orderBy("job_attempts.attempt_no").execute()).toEqual(attempts);
    expect(await postgres.db.selectFrom("job_steps")
      .select(["id", "position", "status", "output_ref", "attempt_count"])
      .where("job_id", "=", recoveryJobId).orderBy("position").execute()).toEqual(steps);
    const eventsAfterReplay = await postgres.db.selectFrom("job_events")
      .select(["id", "type", "dedupe_key", "payload"])
      .where("job_id", "=", recoveryJobId).orderBy("id").execute();
    expect(eventsAfterReplay).toEqual(events);
    expect(eventsAfterReplay.filter((event) => event.type === "progress")).toHaveLength(2);
    expect(eventsAfterReplay.filter((event) => event.type === "completed")).toHaveLength(1);
    outbox = await postgres.db.selectFrom("job_outbox")
      .select(["id", "job_id", "delivered_at", "claimed_by", "claim_expires_at"])
      .where("job_id", "=", recoveryJobId).orderBy("created_at").execute();
    expect(outbox).toHaveLength(3);
    expect(outbox.every((row) => row.delivered_at instanceof Date)).toBe(true);
    expect(outbox.every((row) => row.claimed_by === null && row.claim_expires_at === null)).toBe(true);
    const jobAfterReplay = await postgres.db.selectFrom("jobs")
      .select(["id", "status", "progress"])
      .where("id", "=", recoveryJobId).executeTakeFirstOrThrow();
    expect(jobAfterReplay).toEqual(jobBeforeReplay);
    expect(jobAfterReplay).toMatchObject({
      id: recoveryJobId,
      status: "completed",
      progress: { total: 2, completed: 2, failed: 0, skipped: 0 },
    });

    const auditsAfterReplay = await postgres.db.selectFrom("audit_logs")
      .select(["id", "action", "target_id", "metadata"])
      .where("target_id", "in", [recoveryJobId, cancelledJobId]).orderBy("id").execute();
    expect(auditsAfterReplay).toEqual(auditsBeforeReplay);
    expect(auditsAfterReplay.map((audit) => audit.action)).toEqual([
      "job.paused", "job.resumed", "job.cancelled",
    ]);
    expect(auditsAfterReplay.filter((audit) => audit.target_id === recoveryJobId)).toHaveLength(2);

    const capturedLogs = children.flatMap((child) => child.logs).join("\n");
    expect(capturedLogs).toContain("phase1-auth-redaction authentication_failed");
    expect(capturedLogs).toContain("phase1-worker-ready");
    for (const secret of [
      FEISHU_USERS.admin.code,
      FEISHU_USERS.member.code,
      "phase1-redaction-code",
      admin.cookie,
      member.cookie,
      admin.csrf,
      member.csrf,
      "Cookie",
      clientSecret,
    ]) {
      expect(capturedLogs).not.toContain(secret);
    }
    expect(users.admin).not.toBe(users.member);
  });
});
