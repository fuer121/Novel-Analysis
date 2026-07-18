import { randomBytes } from "node:crypto";

import { sql } from "kysely";

import type { DatabaseConnection } from "@novel-analysis/database";

import type { ApiConfig } from "../config.js";
import type { FeishuOAuthAdapter } from "./feishu-adapter.js";
import { OAuthStateRepository, sha256, validateReturnTo } from "./oauth-state-repository.js";

export class AuthError extends Error {
  readonly code = "authentication_failed";

  constructor() {
    super("Authentication failed");
    this.name = "AuthError";
  }
}

export interface AuthServiceOptions {
  database: DatabaseConnection;
  config: ApiConfig;
  feishu: FeishuOAuthAdapter;
}

export class AuthService {
  readonly #database: DatabaseConnection;
  readonly #config: ApiConfig;
  readonly #feishu: FeishuOAuthAdapter;
  readonly #states: OAuthStateRepository;

  constructor(options: AuthServiceOptions) {
    this.#database = options.database;
    this.#config = options.config;
    this.#feishu = options.feishu;
    this.#states = new OAuthStateRepository(options.database);
  }

  async startLogin(returnTo: string): Promise<URL> {
    const { state } = await this.#states.create(validateReturnTo(returnTo));
    return this.#feishu.authorizationUrl({
      state,
      redirectUri: this.#config.oauthRedirectUri,
    });
  }

  async finishLogin(code: string, state: string, priorSessionToken?: string): Promise<{
    sessionToken: string;
    returnTo: string;
  }> {
    const returnTo = await this.#states.consume(state);
    if (!returnTo) throw new AuthError();

    let identity;
    try {
      identity = await this.#feishu.exchangeCode({
        code,
        redirectUri: this.#config.oauthRedirectUri,
      });
    } catch {
      throw new AuthError();
    }

    const sessionToken = randomBytes(32).toString("base64url");
    const tokenHash = sha256(sessionToken);
    const priorHash = priorSessionToken ? sha256(priorSessionToken) : undefined;

    try {
      await this.#database.transaction().execute(async (transaction) => {
        const user = await transaction.selectFrom("auth_identities")
          .innerJoin("users", "users.id", "auth_identities.user_id")
          .select("users.id")
          .where("auth_identities.provider", "=", "feishu")
          .where("auth_identities.subject", "=", identity.unionId)
          .where("users.status", "=", "active")
          .forUpdate()
          .executeTakeFirst();
        if (!user) throw new AuthError();

        await transaction.insertInto("sessions").values({
          user_id: user.id,
          token_hash: tokenHash,
          csrf_token_hash: null,
          expires_at: new Date(Date.now() + this.#config.sessionTtlMs),
          revoked_at: null,
        }).execute();

        if (priorHash) {
          await transaction.updateTable("sessions")
            .set({ revoked_at: sql`now()` })
            .where("token_hash", "=", priorHash)
            .where("revoked_at", "is", null)
            .execute();
        }
      });
    } catch {
      throw new AuthError();
    }

    return { sessionToken, returnTo };
  }

  async currentUserAndRotateCsrf(sessionToken: string): Promise<{
    user: { id: string; displayName: string; role: "admin" | "member" };
    csrfToken: string;
  }> {
    const csrfToken = randomBytes(32).toString("base64url");
    try {
      return await this.#database.transaction().execute(async (transaction) => {
        const row = await transaction.selectFrom("sessions")
          .innerJoin("users", "users.id", "sessions.user_id")
          .select([
            "sessions.id as sessionId",
            "users.id as userId",
            "users.display_name as displayName",
            "users.role as role",
          ])
          .where("sessions.token_hash", "=", sha256(sessionToken))
          .where("sessions.revoked_at", "is", null)
          .where("sessions.expires_at", ">", sql<Date>`now()`)
          .where("users.status", "=", "active")
          .forUpdate()
          .executeTakeFirst();
        if (!row) throw new AuthError();

        await transaction.updateTable("sessions")
          .set({ csrf_token_hash: sha256(csrfToken), last_seen_at: sql`now()` })
          .where("id", "=", row.sessionId)
          .execute();
        return {
          user: { id: row.userId, displayName: row.displayName, role: row.role },
          csrfToken,
        };
      });
    } catch {
      throw new AuthError();
    }
  }

  async logout(sessionToken: string): Promise<void> {
    await this.#database.updateTable("sessions")
      .set({ revoked_at: sql`now()` })
      .where("token_hash", "=", sha256(sessionToken))
      .where("revoked_at", "is", null)
      .execute();
  }
}
