import { createHash, randomBytes } from "node:crypto";

import { sql } from "kysely";

import {
  consumeOAuthState,
  type DatabaseConnection,
} from "@novel-analysis/database";

const SAFE_RETURN_TO = "/";

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function validateReturnTo(value: string): string {
  let decoded = value;
  for (let index = 0; index < 5; index += 1) {
    const hasControlCharacter = Array.from(decoded).some((character) => {
      const code = character.charCodeAt(0);
      return code <= 31 || code === 127;
    });
    if (
      !decoded.startsWith("/")
      || decoded.startsWith("//")
      || decoded.includes("\\")
      || hasControlCharacter
    ) {
      return SAFE_RETURN_TO;
    }
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) return decoded;
      decoded = next;
    } catch {
      return SAFE_RETURN_TO;
    }
  }
  return SAFE_RETURN_TO;
}

export class OAuthStateRepository {
  constructor(private readonly database: DatabaseConnection) {}

  async create(returnTo: string): Promise<{ state: string }> {
    const state = randomBytes(32).toString("base64url");
    await this.database.insertInto("oauth_states").values({
      state_hash: sha256(state),
      return_to: validateReturnTo(returnTo),
      expires_at: sql<Date>`now() + interval '5 minutes'`,
      consumed_at: null,
    }).execute();
    return { state };
  }

  async consume(state: string): Promise<string | null> {
    return consumeOAuthState(this.database, sha256(state));
  }
}
