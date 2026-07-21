import type { Server } from "node:http";
import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { createServer } from "node:net";

import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { JobEventSchema, type JobEvent } from "@novel-analysis/contracts";
import {
  createDisposablePostgres,
  type DisposablePostgres,
} from "../../../../packages/database/src/testing/postgres.js";

import { createApp } from "../app.js";
import type { ApiConfig } from "../config.js";
import { FakeFeishuOAuthAdapter } from "../auth/feishu-fake.js";
import { writeSseChunk } from "./job-events.js";

const APP_ORIGIN = "http://app.test";
const config: ApiConfig = {
  appOrigin: APP_ORIGIN,
  oauthRedirectUri: `${APP_ORIGIN}/api/auth/callback`,
  sessionCookieName: "novel_test_session",
  oauthCorrelationCookieName: "novel_test_oauth_correlation",
  sessionCookieSecure: false,
  sessionTtlMs: 60 * 60 * 1000,
};

function waitForExit(child: ChildProcessWithoutNullStreams): Promise<{
  code: number | null;
  signal: NodeJS.Signals | null;
}> {
  return new Promise((resolve) => {
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
}

function killProcess(pid: number | undefined, signal: NodeJS.Signals): void {
  if (pid === undefined) return;
  try {
    process.kill(pid, signal);
  } catch (error) {
    if ((error as { code?: string }).code !== "ESRCH") throw error;
  }
}

async function reservePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const address = probe.address();
  if (!address || typeof address === "string") throw new Error("missing probe address");
  await new Promise<void>((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

async function findApiProcess(rootPid: number): Promise<number> {
  const output = await new Promise<string>((resolve, reject) => {
    execFile("ps", ["-axo", "pid=,ppid=,command="], (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
  const processes = new Map<number, { parent: number; command: string }>();
  for (const line of output.split("\n")) {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/);
    if (match) processes.set(Number(match[1]), { parent: Number(match[2]), command: match[3]! });
  }
  const candidates: Array<{ pid: number; depth: number }> = [];
  for (const [pid, info] of processes) {
    if (!info.command.includes("apps/api/src/main.ts") && !info.command.includes("src/main.ts")) continue;
    let current = pid;
    let depth = 0;
    while (current !== rootPid && processes.has(current)) {
      current = processes.get(current)!.parent;
      depth += 1;
    }
    if (current === rootPid) candidates.push({ pid, depth });
  }
  candidates.sort((left, right) => right.depth - left.depth);
  if (!candidates[0]) throw new Error("Could not find the API entry process");
  return candidates[0].pid;
}

async function waitForApiStart(
  child: ChildProcessWithoutNullStreams,
  origin: string,
): Promise<void> {
  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`API exited before startup: ${stderr}`);
    }
    try {
      if ((await fetch(`${origin}/api/jobs`)).status === 401) return;
    } catch {
      // The listener may not be ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for API startup: ${stderr}`);
}

async function expectExit(
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>,
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      exited,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("Timed out waiting for API exit")), 3_000);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

describe("job event stream", () => {
  let postgres: DisposablePostgres;
  let feishu: FakeFeishuOAuthAdapter;
  const servers: Server[] = [];

  beforeEach(async () => {
    postgres = await createDisposablePostgres();
    feishu = new FakeFeishuOAuthAdapter();
  });

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    })));
    await postgres.destroy();
  });

  function app() {
    return createApp({ database: postgres.db, config, feishu });
  }

  async function addUserAndLogin() {
    await postgres.db.insertInto("users").values({
      display_name: "member",
      avatar_url: null,
      role: "member",
      status: "active",
    }).returning("id").executeTakeFirstOrThrow().then(async (user) => {
      await postgres.db.insertInto("auth_identities").values({
        user_id: user.id,
        provider: "feishu",
        subject: "member",
      }).execute();
    });
    feishu.addCode("member-code", {
      unionId: "member",
      displayName: "member",
      avatarUrl: null,
    });
    const agent = request.agent(app());
    const start = await agent.get("/api/auth/login");
    const state = new URL(start.headers.location).searchParams.get("state")!;
    const callback = await agent.get(`/api/auth/callback?code=member-code&state=${state}`);
    const me = await agent.get("/api/auth/me").set("Origin", APP_ORIGIN);
    const sessionCookie = (callback.headers["set-cookie"] as unknown as string[])
      .find((value) => value.startsWith(`${config.sessionCookieName}=`))!
      .split(";", 1)[0]!;
    return { agent, csrfToken: me.body.csrfToken as string, sessionCookie };
  }

  async function createJob(
    agent: ReturnType<typeof request.agent>,
    csrfToken: string,
    requestId: string,
  ) {
    const response = await agent.post("/api/jobs/example").set({
      Origin: APP_ORIGIN,
      "X-CSRF-Token": csrfToken,
      "Idempotency-Key": requestId,
    });
    expect(response.status).toBe(201);
  }

  async function readEvents(options: {
    cookie: string;
    after?: string;
    lastEventId?: string;
    count: number;
    onConnected?: () => Promise<void>;
  }): Promise<JobEvent[]> {
    const server = app().listen(0);
    servers.push(server);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("missing test server address");
    const controller = new AbortController();
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/job-events${options.after ? `?after=${options.after}` : ""}`,
      {
        headers: {
          Cookie: options.cookie,
          ...(options.lastEventId ? { "Last-Event-ID": options.lastEventId } : {}),
        },
        signal: controller.signal,
      },
    );
    expect(response.status).toBe(200);
    await options.onConnected?.();
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    const timeout = setTimeout(() => controller.abort(), 2_500);
    let buffered = "";
    const events: JobEvent[] = [];
    try {
      while (events.length < options.count) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffered += decoder.decode(chunk.value, { stream: true });
        const frames = buffered.split("\n\n");
        buffered = frames.pop() ?? "";
        for (const frame of frames) {
          const data = frame.split("\n").find((line) => line.startsWith("data: "));
          if (data) events.push(JobEventSchema.parse(JSON.parse(data.slice(6))));
        }
      }
    } finally {
      clearTimeout(timeout);
      controller.abort();
      await reader.cancel().catch(() => undefined);
    }
    return events;
  }

  it("rejects a connection without an active session", async () => {
    const response = await request(app()).get("/api/job-events?after=0");
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "unauthorized" });
  });

  it.each(["?after=1&after=2", "?after[]=1", "?after[value]=1"])(
    "rejects a non-scalar cursor %s",
    async (query) => {
      const login = await addUserAndLogin();
      const server = app().listen(0);
      servers.push(server);
      await new Promise<void>((resolve) => server.once("listening", resolve));
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("missing test server address");
      const controller = new AbortController();
      try {
        const response = await fetch(
          `http://127.0.0.1:${address.port}/api/job-events${query}`,
          { headers: { Cookie: login.sessionCookie }, signal: controller.signal },
        );
        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ error: "invalid_request" });
      } finally {
        controller.abort();
      }
    },
  );

  it("replays only database events after the cursor across app recreation", async () => {
    const login = await addUserAndLogin();
    await createJob(login.agent, login.csrfToken, "first");
    await createJob(login.agent, login.csrfToken, "second");

    const allEvents = await readEvents({ cookie: login.sessionCookie, after: "0", count: 2 });
    expect(allEvents).toHaveLength(2);
    expect(allEvents.map((event) => event.type)).toEqual(["created", "created"]);
    expect(JSON.stringify(allEvents)).not.toMatch(
      /leaseOwner|tokenHash|queueId|requestId|configSnapshot/,
    );

    const resumed = await readEvents({
      cookie: login.sessionCookie,
      after: "0",
      lastEventId: String(allEvents[0]!.id),
      count: 1,
    });
    expect(resumed).toEqual([allEvents[1]]);
  });

  it("streams an event inserted after the connection is established", async () => {
    const login = await addUserAndLogin();

    const events = await readEvents({
      cookie: login.sessionCookie,
      after: "0",
      count: 1,
      onConnected: () => createJob(login.agent, login.csrfToken, "live-event"),
    });

    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("created");
  });

  it.each(["revoked session", "disabled user"])(
    "closes the stream without new events after a %s",
    async (invalidation) => {
      const login = await addUserAndLogin();
      const server = app().listen(0);
      servers.push(server);
      await new Promise<void>((resolve) => server.once("listening", resolve));
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("missing test server address");
      const response = await fetch(`http://127.0.0.1:${address.port}/api/job-events?after=0`, {
        headers: { Cookie: login.sessionCookie },
      });
      expect(response.status).toBe(200);
      const reader = response.body!.getReader();
      if (invalidation === "revoked session") {
        await postgres.db.updateTable("sessions").set({ revoked_at: new Date() }).execute();
      } else {
        await postgres.db.updateTable("users").set({ status: "disabled" }).execute();
      }
      await postgres.db.insertInto("jobs").values({
        type: "query",
        status: "queued",
        requested_by: (await postgres.db.selectFrom("users").select("id").executeTakeFirstOrThrow()).id,
        request_id: `after-${invalidation}`,
        scope: { bookId: "phase-1-example" },
        config_snapshot: {},
        concurrency_key: null,
        progress: { total: 1, completed: 0, failed: 0, skipped: 0, current: "" },
      }).returning("id").executeTakeFirstOrThrow().then(async ({ id }) => {
        await postgres.db.insertInto("job_events").values({
          job_id: id,
          type: "created",
          dedupe_key: "created",
          payload: { status: "queued" },
        }).execute();
      });

      try {
        const result = await Promise.race([
          reader.read(),
          new Promise<never>((_, reject) => setTimeout(
            () => reject(new Error("stream did not close after authorization loss")),
            2_500,
          )),
        ]);
        expect(result.done).toBe(true);
        expect(result.value).toBeUndefined();
      } finally {
        await reader.cancel().catch(() => undefined);
      }
    },
  );

  it("waits for drain after backpressure and removes connection listeners", async () => {
    const write = vi.fn<(chunk: string) => boolean>(() => false);
    const response = Object.assign(new EventEmitter(), {
      destroyed: false,
      writableEnded: false,
      write,
    });
    const controller = new AbortController();

    const pending = writeSseChunk(response, "event", controller.signal);
    expect(response.listenerCount("drain")).toBe(1);
    expect(response.listenerCount("error")).toBe(1);
    let settled = false;
    void pending.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);

    response.emit("drain");
    await expect(pending).resolves.toBe(true);
    expect(response.eventNames()).toEqual([]);

    write.mockReturnValueOnce(false);
    const aborted = writeSseChunk(response, "event", controller.signal);
    controller.abort();
    await expect(aborted).resolves.toBe(false);
    expect(response.eventNames()).toEqual([]);
  });

  it("settles and removes listeners when write synchronously aborts before listener setup", async () => {
    const controller = new AbortController();
    const addAbortListener = vi.spyOn(controller.signal, "addEventListener");
    const removeAbortListener = vi.spyOn(controller.signal, "removeEventListener");
    const response = Object.assign(new EventEmitter(), {
      destroyed: false,
      writableEnded: false,
      write: vi.fn(() => {
        controller.abort();
        return false;
      }),
    });

    await expect(writeSseChunk(response, "event", controller.signal)).resolves.toBe(false);
    expect(response.listenerCount("drain")).toBe(0);
    expect(response.listenerCount("error")).toBe(0);
    expect(addAbortListener).toHaveBeenCalledTimes(1);
    expect(removeAbortListener).toHaveBeenCalledTimes(1);
  });

  it("removes internal fields from event payloads", async () => {
    const login = await addUserAndLogin();
    await createJob(login.agent, login.csrfToken, "sensitive-event");
    const jobRow = await postgres.db.selectFrom("jobs").select("id").executeTakeFirstOrThrow();
    const created = await postgres.db.selectFrom("job_events").select("id")
      .where("job_id", "=", jobRow.id).executeTakeFirstOrThrow();
    await postgres.db.insertInto("job_events").values({
      job_id: jobRow.id,
      type: "warning",
      dedupe_key: "sensitive",
      payload: {
        message: "visible",
        leaseOwner: "internal-worker",
        nested: { tokenHash: "internal-token", detail: "visible detail" },
      },
    }).execute();

    const events = await readEvents({
      cookie: login.sessionCookie,
      after: created.id,
      count: 1,
    });

    expect(events[0]!.payload).toEqual({
      message: "visible",
      nested: { detail: "visible detail" },
    });
  });

  it("starts the production entrypoint and exits cleanly on SIGTERM", async () => {
    const port = await reservePort();
    const origin = `http://127.0.0.1:${port}`;
    const child = spawn("npm", ["start", "-w", "apps/api"], {
      cwd: process.cwd(),
      detached: true,
      env: {
        ...process.env,
        APP_ORIGIN: "https://app.test",
        DATABASE_URL: postgres.databaseUrl,
        FEISHU_APP_ID: "test-app-id",
        FEISHU_APP_SECRET: "test-app-secret",
        FEISHU_REDIRECT_URI: "https://app.test/api/auth/callback",
        CONTENT_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
        CONTENT_ENCRYPTION_KEY_VERSION: "test-v1",
        CONTENT_HMAC_KEY: Buffer.alloc(32, 8).toString("base64"),
        PORT: String(port),
      },
    });
    const exited = waitForExit(child);
    let apiPid: number | undefined;
    try {
      await waitForApiStart(child, origin);
      apiPid = await findApiProcess(child.pid!);
      process.kill(apiPid, "SIGTERM");
      await expect(expectExit(exited)).resolves.toEqual({ code: 0, signal: null });
    } finally {
      killProcess(apiPid, "SIGKILL");
      killProcess(child.pid === undefined ? undefined : -child.pid, "SIGKILL");
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      await expectExit(exited).catch(() => undefined);
    }
  });

  it("exits cleanly on SIGTERM with an active production SSE connection", async () => {
    const sessionToken = "production-sse-session";
    const user = await postgres.db.insertInto("users").values({
      display_name: "SSE member",
      avatar_url: null,
      role: "member",
      status: "active",
    }).returning("id").executeTakeFirstOrThrow();
    await postgres.db.insertInto("sessions").values({
      user_id: user.id,
      token_hash: createHash("sha256").update(sessionToken).digest("hex"),
      csrf_token_hash: null,
      expires_at: new Date(Date.now() + 60_000),
      revoked_at: null,
    }).execute();
    const port = await reservePort();
    const origin = `http://127.0.0.1:${port}`;
    const child = spawn("npm", ["start", "-w", "apps/api"], {
      cwd: process.cwd(),
      detached: true,
      env: {
        ...process.env,
        APP_ORIGIN: "https://app.test",
        DATABASE_URL: postgres.databaseUrl,
        FEISHU_APP_ID: "test-app-id",
        FEISHU_APP_SECRET: "test-app-secret",
        FEISHU_REDIRECT_URI: "https://app.test/api/auth/callback",
        CONTENT_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
        CONTENT_ENCRYPTION_KEY_VERSION: "test-v1",
        CONTENT_HMAC_KEY: Buffer.alloc(32, 8).toString("base64"),
        PORT: String(port),
      },
    });
    const exited = waitForExit(child);
    const controller = new AbortController();
    let apiPid: number | undefined;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      await waitForApiStart(child, origin);
      apiPid = await findApiProcess(child.pid!);
      const response = await fetch(`${origin}/api/job-events?after=0`, {
        headers: { Cookie: `__Host-novel_session=${sessionToken}` },
        signal: controller.signal,
      });
      expect(response.status).toBe(200);
      reader = response.body!.getReader();

      process.kill(apiPid, "SIGTERM");
      await expect(expectExit(exited)).resolves.toEqual({ code: 0, signal: null });
    } finally {
      controller.abort();
      await reader?.cancel().catch(() => undefined);
      killProcess(apiPid, "SIGKILL");
      killProcess(child.pid === undefined ? undefined : -child.pid, "SIGKILL");
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      await expectExit(exited).catch(() => undefined);
    }
  });

  it("rejects production startup without an independent content HMAC key", async () => {
    const child = spawn("npm", ["start", "-w", "apps/api"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        APP_ORIGIN: "https://app.test",
        DATABASE_URL: postgres.databaseUrl,
        FEISHU_APP_ID: "test-app-id",
        FEISHU_APP_SECRET: "test-app-secret",
        FEISHU_REDIRECT_URI: "https://app.test/api/auth/callback",
        CONTENT_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
        CONTENT_ENCRYPTION_KEY_VERSION: "test-v1",
        CONTENT_HMAC_KEY: "",
        PORT: "3001",
      },
    });
    let stderr = ""; child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    await expect(expectExit(waitForExit(child))).resolves.toMatchObject({ code: 1 });
    expect(stderr).toContain("CONTENT_HMAC_KEY");
  });

  it.each([
    ["1-byte", Buffer.alloc(1, 9)],
    ["31-byte", Buffer.alloc(31, 9)],
    ["33-byte", Buffer.alloc(33, 9)],
    ["encryption-key-equal", Buffer.alloc(32, 7)],
  ])("rejects a %s production HMAC key without leaking it", async (_name, hmacKey) => {
    const port = await reservePort();
    const child = spawn("npm", ["start", "-w", "apps/api"], {
      cwd: process.cwd(), detached: true,
      env: {
        ...process.env,
        APP_ORIGIN: "https://app.test",
        DATABASE_URL: postgres.databaseUrl,
        FEISHU_APP_ID: "test-app-id",
        FEISHU_APP_SECRET: "test-app-secret",
        FEISHU_REDIRECT_URI: "https://app.test/api/auth/callback",
        CONTENT_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
        CONTENT_ENCRYPTION_KEY_VERSION: "test-v1",
        CONTENT_HMAC_KEY: hmacKey.toString("base64"),
        PORT: String(port),
      },
    });
    const exited = waitForExit(child); let startupError: unknown; let apiPid: number | undefined;
    try {
      await waitForApiStart(child, `http://127.0.0.1:${port}`);
      apiPid = await findApiProcess(child.pid!);
    } catch (error) { startupError = error; }
    finally {
      killProcess(apiPid, "SIGKILL");
      killProcess(child.pid === undefined ? undefined : -child.pid, "SIGKILL");
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      await expectExit(exited).catch(() => undefined);
    }
    expect(startupError).toBeInstanceOf(Error);
    expect((startupError as Error).message).toContain("CONTENT_HMAC_KEY");
    expect((startupError as Error).message).not.toContain(hmacKey.toString("base64"));
  });
});
