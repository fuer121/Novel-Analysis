import type { FeishuIdentity, FeishuOAuthAdapter } from "./feishu-adapter.js";

export class FakeFeishuOAuthAdapter implements FeishuOAuthAdapter {
  readonly exchangedCodes: string[] = [];
  readonly #codes = new Map<string, FeishuIdentity | Error>();

  addCode(code: string, identity: FeishuIdentity): void {
    this.#codes.set(code, identity);
  }

  failCode(code: string, error: Error): void {
    this.#codes.set(code, error);
  }

  authorizationUrl(input: { state: string; redirectUri: string }): URL {
    const url = new URL("https://feishu.test/authorize");
    url.searchParams.set("state", input.state);
    url.searchParams.set("redirect_uri", input.redirectUri);
    return url;
  }

  async exchangeCode(input: { code: string; redirectUri: string }): Promise<FeishuIdentity> {
    this.exchangedCodes.push(input.code);
    const value = this.#codes.get(input.code);
    if (!value || value instanceof Error) {
      throw value ?? new Error("unknown fake OAuth code");
    }
    return value;
  }
}
