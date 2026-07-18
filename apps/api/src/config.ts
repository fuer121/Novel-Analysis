import { z } from "zod";

export interface ApiConfig {
  appOrigin: string;
  oauthRedirectUri: string;
  sessionCookieName: string;
  oauthCorrelationCookieName: string;
  sessionCookieSecure: boolean;
  sessionTtlMs: number;
}

const environmentSchema = z.object({
  APP_ORIGIN: z.string().url(),
  FEISHU_REDIRECT_URI: z.string().url(),
  SESSION_TTL_MS: z.coerce.number().int().positive().default(8 * 60 * 60 * 1000),
}).strict();

export function loadApiConfig(environment: NodeJS.ProcessEnv): ApiConfig {
  const parsed = environmentSchema.parse({
    APP_ORIGIN: environment.APP_ORIGIN,
    FEISHU_REDIRECT_URI: environment.FEISHU_REDIRECT_URI,
    SESSION_TTL_MS: environment.SESSION_TTL_MS,
  });
  const origin = new URL(parsed.APP_ORIGIN);
  const redirect = new URL(parsed.FEISHU_REDIRECT_URI);
  if (origin.origin !== parsed.APP_ORIGIN || origin.protocol !== "https:") {
    throw new Error("APP_ORIGIN must be an exact HTTPS origin");
  }
  if (redirect.origin !== origin.origin) {
    throw new Error("FEISHU_REDIRECT_URI must use APP_ORIGIN");
  }

  return {
    appOrigin: parsed.APP_ORIGIN,
    oauthRedirectUri: parsed.FEISHU_REDIRECT_URI,
    sessionCookieName: "__Host-novel_session",
    oauthCorrelationCookieName: "__Host-novel_oauth_correlation",
    sessionCookieSecure: true,
    sessionTtlMs: parsed.SESSION_TTL_MS,
  };
}

export function assertCookieConfig(config: ApiConfig): void {
  const productionOrigin = new URL(config.appOrigin).protocol === "https:";
  if (config.oauthCorrelationCookieName === config.sessionCookieName) {
    throw new Error("OAuth correlation cookie must be separate from the session cookie");
  }
  if (
    productionOrigin
    && (config.sessionCookieName !== "__Host-novel_session" || !config.sessionCookieSecure)
  ) {
    throw new Error("Production session cookie must always be Secure");
  }
  if (
    productionOrigin
    && (config.oauthCorrelationCookieName !== "__Host-novel_oauth_correlation" || !config.sessionCookieSecure)
  ) {
    throw new Error("Production correlation cookie must always be Secure");
  }
  if (
    !productionOrigin
    && (config.sessionCookieName.startsWith("__Host-")
      || config.oauthCorrelationCookieName.startsWith("__Host-"))
  ) {
    throw new Error("HTTP integration must use a separate non-__Host- cookie name");
  }
}
