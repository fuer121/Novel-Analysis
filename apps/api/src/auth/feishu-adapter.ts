export interface FeishuIdentity {
  unionId: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface FeishuOAuthAdapter {
  authorizationUrl(input: { state: string; redirectUri: string }): URL;
  exchangeCode(input: { code: string; redirectUri: string }): Promise<FeishuIdentity>;
}
