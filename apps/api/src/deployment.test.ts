import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DatabaseConnection } from "@novel-analysis/database";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FakeFeishuOAuthAdapter } from "./auth/feishu-fake.js";
import type { ApiConfig } from "./config.js";
import { createDeploymentApp } from "./deployment-app.js";

const config: ApiConfig = {
  appOrigin: "http://app.test",
  oauthRedirectUri: "http://app.test/api/auth/callback",
  sessionCookieName: "novel_test_session",
  oauthCorrelationCookieName: "novel_test_oauth_correlation",
  sessionCookieSecure: false,
  sessionTtlMs: 60 * 60 * 1000,
};

describe("deployment HTTP surface", () => {
  let webStaticDir: string;

  beforeEach(async () => {
    webStaticDir = await mkdtemp(join(tmpdir(), "novel-web-"));
    await mkdir(join(webStaticDir, "assets"));
    await mkdir(join(webStaticDir, "api"));
    await writeFile(join(webStaticDir, "index.html"), "<!doctype html><title>Novel Web</title>");
    await writeFile(join(webStaticDir, "assets", "app.js"), "globalThis.__novel = true;");
    await writeFile(join(webStaticDir, "api", "does-not-exist"), "must never shadow API");
  });

  afterEach(async () => {
    await rm(webStaticDir, { force: true, recursive: true });
  });

  function app(readinessProbe: () => Promise<void> = async () => undefined) {
    return createDeploymentApp({
      database: {} as DatabaseConnection,
      config,
      feishu: new FakeFeishuOAuthAdapter(),
      readinessProbe,
      webStaticDir,
    });
  }

  it("serves the built SPA at root and deep routes while keeping API misses JSON-only", async () => {
    const root = await request(app()).get("/").set("Accept", "text/html");
    const deepRoute = await request(app()).get("/books/book-1").set("Accept", "text/html");
    const asset = await request(app()).get("/assets/app.js");
    const apiMiss = await request(app()).get("/api/does-not-exist").set("Accept", "text/html");

    expect(root.status).toBe(200);
    expect(root.text).toContain("<title>Novel Web</title>");
    expect(deepRoute.status).toBe(200);
    expect(deepRoute.text).toContain("<title>Novel Web</title>");
    expect(asset.status).toBe(200);
    expect(asset.headers["content-type"]).toContain("text/javascript");
    expect(apiMiss.status).toBe(404);
    expect(apiMiss.headers["content-type"]).toContain("application/json");
    expect(apiMiss.body).toEqual({ error: "not_found" });
  });

  it("reports liveness independently and fails readiness closed when its probe fails", async () => {
    const live = await request(app(async () => {
      throw new Error("not used by liveness");
    })).get("/api/health/live");
    const ready = await request(app()).get("/api/health/ready");
    const unavailable = await request(app(async () => {
      throw new Error("database unavailable");
    })).get("/api/health/ready");

    expect(live.status).toBe(200);
    expect(live.body).toEqual({ status: "ok" });
    expect(ready.status).toBe(200);
    expect(ready.body).toEqual({ status: "ready" });
    expect(unavailable.status).toBe(503);
    expect(unavailable.body).toEqual({ status: "unavailable" });
  });

  it("sets browser security headers without exposing framework identity", async () => {
    const response = await request(app()).get("/");

    expect(response.headers["content-security-policy"]).toContain("default-src 'self'");
    expect(response.headers["permissions-policy"]).toBe("camera=(), microphone=(), geolocation=()");
    expect(response.headers["referrer-policy"]).toBe("no-referrer");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["x-frame-options"]).toBe("DENY");
    expect(response.headers["x-powered-by"]).toBeUndefined();
  });
});
