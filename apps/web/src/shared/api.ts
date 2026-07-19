import { clearCsrfToken, getCsrfToken, setCsrfToken } from "./csrf-memory.js";

export interface CurrentUser {
  id: string;
  displayName: string;
  role: "admin" | "member";
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
    this.name = "ApiError";
  }
}

type SessionExpiredListener = () => void;
const sessionExpiredListeners = new Set<SessionExpiredListener>();
let currentUserRefresh: Promise<CurrentUser> | null = null;

export function subscribeSessionExpired(listener: SessionExpiredListener): () => void {
  sessionExpiredListeners.add(listener);
  return () => sessionExpiredListeners.delete(listener);
}

function expireSession(): void {
  clearCsrfToken();
  for (const listener of sessionExpiredListeners) listener();
}

function apiUrl(path: string): string {
  return `/api${path.startsWith("/") ? path : `/${path}`}`;
}

async function responseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  return text ? JSON.parse(text) : undefined;
}

function errorCode(body: unknown): string {
  if (
    typeof body === "object"
    && body !== null
    && "error" in body
    && typeof body.error === "string"
  ) return body.error;
  return "request_failed";
}

export async function apiRead<T>(path: string): Promise<T> {
  const response = await fetch(apiUrl(path), { credentials: "same-origin" });
  const body = await responseBody(response);
  if (!response.ok) {
    if (response.status === 401) expireSession();
    throw new ApiError(response.status, errorCode(body));
  }
  return body as T;
}

export function refreshCurrentUser(): Promise<CurrentUser> {
  currentUserRefresh ??= apiRead<{ user: CurrentUser; csrfToken: string }>("/auth/me")
    .then((result) => {
      setCsrfToken(result.csrfToken);
      return result.user;
    })
    .finally(() => {
      currentUserRefresh = null;
    });
  return currentUserRefresh;
}

async function performWrite(
  path: string,
  init: RequestInit,
  idempotencyKey: string,
): Promise<{ response: Response; csrfToken: string }> {
  const csrf = getCsrfToken();
  if (!csrf) throw new ApiError(403, "csrf_missing");
  const headers = new Headers(init.headers);
  headers.set("X-CSRF-Token", csrf);
  headers.set("Idempotency-Key", idempotencyKey);
  if (init.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(apiUrl(path), {
    ...init,
    credentials: "same-origin",
    headers,
  });
  return { response, csrfToken: csrf };
}

export async function apiWrite<T>(
  path: string,
  init: RequestInit,
  idempotencyKey: string = crypto.randomUUID(),
): Promise<T> {
  let attempt = await performWrite(path, init, idempotencyKey);
  let response = attempt.response;
  let body = await responseBody(response);
  if (!response.ok && response.status === 403 && errorCode(body) === "CSRF_STALE") {
    if (getCsrfToken() === attempt.csrfToken) await refreshCurrentUser();
    attempt = await performWrite(path, init, idempotencyKey);
    response = attempt.response;
    body = await responseBody(response);
  }
  if (!response.ok) {
    if (response.status === 401) expireSession();
    throw new ApiError(response.status, errorCode(body));
  }
  return body as T;
}

export function forgetSession(): void {
  clearCsrfToken();
}
