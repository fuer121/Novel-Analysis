import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { runPreflight } from "../../scripts/phase5-preflight.mjs";

const key = (byte: number) => Buffer.alloc(32, byte).toString("base64");

type ComposeFixture = {
  services: Record<string, Record<string, unknown>>;
  networks: Record<string, { internal?: boolean }>;
};

const apiHealthTest = [
  "CMD",
  "node",
  "-e",
  "const net=require('node:net');const socket=net.connect(3000,'127.0.0.1',()=>{socket.end();process.exit(0)});socket.on('error',()=>process.exit(1));setTimeout(()=>process.exit(1),2000)",
];

const validConfig = {
  APP_ORIGIN: "https://novel.example.invalid",
  FEISHU_REDIRECT_URI: "https://novel.example.invalid/api/auth/callback",
  CONTENT_ENCRYPTION_KEY: key(1),
  CONTENT_HMAC_KEY: key(2),
  OPERATION_MODE: "preflight-dry-run",
  OPERATION_GATE: "GATE-PHASE5-PREFLIGHT-LOCAL-ONLY",
};

const validCompose = JSON.stringify({
  services: {
    caddy: {
      ports: ["443:443", "443:443/udp"],
      networks: ["edge", "internal"],
      healthcheck: { test: ["CMD", "caddy", "validate", "--config", "/etc/caddy/Caddyfile"] },
    },
    api: {
      networks: ["internal"],
      healthcheck: { test: apiHealthTest },
    },
    worker: {
      networks: ["internal"],
      healthcheck: { test: ["CMD-SHELL", "kill -0 1"] },
    },
    postgres: {
      networks: ["internal"],
      healthcheck: { test: ["CMD-SHELL", "pg_isready -U \"$${POSTGRES_USER}\" -d \"$${POSTGRES_DB}\""] },
    },
  },
  networks: {
    edge: {},
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

  it("requires the exact four-service HTTPS-only topology", () => {
    for (const mutate of [
      (compose: ComposeFixture) => { compose.services.postgres.ports = ["5432:5432"]; },
      (compose: ComposeFixture) => { compose.services.postgres.network_mode = "host"; },
      (compose: ComposeFixture) => { compose.services.postgres.networks = ["edge"]; },
      (compose: ComposeFixture) => { compose.networks.internal!.internal = false; },
      (compose: ComposeFixture) => { compose.services.metrics = { ports: ["9090:9090"] }; },
      (compose: ComposeFixture) => { delete compose.services.caddy.ports; },
      (compose: ComposeFixture) => { compose.services.caddy.ports = ["80:80", "443:443"]; },
      (compose: ComposeFixture) => { compose.services.caddy.network_mode = "host"; },
      (compose: ComposeFixture) => { compose.services.caddy.networks = ["internal"]; },
      (compose: ComposeFixture) => { delete compose.networks.edge; },
      (compose: ComposeFixture) => { compose.services.api.ports = ["3000:3000"]; },
      (compose: ComposeFixture) => { compose.services.worker.ports = ["3001:3001"]; },
      (compose: ComposeFixture) => { compose.services.worker.network_mode = "host"; },
      (compose: ComposeFixture) => { compose.services.api.networks = ["edge"]; },
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

    for (const service of ["caddy", "api", "worker", "postgres"]) {
      const compose = JSON.parse(validCompose) as ComposeFixture;
      compose.services[service]!.healthcheck = { test: ["CMD", "false"] };
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

  it("requires the exact local-only preflight operation Gate pair", () => {
    expect(runPreflight(validConfig, validCompose)).toEqual({ ok: true, code: "ok" });
    for (const override of [
      { OPERATION_MODE: "", OPERATION_GATE: validConfig.OPERATION_GATE },
      { OPERATION_MODE: validConfig.OPERATION_MODE, OPERATION_GATE: "" },
      { OPERATION_MODE: "preflight-dry-run", OPERATION_GATE: "approved" },
    ]) {
      expect(runPreflight({ ...validConfig, ...override }, validCompose))
        .toEqual({ ok: false, code: "gate_not_approved" });
    }

    const example = readFileSync(new URL("../../deploy/phase5/env.example", import.meta.url), "utf8");
    expect(example).toContain("OPERATION_MODE=preflight-dry-run");
    expect(example).toContain("OPERATION_GATE=GATE-PHASE5-PREFLIGHT-LOCAL-ONLY");
    expect(example).not.toContain("OPERATION_GATE=approved");
  });
});
