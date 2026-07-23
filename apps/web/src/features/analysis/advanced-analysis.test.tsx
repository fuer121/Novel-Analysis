// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppRouter } from "../../app/router.js";
import { setCsrfToken } from "../../shared/csrf-memory.js";
import { buildAnalysisExport, tableViewsFromJson } from "./analysis-export.js";

const ids = {
  user: "00000000-0000-4000-8000-000000000001",
  book: "00000000-0000-4000-8000-000000000010",
  group: "00000000-0000-4000-8000-000000000020",
  template: "00000000-0000-4000-8000-000000000030",
  templateVersion: "00000000-0000-4000-8000-000000000031",
  run: "00000000-0000-4000-8000-000000000040",
  job: "00000000-0000-4000-8000-000000000050",
  part: "00000000-0000-4000-8000-000000000060",
};
const now = "2026-07-22T06:00:00.000Z";
const user = { id: ids.user, displayName: "测试成员", role: "member" };
const book = { id: ids.book, title: "山海长卷", status: "active", chapterCount: 120, createdAt: now };
const group = { id: ids.group, key: "people", name: "人物事实", categoryScope: "general", status: "active" };
const template = { id: ids.template, bookId: ids.book, name: "人物弧光", currentVersionId: ids.templateVersion, indexGroupId: ids.group, createdAt: now, updatedAt: now };
const templateDetail = { ...template, prompt: "分析人物选择与变化", outputSchema: { type: "object", properties: { items: { type: "array" } } } };
const runSummary = { id: ids.run, bookId: ids.book, templateVersionId: ids.templateVersion, jobId: ids.job, mode: "balanced", startChapter: 1, endChapter: 20, status: "running", completedParts: 1, totalParts: 4, createdAt: now, updatedAt: now };
const runDetail = { ...runSummary, parts: [{ id: ids.part, position: 1, kind: "chapter-review", status: "running", errorCode: null, createdAt: now, updatedAt: now }], result: null, diagnostics: [] };
const completedRun = { ...runDetail, status: "completed", completedParts: 4, result: { items: [{ name: "陈平安", turningPoint: "选择守城", chapters: [5, 8] }] }, parts: [{ ...runDetail.parts[0], status: "completed" }] };
const preview = {
  bookId: ids.book,
  templateVersionId: ids.templateVersion,
  mode: "balanced",
  startChapter: 1,
  endChapter: 20,
  chapterCount: 20,
  reviewChapterCount: 3,
  readsL1: true,
  readsL2: true,
  readsOriginalChapters: true,
  executionVersions: {
    workflow: { target: "analysis-summary", id: "00000000-0000-4000-8000-000000000070", contractVersion: "v1", dslHash: "dsl-v1" },
    model: "deepseek-chat",
    reasoningEffort: "workflow-default",
    executorVersion: "advanced-analysis-v1",
    l1SchemaVersion: "l1-v1",
    l2SchemaVersion: "l2-v1",
    l2AdmissionVersion: "admission-v1",
  },
  sourceSummary: {
    indexGroupId: ids.group,
    indexGroupConfigHash: "group-v1",
    chapterSourceVersions: ["chapter-v1"],
    l1: { selectedCount: 20, freshCount: 20 },
    l2: { selectedCount: 18, freshCount: 18 },
    readsL1: true,
    readsL2: true,
    readsOriginalChapters: true,
    reviewedChapterBoundary: { startChapter: 1, endChapter: 20, maximumChapterCount: 3 },
  },
  scopeHash: "a".repeat(64),
};
const legacy = { id: "legacy-fixture-1", bookId: ids.book, name: "旧版人物分析", startChapter: 1, endChapter: 10, status: "completed", readOnly: true, canResume: false, createdAt: now, updatedAt: now };

class FakeEventSource {
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror = null;
  close = vi.fn();
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
function renderPath(path = `/books/${ids.book}/analysis`) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  client.setQueryData(["current-user"], user);
  return { client, ...render(<QueryClientProvider client={client}><AppRouter initialEntries={[path]} /></QueryClientProvider>) };
}

function baseRead(url: string): Response | undefined {
  if (url === `/api/books/${ids.book}`) return json({ book });
  if (url === `/api/books/${ids.book}/analysis-readiness`) return json({ state: "available", chapterTotal: 120, l1Fresh: 120, l2Fresh: 120, progressPercent: 100, analysisAvailable: true, blockingCode: null });
  if (url === `/api/books/${ids.book}/index-groups`) return json({ indexGroups: [group] });
  if (url === `/api/books/${ids.book}/analysis-templates`) return json({ templates: [template] });
  if (url === `/api/books/${ids.book}/analysis-templates/${ids.template}`) return json({ template: templateDetail });
  if (url === `/api/books/${ids.book}/advanced-analysis`) return json({ runs: [runSummary] });
  if (url === `/api/books/${ids.book}/advanced-analysis/${ids.run}`) return json({ run: runDetail });
  if (url === `/api/books/${ids.book}/legacy-analysis`) return json({ analyses: [legacy] });
  if (url === `/api/books/${ids.book}/legacy-analysis/${legacy.id}`) return json({ analysis: { ...legacy, result: "# 旧版结论", diagnostics: ["fixture"] } });
  return undefined;
}

describe("book-scoped advanced analysis workspace", () => {
  beforeEach(() => {
    setCsrfToken("csrf");
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it("stays inside the selected book, exposes all modes, and restores server state after navigation", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input); urls.push(url);
      const response = baseRead(url);
      if (response) return response;
      if (url.endsWith("/l1-coverage")) return json({ total: 120, fresh: 120, missing: 0, failed: 0, stale: 0 });
      throw new Error(`unexpected ${url}`);
    }));
    renderPath();
    expect(await screen.findByRole("heading", { name: "高级分析" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: book.title })).toBeTruthy();
    expect(screen.queryByLabelText("选择书籍")).toBeNull();
    expect(screen.getByRole("link", { name: "高级分析" }).getAttribute("aria-current")).toBe("page");
    expect(await screen.findAllByText("chapter-review")).not.toHaveLength(0);
    await userEvent.click(screen.getByRole("button", { name: "创建分析任务" }));
    const mode = screen.getByLabelText("分析模式");
    for (const [value, description] of [
      ["fast_index", "仅读取 L1、L2 索引"],
      ["balanced", "少量原文章节"],
      ["precision", "更多原文章节"],
      ["full_text", "读取所选章节全文"],
    ]) {
      await userEvent.selectOptions(mode, value);
      expect(screen.getByText(description, { exact: false })).toBeTruthy();
    }
    expect((await screen.findAllByText("chapter-review")).length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole("link", { name: "概览" }));
    await userEvent.click(await screen.findByRole("link", { name: "高级分析" }));
    expect((await screen.findAllByText("chapter-review")).length).toBeGreaterThan(0);
    expect(urls.filter((url) => url.endsWith("/advanced-analysis") && !url.includes(ids.run))).toHaveLength(1);
  });

  it("creates and updates a private template, previews the full scope, and creates once with a stable idempotency key", async () => {
    const writes: Array<{ url: string; method: string; body: Record<string, unknown>; idempotencyKey: string | null }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method && init.method !== "GET") {
        const body = init.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
        writes.push({ url, method: init.method, body, idempotencyKey: new Headers(init.headers).get("Idempotency-Key") });
        if (url.endsWith("/analysis-templates") && init.method === "POST") return json({ template }, 201);
        if (url.endsWith(`/analysis-templates/${ids.template}`) && init.method === "PATCH") return json({ template: { ...templateDetail, name: "人物弧光 v2" } });
        if (url.endsWith("/advanced-analysis/preview")) return json(preview);
        if (url.endsWith("/advanced-analysis")) return json({ run: runSummary, job: { id: ids.job } }, 201);
      }
      const response = baseRead(url); if (response) return response;
      throw new Error(`unexpected ${url}`);
    }));
    renderPath();
    await userEvent.click(await screen.findByRole("button", { name: "新建模板" }));
    await userEvent.type(screen.getByLabelText("模板名称"), "人物关系");
    await userEvent.type(screen.getByLabelText("分析提示词"), "分析人物关系变化");
    fireEvent.change(screen.getByLabelText("输出结构 JSON"), { target: { value: '{"type":"object"}' } });
    await userEvent.click(screen.getByRole("button", { name: "保存模板" }));
    await waitFor(() => expect(writes.some((write) => write.method === "POST" && write.url.endsWith("/analysis-templates"))).toBe(true));
    await userEvent.click(screen.getByRole("button", { name: "编辑模板" }));
    await userEvent.clear(screen.getByLabelText("模板名称"));
    await userEvent.type(screen.getByLabelText("模板名称"), "人物弧光 v2");
    await userEvent.click(screen.getByRole("button", { name: "更新模板" }));
    await waitFor(() => expect(writes.some((write) => write.method === "PATCH")).toBe(true));
    await userEvent.click(screen.getByRole("button", { name: "创建分析任务" }));
    await userEvent.click(screen.getByRole("button", { name: "预览分析范围" }));
    const scope = await screen.findByRole("region", { name: "执行范围预览" });
    for (const text of [book.title, "版本", "均衡分析", "1-20 章", group.name, "读取 L1、L2 与少量原文", "最多复核 3 章", "不可变快照"]) expect(within(scope).getAllByText(text, { exact: false }).length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole("button", { name: "确认创建任务" }));
    await waitFor(() => expect(writes.filter((write) => write.url.endsWith("/advanced-analysis") && write.method === "POST")).toHaveLength(1));
    const create = writes.find((write) => write.url.endsWith("/advanced-analysis") && write.body.scopeHash)!;
    expect(create.body).toMatchObject({ bookId: ids.book, templateId: ids.template, templateVersionId: ids.templateVersion, mode: "balanced", scopeHash: preview.scopeHash });
    expect(create.body.idempotencyKey).toEqual(expect.any(String));
    expect(create.idempotencyKey).toBe(create.body.idempotencyKey);
    await userEvent.click(screen.getByRole("link", { name: "概览" }));
    await userEvent.click(await screen.findByRole("link", { name: "高级分析" }));
    expect(writes.filter((write) => write.url.endsWith("/advanced-analysis") && write.method === "POST")).toHaveLength(1);
  });

  it("reuses an uncertain create key after more than five minutes away from the route", async () => {
    const createKeys: string[] = [];
    let creates = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/advanced-analysis/preview") && init?.method === "POST") return json(preview);
      if (url.endsWith("/advanced-analysis") && init?.method === "POST") {
        creates += 1;
        createKeys.push(new Headers(init.headers).get("Idempotency-Key")!);
        return creates === 1 ? json({ error: "provider_unavailable" }, 503) : json({ run: runSummary, job: { id: ids.job } }, 201);
      }
      const response = baseRead(url); if (response) return response;
      throw new Error(`unexpected ${url}`);
    }));
    const rendered = renderPath();
    await userEvent.click(await screen.findByRole("button", { name: "创建分析任务" }));
    await userEvent.click(screen.getByRole("button", { name: "预览分析范围" }));
    await userEvent.click(await screen.findByRole("button", { name: "确认创建任务" }));
    expect(await screen.findByText("提交结果未确认", { exact: false })).toBeTruthy();
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("link", { name: "概览" }));
    const attempt = rendered.client.getQueryCache().find({ queryKey: ["analysis", ids.book, "create-attempt", ids.template] });
    expect(attempt).toBeTruthy();
    (attempt as unknown as { scheduleGc(): void }).scheduleGc();
    await vi.advanceTimersByTimeAsync(5 * 60_000 + 1);
    fireEvent.click(screen.getByRole("link", { name: "高级分析" }));
    vi.useRealTimers();
    await userEvent.click(await screen.findByRole("button", { name: "创建分析任务" }));
    await userEvent.click(screen.getByRole("button", { name: "预览分析范围" }));
    await userEvent.click(await screen.findByRole("button", { name: "确认创建任务" }));
    await waitFor(() => expect(createKeys).toHaveLength(2));
    expect(new Set(createKeys).size).toBe(1);
  });

  it.each([
    { action: "pause", initial: "running", target: "paused", button: "暂停", recovered: "继续" },
    { action: "resume", initial: "paused", target: "queued", button: "继续", recovered: "暂停" },
    { action: "cancel", initial: "running", target: "cancelled", button: "取消", recovered: "删除任务" },
  ] as const)("reconciles a lost $action response and retries with one stable request key", async ({ action, initial, target, button, recovered }) => {
    let detail: Omit<typeof runDetail, "status"> & { status: string } = { ...runDetail, status: initial };
    const controlKeys: string[] = [];
    let controlCalls = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith(`/advanced-analysis/${ids.run}`) && (!init?.method || init.method === "GET")) return json({ run: detail });
      if (url.endsWith("/advanced-analysis") && (!init?.method || init.method === "GET")) return json({ runs: [{ ...runSummary, status: detail.status }] });
      if (init?.method === "POST" && url === `/api/jobs/${ids.job}/${action}`) {
        controlCalls += 1;
        controlKeys.push(new Headers(init.headers).get("Idempotency-Key")!);
        if (controlCalls === 2) detail = { ...detail, status: target };
        return json({ error: "response_lost" }, 503);
      }
      const response = baseRead(url); if (response) return response;
      throw new Error(`unexpected ${url}`);
    }));
    const view = renderPath(`/books/${ids.book}/analysis?run=${ids.run}`);

    await userEvent.click(await screen.findByRole("button", { name: button }));
    expect(await screen.findByText("操作未完成", { exact: false })).toBeTruthy();
    expect(screen.getByRole("button", { name: button })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: button }));

    expect(await screen.findByRole("button", { name: recovered })).toBeTruthy();
    expect(controlKeys).toHaveLength(2);
    expect(new Set(controlKeys).size).toBe(1);
    expect(view.client.getQueryData<{ runs: Array<{ status: string }> }>(["analysis", ids.book, "runs"])?.runs[0]?.status).toBe(target);
    expect(screen.queryByText("操作未完成", { exact: false })).toBeNull();
  });

  it("uses real run progress, exposes controls by state, and requires terminal delete confirmation", async () => {
    let detail: typeof runDetail | typeof completedRun = runDetail;
    const writes: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith(`/advanced-analysis/${ids.run}`) && (!init?.method || init.method === "GET")) return json({ run: detail });
      if (init?.method === "POST" && ["pause", "resume", "cancel"].some((action) => url === `/api/jobs/${ids.job}/${action}`)) { writes.push(url); return json({ job: { id: ids.job, status: url.split("/").at(-1) === "resume" ? "queued" : "paused" } }); }
      if (init?.method === "DELETE" && url.endsWith(`/advanced-analysis/${ids.run}`)) { writes.push(url); return new Response(null, { status: 204 }); }
      const response = baseRead(url); if (response) return response;
      throw new Error(`unexpected ${url}`);
    }));
    const view = renderPath(`/books/${ids.book}/analysis?run=${ids.run}`);
    expect(await screen.findByText("1 / 4 parts")).toBeTruthy();
    expect(screen.getAllByText("chapter-review").length).toBeGreaterThan(0);
    expect(screen.getByText("位置 1")).toBeTruthy();
    expect(screen.getByRole("button", { name: "暂停" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "取消" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "删除任务" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "暂停" }));
    await waitFor(() => expect(writes).toContain(`/api/jobs/${ids.job}/pause`));
    expect(screen.getByText("运行中")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "继续" })).toBeNull();
    detail = { ...runDetail, status: "paused" };
    await view.client.invalidateQueries({ queryKey: ["analysis", ids.book, "run", ids.run] });
    expect(await screen.findByRole("button", { name: "继续" })).toBeTruthy();
    detail = runDetail;
    await userEvent.click(screen.getByRole("button", { name: "继续" }));
    await waitFor(() => expect(writes).toContain(`/api/jobs/${ids.job}/resume`));
    await userEvent.click(await screen.findByRole("button", { name: "取消" }));
    await waitFor(() => expect(writes).toContain(`/api/jobs/${ids.job}/cancel`));
    detail = completedRun;
    await view.client.invalidateQueries({ queryKey: ["analysis", ids.book, "run", ids.run] });
    expect(await screen.findByRole("button", { name: "删除任务" })).toBeTruthy();
    expect(screen.getByText("陈平安").getAttribute("data-label")).toBe("name");
    await userEvent.click(screen.getByRole("button", { name: "删除任务" }));
    const dialog = screen.getByRole("dialog", { name: "永久删除分析任务" });
    expect(within(dialog).getByText("无法恢复", { exact: false })).toBeTruthy();
    await userEvent.click(within(dialog).getByRole("button", { name: "确认永久删除" }));
    await waitFor(() => expect(writes).toContain(`/api/books/${ids.book}/advanced-analysis/${ids.run}`));
  });

  it("keeps legacy history visibly read-only and never sends a legacy mutation", async () => {
    const requests: Array<{ url: string; method: string }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input); requests.push({ url, method: init?.method ?? "GET" });
      const response = baseRead(url); if (response) return response;
      throw new Error(`unexpected ${url}`);
    }));
    renderPath();
    await userEvent.click(await screen.findByRole("tab", { name: "旧历史" }));
    expect(await screen.findByText("旧系统只读")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: /旧版人物分析/ }));
    expect(await screen.findByText("# 旧版结论")).toBeTruthy();
    for (const name of ["暂停", "继续", "取消", "删除任务", "编辑模板"]) expect(screen.queryByRole("button", { name })).toBeNull();
    expect(requests.filter(({ url, method }) => url.includes("legacy-analysis") && method !== "GET")).toEqual([]);
  });

  it("restores drawer focus and traps and restores delete confirmation focus", async () => {
    let detail: typeof runDetail | typeof completedRun = runDetail;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith(`/advanced-analysis/${ids.run}`)) return json({ run: detail });
      const response = baseRead(url); if (response) return response;
      throw new Error(`unexpected ${String(input)}`);
    }));
    const rendered = renderPath(`/books/${ids.book}/analysis?run=${ids.run}`);
    const drawerTrigger = await screen.findByRole("button", { name: "模板与任务" });
    await userEvent.click(drawerTrigger);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "关闭模板与任务列表" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(document.activeElement).toBe(drawerTrigger);
    await userEvent.click(drawerTrigger);
    await userEvent.click(screen.getByRole("button", { name: "关闭模板与任务列表" }));
    expect(document.activeElement).toBe(drawerTrigger);

    await userEvent.click(screen.getByRole("tab", { name: "旧历史" }));
    const legacyTrigger = await screen.findByRole("button", { name: "旧历史列表" });
    await userEvent.click(legacyTrigger);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(document.activeElement).toBe(legacyTrigger);
    await userEvent.click(legacyTrigger);
    await userEvent.click(screen.getByRole("button", { name: "关闭旧历史列表" }));
    expect(document.activeElement).toBe(legacyTrigger);

    await userEvent.click(screen.getByRole("tab", { name: "新任务" }));
    detail = completedRun;
    await rendered.client.invalidateQueries({ queryKey: ["analysis", ids.book, "run", ids.run] });
    const deleteTrigger = await screen.findByRole("button", { name: "删除任务" });
    await userEvent.click(deleteTrigger);
    const confirm = screen.getByRole("button", { name: "确认永久删除" });
    const back = screen.getByRole("button", { name: "返回" });
    await waitFor(() => expect(document.activeElement).toBe(confirm));
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(back);
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(confirm);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "永久删除分析任务" })).toBeNull();
    expect(document.activeElement).toBe(deleteTrigger);
  });

  it("keeps book context in not-found, provider and retryable states", async () => {
    let runCalls = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith(`/advanced-analysis/${ids.run}`)) { runCalls += 1; return runCalls === 1 ? json({ error: "not_found" }, 404) : json({ run: { ...completedRun, status: "failed", diagnostics: ["provider_unavailable"] } }); }
      const response = baseRead(url); if (response) return response;
      throw new Error(`unexpected ${url}`);
    }));
    renderPath(`/books/${ids.book}/analysis?run=${ids.run}`);
    expect(await screen.findByText("任务不存在或无权访问")).toBeTruthy();
    expect(screen.getByRole("heading", { name: book.title })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "重试读取任务" }));
    expect(await screen.findByText("provider_unavailable")).toBeTruthy();
  });

  it("shows loading, empty, and chapter-range validation states", async () => {
    let resolveTemplates!: (response: Response) => void;
    const pendingTemplates = new Promise<Response>((resolve) => { resolveTemplates = resolve; });
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/analysis-templates")) return pendingTemplates;
      if (url.endsWith("/advanced-analysis")) return json({ runs: [] });
      if (url.endsWith("/index-groups")) return json({ indexGroups: [] });
      const response = baseRead(url); if (response) return response;
      throw new Error(`unexpected ${url}`);
    }));
    renderPath();
    expect(await screen.findByText("正在读取模板与任务...")).toBeTruthy();
    resolveTemplates(json({ templates: [] }));
    expect(await screen.findByText("还没有私有模板")).toBeTruthy();
    expect(screen.getByText("还没有分析任务")).toBeTruthy();
    expect(screen.getByText("选择模板创建任务，或从左侧打开已有任务")).toBeTruthy();

    cleanup();
    vi.restoreAllMocks();
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const response = baseRead(String(input)); if (response) return response;
      throw new Error(`unexpected ${String(input)}`);
    }));
    renderPath();
    await userEvent.click(await screen.findByRole("button", { name: "创建分析任务" }));
    fireEvent.change(screen.getByLabelText("起始章节"), { target: { value: "21" } });
    fireEvent.change(screen.getByLabelText("结束章节"), { target: { value: "20" } });
    expect(screen.getByText("请输入书籍范围内的有效章节区间")).toBeTruthy();
    expect(screen.getByRole("button", { name: "预览分析范围" }).hasAttribute("disabled")).toBe(true);
  });
});

describe("advanced analysis export", () => {
  it("prioritizes tables and exports table-compatible JSON as Excel XML", () => {
    const result = { items: [{ name: "陈平安", chapter: 5 }, { name: "宁姚", chapter: 8 }] };
    expect(tableViewsFromJson(result)[0]?.rows).toHaveLength(2);
    expect(buildAnalysisExport("人物分析", result)).toMatchObject({ filename: "人物分析.xls", type: "application/vnd.ms-excel;charset=utf-8" });
    expect(buildAnalysisExport("人物分析", result).content).toContain("<Workbook");
  });

  it("keeps mixed object scalars and heterogeneous array values", () => {
    const result = { items: [{ name: "陈平安" }, "未结构化补充"], summary: "人物关系稳定", confidence: 0.82 };
    const tables = tableViewsFromJson(result);
    expect(tables[0]?.key).toBe("items");
    expect(tables[0]?.rows).toEqual([{ name: "陈平安" }, { value: "未结构化补充" }]);
    expect(tables.find((table) => table.key === "summary_fields")?.rows).toEqual([
      { field: "summary", value: "人物关系稳定" },
      { field: "confidence", value: 0.82 },
    ]);
    const content = buildAnalysisExport("混合结果", result).content;
    for (const value of ["陈平安", "未结构化补充", "人物关系稳定", "0.82"]) expect(content).toContain(value);
  });

  it("deduplicates worksheet names case-insensitively and preserves sanitized fallback and empty arrays", () => {
    const result = {
      Report: [{ value: 1 }],
      report: [{ value: 2 }],
      "///": [],
      "": [],
      mixed: [{ name: "陈平安" }, "补充观察"],
      summary: "人物关系稳定",
    };
    const tables = tableViewsFromJson(result);
    expect(tables.find((table) => table.key === "///")).toMatchObject({ rows: [], columns: [] });
    expect(tables.find((table) => table.key === "")).toMatchObject({ rows: [], columns: [] });
    const content = buildAnalysisExport("工作表", result).content;
    const names = [...content.matchAll(/<Worksheet ss:Name="([^"]+)"/g)].map((match) => match[1]);
    expect(names).toEqual(["Report", "report 2", "结果", "结果 2", "mixed", "结果字段"]);
    expect(content).toContain('<Worksheet ss:Name="结果"><Table></Table></Worksheet>');
    expect(content).toContain('<Worksheet ss:Name="结果 2"><Table></Table></Worksheet>');
    for (const value of ["陈平安", "补充观察", "人物关系稳定"]) expect(content).toContain(value);
  });

  it("exports text as Markdown and non-tabular values as formatted JSON", () => {
    expect(buildAnalysisExport("总结", "# 结论")).toMatchObject({ filename: "总结.md", content: "# 结论", type: "text/markdown;charset=utf-8" });
    expect(buildAnalysisExport("结果", null)).toMatchObject({ filename: "结果.json", content: "null", type: "application/json;charset=utf-8" });
  });
});
