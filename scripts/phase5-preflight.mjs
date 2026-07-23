import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const CALLBACK_PATH = "/api/auth/callback";
const REQUIRED_SERVICES = ["caddy", "api", "worker", "postgres"];
const EXPECTED_CADDY_PORTS = ["443:443", "443:443/udp"];
const EXPECTED_HEALTH_TESTS = {
  caddy: ["CMD", "caddy", "validate", "--config", "/etc/caddy/Caddyfile"],
  api: [
    "CMD",
    "node",
    "-e",
    "const net=require('node:net');const socket=net.connect(3000,'127.0.0.1',()=>{socket.end();process.exit(0)});socket.on('error',()=>process.exit(1));setTimeout(()=>process.exit(1),2000)",
  ],
  worker: ["CMD-SHELL", "kill -0 1"],
  postgres: ["CMD-SHELL", "pg_isready -U \"$${POSTGRES_USER}\" -d \"$${POSTGRES_DB}\""],
};

function isCanonical32ByteBase64(value) {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) return false;
  const decoded = Buffer.from(value, "base64");
  return decoded.length === 32 && decoded.toString("base64") === value;
}

function isHttpsOrigin(url) {
  return url.protocol === "https:"
    && url.username === ""
    && url.password === ""
    && url.pathname === "/"
    && url.search === ""
    && url.hash === "";
}

function networkNames(service) {
  return Array.isArray(service?.networks)
    ? service.networks
    : Object.keys(service?.networks ?? {});
}

function sameMembers(actual, expected) {
  return actual.length === expected.length
    && expected.every((value) => actual.includes(value));
}

function hasExpectedTopology(compose) {
  const services = compose?.services ?? {};
  if (!sameMembers(Object.keys(services), REQUIRED_SERVICES)) return false;

  const caddy = services.caddy;
  if (caddy?.network_mode !== undefined
    || !Array.isArray(caddy?.ports)
    || !sameMembers(caddy.ports, EXPECTED_CADDY_PORTS)
    || !sameMembers(networkNames(caddy), ["edge", "internal"])
    || !compose?.networks?.edge
    || typeof compose.networks.edge !== "object"
    || compose.networks.edge.internal === true
    || compose?.networks?.internal?.internal !== true) return false;

  return ["api", "worker", "postgres"].every((name) => {
    const service = services[name];
    const networks = networkNames(service);
    return service?.ports === undefined
      && service?.network_mode === undefined
      && networks.length > 0
      && networks.every((network) => compose?.networks?.[network]?.internal === true);
  });
}

function hasExpectedHealthcheck(service, expectedTest) {
  const healthcheck = service?.healthcheck;
  if (!healthcheck || typeof healthcheck !== "object" || Array.isArray(healthcheck)
    || healthcheck.disable === true) return false;
  return Array.isArray(healthcheck.test)
    && JSON.stringify(healthcheck.test) === JSON.stringify(expectedTest);
}

export function runPreflight(config, composeText) {
  let origin;
  try {
    origin = new URL(config.APP_ORIGIN);
  } catch {
    return { ok: false, code: "origin_not_https" };
  }
  if (!isHttpsOrigin(origin)) return { ok: false, code: "origin_not_https" };

  if (config.FEISHU_REDIRECT_URI !== `${origin.origin}${CALLBACK_PATH}`) {
    return { ok: false, code: "callback_mismatch" };
  }

  let compose;
  try {
    compose = JSON.parse(composeText);
  } catch {
    return { ok: false, code: "database_exposed" };
  }
  const services = compose?.services ?? {};
  if (!hasExpectedTopology(compose)) {
    return { ok: false, code: "database_exposed" };
  }

  if (REQUIRED_SERVICES.some((service) =>
    !hasExpectedHealthcheck(services[service], EXPECTED_HEALTH_TESTS[service]))) {
    return { ok: false, code: "healthcheck_missing" };
  }

  if (!isCanonical32ByteBase64(config.CONTENT_ENCRYPTION_KEY)
    || !isCanonical32ByteBase64(config.CONTENT_HMAC_KEY)) {
    return { ok: false, code: "key_invalid" };
  }

  if (config.CONTENT_ENCRYPTION_KEY === config.CONTENT_HMAC_KEY) {
    return { ok: false, code: "keys_not_distinct" };
  }

  if (config.OPERATION_MODE !== "preflight-dry-run"
    || config.OPERATION_GATE !== "GATE-PHASE5-PREFLIGHT-LOCAL-ONLY") {
    return { ok: false, code: "gate_not_approved" };
  }

  return { ok: true, code: "ok" };
}

function parseEnvironment(text) {
  return Object.fromEntries(text.split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const separator = line.indexOf("=");
      return separator === -1 ? [line, ""] : [line.slice(0, separator), line.slice(separator + 1)];
    }));
}

function argumentValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

async function main() {
  const configPath = resolve(argumentValue("--config", "deploy/phase5/env.example"));
  const composePath = resolve(argumentValue("--compose", "deploy/phase5/compose.yml"));
  const [configText, composeText] = await Promise.all([
    readFile(configPath, "utf8"),
    readFile(composePath, "utf8"),
  ]);
  const result = runPreflight(parseEnvironment(configText), composeText);
  process.stdout.write(`${JSON.stringify({
    ...result,
    mode: process.argv.includes("--dry-run") ? "dry-run" : "read-only",
    checks: 7,
  })}\n`);
  process.exitCode = result.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
