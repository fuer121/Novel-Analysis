import {
  closeSync,
  existsSync,
  mkdtempSync,
  openSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  executeStage,
  withPrivateSnapshotCopy,
} from "../../scripts/phase5-rehearsal-stage/src/stage.js";

const openBytes = (directory: string, name: string, bytes: string | Buffer): number => {
  const path = join(directory, name);
  writeFileSync(path, bytes, { mode: 0o600 });
  return openSync(path, "r");
};

const withDescriptors = async (
  request: Record<string, unknown>,
  run: (requestFd: number) => Promise<void>,
): Promise<void> => {
  const directory = mkdtempSync(join(tmpdir(), "phase5-stage-source-"));
  const descriptors: number[] = [];
  try {
    for (const [key, value] of Object.entries(request)) {
      if (!key.endsWith("Bytes")) continue;
      const fd = openBytes(directory, key, value as string | Buffer);
      descriptors.push(fd);
      request[`${key.slice(0, -"Bytes".length)}Fd`] = fd;
      delete request[key];
    }
    const requestFd = openBytes(directory, "request.json", JSON.stringify(request));
    descriptors.push(requestFd);
    await run(requestFd);
  } finally {
    for (const fd of descriptors) closeSync(fd);
    await rm(directory, { recursive: true, force: true });
  }
};

describe("Phase 5 rehearsal stage source contract", () => {
  it("reads request and sensitive initialize input from inherited descriptors", async () => {
    await withDescriptors({
      databaseUrlBytes: "postgres://synthetic-only",
    }, async (requestFd) => {
      const initialize = vi.fn(async (request) => {
        expect(request.databaseUrl.toString()).toBe("postgres://synthetic-only");
        return { initialized: true };
      });
      const writeResult = vi.fn(async () => undefined);

      await expect(executeStage([
        "--mode", "initialize",
        "--request-fd", String(requestFd),
        "--result-file", "/output/result",
      ], {
        initialize,
        migrate: vi.fn(),
        capacity: vi.fn(),
        writeResult,
      })).resolves.toBe(0);

      expect(initialize).toHaveBeenCalledOnce();
      expect(writeResult).toHaveBeenCalledWith("/output/result", {
        schemaVersion: "phase5-rehearsal-stage-result-v2",
        mode: "initialize",
        status: "passed",
        details: { initialized: true },
      });
    });
  });

  it("keeps descriptor custody when the descriptor path is replaced", async () => {
    const directory = mkdtempSync(join(tmpdir(), "phase5-stage-swap-"));
    const originalPath = join(directory, "database-url");
    const movedPath = join(directory, "database-url.original");
    writeFileSync(originalPath, "postgres://verified-bytes", { mode: 0o600 });
    const databaseUrlFd = openSync(originalPath, "r");
    renameSync(originalPath, movedPath);
    writeFileSync(originalPath, "postgres://replacement", { mode: 0o600 });
    const requestFd = openBytes(directory, "request.json", JSON.stringify({ databaseUrlFd }));
    try {
      const initialize = vi.fn(async (request) => {
        expect(request.databaseUrl.toString()).toBe("postgres://verified-bytes");
        return {};
      });
      await expect(executeStage([
        "--mode", "initialize",
        "--request-fd", String(requestFd),
        "--result-file", "/output/result",
      ], {
        initialize,
        migrate: vi.fn(),
        capacity: vi.fn(),
        writeResult: vi.fn(async () => undefined),
      })).resolves.toBe(0);
      expect(initialize).toHaveBeenCalledOnce();
    } finally {
      closeSync(requestFd);
      closeSync(databaseUrlFd);
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.each(["migrate", "capacity"] as const)(
    "binds the launcher resource ID for %s",
    async (mode) => {
      const request = mode === "migrate"
        ? {
          sourceBytes: Buffer.from("synthetic sqlite"),
          databaseUrlBytes: "postgres://synthetic-only",
          oldKeyBytes: Buffer.alloc(32, 1),
          targetKeyBytes: Buffer.alloc(32, 2),
          targetHmacKeyBytes: Buffer.alloc(32, 3),
          manifestFile: "/output/manifest.json",
          resourceId: "rid_opaque_resource_123",
        }
        : {
          databaseUrlBytes: "postgres://synthetic-only",
          resourceId: "rid_opaque_resource_123",
        };
      await withDescriptors(request, async (requestFd) => {
        const operation = vi.fn(async (verifiedRequest) => {
          expect(verifiedRequest.databaseUrl.toString()).toBe("postgres://synthetic-only");
          expect(verifiedRequest.resourceId).toBe("rid_opaque_resource_123");
          if (mode === "migrate") {
            expect(verifiedRequest.source.toString()).toBe("synthetic sqlite");
            expect(verifiedRequest.oldKey).toEqual(Buffer.alloc(32, 1));
            expect(verifiedRequest.targetKey).toEqual(Buffer.alloc(32, 2));
            expect(verifiedRequest.targetHmacKey).toEqual(Buffer.alloc(32, 3));
          }
          return {
            resourceId: "rid_opaque_resource_123",
            report: { status: "PASS" },
          };
        });
        const writeResult = vi.fn(async () => undefined);
        const operations = {
          initialize: vi.fn(),
          migrate: mode === "migrate" ? operation : vi.fn(),
          capacity: mode === "capacity" ? operation : vi.fn(),
        };

        await expect(executeStage([
          "--mode", mode,
          "--request-fd", String(requestFd),
          "--result-file", "/output/result",
        ], { ...operations, writeResult })).resolves.toBe(0);

        expect(operation).toHaveBeenCalledOnce();
        expect(writeResult).toHaveBeenCalledWith("/output/result", expect.objectContaining({
          schemaVersion: "phase5-rehearsal-stage-result-v2",
          mode,
          status: "passed",
          resourceId: "rid_opaque_resource_123",
        }));
      });
    },
  );

  it("fails closed when an operation returns a different resource ID", async () => {
    await withDescriptors({
      databaseUrlBytes: "postgres://synthetic-only",
      resourceId: "rid_expected_resource",
    }, async (requestFd) => {
      const writeResult = vi.fn(async () => undefined);
      await expect(executeStage([
        "--mode", "capacity",
        "--request-fd", String(requestFd),
        "--result-file", "/output/result",
      ], {
        initialize: vi.fn(),
        migrate: vi.fn(),
        capacity: vi.fn(async () => ({
          resourceId: "rid_different_resource",
          report: { status: "PASS" },
        })),
        writeResult,
      })).resolves.toBe(65);

      expect(writeResult).toHaveBeenCalledWith("/output/result", {
        schemaVersion: "phase5-rehearsal-stage-result-v2",
        mode: "capacity",
        status: "failed",
        code: "resource_mismatch",
      });
    });
  });

  it("rejects a resource ID shaped like sensitive connection data", async () => {
    await withDescriptors({
      databaseUrlBytes: "postgres://synthetic-only",
      resourceId: "postgres:secret",
    }, async (requestFd) => {
      const capacity = vi.fn();
      await expect(executeStage([
        "--mode", "capacity",
        "--request-fd", String(requestFd),
        "--result-file", "/output/result",
      ], {
        initialize: vi.fn(),
        migrate: vi.fn(),
        capacity,
        writeResult: vi.fn(async () => undefined),
      })).resolves.toBe(65);
      expect(capacity).not.toHaveBeenCalled();
    });
  });

  it.each(["success", "failure"] as const)(
    "uses a private working copy and cleans it after %s",
    async (outcome) => {
      const parent = await mkdtemp(join(tmpdir(), "phase5-stage-copy-test-"));
      let observedDirectory = "";
      let observedFile = "";
      try {
        const operation = vi.fn(async (sourcePath: string) => {
          observedFile = sourcePath;
          observedDirectory = dirname(sourcePath);
          expect(statSync(sourcePath).mode & 0o777).toBe(0o600);
          expect(statSync(observedDirectory).mode & 0o777).toBe(0o700);
          if (outcome === "failure") throw new Error("synthetic failure");
          return "passed";
        });
        const promise = withPrivateSnapshotCopy(
          Buffer.from("verified sqlite bytes"),
          operation,
          parent,
        );
        if (outcome === "failure") {
          await expect(promise).rejects.toThrow("synthetic failure");
        } else {
          await expect(promise).resolves.toBe("passed");
        }
        expect(operation).toHaveBeenCalledOnce();
        expect(existsSync(observedFile)).toBe(false);
        expect(existsSync(observedDirectory)).toBe(false);
      } finally {
        await rm(parent, { recursive: true, force: true });
      }
    },
  );
});
