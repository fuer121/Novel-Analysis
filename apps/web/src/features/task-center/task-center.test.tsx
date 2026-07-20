// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { URL as NodeUrl } from "node:url";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppShell } from "../../app/AppShell.js";
import { AppRouter } from "../../app/router.js";
import { apiWrite } from "../../shared/api.js";
import { clearCsrfToken, getCsrfToken, setCsrfToken } from "../../shared/csrf-memory.js";

const member = { id: "00000000-0000-4000-8000-000000000001", displayName: "测试成员", role: "member" as const };
const admin = { ...member, displayName: "管理员", role: "admin" as const };
const job = {
  id: "00000000-0000-4000-8000-000000000002",
  type: "query",
  status: "queued",
  requestedBy: member.id,
  scope: { bookId: "phase-1-example" },
  progress: { total: 2, completed: 0, failed: 0, skipped: 0, current: "等待执行" },
  createdAt: "2026-07-19T00:00:00.000Z",
  updatedAt: "2026-07-19T00:00:00.000Z",
};

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: (() => void) | null = null;
  close = vi.fn();

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  emit(data: unknown) {
    this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(data) }));
  }

  fail() {
    this.onerror?.();
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function renderRouter(path: string, queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
})) {
  return render(
    <QueryClientProvider client={queryClient}>
      <AppRouter initialEntries={[path]} />
    </QueryClientProvider>,
  );
}

describe("persisted task center", () => {
  beforeEach(() => {
    clearCsrfToken();
    FakeEventSource.instances = [];
    vi.stubGlobal("EventSource", FakeEventSource);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("contains wide tables without allowing their width to escape the scroll wrapper", () => {
    const styles = readFileSync(new NodeUrl("../../app/styles.css", import.meta.url), "utf8");
    const wrapperRule = styles.match(/\.data-table-wrap\s*\{([^}]*)\}/)?.[1] ?? "";
    const screenReaderRule = styles.match(/\.sr-only\s*\{([^}]*)\}/)?.[1] ?? "";

    expect(wrapperRule).toMatch(/min-width:\s*0/);
    expect(wrapperRule).toMatch(/overflow-x:\s*auto/);
    expect(screenReaderRule).toMatch(/left:\s*0/);
    expect(screenReaderRule).toMatch(/top:\s*0/);
  });

  it("completes login by storing rotated CSRF in memory and replacing a validated return path", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/auth/me") return json({ user: member, csrfToken: "csrf-after-login" });
      if (url === "/api/jobs") return json({ jobs: [job], nextCursor: null });
      throw new Error(`unexpected fetch ${url}`);
    }));

    renderRouter("/auth/complete?returnTo=/tasks");

    expect(await screen.findByRole("heading", { name: "任务中心" })).toBeTruthy();
    expect(getCsrfToken()).toBe("csrf-after-login");
  });

  it("creates a task, reloads server data, and invalidates list and detail caches on SSE", async () => {
    setCsrfToken("csrf-current");
    let listCalls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/auth/me") return json({ user: member, csrfToken: "csrf-current" });
      if (url === "/api/jobs" && !init?.method) {
        listCalls += 1;
        return json({ jobs: [job], nextCursor: null });
      }
      if (url === "/api/jobs/example") return json({ job }, 201);
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    queryClient.setQueryData(["current-user"], member);
    queryClient.setQueryData(["job", job.id], { job });

    renderRouter("/tasks", queryClient);
    expect(await screen.findByText("等待执行")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "新建示例任务" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/jobs/example",
      expect.objectContaining({ method: "POST", credentials: "same-origin" }),
    ));

    FakeEventSource.instances[0]!.emit({ id: 1, jobId: job.id, type: "progress" });
    await waitFor(() => expect(listCalls).toBeGreaterThan(1));
    expect(queryClient.getQueryState(["job", job.id])?.isInvalidated).toBe(true);
  });

  it("shows member management navigation only to admins", () => {
    const memberClient = new QueryClient();
    memberClient.setQueryData(["current-user"], member);
    const adminClient = new QueryClient();
    adminClient.setQueryData(["current-user"], admin);

    const memberView = render(
      <QueryClientProvider client={memberClient}>
        <MemoryRouter><AppShell /></MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.queryByRole("link", { name: "成员管理" })).toBeNull();
    memberView.unmount();
    render(
      <QueryClientProvider client={adminClient}>
        <MemoryRouter><AppShell /></MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getByRole("link", { name: "成员管理" })).toBeTruthy();
  });

  it("refreshes CSRF at most once and retries with the same idempotency key", async () => {
    setCsrfToken("stale-token");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ error: "CSRF_STALE" }, 403))
      .mockResolvedValueOnce(json({ user: member, csrfToken: "fresh-token" }))
      .mockResolvedValueOnce(json({ job }, 201));
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiWrite("/jobs/example", { method: "POST" }, "stable-key")).resolves.toEqual({ job });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/jobs/example");
    expect(fetchMock.mock.calls[1]![0]).toBe("/api/auth/me");
    expect(fetchMock.mock.calls[2]![0]).toBe("/api/jobs/example");
    expect(new Headers(fetchMock.mock.calls[0]![1]!.headers).get("Idempotency-Key")).toBe("stable-key");
    expect(new Headers(fetchMock.mock.calls[2]![1]!.headers).get("Idempotency-Key")).toBe("stable-key");
    expect(getCsrfToken()).toBe("fresh-token");
  });

  it("shares one CSRF refresh across concurrent stale writes and preserves each request", async () => {
    setCsrfToken("stale-token");
    const attempts = new Map<string, number>();
    let meCalls = 0;
    let releaseRefresh!: () => void;
    const refreshGate = new Promise<void>((resolve) => { releaseRefresh = resolve; });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/auth/me") {
        meCalls += 1;
        await refreshGate;
        return json({ user: member, csrfToken: "fresh-token" });
      }
      const key = new Headers(init?.headers).get("Idempotency-Key")!;
      const count = (attempts.get(key) ?? 0) + 1;
      attempts.set(key, count);
      if (count === 1) return json({ error: "CSRF_STALE" }, 403);
      return json({ job });
    });
    vi.stubGlobal("fetch", fetchMock);

    const first = apiWrite("/jobs/example", {
      method: "POST",
      headers: { "X-Request-Label": "first" },
      body: '{"source":"first"}',
    }, "first-key");
    const second = apiWrite("/jobs/example", {
      method: "POST",
      headers: { "X-Request-Label": "second" },
      body: '{"source":"second"}',
    }, "second-key");
    await waitFor(() => expect(meCalls).toBe(1));
    releaseRefresh();
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);

    expect(meCalls).toBe(1);
    expect(attempts).toEqual(new Map([["first-key", 2], ["second-key", 2]]));
    const writeCalls = fetchMock.mock.calls.filter(([url]) => url === "/api/jobs/example");
    expect(writeCalls.filter(([, init]) => init?.body === '{"source":"first"}')).toHaveLength(2);
    expect(writeCalls.filter(([, init]) => init?.body === '{"source":"second"}')).toHaveLength(2);
    expect(writeCalls.filter(([, init]) => new Headers(init?.headers).get("X-Request-Label") === "first")).toHaveLength(2);
    expect(writeCalls.filter(([, init]) => new Headers(init?.headers).get("X-Request-Label") === "second")).toHaveLength(2);
  });

  it("does not refresh again when a staggered stale response used the previous CSRF token", async () => {
    setCsrfToken("stale-token");
    let currentServerToken = "stale-token";
    let meCalls = 0;
    let releaseSecondStale!: () => void;
    let releaseFirstReplay!: () => void;
    const secondStaleGate = new Promise<void>((resolve) => { releaseSecondStale = resolve; });
    const firstReplayGate = new Promise<void>((resolve) => { releaseFirstReplay = resolve; });
    const attempts = new Map<string, number>();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/auth/me") {
        meCalls += 1;
        currentServerToken = `fresh-token-${meCalls}`;
        return json({ user: member, csrfToken: currentServerToken });
      }
      const headers = new Headers(init?.headers);
      const key = headers.get("Idempotency-Key")!;
      const csrf = headers.get("X-CSRF-Token");
      const count = (attempts.get(key) ?? 0) + 1;
      attempts.set(key, count);
      if (count === 1) {
        if (key === "second-key") await secondStaleGate;
        return json({ error: "CSRF_STALE" }, 403);
      }
      if (key === "first-key") await firstReplayGate;
      return csrf === currentServerToken ? json({ job }) : json({ error: "CSRF_STALE" }, 403);
    });
    vi.stubGlobal("fetch", fetchMock);

    const first = apiWrite("/jobs/example", { method: "POST" }, "first-key");
    const second = apiWrite("/jobs/example", { method: "POST" }, "second-key");
    await waitFor(() => expect(meCalls).toBe(1));
    await waitFor(() => expect(attempts.get("first-key")).toBe(2));
    releaseSecondStale();
    await expect(second).resolves.toEqual({ job });
    releaseFirstReplay();
    await expect(first).resolves.toEqual({ job });

    expect(meCalls).toBe(1);
    expect(attempts).toEqual(new Map([["first-key", 2], ["second-key", 2]]));
  });

  it("replays with a newer independently installed CSRF token without refreshing", async () => {
    setCsrfToken("initial-token");
    let releaseStale!: () => void;
    const staleGate = new Promise<void>((resolve) => { releaseStale = resolve; });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/auth/me") throw new Error("unexpected refresh");
      const csrf = new Headers(init?.headers).get("X-CSRF-Token");
      if (csrf === "initial-token") {
        await staleGate;
        return json({ error: "CSRF_STALE" }, 403);
      }
      return csrf === "newer-token" ? json({ job }) : json({ error: "invalid token" }, 403);
    });
    vi.stubGlobal("fetch", fetchMock);

    const pending = apiWrite("/jobs/example", { method: "POST" }, "different-token");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    setCsrfToken("newer-token");
    releaseStale();

    await expect(pending).resolves.toEqual({ job });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not refresh or replay a stale write more than once", async () => {
    setCsrfToken("stale-token");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ error: "CSRF_STALE" }, 403))
      .mockResolvedValueOnce(json({ user: member, csrfToken: "fresh-token" }))
      .mockResolvedValueOnce(json({ error: "CSRF_STALE" }, 403));
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiWrite("/jobs/example", { method: "POST" }, "one-replay"))
      .rejects.toMatchObject({ status: 403, code: "CSRF_STALE" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/auth/me")).toHaveLength(1);
  });

  it("clears session memory and replaces to login with the protected route after an API 401", async () => {
    setCsrfToken("csrf-current");
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/jobs") return json({ error: "unauthorized" }, 401);
      throw new Error(`unexpected fetch ${String(input)}`);
    }));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(["current-user"], member);
    queryClient.setQueryData(["book", "prior-book", "group", "prior-group", "facts", "first"], { facts: [{ body: "prior-session-plaintext" }] });

    renderRouter("/tasks", queryClient);

    expect(await screen.findByRole("heading", { name: "登录团队工作区" })).toBeTruthy();
    expect(getCsrfToken()).toBeNull();
    expect(queryClient.getQueryData(["book", "prior-book", "group", "prior-group", "facts", "first"])).toBeUndefined();
    const loginHref = screen.getByRole("link", { name: "使用飞书登录" }).getAttribute("href")!;
    expect(new URL(loginHref, "http://app.test").searchParams.get("returnTo"))
      .toBe("/auth/complete?returnTo=%2Ftasks");
  });

  it("rechecks /me after a successful SSE auth check and enters login when the session later expires", async () => {
    setCsrfToken("csrf-current");
    let meCalls = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/jobs") return json({ jobs: [job], nextCursor: null });
      if (url === "/api/auth/me") {
        meCalls += 1;
        if (meCalls === 1) return json({ user: member, csrfToken: "csrf-refreshed" });
        return json({ error: "unauthorized" }, 401);
      }
      throw new Error(`unexpected fetch ${url}`);
    }));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(["current-user"], member);

    renderRouter(`/tasks/${job.id}`, queryClient);
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    FakeEventSource.instances[0]!.fail();
    await waitFor(() => expect(meCalls).toBe(1));
    expect(getCsrfToken()).toBe("csrf-refreshed");
    FakeEventSource.instances[0]!.fail();

    expect(await screen.findByRole("heading", { name: "登录团队工作区" })).toBeTruthy();
    expect(meCalls).toBe(2);
    expect(FakeEventSource.instances[0]!.close).toHaveBeenCalled();
    expect(getCsrfToken()).toBeNull();
  });

  it("shares one in-flight auth check across concurrent SSE errors", async () => {
    setCsrfToken("csrf-current");
    let meCalls = 0;
    let releaseCheck!: () => void;
    const checkGate = new Promise<void>((resolve) => { releaseCheck = resolve; });
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/jobs") return json({ jobs: [job], nextCursor: null });
      if (url === "/api/auth/me") {
        meCalls += 1;
        await checkGate;
        return json({ user: member, csrfToken: "csrf-refreshed" });
      }
      throw new Error(`unexpected fetch ${url}`);
    }));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(["current-user"], member);

    const view = renderRouter(`/tasks/${job.id}`, queryClient);
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    FakeEventSource.instances[0]!.fail();
    FakeEventSource.instances[0]!.fail();
    FakeEventSource.instances[0]!.fail();
    await waitFor(() => expect(meCalls).toBe(1));

    releaseCheck();
    await waitFor(() => expect(getCsrfToken()).toBe("csrf-refreshed"));
    expect(meCalls).toBe(1);
    view.unmount();
    expect(FakeEventSource.instances[0]!.close).toHaveBeenCalled();
  });

  it("protects the current admin and confirms changes to other members", async () => {
    setCsrfToken("csrf-current");
    const other = { ...member, id: "00000000-0000-4000-8000-000000000003", displayName: "其他成员" };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/admin/members" && !init?.method) {
        return json({ members: [admin, other].map((user) => ({ ...user, avatarUrl: null, status: "active" })) });
      }
      if (String(input).startsWith("/api/admin/members/")) {
        return json({ member: { ...other, avatarUrl: null, status: "disabled" } });
      }
      throw new Error(`unexpected fetch ${String(input)}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(["current-user"], admin);

    renderRouter("/admin/members", queryClient);
    const selfProtection = await screen.findByText("当前账号不可修改");
    const selfRow = selfProtection.closest("tr")!;
    expect(within(selfRow).queryByRole("button")).toBeNull();
    const otherRow = screen.getByText("其他成员").closest("tr")!;
    await userEvent.click(within(otherRow).getByRole("button", { name: "停用" }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls.some(([url, init]) => String(url).includes(other.id) && init?.method === "PATCH")).toBe(false);

    confirm.mockReturnValue(true);
    await userEvent.click(within(otherRow).getByRole("button", { name: "停用" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(
      ([url, init]) => String(url).includes(other.id) && init?.method === "PATCH",
    )).toBe(true));
  });

  it("renders a Chinese safe return for unknown routes", async () => {
    renderRouter("/unknown");
    expect(await screen.findByRole("heading", { name: "页面不存在" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "返回任务中心" }).getAttribute("href")).toBe("/tasks");
  });
});
