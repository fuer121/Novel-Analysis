import { z } from "zod";

import type { FeishuOAuthAdapter } from "./feishu-adapter.js";

const tokenResponseSchema = z.object({
  code: z.literal(0),
  data: z.object({
    access_token: z.string().min(1),
  }),
});

const userInfoResponseSchema = z.object({
  code: z.literal(0),
  data: z.object({
    union_id: z.string().min(1),
    name: z.string().min(1),
    avatar_url: z.string().url().nullable().optional(),
  }),
});

const PROVIDER_TIMEOUT_MS = 10_000;

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
      const tokenResponse = await this.#fetch("https://open.feishu.cn/open-apis/authen/v2/oauth/token", {
        method: "POST",
        redirect: "error",
        headers: { "content-type": "application/json" },
        signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
        body: JSON.stringify({
          grant_type: "authorization_code",
          client_id: this.#appId,
          client_secret: this.#appSecret,
          code: input.code,
          redirect_uri: input.redirectUri,
        }),
      });
      if (!tokenResponse.ok) throw new Error("token request failed");
      const token = tokenResponseSchema.parse(await tokenResponse.json());

      const userInfoResponse = await this.#fetch(
        "https://open.feishu.cn/open-apis/authen/v1/user_info",
        {
          method: "GET",
          redirect: "error",
          headers: { authorization: `Bearer ${token.data.access_token}` },
          signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
        },
      );
      if (!userInfoResponse.ok) throw new Error("user info request failed");
      const userInfo = userInfoResponseSchema.parse(await userInfoResponse.json());
      return {
        unionId: userInfo.data.union_id,
        displayName: userInfo.data.name,
        avatarUrl: userInfo.data.avatar_url ?? null,
      };
    } catch {
      throw new Error("authentication_failed");
    }
  }
}
