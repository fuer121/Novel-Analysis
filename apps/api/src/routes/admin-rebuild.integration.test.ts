import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";

import { createDisposablePostgres, type DisposablePostgres } from "../../../../packages/database/src/testing/postgres.js";

import { createApp } from "../app.js";
import { FakeFeishuOAuthAdapter } from "../auth/feishu-fake.js";
import type { ApiConfig } from "../config.js";

const config: ApiConfig = {
  appOrigin: "http://rebuild.test",
  oauthRedirectUri: "http://rebuild.test/api/auth/callback",
  sessionCookieName: "rebuild_session",
  oauthCorrelationCookieName: "rebuild_oauth",
  sessionCookieSecure: false,
  sessionTtlMs: 60_000,
};

describe("admin library rebuild routes", () => {
  let postgres: DisposablePostgres;
  const identities: Record<string, { id: string; cookie: string; csrf: string }> = {};

  beforeEach(async () => {
    postgres = await createDisposablePostgres();
    for (const [name, role] of [["admin", "admin"], ["member", "member"]] as const) {
      const user = await postgres.db.insertInto("users").values({
        display_name: name,
        role,
        status: "active",
      }).returning("id").executeTakeFirstOrThrow();
      const token = `${name}-token`;
      const csrf = `${name}-csrf`;
      await postgres.db.insertInto("sessions").values({
        user_id: user.id,
        token_hash: createHash("sha256").update(token).digest("hex"),
        csrf_token_hash: createHash("sha256").update(csrf).digest("hex"),
        expires_at: new Date(Date.now() + 60_000),
        revoked_at: null,
      }).execute();
      identities[name] = { id: user.id, cookie: `rebuild_session=${token}`, csrf };
    }
    for (const title of ["First", "Second"]) {
      await postgres.db.insertInto("books").values({
        title,
        created_by: identities.admin!.id,
        status: "active",
      }).execute();
    }
  });

  afterEach(async () => postgres.destroy());

  const app = () => createApp({
    database: postgres.db,
    config,
    feishu: new FakeFeishuOAuthAdapter(),
  });
  const auth = (name: string) => ({ Cookie: identities[name]!.cookie });
  const write = (name: string) => ({
    ...auth(name),
    Origin: config.appOrigin,
    "X-CSRF-Token": identities[name]!.csrf,
    "Idempotency-Key": `${name}-request`,
  });

  it("lets only admins create, get and reorder untouched queue steps", async () => {
    expect((await request(app()).post("/api/admin/library-rebuilds")
      .set(write("member")).send({})).status).toBe(404);
    const created = await request(app()).post("/api/admin/library-rebuilds")
      .set(write("admin")).send({});
    expect(created.status).toBe(201);
    expect(created.body.detail.steps).toHaveLength(2);
    const jobId = created.body.detail.job.id as string;
    expect((await request(app()).get(`/api/admin/library-rebuilds/${jobId}`)
      .set(auth("member"))).status).toBe(404);
    const current = await request(app()).get("/api/admin/library-rebuilds/current")
      .set(auth("admin"));
    expect(current.body.detail.job.id).toBe(jobId);

    const orderedStepIds = created.body.detail.steps
      .map((step: { id: string }) => step.id).reverse();
    const reordered = await request(app()).put(`/api/admin/library-rebuilds/${jobId}/order`)
      .set(write("admin")).send({ orderedStepIds });
    expect(reordered.status).toBe(200);
    expect(reordered.body.detail.steps.map((step: { id: string }) => step.id))
      .toEqual(orderedStepIds);

    await postgres.db.updateTable("job_steps").set({ attempt_count: 1 })
      .where("id", "=", orderedStepIds[0]).execute();
    expect((await request(app()).put(`/api/admin/library-rebuilds/${jobId}/order`)
      .set(write("admin")).send({ orderedStepIds: orderedStepIds.reverse() })).status).toBe(409);
  });

  it("requires authentication, CSRF, idempotency, and strict request bodies", async () => {
    expect((await request(app()).get("/api/admin/library-rebuilds/current")).status).toBe(401);
    expect((await request(app()).post("/api/admin/library-rebuilds")
      .set(auth("admin")).send({})).status).toBe(403);
    expect((await request(app()).post("/api/admin/library-rebuilds")
      .set({ ...write("admin"), "Idempotency-Key": "" }).send({})).status).toBe(400);
    expect((await request(app()).post("/api/admin/library-rebuilds")
      .set(write("admin")).send({ bypassReadiness: true })).status).toBe(400);
  });
});
