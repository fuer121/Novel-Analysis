import { z } from "zod";

import type { FeishuOAuthAdapter } from "./feishu-adapter.js";

const tokenResponseSchema = z.object({
  union_id: z.string().min(1),
  name: z.string().min(1),
  avatar_url: z.string().url().nullable().optional(),
});

export interface FeishuHttpAdapterOptions {
  appId: string;
  appSecret: string;
  fetch?: typeof fetch;
}

export class FeishuHttpOAuthAdapter implements FeishuOAuthAdapter {
  readonly #appId: string;
  readonly #appSecret: string;
  readonly #fetch: typeof fetch;

  constructor(options: FeishuHttpAdapterOptions) {
    this.#appId = options.appId;
    this.#appSecret = options.appSecret;
    this.#fetch = options.fetch ?? fetch;
  }

  authorizationUrl(input: { state: string; redirectUri: string }): URL {
    const url = new URL("https://accounts.feishu.cn/open-apis/authen/v1/authorize");
    url.searchParams.set("app_id", this.#appId);
    url.searchParams.set("redirect_uri", input.redirectUri);
    url.searchParams.set("state", input.state);
    return url;
  }

  async exchangeCode(input: { code: string; redirectUri: string }) {
    try {
      const response = await this.#fetch("https://open.feishu.cn/open-apis/authen/v2/oauth/token", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          grant_type: "authorization_code",
          client_id: this.#appId,
          client_secret: this.#appSecret,
          code: input.code,
          redirect_uri: input.redirectUri,
        }),
      });
      if (!response.ok) {
        throw new Error("provider rejected OAuth exchange");
      }
      const parsed = tokenResponseSchema.parse(await response.json());
      return {
        unionId: parsed.union_id,
        displayName: parsed.name,
        avatarUrl: parsed.avatar_url ?? null,
      };
    } catch {
      throw new Error("Feishu OAuth exchange failed");
    }
  }
}
