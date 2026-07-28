import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import {
  access,
  mkdtemp,
  readFile,
  readdir,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { DatabaseConnection } from "@novel-analysis/database";
import request from "supertest";
import { build } from "vite";

import { FakeFeishuOAuthAdapter } from "../apps/api/src/auth/feishu-fake.js";
import type { ApiConfig } from "../apps/api/src/config.js";
import { createDeploymentApp } from "../apps/api/src/deployment-app.js";
import {
  clearWorkerReadiness,
  isWorkerReady,
  markWorkerReady,
  prepareWorkerReadiness,
} from "../apps/worker/src/readiness.js";

export interface SyntheticDeploymentSmokeReport {
  committedArtifacts: true;
  webBuild: true;
  apiSurface: true;
  apiReadiness: true;
  workerReadiness: true;
  temporaryArtifactsCleaned: true;
  realInputsAccessed: false;
  externalRuntimeAccessed: false;
}

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const syntheticConfig: ApiConfig = {
  appOrigin: "http://synthetic.invalid",
  oauthRedirectUri: "http://synthetic.invalid/api/auth/callback",
  sessionCookieName: "novel_synthetic_session",
  oauthCorrelationCookieName: "novel_synthetic_oauth_correlation",
  sessionCookieSecure: false,
  sessionTtlMs: 60 * 60 * 1000,
};

async function verifyCommittedArtifacts(): Promise<void> {
  const [dockerfile, composeText, caddyfile] = await Promise.all([
    readFile(join(repositoryRoot, "deploy/phase5/Dockerfile"), "utf8"),
    readFile(join(repositoryRoot, "deploy/phase5/compose.yml"), "utf8"),
    readFile(join(repositoryRoot, "deploy/phase5/Caddyfile"), "utf8"),
  ]);
  const compose = JSON.parse(composeText);

  assert.match(dockerfile, /FROM runtime AS api/);
  assert.match(dockerfile, /FROM runtime AS worker/);
  assert.equal(
    compose.services.api.environment.WEB_STATIC_DIR,
    "/app/apps/web/dist",
  );
  assert.match(
    compose.services.api.healthcheck.test.join(" "),
    /\/api\/health\/ready/,
  );
  assert.match(
    compose.services.worker.healthcheck.test.join(" "),
    /healthcheck/,
  );
  assert.match(caddyfile, /Strict-Transport-Security/);
  assert.match(caddyfile, /X-Content-Type-Options/);
}

async function buildSyntheticWeb(outputDirectory: string): Promise<string> {
  assert.equal(
    Object.keys(process.env).some((name) => name.startsWith("VITE_")),
    false,
    "ambient VITE variables are not allowed",
  );

  await build({
    root: join(repositoryRoot, "apps/web"),
    configFile: join(repositoryRoot, "apps/web/vite.config.ts"),
    envDir: false,
    logLevel: "silent",
    mode: "synthetic-smoke",
    build: {
      emptyOutDir: true,
      outDir: outputDirectory,
    },
  });

  await access(join(outputDirectory, "index.html"));
  const assets = await readdir(join(outputDirectory, "assets"));
  const asset = assets.find((name) => name.endsWith(".js"));
  assert.ok(asset, "built JavaScript asset is required");
  return asset;
}

async function verifyApiRuntime(
  webDirectory: string,
  asset: string,
): Promise<void> {
  let ready = true;
  const app = createDeploymentApp({
    database: {} as DatabaseConnection,
    config: syntheticConfig,
    feishu: new FakeFeishuOAuthAdapter(),
    readinessProbe: async () => {
      if (!ready) throw new Error("synthetic readiness failure");
    },
    webStaticDir: webDirectory,
  });

  const root = await request(app).get("/").set("Accept", "text/html");
  const deepRoute = await request(app)
    .get("/books/synthetic-book")
    .set("Accept", "text/html");
  const builtAsset = await request(app).get(`/assets/${asset}`);
  const apiMiss = await request(app)
    .get("/api/synthetic-miss")
    .set("Accept", "text/html");
  const live = await request(app).get("/api/health/live");
  const readyResponse = await request(app).get("/api/health/ready");
  ready = false;
  const unavailable = await request(app).get("/api/health/ready");

  assert.equal(root.status, 200);
  assert.match(root.text, /<div id="root"><\/div>/);
  assert.equal(deepRoute.status, 200);
  assert.match(deepRoute.text, /<div id="root"><\/div>/);
  assert.equal(builtAsset.status, 200);
  assert.equal(apiMiss.status, 404);
  assert.match(apiMiss.headers["content-type"], /application\/json/);
  assert.equal(live.status, 200);
  assert.equal(readyResponse.status, 200);
  assert.equal(unavailable.status, 503);
  assert.match(root.headers["content-security-policy"], /default-src 'self'/);
  assert.equal(root.headers["x-content-type-options"], "nosniff");
  assert.equal(root.headers["x-powered-by"], undefined);
}

async function verifyWorkerRuntime(markerPath: string): Promise<void> {
  await prepareWorkerReadiness(markerPath);
  await markWorkerReady(markerPath);
  assert.equal(await isWorkerReady(markerPath), true);
  await clearWorkerReadiness(markerPath);
  assert.equal(await isWorkerReady(markerPath), false);
}

export async function runSyntheticDeploymentSmoke(): Promise<SyntheticDeploymentSmokeReport> {
  await verifyCommittedArtifacts();

  const temporaryRoot = await mkdtemp(
    join(tmpdir(), "novel-phase5-deployment-smoke-"),
  );
  try {
    const webDirectory = join(temporaryRoot, "web");
    const asset = await buildSyntheticWeb(webDirectory);
    await verifyApiRuntime(webDirectory, asset);
    await verifyWorkerRuntime(join(temporaryRoot, "worker.ready"));
  } finally {
    await rm(temporaryRoot, { force: true, recursive: true });
  }
  assert.equal(existsSync(temporaryRoot), false);

  return {
    committedArtifacts: true,
    webBuild: true,
    apiSurface: true,
    apiReadiness: true,
    workerReadiness: true,
    temporaryArtifactsCleaned: true,
    realInputsAccessed: false,
    externalRuntimeAccessed: false,
  };
}
