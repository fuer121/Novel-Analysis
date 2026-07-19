import { createDatabase, destroyDatabase } from "@novel-analysis/database";

import { createApp } from "../../../apps/api/src/app.js";
import { FakeFeishuOAuthAdapter } from "../../../apps/api/src/auth/feishu-fake.js";
import { FeishuHttpOAuthAdapter } from "../../../apps/api/src/auth/feishu-http-adapter.js";
import type { ApiConfig } from "../../../apps/api/src/config.js";
import { FEISHU_USERS } from "../fixtures/feishu-users.js";

const databaseUrl = process.env.DATABASE_URL;
const clientSecret = process.env.TEST_FEISHU_CLIENT_SECRET;
if (!databaseUrl || !clientSecret || !process.send) {
  throw new Error("Test API requires DATABASE_URL, test client secret and IPC");
}

const redactionProbe = new FeishuHttpOAuthAdapter({
  appId: "phase1-test-app",
  appSecret: clientSecret,
  async fetch() {
    throw new Error(`provider failure ${clientSecret} phase1-redaction-code Cookie csrf-value`);
  },
});
try {
  await redactionProbe.exchangeCode({
    code: "phase1-redaction-code",
    redirectUri: "http://127.0.0.1/api/auth/callback",
  });
} catch (error) {
  console.error(
    "phase1-auth-redaction",
    error instanceof Error ? error.message : "authentication_failed",
  );
}

const database = createDatabase(databaseUrl);
const feishu = new FakeFeishuOAuthAdapter();
for (const user of Object.values(FEISHU_USERS)) feishu.addCode(user.code, user.identity);

const config: ApiConfig = {
  appOrigin: "http://127.0.0.1",
  oauthRedirectUri: "http://127.0.0.1/api/auth/callback",
  sessionCookieName: "phase1_session",
  oauthCorrelationCookieName: "phase1_oauth_correlation",
  sessionCookieSecure: false,
  sessionTtlMs: 60 * 60 * 1000,
};
const app = createApp({
  database,
  config,
  feishu,
  logger: { error: (message) => console.error(message) },
});
const server = app.listen(0, "127.0.0.1", () => {
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test API address unavailable");
  if (process.env.TEST_SUPPRESS_READY !== "true") {
    process.send!({ type: "ready", port: address.port });
  }
});

let stopping = false;
async function stop(): Promise<void> {
  if (stopping) return;
  stopping = true;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await destroyDatabase(database);
  process.exit(0);
}

process.on("message", (message) => {
  if ((message as { type?: string }).type === "stop") void stop();
});
process.once("SIGTERM", () => void stop());
