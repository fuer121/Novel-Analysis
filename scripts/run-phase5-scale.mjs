import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { closeSync, mkdirSync, openSync, readFileSync, realpathSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const PHASE5_BENCHMARK_CONTRACT_VERSION = "phase5-local-idle-v1";
export const PHASE5_BENCHMARK_ISOLATION_MODE = "local-idle-host";

function repositoryCommonDirectory(cwd) {
  const value = execFileSync(
    "git",
    ["rev-parse", "--git-common-dir"],
    { cwd, encoding: "utf8" },
  ).trim();
  return realpathSync(isAbsolute(value) ? value : resolve(cwd, value));
}

export function phase5ScaleLockPath(cwd = process.cwd()) {
  const repositoryId = createHash("sha256")
    .update(repositoryCommonDirectory(cwd))
    .digest("hex");
  return join(tmpdir(), "novel-analysis-phase5-scale", `${repositoryId}.lock`);
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function readOwner(path) {
  try {
    const owner = JSON.parse(readFileSync(path, "utf8"));
    return Number.isSafeInteger(owner.pid) && typeof owner.token === "string"
      ? owner
      : null;
  } catch {
    return null;
  }
}

export function acquirePhase5ScaleLock(cwd = process.cwd()) {
  const path = phase5ScaleLockPath(cwd);
  mkdirSync(dirname(path), { recursive: true });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const token = randomUUID();
    let descriptor;
    let created = false;
    try {
      descriptor = openSync(path, "wx", 0o600);
      created = true;
      writeFileSync(descriptor, JSON.stringify({ pid: process.pid, token }), "utf8");
      closeSync(descriptor);
      descriptor = undefined;
      return {
        path,
        release() {
          const owner = readOwner(path);
          if (owner?.pid === process.pid && owner.token === token) unlinkSync(path);
        },
      };
    } catch (error) {
      if (descriptor !== undefined) closeSync(descriptor);
      if (created) {
        try { unlinkSync(path); } catch {}
      }
      if (error?.code !== "EEXIST") throw error;
      const owner = readOwner(path);
      if (!owner || processIsAlive(owner.pid)) {
        throw new Error(`Phase 5 scale benchmark isolation lock is already held${owner ? ` by PID ${owner.pid}` : ""}`);
      }
      unlinkSync(path);
    }
  }
  throw new Error("Unable to acquire Phase 5 scale benchmark isolation lock");
}

export function stopPhase5ScaleRun(child, signal, release) {
  if (child) {
    if (!child.killed) child.kill(signal);
    return;
  }
  release();
}

async function main() {
  const cwd = process.cwd();
  const lock = acquirePhase5ScaleLock(cwd);
  let child;
  let stoppingSignal;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    lock.release();
  };
  const stop = (signal) => {
    stoppingSignal = signal;
    stopPhase5ScaleRun(child, signal, release);
    process.exitCode = signal === "SIGINT" ? 130 : 143;
  };
  process.once("exit", release);
  process.once("SIGINT", () => stop("SIGINT"));
  process.once("SIGTERM", () => stop("SIGTERM"));

  try {
    const vitest = join(cwd, "node_modules", "vitest", "vitest.mjs");
    child = spawn(process.execPath, [vitest, "run", "--config", "vitest.phase5.config.ts", ...process.argv.slice(2)], {
      cwd,
      env: {
        ...process.env,
        PHASE5_SCALE: "1",
        PHASE5_SCALE_LOCK_ACQUIRED: "1",
        PHASE5_LOAD_REPORT_PATH: process.env.PHASE5_LOAD_REPORT_PATH ?? ".artifacts/phase5-load-report.json",
        TEST_DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgres://novel:novel_dev_only@127.0.0.1:55432/postgres",
      },
      stdio: "inherit",
    });
    const code = await new Promise((resolveCode, reject) => {
      child.once("error", reject);
      child.once("exit", (exitCode, signal) => resolveCode(signal ? 1 : (exitCode ?? 1)));
    });
    process.exitCode = stoppingSignal === "SIGINT"
      ? 130
      : stoppingSignal === "SIGTERM"
        ? 143
        : code;
  } finally {
    release();
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
