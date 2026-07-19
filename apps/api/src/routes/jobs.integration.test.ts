import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { JobListResponseSchema, JobResponseSchema } from "@novel-analysis/contracts";
import {
  createDisposablePostgres,
  type DisposablePostgres,
} from "../../../../packages/database/src/testing/postgres.js";

import { createApp } from "../app.js";
import { type ApiConfig } from "../config.js";
import { FakeFeishuOAuthAdapter } from "../auth/feishu-fake.js";

const APP_ORIGIN = "http://app.test";
const config: ApiConfig = {
  appOrigin: APP_ORIGIN,
  oauthRedirectUri: `${APP_ORIGIN}/api/auth/callback`,
  sessionCookieName: "novel_test_session",
  oauthCorrelationCookieName: "novel_test_oauth_correlation",
  sessionCookieSecure: false,
  sessionTtlMs: 60 * 60 * 1000,
};

describe("jobs API", () => {
  let postgres: DisposablePostgres;
  let feishu: FakeFeishuOAuthAdapter;

  beforeEach(async () => {
    postgres = await createDisposablePostgres();
    feishu = new FakeFeishuOAuthAdapter();
  });

  afterEach(async () => {
    await postgres.destroy();
  });

  function app() {
    return createApp({ database: postgres.db, config, feishu });
  }

  async function addUser(subject: string, role: "admin" | "member") {
    const user = await postgres.db.insertInto("users").values({
      display_name: subject,
      avatar_url: null,
      role,
      status: "active",
    }).returning("id").executeTakeFirstOrThrow();
    await postgres.db.insertInto("auth_identities").values({
      user_id: user.id,
      provider: "feishu",
      subject,
    }).execute();
    return user.id;
  }

  async function login(subject: string) {
    feishu.addCode(`${subject}-code`, {
      unionId: subject,
      displayName: subject,
      avatarUrl: null,
    });
    const agent = request.agent(app());
    const start = await agent.get("/api/auth/login");
    const state = new URL(start.headers.location).searchParams.get("state")!;
    const callback = await agent.get(`/api/auth/callback?code=${subject}-code&state=${state}`);
    const me = await agent.get("/api/auth/me").set("Origin", APP_ORIGIN);
    const setCookie = callback.headers["set-cookie"] as unknown as string[];
    const sessionCookie = setCookie.find((value) =>
      value.startsWith(`${config.sessionCookieName}=`),
    )!.split(";", 1)[0]!;
    return { agent, csrfToken: me.body.csrfToken as string, sessionCookie };
  }

  function writeHeaders(csrfToken: string, requestId = "request-1") {
    return {
      Origin: APP_ORIGIN,
      "X-CSRF-Token": csrfToken,
      "Idempotency-Key": requestId,
    };
  }

  it("requires session, exact Origin, CSRF, and Idempotency-Key for creation", async () => {
    await addUser("member", "member");
    const { agent, csrfToken } = await login("member");

    const missingSession = await request(app()).post("/api/jobs/example").set(writeHeaders(csrfToken));
    expect(missingSession.status).toBe(401);
    expect(missingSession.body).toEqual({ error: "unauthorized" });
    expect((await request(app()).get("/api/jobs")).status).toBe(401);
    const badOrigin = await agent.post("/api/jobs/example").set("Origin", "https://evil.test").set("X-CSRF-Token", csrfToken).set("Idempotency-Key", "bad-origin");
    expect(badOrigin.status).toBe(403);
    expect(badOrigin.body).toEqual({ error: "forbidden" });
    const missingCsrf = await agent.post("/api/jobs/example").set("Origin", APP_ORIGIN).set("Idempotency-Key", "no-csrf");
    expect(missingCsrf.status).toBe(403);
    expect(missingCsrf.body).toEqual({ error: "forbidden" });
    expect((await agent.post("/api/jobs/example").set("Origin", APP_ORIGIN).set("X-CSRF-Token", csrfToken)).status).toBe(400);
    expect(await postgres.db.selectFrom("jobs").selectAll().execute()).toEqual([]);
  });

  it("reports only an authenticated stale CSRF token and accepts the rotated token", async () => {
    await addUser("member", "member");
    const loginResult = await login("member");
    const rotated = await loginResult.agent.get("/api/auth/me").set("Origin", APP_ORIGIN);

    const stale = await loginResult.agent.post("/api/jobs/example")
      .set(writeHeaders(loginResult.csrfToken, "stale-csrf"));
    expect(stale.status).toBe(403);
    expect(stale.body).toEqual({ error: "CSRF_STALE" });

    const created = await loginResult.agent.post("/api/jobs/example")
      .set(writeHeaders(rotated.body.csrfToken as string, "fresh-csrf"));
    expect(created.status).toBe(201);
  });

  it("creates and replays a public job without exposing internal fields", async () => {
    const userId = await addUser("member", "member");
    const { agent, csrfToken } = await login("member");
    const first = await agent.post("/api/jobs/example").set(writeHeaders(csrfToken, "same-create"));
    const duplicate = await agent.post("/api/jobs/example").set(writeHeaders(csrfToken, "same-create"));

    expect(first.status).toBe(201);
    expect(duplicate.status).toBe(201);
    expect(duplicate.body).toEqual(first.body);
    expect(JobResponseSchema.parse(first.body)).toEqual(first.body);
    expect(first.body.job).toMatchObject({ requestedBy: userId, type: "query", status: "queued" });
    expect(Object.keys(first.body.job).sort()).toEqual([
      "createdAt", "id", "progress", "requestedBy", "scope", "status", "type", "updatedAt",
    ]);
    expect(JSON.stringify(first.body)).not.toMatch(/leaseOwner|tokenHash|queueId|requestId|configSnapshot|errorStack/);
    expect(await postgres.db.selectFrom("jobs").selectAll().execute()).toHaveLength(1);
  });

  it("lists bounded pages and reads details after app recreation", async () => {
    await addUser("member", "member");
    const loginResult = await login("member");
    const created = await loginResult.agent.post("/api/jobs/example")
      .set(writeHeaders(loginResult.csrfToken, "query-after-recreate"));

    const list = await request(app()).get("/api/jobs?limit=1")
      .set("Cookie", loginResult.sessionCookie);
    const detail = await request(app()).get(`/api/jobs/${created.body.job.id}`)
      .set("Cookie", loginResult.sessionCookie);
    expect(list.status).toBe(200);
    expect(JobListResponseSchema.parse(list.body)).toEqual(list.body);
    expect(detail.status).toBe(200);
    expect(JobResponseSchema.parse(detail.body)).toEqual(detail.body);
    expect(detail.body).toEqual(created.body);
    expect((await request(app()).get("/api/jobs?limit=101")
      .set("Cookie", loginResult.sessionCookie)).status).toBe(400);
    expect((await request(app()).get("/api/jobs?limit=1&cursor=not-a-cursor")
      .set("Cookie", loginResult.sessionCookie)).status).toBe(400);
  });

  it("enforces owner/admin control and control-write security", async () => {
    await addUser("owner", "member");
    await addUser("other", "member");
    await addUser("admin", "admin");
    const owner = await login("owner");
    const other = await login("other");
    const admin = await login("admin");
    const created = await owner.agent.post("/api/jobs/example")
      .set(writeHeaders(owner.csrfToken, "owned-job"));
    const id = created.body.job.id as string;

    expect((await other.agent.post(`/api/jobs/${id}/pause`).set(writeHeaders(other.csrfToken, "other-pause"))).status).toBe(403);
    expect((await owner.agent.post(`/api/jobs/${id}/pause`).set("Origin", APP_ORIGIN).set("X-CSRF-Token", owner.csrfToken)).status).toBe(400);
    const paused = await owner.agent.post(`/api/jobs/${id}/pause`).set(writeHeaders(owner.csrfToken, "owner-pause"));
    const resumed = await admin.agent.post(`/api/jobs/${id}/resume`).set(writeHeaders(admin.csrfToken, "admin-resume"));
    expect(paused.status).toBe(200);
    expect(paused.body.job.status).toBe("paused");
    expect(resumed.status).toBe(200);
    expect(resumed.body.job.status).toBe("queued");
    expect(await postgres.db.selectFrom("audit_logs").selectAll().where("target_id", "=", id).execute()).toHaveLength(2);
  });

  it("maps missing jobs and invalid transitions without leaking errors or writing audit", async () => {
    await addUser("member", "member");
    const { agent, csrfToken } = await login("member");
    const missing = await agent.post("/api/jobs/00000000-0000-4000-8000-000000000000/cancel")
      .set(writeHeaders(csrfToken, "missing"));
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ error: "job_not_found" });

    const created = await agent.post("/api/jobs/example").set(writeHeaders(csrfToken, "terminal-job"));
    await agent.post(`/api/jobs/${created.body.job.id}/cancel`).set(writeHeaders(csrfToken, "cancel"));
    const invalid = await agent.post(`/api/jobs/${created.body.job.id}/pause`).set(writeHeaders(csrfToken, "terminal-pause"));
    expect(invalid.status).toBe(409);
    expect(invalid.body).toEqual({ error: "invalid_transition" });
    expect(JSON.stringify(invalid.body)).not.toContain("Invalid job transition");
    expect(await postgres.db.selectFrom("audit_logs").selectAll().where("target_id", "=", created.body.job.id).execute()).toHaveLength(1);
  });
});
