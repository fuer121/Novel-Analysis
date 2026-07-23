import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  acquirePhase5ScaleLock,
  phase5ScaleLockPath,
  stopPhase5ScaleRun,
} from "../../scripts/run-phase5-scale.mjs";

test("Phase 5 scale lock has a repository-stable path and fails closed", () => {
  const repository = process.cwd();
  assert.equal(
    phase5ScaleLockPath(repository),
    phase5ScaleLockPath(join(repository, "test", "phase5")),
  );

  const first = acquirePhase5ScaleLock(repository);
  assert.throws(
    () => acquirePhase5ScaleLock(repository),
    /isolation lock is already held/,
  );
  first.release();
  const next = acquirePhase5ScaleLock(repository);
  next.release();
});

test("Phase 5 scale lock fails closed across processes", async () => {
  const repository = process.cwd();
  const script = `
    const { acquirePhase5ScaleLock } = await import(${JSON.stringify(new URL("../../scripts/run-phase5-scale.mjs", import.meta.url).href)});
    const lock = acquirePhase5ScaleLock(${JSON.stringify(repository)});
    process.stdout.write("READY\\n");
    process.on("SIGTERM", () => { lock.release(); process.exit(0); });
    setInterval(() => {}, 1000);
  `;
  const owner = spawn(process.execPath, ["--input-type=module", "--eval", script], {
    stdio: ["ignore", "pipe", "inherit"],
  });

  try {
    await new Promise((resolve, reject) => {
      owner.once("error", reject);
      owner.once("exit", (code) => reject(new Error(`lock owner exited before readiness with code ${code}`)));
      owner.stdout.once("data", (chunk) => {
        if (chunk.toString().includes("READY")) resolve();
        else reject(new Error(`unexpected lock owner output: ${chunk}`));
      });
    });
    assert.throws(
      () => acquirePhase5ScaleLock(repository),
      /isolation lock is already held by PID/,
    );
  } finally {
    owner.kill("SIGTERM");
    await new Promise((resolve) => owner.once("exit", resolve));
  }
});

test("Phase 5 scale lock recovers a dead owner", () => {
  const repository = process.cwd();
  writeFileSync(
    phase5ScaleLockPath(repository),
    JSON.stringify({ pid: 2_147_483_647, token: "dead-owner" }),
    { mode: 0o600 },
  );

  const lock = acquirePhase5ScaleLock(repository);
  lock.release();
});

test("repeated signals do not release the lock before child exit", () => {
  let releases = 0;
  const child = {
    killed: false,
    signals: [],
    kill(signal) {
      this.killed = true;
      this.signals.push(signal);
    },
  };

  stopPhase5ScaleRun(child, "SIGTERM", () => { releases += 1; });
  stopPhase5ScaleRun(child, "SIGTERM", () => { releases += 1; });

  assert.deepEqual(child.signals, ["SIGTERM"]);
  assert.equal(releases, 0);
});
