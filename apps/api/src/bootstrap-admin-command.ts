import type { DatabaseConnection } from "@novel-analysis/database";

import type { FeishuIdentity } from "./auth/feishu-adapter.js";

export const FIRST_ADMIN_CONFIRMATION = "CREATE_FIRST_ADMIN";

interface BootstrapAdminCommandOptions {
  environment: Record<string, string | undefined>;
  createDatabase(databaseUrl: string): DatabaseConnection;
  bootstrapAdmin(
    database: DatabaseConnection,
    identity: FeishuIdentity,
  ): Promise<{ id: string }>;
  destroyDatabase(database: DatabaseConnection): Promise<void>;
  writeOutput(message: string): void;
  writeError(message: string): void;
}

function parseEnvironment(environment: Record<string, string | undefined>): {
  databaseUrl: string;
  identity: FeishuIdentity;
} {
  if (environment.BOOTSTRAP_ADMIN_CONFIRM !== FIRST_ADMIN_CONFIRMATION) {
    throw new Error("Bootstrap confirmation is invalid");
  }
  const databaseUrl = environment.DATABASE_URL?.trim();
  const unionId = environment.BOOTSTRAP_ADMIN_UNION_ID?.trim();
  const displayName = environment.BOOTSTRAP_ADMIN_DISPLAY_NAME?.trim();
  if (!databaseUrl || !unionId || !displayName) {
    throw new Error("Bootstrap configuration is incomplete");
  }
  let parsedDatabaseUrl: URL;
  try {
    parsedDatabaseUrl = new URL(databaseUrl);
  } catch {
    throw new Error("Bootstrap database URL is invalid");
  }
  if (!["postgres:", "postgresql:"].includes(parsedDatabaseUrl.protocol)) {
    throw new Error("Bootstrap database URL is invalid");
  }
  const avatarValue = environment.BOOTSTRAP_ADMIN_AVATAR_URL?.trim();
  let avatarUrl: string | null = null;
  if (avatarValue) {
    let parsedAvatar: URL;
    try {
      parsedAvatar = new URL(avatarValue);
    } catch {
      throw new Error("Bootstrap avatar URL is invalid");
    }
    if (!["http:", "https:"].includes(parsedAvatar.protocol)) {
      throw new Error("Bootstrap avatar URL is invalid");
    }
    avatarUrl = parsedAvatar.toString();
  }
  return {
    databaseUrl,
    identity: { unionId, displayName, avatarUrl },
  };
}

export async function executeFirstAdminBootstrap(
  options: BootstrapAdminCommandOptions,
): Promise<0 | 1> {
  let database: DatabaseConnection | undefined;
  let failed = false;
  try {
    const parsed = parseEnvironment(options.environment);
    database = options.createDatabase(parsed.databaseUrl);
    await options.bootstrapAdmin(database, parsed.identity);
  } catch {
    failed = true;
  } finally {
    if (database) {
      try {
        await options.destroyDatabase(database);
      } catch {
        failed = true;
      }
    }
  }

  if (failed) {
    options.writeError("First admin bootstrap failed");
    return 1;
  }
  options.writeOutput("First admin bootstrap completed");
  return 0;
}
