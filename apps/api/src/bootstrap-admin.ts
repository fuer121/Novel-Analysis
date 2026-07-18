import { sql } from "kysely";

import type { DatabaseConnection } from "@novel-analysis/database";

import type { FeishuIdentity } from "./auth/feishu-adapter.js";

export async function bootstrapFirstAdmin(
  database: DatabaseConnection,
  identity: FeishuIdentity,
): Promise<{ id: string }> {
  return database.transaction().execute(async (transaction) => {
    await sql`select pg_advisory_xact_lock(706673891)`.execute(transaction);
    const existing = await transaction.selectFrom("users")
      .leftJoin("auth_identities", (join) => join
        .onRef("auth_identities.user_id", "=", "users.id")
        .on("auth_identities.provider", "=", "feishu"))
      .select(["users.id", "users.role", "auth_identities.subject"])
      .execute();

    if (existing.length > 0) {
      const same = existing.length === 1
        && existing[0]?.role === "admin"
        && existing[0]?.subject === identity.unionId;
      if (!same) throw new Error("Cannot bootstrap admin from nonempty users state");
      return { id: existing[0]!.id };
    }

    const user = await transaction.insertInto("users").values({
      display_name: identity.displayName,
      avatar_url: identity.avatarUrl,
      role: "admin",
      status: "active",
    }).returning("id").executeTakeFirstOrThrow();
    await transaction.insertInto("auth_identities").values({
      user_id: user.id,
      provider: "feishu",
      subject: identity.unionId,
    }).execute();
    return user;
  });
}
