import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const CALLBACK_PATH = "/api/auth/callback";
const REQUIRED_SERVICES = ["caddy", "api", "worker", "postgres"];

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

function isPostgresInternal(compose, postgres) {
  if (postgres?.network_mode === "host") return false;
  if (postgres?.ports !== undefined
    && (!Array.isArray(postgres.ports) || postgres.ports.length > 0)) return false;
  const networkNames = Array.isArray(postgres?.networks)
    ? postgres.networks
    : Object.keys(postgres?.networks ?? {});
  return networkNames.length > 0
    && networkNames.every((name) => compose?.networks?.[name]?.internal === true);
}

function hasHealthcheck(service) {
  const healthcheck = service?.healthcheck;
  if (!healthcheck || typeof healthcheck !== "object" || Array.isArray(healthcheck)
    || healthcheck.disable === true) return false;
  const test = healthcheck.test;
  if (typeof test === "string") return test.trim() !== "" && test.trim().toUpperCase() !== "NONE";
  return Array.isArray(test) && test.some((part) => String(part).trim() !== "")
    && String(test[0]).trim().toUpperCase() !== "NONE";
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
  if (!isPostgresInternal(compose, services.postgres)) {
    return { ok: false, code: "database_exposed" };
  }

  if (REQUIRED_SERVICES.some((service) => !hasHealthcheck(services[service]))) {
    return { ok: false, code: "healthcheck_missing" };
  }

  if (!isCanonical32ByteBase64(config.CONTENT_ENCRYPTION_KEY)
    || !isCanonical32ByteBase64(config.CONTENT_HMAC_KEY)) {
    return { ok: false, code: "key_invalid" };
  }

  if (config.CONTENT_ENCRYPTION_KEY === config.CONTENT_HMAC_KEY) {
    return { ok: false, code: "keys_not_distinct" };
  }

  if (config.OPERATION_GATE !== "approved") {
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
