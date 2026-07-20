import { createHash } from "node:crypto";
import type { Server } from "node:http";

import { createContentCipher, type DatabaseConnection } from "@novel-analysis/database";
import { createApp } from "../../../apps/api/src/app.js";
import { FakeFeishuOAuthAdapter } from "../../../apps/api/src/auth/feishu-fake.js";
import type { ApiConfig } from "../../../apps/api/src/config.js";

export async function startPhase2TestApi(database: DatabaseConnection, userId: string) {
  const token = "phase2-session-token";
  await database.insertInto("sessions").values({ user_id: userId, token_hash: createHash("sha256").update(token).digest("hex"), csrf_token_hash: null, expires_at: new Date(Date.now() + 60_000), revoked_at: null }).onConflict((conflict) => conflict.column("token_hash").doNothing()).execute();
  const config: ApiConfig = { appOrigin: "http://127.0.0.1", oauthRedirectUri: "http://127.0.0.1/api/auth/callback", sessionCookieName: "phase2_session", oauthCorrelationCookieName: "phase2_oauth", sessionCookieSecure: false, sessionTtlMs: 60_000 };
  const app = createApp({ database, config, feishu: new FakeFeishuOAuthAdapter(), contentCipher: createContentCipher({ activeKeyVersion: "phase2-test", keys: { "phase2-test": Buffer.alloc(32, 8) } }) });
  const server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Phase 2 API address unavailable");
  return {
    origin: `http://127.0.0.1:${address.port}`,
    cookie: `phase2_session=${token}`,
    stop: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}
