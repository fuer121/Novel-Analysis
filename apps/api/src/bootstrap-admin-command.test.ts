import type { DatabaseConnection } from "@novel-analysis/database";
import { describe, expect, it, vi } from "vitest";

import { executeFirstAdminBootstrap } from "./bootstrap-admin-command.js";

const sensitiveEnvironment = {
  BOOTSTRAP_ADMIN_CONFIRM: "CREATE_FIRST_ADMIN",
  BOOTSTRAP_ADMIN_UNION_ID: "private-union-id",
  BOOTSTRAP_ADMIN_DISPLAY_NAME: "Private Admin",
  DATABASE_URL: "postgres://private-user:private-password@database/private",
};

function harness(overrides: {
  environment?: Record<string, string | undefined>;
  bootstrapAdmin?: () => Promise<{ id: string }>;
  destroyDatabase?: () => Promise<void>;
} = {}) {
  const output: string[] = [];
  const errors: string[] = [];
  const database = {} as DatabaseConnection;
  const createDatabase = vi.fn(() => database);
  const bootstrapAdmin = vi.fn(overrides.bootstrapAdmin ?? (async () => ({ id: "private-user-id" })));
  const destroyDatabase = vi.fn(overrides.destroyDatabase ?? (async () => undefined));
  const execute = () => executeFirstAdminBootstrap({
    environment: overrides.environment ?? sensitiveEnvironment,
    createDatabase,
    bootstrapAdmin,
    destroyDatabase,
    writeOutput: (message) => output.push(message),
    writeError: (message) => errors.push(message),
  });
  return { bootstrapAdmin, createDatabase, destroyDatabase, errors, execute, output };
}

describe("first-admin bootstrap command", () => {
  it("fails before database access without exact confirmation", async () => {
    const context = harness({
      environment: {
        ...sensitiveEnvironment,
        BOOTSTRAP_ADMIN_CONFIRM: "yes",
      },
    });

    await expect(context.execute()).resolves.toBe(1);
    expect(context.createDatabase).not.toHaveBeenCalled();
    expect(context.bootstrapAdmin).not.toHaveBeenCalled();
    expect(context.output).toEqual([]);
    expect(context.errors).toEqual(["First admin bootstrap failed"]);
  });

  it("passes the identity once and emits no sensitive success value", async () => {
    const context = harness();

    await expect(context.execute()).resolves.toBe(0);
    expect(context.bootstrapAdmin).toHaveBeenCalledWith(
      expect.anything(),
      {
        unionId: "private-union-id",
        displayName: "Private Admin",
        avatarUrl: null,
      },
    );
    expect(context.destroyDatabase).toHaveBeenCalledOnce();
    expect(context.output).toEqual(["First admin bootstrap completed"]);
    expect(context.errors).toEqual([]);
    expect(JSON.stringify(context.output)).not.toMatch(
      /private-union-id|Private Admin|private-password|private-user-id/,
    );
  });

  it("redacts bootstrap and cleanup failures while still closing the database", async () => {
    const context = harness({
      bootstrapAdmin: async () => {
        throw new Error("private-union-id private-password");
      },
      destroyDatabase: async () => {
        throw new Error("postgres://private");
      },
    });

    await expect(context.execute()).resolves.toBe(1);
    expect(context.destroyDatabase).toHaveBeenCalledOnce();
    expect(context.output).toEqual([]);
    expect(context.errors).toEqual(["First admin bootstrap failed"]);
    expect(JSON.stringify(context.errors)).not.toMatch(
      /private-union-id|private-password|postgres/,
    );
  });
});
