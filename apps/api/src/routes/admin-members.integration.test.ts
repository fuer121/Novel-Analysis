import { createHash } from "node:crypto";

import { sql } from "kysely";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createDisposablePostgres,
  type DisposablePostgres,
} from "../../../../packages/database/src/testing/postgres.js";

import { createApp } from "../app.js";
import { bootstrapFirstAdmin } from "../bootstrap-admin.js";
import { type ApiConfig } from "../config.js";
import { FakeFeishuOAuthAdapter } from "../auth/feishu-fake.js";

const APP_ORIGIN = "http://app.test";
const config: ApiConfig = {
  appOrigin: APP_ORIGIN,
  oauthRedirectUri: `${APP_ORIGIN}/api/auth/callback`,
  sessionCookieName: "novel_test_session",
  sessionCookieSecure: false,
  sessionTtlMs: 60 * 60 * 1000,
};

describe("admin member management", () => {
  let postgres: DisposablePostgres;
  let feishu: FakeFeishuOAuthAdapter;

  beforeEach(async () => {
    postgres = await createDisposablePostgres();
    feishu = new FakeFeishuOAuthAdapter();
  });

  afterEach(async () => {
    await postgres.destroy();
  });

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

  function app() {
    return createApp({ database: postgres.db, config, feishu });
  }

  async function login(subject: string) {
    feishu.addCode(`${subject}-code`, { unionId: subject, displayName: subject, avatarUrl: null });
    const agent = request.agent(app());
    const start = await agent.get("/api/auth/login");
    const state = new URL(start.headers.location).searchParams.get("state")!;
    await agent.get(`/api/auth/callback?code=${subject}-code&state=${state}`);
    const me = await agent.get("/api/auth/me").set("Origin", APP_ORIGIN);
    return { agent, csrfToken: me.body.csrfToken };
  }

  async function waitForBlockedRequests(expectedCount = 1) {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const result = await sql<{ count: string }>`
        select count(*)::text as count
        from pg_stat_activity
        where datname = current_database()
          and pid <> pg_backend_pid()
          and wait_event_type = 'Lock'
      `.execute(postgres.db);
      if (Number(result.rows[0]?.count) >= expectedCount) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`expected ${expectedCount} blocked database requests`);
  }

  it("returns 403 for member GET, POST, and PATCH requests", async () => {
    const memberId = await addUser("member", "member");
    const { agent, csrfToken } = await login("member");
    const headers = { Origin: APP_ORIGIN, "X-CSRF-Token": csrfToken };

    expect((await agent.get("/api/admin/members")).status).toBe(403);
    expect((await agent.post("/api/admin/members").set(headers).send({ displayName: "Other", unionId: "other", role: "member" })).status).toBe(403);
    expect((await agent.patch(`/api/admin/members/${memberId}`).set(headers).send({ status: "disabled" })).status).toBe(403);
  });

  it("lets an admin list and create members with exactly one audit row", async () => {
    const adminId = await addUser("admin", "admin");
    const { agent, csrfToken } = await login("admin");

    const list = await agent.get("/api/admin/members");
    expect(list.status).toBe(200);
    expect(list.body.members).toEqual([
      expect.objectContaining({ id: adminId, displayName: "admin", role: "admin", status: "active" }),
    ]);

    const created = await agent.post("/api/admin/members")
      .set("Origin", APP_ORIGIN).set("X-CSRF-Token", csrfToken)
      .send({ displayName: "New Member", unionId: "new-member", role: "member" });
    expect(created.status).toBe(201);
    expect(await postgres.db.selectFrom("audit_logs").select(({ fn }) => fn.countAll<number>().as("count")).executeTakeFirstOrThrow())
      .toEqual({ count: "1" });
    expect(await postgres.db.selectFrom("audit_logs").selectAll().executeTakeFirstOrThrow())
      .toMatchObject({ actor_user_id: adminId, action: "member.created", target_type: "user", target_id: created.body.member.id });
  });

  it("updates a member, revokes all target sessions, and audits in one transaction", async () => {
    await addUser("admin", "admin");
    const memberId = await addUser("member", "member");
    const memberLogin = await login("member");
    const adminLogin = await login("admin");

    const response = await adminLogin.agent.patch(`/api/admin/members/${memberId}`)
      .set("Origin", APP_ORIGIN).set("X-CSRF-Token", adminLogin.csrfToken)
      .send({ status: "disabled" });
    expect(response.status).toBe(200);
    expect((await memberLogin.agent.get("/api/auth/me")).status).toBe(401);
    const sessions = await postgres.db.selectFrom("sessions").select(["user_id", "revoked_at"]).where("user_id", "=", memberId).execute();
    expect(sessions).not.toHaveLength(0);
    expect(sessions.every((session) => session.revoked_at !== null)).toBe(true);
    const audits = await postgres.db.selectFrom("audit_logs").selectAll().execute();
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ action: "member.updated", target_id: memberId });
  });

  it("rolls back a failed mutation so it writes no audit and does not revoke sessions", async () => {
    await addUser("admin", "admin");
    const memberId = await addUser("member", "member");
    const memberLogin = await login("member");
    const adminLogin = await login("admin");

    await sql`
      create function reject_audit_insert() returns trigger language plpgsql as $$
      begin
        raise exception 'forced audit failure';
      end
      $$
    `.execute(postgres.db);
    await sql`
      create trigger reject_audit before insert on audit_logs
      for each statement execute function reject_audit_insert()
    `.execute(postgres.db);

    const response = await adminLogin.agent.patch(`/api/admin/members/${memberId}`)
      .set("Origin", APP_ORIGIN).set("X-CSRF-Token", adminLogin.csrfToken)
      .send({ status: "disabled" });
    expect(response.status).toBe(500);
    expect(await postgres.db.selectFrom("audit_logs").selectAll().execute()).toEqual([]);
    expect(await postgres.db.selectFrom("users").select("status").where("id", "=", memberId).executeTakeFirstOrThrow())
      .toEqual({ status: "active" });
    expect((await memberLogin.agent.get("/api/auth/me")).status).toBe(200);
  });

  it.each([
    { change: "session revocation", route: "create" },
    { change: "session expiry", route: "create" },
    { change: "user disable", route: "update" },
    { change: "role downgrade", route: "update" },
    { change: "CSRF rotation", route: "update" },
  ] as const)("rejects an in-flight $route after concurrent $change", async ({ change, route }) => {
    const adminId = await addUser("admin", "admin");
    const targetId = route === "update" ? await addUser("target", "member") : null;
    const adminLogin = await login("admin");
    const actorSession = await postgres.db.selectFrom("sessions")
      .select("id")
      .where("user_id", "=", adminId)
      .executeTakeFirstOrThrow();

    let actorLocked!: () => void;
    const actorLockedPromise = new Promise<void>((resolve) => {
      actorLocked = resolve;
    });
    let applyConcurrentChange!: () => void;
    const concurrentChangePromise = new Promise<void>((resolve) => {
      applyConcurrentChange = resolve;
    });
    const blocker = postgres.db.transaction().execute(async (transaction) => {
      await transaction.selectFrom("sessions").select("id")
        .where("id", "=", actorSession.id).forUpdate().executeTakeFirstOrThrow();
      await transaction.selectFrom("users").select("id")
        .where("id", "=", adminId).forUpdate().executeTakeFirstOrThrow();
      actorLocked();
      await concurrentChangePromise;
      if (change === "session revocation") {
        await transaction.updateTable("sessions").set({ revoked_at: sql`now()` })
          .where("id", "=", actorSession.id).execute();
      } else if (change === "session expiry") {
        await transaction.updateTable("sessions").set({ expires_at: sql`now() - interval '1 second'` })
          .where("id", "=", actorSession.id).execute();
      } else if (change === "user disable") {
        await transaction.updateTable("users").set({ status: "disabled" })
          .where("id", "=", adminId).execute();
      } else if (change === "role downgrade") {
        await transaction.updateTable("users").set({ role: "member" })
          .where("id", "=", adminId).execute();
      } else {
        await transaction.updateTable("sessions").set({
          csrf_token_hash: createHash("sha256").update("rotated-csrf-token").digest("hex"),
        }).where("id", "=", actorSession.id).execute();
      }
    });
    await actorLockedPromise;

    const pendingResponse = route === "create"
      ? adminLogin.agent.post("/api/admin/members")
        .set("Origin", APP_ORIGIN).set("X-CSRF-Token", adminLogin.csrfToken)
        .send({ displayName: "Concurrent Member", unionId: "concurrent-member", role: "member" })
      : adminLogin.agent.patch(`/api/admin/members/${targetId}`)
        .set("Origin", APP_ORIGIN).set("X-CSRF-Token", adminLogin.csrfToken)
        .send({ displayName: "Mutated Target" });
    const responsePromise = Promise.resolve(pendingResponse);
    await waitForBlockedRequests();
    applyConcurrentChange();
    const [response] = await Promise.all([responsePromise, blocker]);

    expect(response.status).toBe(403);
    expect(await postgres.db.selectFrom("audit_logs").selectAll().execute()).toEqual([]);
    if (route === "create") {
      expect(await postgres.db.selectFrom("auth_identities").select("subject")
        .where("subject", "=", "concurrent-member").execute()).toEqual([]);
    } else {
      expect(await postgres.db.selectFrom("users").select("display_name")
        .where("id", "=", targetId!).executeTakeFirstOrThrow()).toEqual({ display_name: "target" });
    }
  });

  it.each([
    { replacement: "actor", mutation: "create" },
    { replacement: "actor", mutation: "update-self" },
    { replacement: "target", mutation: "update-target" },
  ] as const)(
    "avoids a user/session deadlock between $replacement replacement login and $mutation",
    async ({ replacement, mutation }) => {
      const actorId = await addUser("actor-admin", "admin");
      const targetId = mutation === "update-target" ? await addUser("target-admin", "admin") : actorId;
      const actorLogin = await login("actor-admin");
      const targetLogin = mutation === "update-target" ? await login("target-admin") : actorLogin;
      const replacementSubject = replacement === "actor" ? "actor-admin" : "target-admin";
      const replacementLogin = replacement === "actor" ? actorLogin : targetLogin;
      const replacementCode = `${replacementSubject}-replacement-code`;
      feishu.addCode(replacementCode, {
        unionId: replacementSubject,
        displayName: replacementSubject,
        avatarUrl: null,
      });
      const replacementStart = await replacementLogin.agent.get("/api/auth/login");
      const replacementState = new URL(replacementStart.headers.location).searchParams.get("state")!;

      await sql`
        create function block_replacement_session_insert() returns trigger language plpgsql as $$
        begin
          perform pg_advisory_xact_lock(7319421, 17);
          return new;
        end
        $$
      `.execute(postgres.db);
      await sql`
        create trigger block_replacement_session before insert on sessions
        for each row execute function block_replacement_session_insert()
      `.execute(postgres.db);

      let triggerLockHeld!: () => void;
      const triggerLockHeldPromise = new Promise<void>((resolve) => {
        triggerLockHeld = resolve;
      });
      let releaseTrigger!: () => void;
      const releaseTriggerPromise = new Promise<void>((resolve) => {
        releaseTrigger = resolve;
      });
      const triggerBlocker = postgres.db.transaction().execute(async (transaction) => {
        await sql`select pg_advisory_xact_lock(7319421, 17)`.execute(transaction);
        triggerLockHeld();
        await releaseTriggerPromise;
      });
      await triggerLockHeldPromise;

      const replacementResponsePromise = Promise.resolve(
        replacementLogin.agent.get(
          `/api/auth/callback?code=${replacementCode}&state=${replacementState}`,
        ),
      );
      await waitForBlockedRequests(1);

      const mutationResponsePromise = mutation === "create"
        ? Promise.resolve(actorLogin.agent.post("/api/admin/members")
          .set("Origin", APP_ORIGIN).set("X-CSRF-Token", actorLogin.csrfToken)
          .send({ displayName: "Deadlock Member", unionId: "deadlock-member", role: "member" }))
        : Promise.resolve(actorLogin.agent.patch(`/api/admin/members/${targetId}`)
          .set("Origin", APP_ORIGIN).set("X-CSRF-Token", actorLogin.csrfToken)
          .send({ displayName: "Updated During Replacement" }));
      await waitForBlockedRequests(2);
      releaseTrigger();

      const [replacementResponse, mutationResponse] = await Promise.all([
        replacementResponsePromise,
        mutationResponsePromise,
        triggerBlocker,
      ]);

      expect(replacementResponse.status).toBe(303);
      if (replacement === "actor") {
        expect(mutationResponse.status).toBe(403);
        expect(await postgres.db.selectFrom("audit_logs").selectAll().execute()).toEqual([]);
        if (mutation === "create") {
          expect(await postgres.db.selectFrom("auth_identities").select("subject")
            .where("subject", "=", "deadlock-member").execute()).toEqual([]);
        } else {
          expect(await postgres.db.selectFrom("users").select("display_name")
            .where("id", "=", actorId).executeTakeFirstOrThrow())
            .toEqual({ display_name: "actor-admin" });
        }
      } else {
        expect(mutationResponse.status).toBe(200);
        expect(await postgres.db.selectFrom("audit_logs").selectAll().execute()).toHaveLength(1);
        expect(await postgres.db.selectFrom("users").select("display_name")
          .where("id", "=", targetId).executeTakeFirstOrThrow())
          .toEqual({ display_name: "Updated During Replacement" });
        expect((await targetLogin.agent.get("/api/auth/me")).status).toBe(401);
      }
    },
  );

  it("serializes two admins updating each other and revalidates the revoked actor", async () => {
    const firstId = await addUser("first-admin", "admin");
    const secondId = await addUser("second-admin", "admin");
    const firstLogin = await login("first-admin");
    const secondLogin = await login("second-admin");

    let advisoryLockHeld!: () => void;
    const advisoryLockHeldPromise = new Promise<void>((resolve) => {
      advisoryLockHeld = resolve;
    });
    let releaseAdvisory!: () => void;
    const releaseAdvisoryPromise = new Promise<void>((resolve) => {
      releaseAdvisory = resolve;
    });
    const blocker = postgres.db.transaction().execute(async (transaction) => {
      await sql`select pg_advisory_xact_lock(hashtext('novel-analysis'), hashtext('admin-members'))`
        .execute(transaction);
      advisoryLockHeld();
      await releaseAdvisoryPromise;
    });
    await advisoryLockHeldPromise;

    const firstResponsePromise = Promise.resolve(firstLogin.agent.patch(`/api/admin/members/${secondId}`)
      .set("Origin", APP_ORIGIN).set("X-CSRF-Token", firstLogin.csrfToken)
      .send({ displayName: "Updated By First" }));
    const secondResponsePromise = Promise.resolve(secondLogin.agent.patch(`/api/admin/members/${firstId}`)
      .set("Origin", APP_ORIGIN).set("X-CSRF-Token", secondLogin.csrfToken)
      .send({ displayName: "Updated By Second" }));
    await waitForBlockedRequests(2);
    releaseAdvisory();

    const [firstResponse, secondResponse] = await Promise.all([
      firstResponsePromise,
      secondResponsePromise,
      blocker,
    ]);

    expect([firstResponse.status, secondResponse.status].sort()).toEqual([200, 403]);
    expect(await postgres.db.selectFrom("audit_logs").selectAll().execute()).toHaveLength(1);
    const users = await postgres.db.selectFrom("users")
      .select(["id", "display_name"])
      .orderBy("id", "asc")
      .execute();
    expect(users.filter((user) => user.display_name.startsWith("Updated By"))).toHaveLength(1);
  });

  it("bootstraps only the first admin, is idempotent for the same identity, and rejects other nonempty state", async () => {
    const first = await bootstrapFirstAdmin(postgres.db, {
      unionId: "first-admin",
      displayName: "First Admin",
      avatarUrl: null,
    });
    const second = await bootstrapFirstAdmin(postgres.db, {
      unionId: "first-admin",
      displayName: "Changed Name",
      avatarUrl: null,
    });
    expect(second).toEqual(first);
    expect(await postgres.db.selectFrom("users").selectAll().execute()).toHaveLength(1);
    expect(await postgres.db.selectFrom("auth_identities").selectAll().execute()).toHaveLength(1);

    await expect(bootstrapFirstAdmin(postgres.db, {
      unionId: "other-admin",
      displayName: "Other Admin",
      avatarUrl: null,
    })).rejects.toThrow(/nonempty/i);
  });

  it("stores admin session and CSRF values as hashes only", async () => {
    await addUser("admin", "admin");
    const { csrfToken } = await login("admin");
    const session = await postgres.db.selectFrom("sessions").selectAll().executeTakeFirstOrThrow();
    expect(session.csrf_token_hash).toBe(createHash("sha256").update(csrfToken).digest("hex"));
    expect(JSON.stringify(session)).not.toContain(csrfToken);
  });
});
