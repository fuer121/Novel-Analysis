// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppRouter } from "../../app/router.js";
import { setCsrfToken } from "../../shared/csrf-memory.js";

const user = { id: "00000000-0000-4000-8000-000000000001", displayName: "测试成员", role: "member" };
const book = { id: "00000000-0000-4000-8000-000000000010", title: "山海长卷", status: "active", chapterCount: 12, createdAt: "2026-07-20T00:00:00.000Z" };
const group = { id: "00000000-0000-4000-8000-000000000020", key: "creatures", name: "异兽事实", categoryScope: "magical_creature", status: "active" };
const preview = { total: 12, fresh: 3, missing: 6, failed: 1, stale: 2, executable: 9, skipped: 3, scopeHash: "a".repeat(64) };

class FakeEventSource { static instance: FakeEventSource; onmessage: ((event: MessageEvent<string>) => void) | null = null; onerror = null; close = vi.fn(); constructor() { FakeEventSource.instance = this; } }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
function renderPath(path: string) { const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }); client.setQueryData(["current-user"], user); return { client, ...render(<QueryClientProvider client={client}><AppRouter initialEntries={[path]} /></QueryClientProvider>) }; }

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

  it("requires preview and reconfirmation when the server reports scope_changed", async () => {
    let submissions = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === `/api/books/${book.id}`) return json({ book });
      if (url.endsWith("/l1-coverage")) return json({ total: 12, fresh: 3, missing: 6, failed: 1, stale: 2 });
      if (url.endsWith("/l1-preview")) return json(preview);
      if (url.endsWith("/l1-jobs") && init?.method === "POST") { submissions += 1; return json({ error: "scope_changed" }, 409); }
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
    await userEvent.click(screen.getByRole("button", { name: "下一页" }));
    expect(await screen.findByText("第二页事实")).toBeTruthy();
    FakeEventSource.instance.onmessage?.(new MessageEvent("message", { data: JSON.stringify({ jobId: "job" }) }));
    await waitFor(() => expect(bookCalls).toBeGreaterThan(1));
  });
});
