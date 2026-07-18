import { createHash } from "node:crypto";

import { sql } from "kysely";
import request, { type Response } from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createDisposablePostgres,
  type DisposablePostgres,
} from "../../../../packages/database/src/testing/postgres.js";

import { createApp } from "../app.js";
import { type ApiConfig } from "../config.js";
import { AuthService } from "./auth-service.js";
import { FakeFeishuOAuthAdapter } from "./feishu-fake.js";
import { FeishuHttpOAuthAdapter } from "./feishu-http-adapter.js";
import { OAuthStateRepository } from "./oauth-state-repository.js";

const APP_ORIGIN = "http://app.test";
const CALLBACK_URL = `${APP_ORIGIN}/api/auth/callback`;
const TEST_COOKIE = "novel_test_session";

const config: ApiConfig = {
  appOrigin: APP_ORIGIN,
  oauthRedirectUri: CALLBACK_URL,
  sessionCookieName: TEST_COOKIE,
  sessionCookieSecure: false,
  sessionTtlMs: 60 * 60 * 1000,
};

function cookieValue(response: Response): string {
  const header = response.headers["set-cookie"] as unknown as string[] | undefined;
  const cookie = header?.find((value) => value.startsWith(`${TEST_COOKIE}=`));
  if (!cookie) throw new Error("session cookie missing");
  return cookie.split(";", 1)[0]!;
}

function locationState(response: Response): string {
  return new URL(response.headers.location).searchParams.get("state")!;
}

describe("collaboration authentication", () => {
  let postgres: DisposablePostgres;
  let feishu: FakeFeishuOAuthAdapter;
  let logs: unknown[];

  beforeEach(async () => {
    postgres = await createDisposablePostgres();
    feishu = new FakeFeishuOAuthAdapter();
    logs = [];
  });

  afterEach(async () => {
    await postgres.destroy();
  });

  async function addUser(input: {
    subject: string;
    role?: "admin" | "member";
    status?: "active" | "disabled";
  }) {
    const user = await postgres.db
      .insertInto("users")
      .values({
        display_name: input.subject,
        avatar_url: null,
        role: input.role ?? "member",
        status: input.status ?? "active",
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    await postgres.db.insertInto("auth_identities").values({
      user_id: user.id,
      provider: "feishu",
      subject: input.subject,
    }).execute();
    return user.id;
  }

  function app() {
    return createApp({
      database: postgres.db,
      config,
      feishu,
      logger: { error: (...values: unknown[]) => logs.push(values) },
    });
  }

  async function login(subject: string, priorCookie?: string) {
    feishu.addCode(`code-${subject}`, {
      unionId: subject,
      displayName: subject,
      avatarUrl: null,
    });
    const start = await request(app()).get("/api/auth/login?returnTo=%2Fjobs%3Fmine%3D1");
    const callback = request(app())
      .get(`/api/auth/callback?code=code-${subject}&state=${encodeURIComponent(locationState(start))}`);
    if (priorCookie) callback.set("Cookie", priorCookie);
    return callback;
  }

  it("stores only a state hash, expires it after five minutes, and atomically rejects replay", async () => {
    const repository = new OAuthStateRepository(postgres.db);
    const created = await repository.create("/jobs");

    expect(Buffer.from(created.state, "base64url")).toHaveLength(32);
    const row = await postgres.db.selectFrom("oauth_states").selectAll().executeTakeFirstOrThrow();
    expect(row.state_hash).toBe(createHash("sha256").update(created.state).digest("hex"));
    expect(JSON.stringify(row)).not.toContain(created.state);
    expect(row.expires_at.getTime() - row.created_at.getTime()).toBe(5 * 60 * 1000);
    expect(await repository.consume(created.state)).toBe("/jobs");
    expect(await repository.consume(created.state)).toBeNull();

    const expired = await repository.create("/expired");
    await postgres.db.updateTable("oauth_states")
      .set({ expires_at: sql<Date>`now() - interval '1 second'` })
      .where("state_hash", "=", createHash("sha256").update(expired.state).digest("hex"))
      .execute();
    expect(await repository.consume(expired.state)).toBeNull();
  });

  it.each([
    "https://evil.test/",
    "//evil.test/path",
    "/\\evil",
    "/%5cevil",
    "/%2f%2fevil.test",
    "/%252f%252fevil.test",
  ])("rejects unsafe returnTo %s and uses the fixed safe path", async (returnTo) => {
    const response = await request(app()).get(`/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`);
    const row = await postgres.db.selectFrom("oauth_states").select("return_to").executeTakeFirstOrThrow();
    expect(response.status).toBe(302);
    expect(row.return_to).toBe("/");
  });

  it("rejects replayed state, unmapped identities, and disabled users with generic errors", async () => {
    feishu.addCode("unmapped-code", { unionId: "unmapped", displayName: "Raw Provider Body", avatarUrl: null });
    const start = await request(app()).get("/api/auth/login");
    const state = locationState(start);
    const first = await request(app()).get(`/api/auth/callback?code=unmapped-code&state=${state}`);
    const replay = await request(app()).get(`/api/auth/callback?code=unmapped-code&state=${state}`);
    expect(first.status).toBe(401);
    expect(replay.status).toBe(401);

    await addUser({ subject: "disabled", status: "disabled" });
    feishu.addCode("disabled-code", { unionId: "disabled", displayName: "Disabled", avatarUrl: null });
    const disabledStart = await request(app()).get("/api/auth/login");
    const disabled = await request(app()).get(`/api/auth/callback?code=disabled-code&state=${locationState(disabledStart)}`);
    expect(disabled.status).toBe(401);
    for (const response of [first, replay, disabled]) {
      expect(response.body).toEqual({ error: "authentication_failed" });
    }
  });

  it("sets a hash-only session cookie and redirects with 303 to the fixed internal returnTo", async () => {
    await addUser({ subject: "member" });
    const response = await login("member");

    expect(response.status).toBe(303);
    expect(response.headers.location).toBe("/jobs?mine=1");
    const setCookie = (response.headers["set-cookie"] as unknown as string[])[0]!;
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain("Path=/");
    expect(setCookie).not.toContain("Secure");
    const rawToken = cookieValue(response).split("=")[1]!;
    expect(Buffer.from(rawToken, "base64url")).toHaveLength(32);
    const session = await postgres.db.selectFrom("sessions").selectAll().executeTakeFirstOrThrow();
    expect(session.token_hash).toBe(createHash("sha256").update(rawToken).digest("hex"));
    expect(JSON.stringify(session)).not.toContain(rawToken);
    expect(response.headers.location).not.toContain(rawToken);
  });

  it("keeps production cookie attributes fixed while using a separate HTTP test cookie", async () => {
    const production: ApiConfig = {
      ...config,
      appOrigin: "https://novel.test",
      oauthRedirectUri: "https://novel.test/api/auth/callback",
      sessionCookieName: "__Host-novel_session",
      sessionCookieSecure: true,
    };
    await addUser({ subject: "production-member" });
    feishu.addCode("production-code", {
      unionId: "production-member",
      displayName: "Production Member",
      avatarUrl: null,
    });
    const productionApp = createApp({ database: postgres.db, config: production, feishu });
    const start = await request(productionApp).get("/api/auth/login");
    const callback = await request(productionApp)
      .get(`/api/auth/callback?code=production-code&state=${locationState(start)}`);
    const setCookie = (callback.headers["set-cookie"] as unknown as string[])[0]!;
    expect(setCookie).toContain("__Host-novel_session=");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain("Path=/");
    expect(() => createApp({
      database: postgres.db,
      config: { ...production, sessionCookieSecure: false },
      feishu,
    })).toThrow(/production session cookie/i);
    expect(() => createApp({
      database: postgres.db,
      config: { ...production, sessionCookieName: "weakened_session" },
      feishu,
    })).toThrow(/production session cookie/i);
  });

  it("rotates CSRF on every same-origin /me call and rejects cross-site reads", async () => {
    await addUser({ subject: "member" });
    const cookie = cookieValue(await login("member"));
    const first = await request(app()).get("/api/auth/me").set("Cookie", cookie).set("Origin", APP_ORIGIN);
    const second = await request(app()).get("/api/auth/me").set("Cookie", cookie).set("Origin", APP_ORIGIN);
    expect(first.status).toBe(200);
    expect(first.headers["cache-control"]).toBe("no-store");
    expect(first.headers["access-control-allow-origin"]).toBeUndefined();
    expect(second.body.csrfToken).not.toBe(first.body.csrfToken);

    const crossSite = await request(app()).get("/api/auth/me").set("Cookie", cookie).set("Sec-Fetch-Site", "cross-site");
    const badOrigin = await request(app()).get("/api/auth/me").set("Cookie", cookie).set("Origin", "https://evil.test");
    expect(crossSite.status).toBe(403);
    expect(badOrigin.status).toBe(403);
  });

  it("requires exact Origin and the current timing-safe CSRF token for logout", async () => {
    await addUser({ subject: "member" });
    const cookie = cookieValue(await login("member"));
    const firstMe = await request(app()).get("/api/auth/me").set("Cookie", cookie).set("Origin", APP_ORIGIN);
    const secondMe = await request(app()).get("/api/auth/me").set("Cookie", cookie).set("Origin", APP_ORIGIN);

    const oldToken = await request(app()).post("/api/auth/logout").set("Cookie", cookie)
      .set("Origin", APP_ORIGIN).set("X-CSRF-Token", firstMe.body.csrfToken);
    const badOrigin = await request(app()).post("/api/auth/logout").set("Cookie", cookie)
      .set("Origin", "http://app.test.evil.test").set("X-CSRF-Token", secondMe.body.csrfToken);
    expect(oldToken.status).toBe(403);
    expect(badOrigin.status).toBe(403);

    const logout = await request(app()).post("/api/auth/logout").set("Cookie", cookie)
      .set("Origin", APP_ORIGIN).set("X-CSRF-Token", secondMe.body.csrfToken);
    expect(logout.status).toBe(204);
    expect((logout.headers["set-cookie"] as unknown as string[])[0]).toContain(`${TEST_COOKIE}=;`);
    expect((await request(app()).get("/api/auth/me").set("Cookie", cookie)).status).toBe(401);
  });

  it("rejects expired sessions", async () => {
    await addUser({ subject: "member" });
    const cookie = cookieValue(await login("member"));
    await postgres.db.updateTable("sessions")
      .set({ expires_at: sql<Date>`now() - interval '1 second'` })
      .execute();
    expect((await request(app()).get("/api/auth/me").set("Cookie", cookie)).status).toBe(401);
  });

  it("revokes a prior session only after a replacement login succeeds", async () => {
    await addUser({ subject: "member" });
    const firstCookie = cookieValue(await login("member"));

    feishu.addCode("bad-code", { unionId: "unknown", displayName: "Unknown", avatarUrl: null });
    const badStart = await request(app()).get("/api/auth/login");
    await request(app()).get(`/api/auth/callback?code=bad-code&state=${locationState(badStart)}`).set("Cookie", firstCookie);
    expect((await request(app()).get("/api/auth/me").set("Cookie", firstCookie)).status).toBe(200);

    const replacement = await login("member", firstCookie);
    const secondCookie = cookieValue(replacement);
    expect((await request(app()).get("/api/auth/me").set("Cookie", firstCookie)).status).toBe(401);
    expect((await request(app()).get("/api/auth/me").set("Cookie", secondCookie)).status).toBe(200);
  });

  it("redacts OAuth code, provider data, session, CSRF, and client secret from errors and logs", async () => {
    await addUser({ subject: "member" });
    feishu.failCode("sensitive-code", new Error("provider-body-sensitive client-secret-sensitive"));
    const start = await request(app()).get("/api/auth/login");
    const response = await request(app()).get(`/api/auth/callback?code=sensitive-code&state=${locationState(start)}`);
    const serialized = JSON.stringify({ body: response.body, logs });
    expect(response.status).toBe(401);
    for (const secret of ["sensitive-code", "provider-body-sensitive", "client-secret-sensitive"]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it("returns a redacted 500 when the login transaction has a database failure", async () => {
    await addUser({ subject: "member" });
    const start = await request(app()).get("/api/auth/login");
    await sql`
      create function reject_session_insert() returns trigger language plpgsql as $$
      begin
        raise exception 'database-secret-sensitive';
      end
      $$
    `.execute(postgres.db);
    await sql`
      create trigger reject_session before insert on sessions
      for each statement execute function reject_session_insert()
    `.execute(postgres.db);
    feishu.addCode("database-failure-code", {
      unionId: "member",
      displayName: "Member",
      avatarUrl: null,
    });

    const response = await request(app()).get(
      `/api/auth/callback?code=database-failure-code&state=${locationState(start)}`,
    );

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: "internal_error" });
    const serialized = JSON.stringify({ body: response.body, logs });
    expect(serialized).not.toContain("database-secret-sensitive");
    expect(serialized).not.toContain("database-failure-code");
  });

  it("returns a redacted 500 when /me cannot query the database", async () => {
    await addUser({ subject: "member" });
    const cookie = cookieValue(await login("member"));
    const failingDatabase = postgres.db.withPlugin({
      transformQuery() {
        throw new Error("database-secret-sensitive");
      },
      async transformResult(args) {
        return args.result;
      },
    });

    const response = await request(createApp({
      database: failingDatabase,
      config,
      feishu,
      logger: { error: (message) => logs.push(message) },
    })).get("/api/auth/me").set("Cookie", cookie);

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: "internal_error" });
    expect(JSON.stringify({ body: response.body, logs })).not.toContain("database-secret-sensitive");
  });

  it("exchanges the OAuth code for an access token and then fetches Feishu user info", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const adapter = new FeishuHttpOAuthAdapter({
      appId: "app-id",
      appSecret: "client-secret-sensitive",
      fetch: async (input, init) => {
        requests.push({ url: input.toString(), init });
        if (requests.length === 1) {
          return new globalThis.Response(JSON.stringify({
            code: 0,
            msg: "success",
            data: {
              access_token: "access-token-sensitive",
              refresh_token: "refresh-token-sensitive",
            },
          }), { status: 200, headers: { "content-type": "application/json" } });
        }
        return new globalThis.Response(JSON.stringify({
          code: 0,
          msg: "success",
          data: {
            union_id: "union-123",
            name: "Feishu Member",
            avatar_url: "https://avatar.test/member.png",
          },
        }), { status: 200, headers: { "content-type": "application/json" } });
      },
    });

    const identity = await adapter.exchangeCode({
      code: "sensitive-code",
      redirectUri: CALLBACK_URL,
    });

    expect(identity).toEqual({
      unionId: "union-123",
      displayName: "Feishu Member",
      avatarUrl: "https://avatar.test/member.png",
    });
    expect(requests).toHaveLength(2);
    expect(requests[0]).toMatchObject({
      url: "https://open.feishu.cn/open-apis/authen/v2/oauth/token",
      init: { method: "POST" },
    });
    expect(JSON.parse(String(requests[0]!.init?.body))).toMatchObject({
      grant_type: "authorization_code",
      client_id: "app-id",
      client_secret: "client-secret-sensitive",
      code: "sensitive-code",
      redirect_uri: CALLBACK_URL,
    });
    expect(requests[1]).toMatchObject({
      url: "https://open.feishu.cn/open-apis/authen/v1/user_info",
      init: { method: "GET" },
    });
    expect(new Headers(requests[1]!.init?.headers).get("Authorization"))
      .toBe("Bearer access-token-sensitive");
    expect(JSON.stringify(identity)).not.toContain("access-token-sensitive");
    expect(JSON.stringify(identity)).not.toContain("refresh-token-sensitive");
  });

  it.each([
    {
      name: "token provider error",
      fetch: async () => new globalThis.Response("provider-body-sensitive", { status: 400 }),
    },
    {
      name: "token provider error envelope",
      fetch: async () => new globalThis.Response(JSON.stringify({
        code: 10003,
        msg: "provider-body-sensitive",
      }), { status: 200, headers: { "content-type": "application/json" } }),
    },
    {
      name: "token non-JSON response",
      fetch: async () => new globalThis.Response("provider-body-sensitive", { status: 200 }),
    },
    {
      name: "token schema mismatch",
      fetch: async () => new globalThis.Response(JSON.stringify({ code: 0, data: {} }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    },
    {
      name: "user-info provider error",
      fetch: async (_input: string | URL | Request, init?: RequestInit) => init?.method === "POST"
        ? new globalThis.Response(JSON.stringify({
          code: 0,
          data: { access_token: "access-token-sensitive" },
        }), { status: 200, headers: { "content-type": "application/json" } })
        : new globalThis.Response("provider-body-sensitive", { status: 500 }),
    },
    {
      name: "user-info provider error envelope",
      fetch: async (_input: string | URL | Request, init?: RequestInit) => init?.method === "POST"
        ? new globalThis.Response(JSON.stringify({
          code: 0,
          data: { access_token: "access-token-sensitive" },
        }), { status: 200, headers: { "content-type": "application/json" } })
        : new globalThis.Response(JSON.stringify({
          code: 10003,
          msg: "provider-body-sensitive",
        }), { status: 200, headers: { "content-type": "application/json" } }),
    },
    {
      name: "user-info non-JSON response",
      fetch: async (_input: string | URL | Request, init?: RequestInit) => init?.method === "POST"
        ? new globalThis.Response(JSON.stringify({
          code: 0,
          data: { access_token: "access-token-sensitive" },
        }), { status: 200, headers: { "content-type": "application/json" } })
        : new globalThis.Response("provider-body-sensitive", { status: 200 }),
    },
    {
      name: "user-info schema mismatch",
      fetch: async (_input: string | URL | Request, init?: RequestInit) => init?.method === "POST"
        ? new globalThis.Response(JSON.stringify({
          code: 0,
          data: { access_token: "access-token-sensitive" },
        }), { status: 200, headers: { "content-type": "application/json" } })
        : new globalThis.Response(JSON.stringify({ code: 0, data: {} }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    },
    {
      name: "network error",
      fetch: async () => {
        throw new Error("sensitive-code access-token-sensitive client-secret-sensitive provider-body-sensitive");
      },
    },
    {
      name: "timeout error",
      fetch: async () => {
        throw new DOMException("provider-body-sensitive", "TimeoutError");
      },
    },
  ])("maps $name to a redacted authentication failure", async ({ fetch }) => {
    const adapter = new FeishuHttpOAuthAdapter({
      appId: "app-id",
      appSecret: "client-secret-sensitive",
      fetch,
    });
    let serialized = "";
    try {
      await adapter.exchangeCode({ code: "sensitive-code", redirectUri: CALLBACK_URL });
    } catch (error) {
      serialized = JSON.stringify(error, Object.getOwnPropertyNames(error));
    }
    expect(serialized).toContain("authentication_failed");
    for (const secret of [
      "sensitive-code",
      "access-token-sensitive",
      "refresh-token-sensitive",
      "provider-body-sensitive",
      "client-secret-sensitive",
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it("AuthService never returns provider data when state is invalid", async () => {
    const service = new AuthService({ database: postgres.db, config, feishu });
    await expect(service.finishLogin("secret-code", "invalid-state")).rejects.toMatchObject({
      code: "authentication_failed",
    });
    expect(feishu.exchangedCodes).toEqual([]);
  });
});
