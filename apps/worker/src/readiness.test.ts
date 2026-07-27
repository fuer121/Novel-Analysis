import { lstat, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  clearWorkerReadiness,
  createReadinessAwareShutdown,
  isWorkerReady,
  markWorkerReady,
  prepareWorkerReadiness,
} from "./readiness.js";

describe("Worker readiness marker", () => {
  let directory: string;
  let markerPath: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "novel-worker-readiness-"));
    markerPath = join(directory, "ready");
  });

  afterEach(async () => {
    await clearWorkerReadiness(markerPath);
  });

  it("clears stale state before startup and publishes an owner-only regular marker", async () => {
    await writeFile(markerPath, "999\n");
    await prepareWorkerReadiness(markerPath);
    await expect(lstat(markerPath)).rejects.toMatchObject({ code: "ENOENT" });

    await markWorkerReady(markerPath, 42);
    const metadata = await lstat(markerPath);

    expect(metadata.isFile()).toBe(true);
    expect(metadata.isSymbolicLink()).toBe(false);
    expect(metadata.mode & 0o077).toBe(0);
    await expect(isWorkerReady(markerPath, (pid) => pid === 42)).resolves.toBe(true);
  });

  it("fails closed for dead processes and symlink markers", async () => {
    await markWorkerReady(markerPath, 43);
    await expect(isWorkerReady(markerPath, () => false)).resolves.toBe(false);

    await clearWorkerReadiness(markerPath);
    const target = join(directory, "target");
    await writeFile(target, "43\n");
    await symlink(target, markerPath);
    await expect(isWorkerReady(markerPath, () => true)).resolves.toBe(false);
  });

  it("removes readiness during shutdown", async () => {
    await markWorkerReady(markerPath, 44);
    await clearWorkerReadiness(markerPath);

    await expect(isWorkerReady(markerPath, () => true)).resolves.toBe(false);
    await expect(lstat(markerPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("continues resource shutdown when marker cleanup fails and remains idempotent", async () => {
    const calls: string[] = [];
    const shutdown = createReadinessAwareShutdown({
      async clearReadiness() {
        calls.push("clear");
        throw new Error("clear failed");
      },
      async stopResources() {
        calls.push("stop");
      },
    });

    const first = shutdown();
    const second = shutdown();

    await expect(first).rejects.toThrow("clear failed");
    await expect(second).rejects.toThrow("clear failed");
    expect(calls).toEqual(["clear", "stop"]);
  });
});
