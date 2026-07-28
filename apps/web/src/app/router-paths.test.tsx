// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { AppRouter } from "./router.js";

class FakeEventSource {
  onmessage = null;
  onerror = null;
  close() {}
}

beforeEach(() => vi.stubGlobal("EventSource", FakeEventSource));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderPath(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["current-user"], { id: "user-1", displayName: "测试成员", role: "member" });
  client.setQueryData(["book", "book-1"], {
    book: { id: "book-1", title: "测试书籍", status: "active", chapterCount: 1, createdAt: "2026-07-28T00:00:00.000Z" },
  });
  client.setQueryData(["analysis-readiness", "book-1"], {
    requiredIndexGroups: [],
    readyIndexGroups: [],
    missingIndexGroups: [],
  });
  client.setQueryData(["book", "book-1", "l1-coverage"], {
    total: 1,
    fresh: 1,
    missing: 0,
    failed: 0,
    stale: 0,
  });
  return render(
    <QueryClientProvider client={client}>
      <AppRouter initialEntries={[path]} />
    </QueryClientProvider>,
  );
}

it.each([
  ["/LOGIN", "登录团队工作区"],
  ["/%6cogin", "登录团队工作区"],
  ["/books/book-1/%6fverview", "索引概况"],
])("matches decoded static path segments case-insensitively: %s", (path, heading) => {
  renderPath(path);

  expect(screen.getByRole("heading", { name: heading })).toBeTruthy();
});

it("renders the safe unknown route for malformed encoded parameters", () => {
  renderPath("/tasks/%");

  expect(screen.getByRole("heading", { name: "页面不存在" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "返回任务中心" }).getAttribute("href")).toBe("/tasks");
});

it.each(["__proto__", "constructor"])("renders the safe unknown route for an undeclared inherited tab: %s", (tab) => {
  renderPath(`/books/book-1/${tab}`);

  expect(screen.getByRole("heading", { name: "页面不存在" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "返回任务中心" }).getAttribute("href")).toBe("/tasks");
});
