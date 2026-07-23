import { describe, expect, test, vi } from "vitest";
import { executeMigrationCli, parseMigrationCliArgs } from "./cli.js";

const complete = [
  "--source", "/tmp/source.sqlite",
  "--database-url", "postgres://localhost/test",
  "--old-key-file", "/tmp/old.key",
  "--target-key-file", "/tmp/target.key",
  "--target-hmac-key-file", "/tmp/hmac.key",
  "--manifest", "/tmp/manifest.json",
];

describe("migration CLI", () => {
  test("requires every explicit file and database argument", () => {
    for (let index = 0; index < complete.length; index += 2) {
      expect(() => parseMigrationCliArgs([
        ...complete.slice(0, index),
        ...complete.slice(index + 2),
      ])).toThrow(`missing_required_argument:${complete[index]}`);
    }
  });

  test.each([
    "--old-key", "--target-key", "--target-hmac-key",
    "--old-master-key", "--content-key", "--hmac-key",
  ])("rejects inline key option %s", (option) => {
    expect(() => parseMigrationCliArgs([...complete, option, "secret"]))
      .toThrow("inline_keys_forbidden");
  });

  test("rejects unknown options, duplicate options, and positional values", () => {
    expect(() => parseMigrationCliArgs([...complete, "--unknown", "value"]))
      .toThrow("unknown_argument:--unknown");
    expect(() => parseMigrationCliArgs([...complete, "--source", "/tmp/other"]))
      .toThrow("duplicate_argument:--source");
    expect(() => parseMigrationCliArgs([...complete, "production.sqlite"]))
      .toThrow("unexpected_positional_argument");
  });

  test("returns nonzero and emits a redacted controlled error", async () => {
    const stderr = vi.fn();
    const exitCode = await executeMigrationCli(complete, {
      run: async () => {
        throw new Error("target_not_empty");
      },
      stderr,
      stdout: vi.fn(),
    });

    expect(exitCode).toBe(1);
    expect(stderr).toHaveBeenCalledWith("migration_failed:target_not_empty\n");
  });

  test("returns zero only for a passed result", async () => {
    const stdout = vi.fn();
    const result = {
      status: "passed" as const,
      elapsedMs: 1,
      manifestPath: "/tmp/manifest.json",
      books: 2,
      chapters: 4,
      validations: [],
    };
    const exitCode = await executeMigrationCli(complete, {
      run: async () => result,
      stderr: vi.fn(),
      stdout,
    });

    expect(exitCode).toBe(0);
    expect(stdout).toHaveBeenCalledWith(`${JSON.stringify(result)}\n`);
  });
});
