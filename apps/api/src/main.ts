import { createContentCipher, createDatabase, destroyDatabase } from "@novel-analysis/database";

import { createApp } from "./app.js";
import { loadApiConfig } from "./config.js";
import { FeishuHttpOAuthAdapter } from "./auth/feishu-http-adapter.js";

const databaseUrl = process.env.DATABASE_URL;
const feishuAppId = process.env.FEISHU_APP_ID;
const feishuAppSecret = process.env.FEISHU_APP_SECRET;
const contentKey = process.env.CONTENT_ENCRYPTION_KEY;
const contentKeyVersion = process.env.CONTENT_ENCRYPTION_KEY_VERSION;
const contentHmacKey = process.env.CONTENT_HMAC_KEY;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
if (!feishuAppId || !feishuAppSecret) throw new Error("Feishu credentials are required");
if (!contentKey || !contentKeyVersion) throw new Error("Content encryption configuration is required");
if (contentHmacKey === undefined) throw new Error("CONTENT_HMAC_KEY is required");
const decodedContentKey = Buffer.from(contentKey, "base64");
const decodedContentHmacKey = Buffer.from(contentHmacKey, "base64");
if (decodedContentKey.length !== 32 || decodedContentKey.toString("base64") !== contentKey) throw new Error("CONTENT_ENCRYPTION_KEY is invalid");
if (!/^[A-Za-z0-9+/]+={0,2}$/.test(contentHmacKey) || contentHmacKey.length % 4 !== 0 || decodedContentHmacKey.length !== 32 || decodedContentHmacKey.toString("base64") !== contentHmacKey || decodedContentHmacKey.equals(decodedContentKey)) throw new Error("CONTENT_HMAC_KEY is invalid");

const port = Number(process.env.PORT ?? "3001");
if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("PORT is invalid");

const database = createDatabase(databaseUrl);
const app = createApp({
  database,
  config: loadApiConfig(process.env),
  feishu: new FeishuHttpOAuthAdapter({ appId: feishuAppId, appSecret: feishuAppSecret }),
  contentCipher: createContentCipher({ activeKeyVersion: contentKeyVersion, keys: { [contentKeyVersion]: decodedContentKey } }),
  queryHmacKey: decodedContentHmacKey,
});
const server = app.listen(port);

let shutdownPromise: Promise<void> | undefined;

function closeServer(): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  });
}

async function stopResources(): Promise<void> {
  const errors: unknown[] = [];
  try {
    await closeServer();
  } catch (error) {
    errors.push(error);
  }
  try {
    await destroyDatabase(database);
  } catch (error) {
    errors.push(error);
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, "API shutdown failed");
}

function shutdown(): Promise<void> {
  shutdownPromise ??= stopResources();
  return shutdownPromise;
}

function handleSignal(): void {
  void shutdown().catch((error: unknown) => {
    console.error("API shutdown failed", error);
    process.exitCode = 1;
  });
}

process.once("SIGTERM", handleSignal);
process.once("SIGINT", handleSignal);
