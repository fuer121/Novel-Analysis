import { describe, expect, it } from "vitest";

import { runPreflight } from "../../scripts/phase5-preflight.mjs";

const key = (byte: number) => Buffer.alloc(32, byte).toString("base64");

type ComposeFixture = {
  services: { postgres: Record<string, unknown>; worker: Record<string, unknown> };
  networks: { internal: { internal: boolean } };
};

const validConfig = {
  APP_ORIGIN: "https://novel.example.invalid",
  FEISHU_REDIRECT_URI: "https://novel.example.invalid/api/auth/callback",
  CONTENT_ENCRYPTION_KEY: key(1),
  CONTENT_HMAC_KEY: key(2),
  OPERATION_GATE: "approved",
};

const validCompose = JSON.stringify({
  services: {
    caddy: {
      ports: ["443:443"],
      healthcheck: { test: ["CMD", "caddy", "version"] },
    },
    api: {
      healthcheck: { test: ["CMD", "node", "--version"] },
    },
    worker: {
      healthcheck: { test: ["CMD", "node", "--version"] },
    },
    postgres: {
      networks: ["internal"],
      healthcheck: { test: ["CMD", "pg_isready"] },
    },
  },
  networks: {
    internal: { internal: true },
  },
});

describe("Phase 5 read-only preflight", () => {
  it("requires an HTTPS application origin", () => {
    for (const APP_ORIGIN of [
      "http://novel.example.invalid",
      "https://user:password@novel.example.invalid",
      "https://novel.example.invalid/path",
      "https://novel.example.invalid/?query=value",
      "https://novel.example.invalid/#fragment",
    ]) {
      expect(runPreflight({ ...validConfig, APP_ORIGIN }, validCompose))
        .toEqual({ ok: false, code: "origin_not_https" });
    }
  });

  it("requires the exact Feishu callback path under the application origin", () => {
    for (const FEISHU_REDIRECT_URI of [
      "https://novel.example.invalid/auth/callback",
      "https://other.example.invalid/api/auth/callback",
    ]) {
      expect(runPreflight({ ...validConfig, FEISHU_REDIRECT_URI }, validCompose))
        .toEqual({ ok: false, code: "callback_mismatch" });
    }
  });

  it("rejects an externally published PostgreSQL port", () => {
    for (const mutate of [
      (compose: ComposeFixture) => { compose.services.postgres.ports = ["5432:5432"]; },
      (compose: ComposeFixture) => { compose.services.postgres.network_mode = "host"; },
      (compose: ComposeFixture) => { compose.services.postgres.networks = ["edge"]; },
      (compose: ComposeFixture) => { compose.networks.internal.internal = false; },
    ]) {
      const compose = JSON.parse(validCompose) as ComposeFixture;
      mutate(compose);
      expect(runPreflight(validConfig, JSON.stringify(compose)))
        .toEqual({ ok: false, code: "database_exposed" });
    }
  });

  it("requires health checks on every service", () => {
    for (const healthcheck of [
      undefined,
      null,
      {},
      { disable: true, test: ["CMD", "node", "--version"] },
      { test: [] },
      { test: [""] },
      { test: ["NONE"] },
    ]) {
      const compose = JSON.parse(validCompose) as ComposeFixture;
      compose.services.worker.healthcheck = healthcheck;
      expect(runPreflight(validConfig, JSON.stringify(compose)))
        .toEqual({ ok: false, code: "healthcheck_missing" });
    }
  });

  it("requires canonical base64 32-byte encryption and HMAC keys", () => {
    expect(runPreflight({ ...validConfig, CONTENT_HMAC_KEY: key(3).slice(0, -4) }, validCompose))
      .toEqual({ ok: false, code: "key_invalid" });
  });

  it("requires distinct encryption and HMAC keys", () => {
    expect(runPreflight({ ...validConfig, CONTENT_HMAC_KEY: validConfig.CONTENT_ENCRYPTION_KEY }, validCompose))
      .toEqual({ ok: false, code: "keys_not_distinct" });
  });

  it("requires an explicit approved operation Gate", () => {
    expect(runPreflight({ ...validConfig, OPERATION_GATE: "" }, validCompose))
      .toEqual({ ok: false, code: "gate_not_approved" });
  });
});
