import { createApp } from "../../../apps/api/src/app.js";
import { FakeFeishuOAuthAdapter } from "../../../apps/api/src/auth/feishu-fake.js";
import type { ApiConfig } from "../../../apps/api/src/config.js";
import { createLegacyAnalysisFixtureReader } from "../../../apps/api/src/legacy-analysis.js";
import { createDatabase, destroyDatabase } from "@novel-analysis/database";
import { LEGACY_ANALYSIS_GOLDEN } from "../fixtures/legacy-analysis-golden.js";

const databaseUrl = process.env.DATABASE_URL;
const ownerId = process.env.PHASE4_OWNER_ID;
const bookId = process.env.PHASE4_BOOK_ID;
const port = Number(process.env.PORT);
if (!databaseUrl || !ownerId || !bookId || !Number.isInteger(port) || port < 1) {
  throw new Error("Phase 4 legacy fixture API configuration is invalid");
}

const config: ApiConfig = {
  appOrigin: "https://phase4.test",
  oauthRedirectUri: "https://phase4.test/api/auth/callback",
  sessionCookieName: "__Host-novel_session",
  oauthCorrelationCookieName: "__Host-novel_oauth_correlation",
  sessionCookieSecure: true,
  sessionTtlMs: 5 * 60_000,
};
const database = createDatabase(databaseUrl);
const reader = createLegacyAnalysisFixtureReader({
  ownerId,
  records: LEGACY_ANALYSIS_GOLDEN.map((record) => ({ ...record, bookId })),
});
const app = createApp({
  database,
  config,
  feishu: new FakeFeishuOAuthAdapter(),
  legacyAnalysisReader: reader,
});
const server = app.listen(port, "127.0.0.1");

let shutdownPromise: Promise<void> | undefined;

function shutdown(): Promise<void> {
  shutdownPromise ??= (async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      server.closeAllConnections();
    });
    await destroyDatabase(database);
  })();
  return shutdownPromise;
}

function handleSignal(): void {
  void shutdown().catch((error: unknown) => {
    console.error("Phase 4 legacy fixture API shutdown failed", error);
    process.exitCode = 1;
  });
}

process.once("SIGTERM", handleSignal);
process.once("SIGINT", handleSignal);
