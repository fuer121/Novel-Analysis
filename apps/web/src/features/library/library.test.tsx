// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppRouter } from "../../app/router.js";
import { setCsrfToken } from "../../shared/csrf-memory.js";

const user = { id: "00000000-0000-4000-8000-000000000001", displayName: "测试成员", role: "member" as const };
const admin = { ...user, displayName: "测试管理员", role: "admin" as const };
const book = { id: "00000000-0000-4000-8000-000000000010", title: "山海长卷", status: "active", chapterCount: 12, createdAt: "2026-07-20T00:00:00.000Z" };
const group = { id: "00000000-0000-4000-8000-000000000020", key: "creatures", name: "异兽事实", categoryScope: "magical_creature", status: "active" };
const preview = { total: 12, fresh: 3, missing: 6, failed: 1, stale: 2, executable: 9, skipped: 3, scopeHash: "a".repeat(64) };

class FakeEventSource { static instance: FakeEventSource; onmessage: ((event: MessageEvent<string>) => void) | null = null; onerror = null; close = vi.fn(); constructor() { FakeEventSource.instance = this; } }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
function renderPath(path: string, currentUser: { id: string; displayName: string; role: "admin" | "member" } = user) { const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }); client.setQueryData(["current-user"], currentUser); return { client, ...render(<QueryClientProvider client={client}><AppRouter initialEntries={[path]} /></QueryClientProvider>) }; }

describe("book workspace", () => {
  beforeEach(() => { setCsrfToken("csrf"); vi.stubGlobal("EventSource", FakeEventSource); });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it("lists and creates a book before entering its persistent workspace", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/books" && init?.method === "POST") return json({ book }, 201);
      if (url === "/api/books") return json({ books: [] });
      if (url === `/api/books/${book.id}`) return json({ book });
      if (url.endsWith("/l1-coverage")) return json({ total: 12, fresh: 3, missing: 6, failed: 1, stale: 2 });
      throw new Error(`unexpected ${url}`);
    }));
    renderPath("/books");
    await userEvent.click(await screen.findByRole("button", { name: "新建书籍" }));
    await userEvent.type(screen.getByLabelText("书名"), book.title);
    await userEvent.type(screen.getByLabelText("Dify 数据源 ID"), "42");
    await userEvent.click(screen.getByRole("button", { name: "创建并进入" }));
    expect(await screen.findByRole("heading", { name: book.title })).toBeTruthy();
    expect(screen.getByRole("link", { name: "导入" }).getAttribute("href")).toContain(`/books/${book.id}/import`);
  });

  it("shows admins persistent rebuild progress and reorders only untouched waiting books", async () => {
    const firstId = "00000000-0000-4000-8000-000000000061";
    const secondId = "00000000-0000-4000-8000-000000000062";
    const detail = {
      job: {
        id: "00000000-0000-4000-8000-000000000060",
        type: "library-rebuild",
        status: "queued",
        requestedBy: admin.id,
        scope: { target: "all" },
        progress: { total: 2, completed: 0, failed: 0, skipped: 0, current: "" },
        createdAt: book.createdAt,
        updatedAt: book.createdAt,
      },
      steps: [
        { id: firstId, position: 0, status: "queued", attemptCount: 0, bookTitle: "第一本", ref: { bookId: book.id, stage: "waiting" }, failureCode: null },
        { id: secondId, position: 1, status: "queued", attemptCount: 0, bookTitle: "第二本", ref: { bookId: "00000000-0000-4000-8000-000000000099", stage: "waiting" }, failureCode: null },
      ],
    };
    let reorderedBody = "";
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/books") return json({ books: [] });
      if (url === "/api/admin/library-rebuilds/current") return json({ detail });
      if (url.endsWith("/order") && init?.method === "PUT") {
        reorderedBody = String(init.body);
        return json({ detail: { ...detail, steps: [...detail.steps].reverse().map((step, position) => ({ ...step, position })) } });
      }
      throw new Error(`unexpected ${url}`);
    }));
    renderPath("/books", admin);
    expect(await screen.findByRole("heading", { name: "索引重建队列" })).toBeTruthy();
    expect(await screen.findByText("0 / 2")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "上移 第二本" }));
    expect(JSON.parse(reorderedBody)).toEqual({ orderedStepIds: [secondId, firstId] });
    expect((await screen.findAllByText(/本$/))[0]?.textContent).toContain("第二本");
    expect(screen.queryByRole("button", { name: /跳过校验/ })).toBeNull();
  });

  it("keeps analysis entries visible but blocks them until readiness refetch unlocks", async () => {
    let readinessCalls = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === `/api/books/${book.id}`) return json({ book });
      if (url.endsWith("/analysis-readiness")) {
        readinessCalls += 1;
        return json(readinessCalls === 1
          ? { state: "building_l2", chapterTotal: 12, l1Fresh: 12, l2Fresh: 6, progressPercent: 75, analysisAvailable: false, blockingCode: "l2_incomplete" }
          : { state: "available", chapterTotal: 12, l1Fresh: 12, l2Fresh: 12, progressPercent: 100, analysisAvailable: true, blockingCode: null });
      }
      if (url.endsWith("/l1-coverage")) return json({ total: 12, fresh: 3, missing: 6, failed: 1, stale: 2 });
      throw new Error(`unexpected ${url}`);
    }));
    const { client } = renderPath(`/books/${book.id}/overview`);
    const query = await screen.findByRole("link", { name: /连续提问/ });
    const analysis = screen.getByRole("link", { name: /高级分析/ });
    expect(query.getAttribute("aria-disabled")).toBe("true");
    expect(analysis.getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByText("索引重建中")).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("value")).toBe("75");
    const readinessSlot = screen.getByText("索引重建中").parentElement;
    await userEvent.click(query);
    expect(window.location.pathname).not.toContain("/query");
    await client.invalidateQueries({ queryKey: ["analysis-readiness", book.id] });
    await waitFor(() => expect(query.getAttribute("aria-disabled")).toBeNull());
    expect(screen.queryByText("索引重建中")).toBeNull();
    expect(readinessSlot?.isConnected).toBe(true);
    expect(readinessSlot?.textContent).toBe("");
  });

  it("blocks analysis navigation immediately while readiness is pending", async () => {
    let resolveReadiness: ((response: Response) => void) | undefined;
    const pendingReadiness = new Promise<Response>((resolve) => { resolveReadiness = resolve; });
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === `/api/books/${book.id}`) return json({ book });
      if (url.endsWith("/analysis-readiness")) return pendingReadiness;
      if (url.endsWith("/l1-coverage")) return json({ total: 12, fresh: 3, missing: 6, failed: 1, stale: 2 });
      throw new Error(`unexpected ${url}`);
    }));
    renderPath(`/books/${book.id}/overview`);
    const query = await screen.findByRole("link", { name: /连续提问/ });
    expect(query.getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByRole("link", { name: /高级分析/ }).getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByText("索引重建中")).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("value")).toBe("0");
    await userEvent.click(query);
    expect(screen.getByRole("heading", { name: "索引概况" })).toBeTruthy();
    resolveReadiness?.(json({ state: "available", chapterTotal: 12, l1Fresh: 12, l2Fresh: 12, progressPercent: 100, analysisAvailable: true, blockingCode: null }));
  });

  it("keeps analysis navigation locked when readiness fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === `/api/books/${book.id}`) return json({ book });
      if (url.endsWith("/analysis-readiness")) return json({ error: "internal_error" }, 500);
      if (url.endsWith("/l1-coverage")) return json({ total: 12, fresh: 3, missing: 6, failed: 1, stale: 2 });
      throw new Error(`unexpected ${url}`);
    }));
    renderPath(`/books/${book.id}/overview`);
    const query = await screen.findByRole("link", { name: /连续提问/ });
    await waitFor(() => expect(screen.getByText("索引重建中")).toBeTruthy());
    expect(query.getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByRole("link", { name: /高级分析/ }).getAttribute("aria-disabled")).toBe("true");
    await userEvent.click(query);
    expect(screen.getByRole("heading", { name: "索引概况" })).toBeTruthy();
  });

  it("requires preview and reconfirmation when the server reports scope_changed", async () => {
    let submissions = 0;
    const keys: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === `/api/books/${book.id}`) return json({ book });
      if (url.endsWith("/l1-coverage")) return json({ total: 12, fresh: 3, missing: 6, failed: 1, stale: 2 });
      if (url.endsWith("/l1-preview")) return json(preview);
      if (url.endsWith("/l1-jobs") && init?.method === "POST") { submissions += 1; keys.push(new Headers(init.headers).get("Idempotency-Key")!); return json({ error: "scope_changed" }, 409); }
      throw new Error(`unexpected ${url}`);
    }));
    renderPath(`/books/${book.id}/l1`);
    expect(screen.queryByRole("button", { name: /确认执行/ })).toBeNull();
    await userEvent.click(await screen.findByRole("button", { name: "预览范围" }));
    expect(await screen.findByText("9", { selector: "dd" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "确认执行 9 项" }));
    expect(await screen.findByText("范围已变化，请重新预览并确认")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /确认执行/ })).toBeNull();
    expect(submissions).toBe(1);
    await userEvent.click(screen.getByRole("button", { name: "预览范围" }));
    await userEvent.click(await screen.findByRole("button", { name: "确认执行 9 项" }));
    await waitFor(() => expect(submissions).toBe(2));
    expect(keys[1]).not.toBe(keys[0]);
  });

  it("creates an import job only after a successful preview and explicit confirmation", async () => {
    const job = { id: "00000000-0000-4000-8000-000000000050", type: "import", status: "queued", requestedBy: user.id, scope: { bookId: book.id }, progress: { total: 9, completed: 0, failed: 0, skipped: 0, current: "" }, createdAt: book.createdAt, updatedAt: book.createdAt };
    let submittedBody = "";
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === `/api/books/${book.id}`) return json({ book });
      if (url.endsWith("/import-preview")) return json({ requested: 12, existingFresh: 2, existingStale: 1, executable: 9, scopeHash: preview.scopeHash });
      if (url.endsWith("/import-jobs")) { submittedBody = String(init?.body); return json({ job }, 201); }
      throw new Error(`unexpected ${url}`);
    }));
    renderPath(`/books/${book.id}/import`);
    expect(screen.queryByRole("button", { name: /确认执行/ })).toBeNull();
    await userEvent.click(await screen.findByRole("button", { name: "预览范围" }));
    expect(screen.getByText("请求").nextElementSibling?.textContent).toBe("12");
    expect(screen.getByText("将跳过").nextElementSibling?.textContent).toBe("3");
    expect(screen.getByText("已有新鲜内容").nextElementSibling?.textContent).toBe("2");
    expect(screen.getByText("已有过期内容").nextElementSibling?.textContent).toBe("1");
    expect(screen.queryByText("缺失")).toBeNull();
    expect(screen.queryByText("失败")).toBeNull();
    expect(document.body.textContent).not.toContain("undefined");
    await userEvent.click(await screen.findByRole("button", { name: "确认执行 9 项" }));
    expect(await screen.findByText("任务已创建，", { exact: false })).toBeTruthy();
    expect(JSON.parse(submittedBody)).toMatchObject({ scopeHash: preview.scopeHash, autoStartL1: true });
  });

  it("paginates fact review and invalidates library projections on SSE", async () => {
    let bookCalls = 0;
    const fact = (id: string, body: string) => ({ id, chapterId: "00000000-0000-4000-8000-000000000030", chapterIndex: 1, subjectKey: "white-deer", factType: "event", body, metadata: { category: "event" }, createdAt: "2026-07-20T00:00:00.000Z" });
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === `/api/books/${book.id}`) { bookCalls += 1; return json({ book }); }
      if (url.endsWith("/index-groups")) return json({ indexGroups: [group] });
      if (url.endsWith("/coverage")) return json({ total: 12, fresh: 3, missing: 6, failed: 1, stale: 2 });
      if (url.includes("/facts?limit=20&cursor=")) return json({ facts: [fact("00000000-0000-4000-8000-000000000042", "第二页事实")], nextCursor: null });
      if (url.includes("/facts?limit=20")) return json({ facts: [fact("00000000-0000-4000-8000-000000000041", "第一页事实")], nextCursor: "00000000-0000-4000-8000-000000000041" });
      throw new Error(`unexpected ${url}`);
    }));
    renderPath(`/books/${book.id}/l2`);
    expect(await screen.findByText("第一页事实")).toBeTruthy();
    expect((screen.getByLabelText("结束章节") as HTMLInputElement).value).toBe(String(book.chapterCount));
    await userEvent.click(screen.getByRole("button", { name: "下一页" }));
    expect(await screen.findByText("第二页事实")).toBeTruthy();
    FakeEventSource.instance.onmessage?.(new MessageEvent("message", { data: JSON.stringify({ jobId: "job" }) }));
    await waitFor(() => expect(bookCalls).toBeGreaterThan(1));
  });

  it("roundtrips an allowed book workspace destination through login completion", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/auth/me") return json({ user, csrfToken: "fresh" });
      if (url === `/api/books/${book.id}`) return json({ book });
      if (url.endsWith("/l1-coverage")) return json({ total: 12, fresh: 3, missing: 6, failed: 1, stale: 2 });
      throw new Error(`unexpected ${url}`);
    }));
    const login = renderPath(`/login?returnTo=/books/${book.id}/overview`);
    const loginHref = screen.getByRole("link", { name: "使用飞书登录" }).getAttribute("href")!;
    expect(new URL(loginHref, "http://app.test").searchParams.get("returnTo")).toBe(`/auth/complete?returnTo=${encodeURIComponent(`/books/${book.id}/overview`)}`);
    login.unmount();
    const completeClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    completeClient.setQueryData(["book", "prior-book", "group", "prior-group", "facts", "first"], { facts: [{ body: "prior-user-plaintext" }] });
    render(<QueryClientProvider client={completeClient}><AppRouter initialEntries={[`/auth/complete?returnTo=${encodeURIComponent(`/books/${book.id}/overview`)}`]} /></QueryClientProvider>);
    expect(await screen.findByRole("heading", { name: book.title })).toBeTruthy();
    expect(completeClient.getQueryData(["book", "prior-book", "group", "prior-group", "facts", "first"])).toBeUndefined();
  });

  it("keeps the initial L2 range valid for a book without imported chapters", async () => {
    const emptyBook = { ...book, chapterCount: 0 };
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === `/api/books/${book.id}`) return json({ book: emptyBook });
      if (url.endsWith("/index-groups")) return json({ indexGroups: [group] });
      if (url.endsWith("/coverage")) return json({ total: 0, fresh: 0, missing: 0, failed: 0, stale: 0 });
      if (url.includes("/facts?limit=20")) return json({ facts: [], nextCursor: null });
      throw new Error(`unexpected ${url}`);
    }));
    renderPath(`/books/${book.id}/l2`);
    expect((await screen.findByLabelText("结束章节") as HTMLInputElement).value).toBe("1");
  });

  it("reuses one idempotency key for uncertain submit retries and rotates after a fresh preview", async () => {
    const keys: string[] = [];
    let submitAttempt = 0;
    const job = { id: "00000000-0000-4000-8000-000000000050", type: "import", status: "queued", requestedBy: user.id, scope: { bookId: book.id }, progress: { total: 9, completed: 0, failed: 0, skipped: 0, current: "" }, createdAt: book.createdAt, updatedAt: book.createdAt };
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === `/api/books/${book.id}`) return json({ book });
      if (url.endsWith("/import-preview")) return json({ requested: 12, existingFresh: 2, existingStale: 1, executable: 9, scopeHash: preview.scopeHash });
      if (url.endsWith("/import-jobs")) { keys.push(new Headers(init?.headers).get("Idempotency-Key")!); submitAttempt += 1; return submitAttempt === 1 ? json({ error: "internal_error" }, 500) : json({ job }, 201); }
      throw new Error(`unexpected ${url}`);
    }));
    renderPath(`/books/${book.id}/import`);
    await userEvent.click(await screen.findByRole("button", { name: "预览范围" }));
    await userEvent.click(await screen.findByRole("button", { name: "确认执行 9 项" }));
    expect(await screen.findByText("提交结果未确认，请使用同一范围重试")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "确认执行 9 项" }));
    expect(await screen.findByText("任务已创建，", { exact: false })).toBeTruthy();
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
    await userEvent.click(screen.getByRole("button", { name: "预览范围" }));
    await userEvent.click(await screen.findByRole("button", { name: "确认执行 9 项" }));
    await waitFor(() => expect(keys).toHaveLength(3));
    expect(keys[2]).not.toBe(keys[1]);
  });

  it("shows retry actions for overview and L2 query failures", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === `/api/books/${book.id}`) return json({ book });
      if (url.endsWith("/l1-coverage")) return json({ error: "internal_error" }, 500);
      throw new Error(`unexpected ${url}`);
    }));
    const overview = renderPath(`/books/${book.id}/overview`);
    expect(await screen.findByText("覆盖情况读取失败")).toBeTruthy();
    expect(screen.getByRole("button", { name: "重试覆盖情况" })).toBeTruthy();
    overview.unmount();
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input) === `/api/books/${book.id}` ? json({ book }) : json({ error: "internal_error" }, 500)));
    renderPath(`/books/${book.id}/l2`);
    expect(await screen.findByText("索引组读取失败")).toBeTruthy();
    expect(screen.getByRole("button", { name: "重试索引组" })).toBeTruthy();
  });

  it("shows a retry action when L2 coverage fails after groups load", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === `/api/books/${book.id}`) return json({ book });
      if (url.endsWith("/index-groups")) return json({ indexGroups: [group] });
      if (url.endsWith("/coverage")) return json({ error: "internal_error" }, 500);
      if (url.includes("/facts?limit=20")) return json({ facts: [], nextCursor: null });
      throw new Error(`unexpected ${url}`);
    }));
    renderPath(`/books/${book.id}/l2`);
    expect(await screen.findByText("L2 覆盖情况读取失败")).toBeTruthy();
    expect(screen.getByRole("button", { name: "重试 L2 覆盖情况" })).toBeTruthy();
  });
});
