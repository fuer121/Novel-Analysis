// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { URL as NodeUrl } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppRouter } from "../../app/router.js";
import { setCsrfToken } from "../../shared/csrf-memory.js";

const ids = {
  user: "00000000-0000-4000-8000-000000000001",
  book: "00000000-0000-4000-8000-000000000010",
  group: "00000000-0000-4000-8000-000000000020",
  session: "00000000-0000-4000-8000-000000000030",
  session2: "00000000-0000-4000-8000-000000000031",
  turn: "00000000-0000-4000-8000-000000000040",
  olderTurn: "00000000-0000-4000-8000-000000000041",
  factUsed: "00000000-0000-4000-8000-000000000050",
  factExcluded: "00000000-0000-4000-8000-000000000051",
};
const user = { id: ids.user, displayName: "测试成员", role: "member" };
const book = { id: ids.book, title: "山海长卷", status: "active", chapterCount: 12, createdAt: "2026-07-20T00:00:00.000Z" };
const group = { id: ids.group, key: "people", name: "人物事实", categoryScope: "character", status: "active" };
const session = { id: ids.session, bookId: ids.book, groupId: ids.group, createdBy: ids.user, title: "陈平安研究", visibility: "private", defaultStartChapter: 2, defaultEndChapter: 10, canManage: true, archivedAt: null };
const trace = { kind: "single-target", target: "陈平安", aliases: ["陈十一"], referents: ["他"], categories: ["人物"], keywords: ["选择"], sourceCounts: { candidates: 2, used: 1, excluded: 1 }, gapCount: 2, recallPolicyVersion: "query-recall-v1", summaryWorkflowVersion: "summary-v1" };
const turn = { id: ids.turn, sessionId: ids.session, createdBy: ids.user, question: "他为何做出这个选择？", startChapter: 3, endChapter: 8, status: "awaiting_fallback", answer: null, degradation: "summary_unavailable", sourceStats: { candidates: 2, used: 1, excluded: 1, gaps: 0 }, trace };
const detail = { ...turn, evidence: [
  { turnId: ids.turn, factId: ids.factUsed, chapterIndex: 5, body: "陈平安选择留下守城", rank: 1, recallReason: "目标与关键词匹配", disposition: "used", exclusionReason: null },
  { turnId: ids.turn, factId: ids.factExcluded, chapterIndex: 7, body: "另一人物离开城池", rank: 2, recallReason: "关键词匹配", disposition: "excluded", exclusionReason: "目标不匹配" },
] };

class FakeEventSource {
  static instance: FakeEventSource;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror = null;
  close = vi.fn();
  constructor() { FakeEventSource.instance = this; }
  emit(value: unknown) { this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(value) })); }
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
function renderPath(path = `/books/${ids.book}/query`) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  client.setQueryData(["current-user"], user);
  return { client, ...render(<QueryClientProvider client={client}><AppRouter initialEntries={[path]} /></QueryClientProvider>) };
}
function baseRead(url: string): Response | undefined {
  if (url === `/api/books/${ids.book}`) return json({ book });
  if (url === `/api/books/${ids.book}/index-groups`) return json({ indexGroups: [group] });
  if (url === `/api/books/${ids.book}/query-sessions`) return json({ sessions: [session] });
  if (url === `/api/books/${ids.book}/query-sessions/${ids.session}`) return json({ session });
  if (url.startsWith(`/api/books/${ids.book}/query-sessions/${ids.session}/turns?`)) return json({ turns: [turn], nextCursor: null });
  if (url === `/api/books/${ids.book}/query-sessions/${ids.session}/turns/${ids.turn}`) return json({ turn: detail });
  return undefined;
}

describe("continuous query workspace", () => {
  beforeEach(() => { setCsrfToken("csrf"); vi.stubGlobal("EventSource", FakeEventSource); });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it("uses the compact query layout before the desktop columns can clip", () => {
    const styles = readFileSync(new NodeUrl("../../app/styles.css", import.meta.url), "utf8");
    expect(styles).toContain("@media (min-width: 721px) and (max-width: 900px)");
    expect(styles).toContain(".query-session-rail { display: none; }");
    expect(styles).toContain(".query-mobile-tools button:first-child { display: inline-block; }");
  });

  it("lists, creates, selects and restores sessions from the route", async () => {
    const created = { ...session, id: ids.session2, title: "新研究会话", visibility: "team" };
    let createdOnServer = false;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === `/api/books/${ids.book}/query-sessions` && init?.method === "POST") { createdOnServer = true; return json({ session: created }, 201); }
      if (url === `/api/books/${ids.book}/query-sessions` && createdOnServer) return json({ sessions: [created, session] });
      const response = baseRead(url);
      if (response) return response;
      if (url.includes(ids.session2) && url.endsWith("/turns?limit=50")) return json({ turns: [], nextCursor: null });
      if (url.endsWith(`/query-sessions/${ids.session2}`)) return json({ session: created });
      throw new Error(`unexpected ${url}`);
    }));
    renderPath(`/books/${ids.book}/query?session=${ids.session}&turn=${ids.turn}`);
    expect(await screen.findByRole("heading", { name: "陈平安研究" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "连续提问" }).className).toContain("active");
    expect(screen.getByText("他为何做出这个选择？")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "新建会话" }));
    await userEvent.type(screen.getByLabelText("会话标题"), created.title);
    await userEvent.selectOptions(screen.getByLabelText("索引组"), ids.group);
    await userEvent.selectOptions(screen.getByLabelText("可见范围"), "team");
    await userEvent.click(screen.getByRole("button", { name: "创建会话" }));
    expect(await screen.findByRole("heading", { name: created.title })).toBeTruthy();
    expect(screen.getByText(created.title, { selector: "strong" }).closest("button")?.getAttribute("aria-current")).toBe("true");
  });

  it("requires a fresh preview, clears scope_changed and reuses uncertain-submit idempotency", async () => {
    const keys: string[] = [];
    let previewCalls = 0;
    let submitCalls = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const response = baseRead(url);
      if (response) return response;
      if (url.endsWith("/turn-preview")) { previewCalls += 1; return json({ book: { id: ids.book, title: book.title }, group: { id: ids.group, key: group.key, name: group.name }, defaultRange: { startChapter: 2, endChapter: 10 }, effectiveRange: { startChapter: 3, endChapter: 8 }, queryableChapterCount: 5, coverageGaps: [6], executionVersions: { summaryWorkflowVersion: "summary-v1", recallPolicyVersion: "query-recall-v1" }, estimatedQueuePosition: 2, scopeHash: String(previewCalls).repeat(64) }); }
      if (url.endsWith(`/query-sessions/${ids.session}/turns`) && init?.method === "POST") {
        keys.push(new Headers(init.headers).get("Idempotency-Key")!);
        submitCalls += 1;
        if (submitCalls === 1) return json({ error: "scope_changed" }, 409);
        if (submitCalls === 2) return json({ error: "internal_error" }, 500);
        return json({ turn: { ...turn, status: "queued" }, job: { id: "job" } }, 201);
      }
      throw new Error(`unexpected ${url}`);
    }));
    renderPath();
    const question = await screen.findByLabelText("问题");
    await userEvent.clear(question);
    await userEvent.type(question, "陈平安为何留下？");
    expect(screen.queryByRole("button", { name: "发送问题" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "预览问题范围" }));
    expect(await screen.findByRole("button", { name: "发送问题" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "发送问题" }));
    expect(await screen.findByText("范围已变化，请重新预览")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "发送问题" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "预览问题范围" }));
    await userEvent.click(await screen.findByRole("button", { name: "发送问题" }));
    expect(await screen.findByText("提交结果未确认，请重试")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "发送问题" }));
    await waitFor(() => expect(submitCalls).toBe(3));
    expect(keys[1]).toBe(keys[2]);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it("does not expose submit when an old preview resolves after the question changes", async () => {
    let resolvePreview!: (response: Response) => void;
    const pendingPreview = new Promise<Response>((resolve) => { resolvePreview = resolve; });
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const response = baseRead(url);
      if (response) return response;
      if (url.endsWith("/turn-preview")) return pendingPreview;
      throw new Error(`unexpected ${url}`);
    }));
    renderPath();
    const question = await screen.findByLabelText("问题");
    await userEvent.type(question, "旧问题");
    await userEvent.click(screen.getByRole("button", { name: "预览问题范围" }));
    await userEvent.clear(question);
    await userEvent.type(question, "新问题");
    resolvePreview(json({ book: { id: ids.book, title: book.title }, group: { id: ids.group, key: group.key, name: group.name }, defaultRange: { startChapter: 2, endChapter: 10 }, effectiveRange: { startChapter: 2, endChapter: 10 }, queryableChapterCount: 8, coverageGaps: [], executionVersions: { summaryWorkflowVersion: "summary-v1", recallPolicyVersion: "query-recall-v1" }, estimatedQueuePosition: 1, scopeHash: "a".repeat(64) }));
    await waitFor(() => expect((screen.getByRole("button", { name: "预览问题范围" }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.queryByRole("button", { name: "发送问题" })).toBeNull();
    expect(screen.queryByText("“旧问题”")).toBeNull();
  });

  it("loads an older history page and restores a selected older turn", async () => {
    const older = { ...turn, id: ids.olderTurn, question: "更早的问题", status: "completed", answer: "更早的回答" };
    const requested: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input); requested.push(url);
      if (url === `/api/books/${ids.book}`) return json({ book });
      if (url === `/api/books/${ids.book}/index-groups`) return json({ indexGroups: [group] });
      if (url === `/api/books/${ids.book}/query-sessions`) return json({ sessions: [session] });
      if (url === `/api/books/${ids.book}/query-sessions/${ids.session}`) return json({ session });
      if (url.endsWith("/turns?limit=50")) return json({ turns: [turn], nextCursor: "opaque-older" });
      if (url.endsWith("/turns?limit=50&cursor=opaque-older")) return json({ turns: [older], nextCursor: null });
      if (url.endsWith(`/turns/${ids.turn}`)) return json({ turn: detail });
      if (url.endsWith(`/turns/${ids.olderTurn}`)) return json({ turn: { ...older, evidence: [] } });
      throw new Error(`unexpected ${url}`);
    }));
    renderPath(`/books/${ids.book}/query?session=${ids.session}&turn=${ids.olderTurn}`);
    await userEvent.click(await screen.findByRole("button", { name: "加载更早" }));
    expect(await screen.findByText("更早的问题")).toBeTruthy();
    await userEvent.click(screen.getByText("更早的问题").closest("button")!);
    expect(await screen.findByText("更早的回答")).toBeTruthy();
    expect(requested.some((url) => url.endsWith("cursor=opaque-older"))).toBe(true);
  });

  it("replaces an unauthorized session and an explicitly missing turn with authorized history", async () => {
    const missingSession = "00000000-0000-4000-8000-000000000099";
    const missingTurn = "00000000-0000-4000-8000-000000000098";
    const requested: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input); requested.push(url);
      if (url === `/api/books/${ids.book}`) return json({ book });
      if (url === `/api/books/${ids.book}/index-groups`) return json({ indexGroups: [group] });
      if (url === `/api/books/${ids.book}/query-sessions`) return json({ sessions: [session] });
      if (url.includes(missingSession)) return json({ error: "not_found" }, 404);
      if (url === `/api/books/${ids.book}/query-sessions/${ids.session}`) return json({ session });
      if (url.endsWith(`/query-sessions/${ids.session}/turns?limit=50`)) return json({ turns: [turn], nextCursor: null });
      if (url.endsWith(`/query-sessions/${ids.session}/turns/${missingTurn}`)) return json({ error: "not_found" }, 404);
      if (url.endsWith(`/query-sessions/${ids.session}/turns/${ids.turn}`)) return json({ turn: detail });
      throw new Error(`unexpected ${url}`);
    }));
    renderPath(`/books/${ids.book}/query?session=${missingSession}&turn=${missingTurn}`);
    expect(await screen.findByRole("heading", { name: session.title })).toBeTruthy();
    expect(await screen.findByText("陈平安选择留下守城")).toBeTruthy();
    expect(requested.some((url) => url.includes(missingSession))).toBe(true);
    expect(requested.some((url) => url.endsWith(`/turns/${missingTurn}`))).toBe(true);
  });

  it("clears both stale route parameters when the settled session list is empty", async () => {
    const missingSession = "00000000-0000-4000-8000-000000000099";
    const missingTurn = "00000000-0000-4000-8000-000000000098";
    const requested: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input); requested.push(url);
      if (url === `/api/books/${ids.book}`) return json({ book });
      if (url === `/api/books/${ids.book}/index-groups`) return json({ indexGroups: [group] });
      if (url === `/api/books/${ids.book}/query-sessions`) return json({ sessions: [] });
      if (url.includes(missingSession)) return json({ error: "not_found" }, 404);
      if (url === `/api/books/${ids.book}/query-sessions/${ids.session}`) return json({ session });
      if (url.endsWith(`/query-sessions/${ids.session}/turns?limit=50`)) return json({ turns: [turn], nextCursor: null });
      if (url.endsWith(`/query-sessions/${ids.session}/turns/${ids.turn}`)) return json({ turn: detail });
      if (url.endsWith(`/query-sessions/${ids.session}/turns/${missingTurn}`)) return json({ error: "not_found" }, 404);
      throw new Error(`unexpected ${url}`);
    }));
    const { client } = renderPath(`/books/${ids.book}/query?session=${missingSession}&turn=${missingTurn}`);
    expect(await screen.findByText("选择或新建研究会话")).toBeTruthy();
    await waitFor(() => expect(requested.some((url) => url.endsWith(`/turns/${missingTurn}`))).toBe(true));
    await waitFor(() => expect(client.getQueryCache().find({
      queryKey: ["query", ids.book, "session", "none", "turn", "none"],
      exact: true,
    })?.getObserversCount()).toBe(1));
    requested.length = 0;
    client.setQueryData(["query", ids.book, "sessions"], { sessions: [session] });
    expect(await screen.findByText("陈平安选择留下守城")).toBeTruthy();
    expect(requested.some((url) => url.endsWith(`/turns/${missingTurn}`))).toBe(false);
  });

  it("reuses a create key after an uncertain failure and rotates it when the payload changes", async () => {
    const keys: string[] = [];
    let createCalls = 0;
    let createdOnServer = false;
    let resolveFirstCreate!: (response: Response) => void;
    const firstCreate = new Promise<Response>((resolve) => { resolveFirstCreate = resolve; });
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === `/api/books/${ids.book}/query-sessions` && init?.method === "POST") {
        keys.push(new Headers(init.headers).get("Idempotency-Key")!);
        createCalls += 1;
        if (createCalls === 1) return firstCreate;
        if (createCalls === 2) return json({ error: "internal_error" }, 500);
        createdOnServer = true;
        return json({ session: { ...session, id: ids.session2, title: "变更后的会话" } }, 201);
      }
      if (url === `/api/books/${ids.book}/query-sessions` && createdOnServer) return json({ sessions: [{ ...session, id: ids.session2, title: "变更后的会话" }, session] });
      const response = baseRead(url);
      if (response) return response;
      if (url.includes(ids.session2) && url.endsWith("/turns?limit=50")) return json({ turns: [], nextCursor: null });
      if (url.endsWith(`/query-sessions/${ids.session2}`)) return json({ session: { ...session, id: ids.session2, title: "变更后的会话" } });
      throw new Error(`unexpected ${url}`);
    }));
    renderPath();
    await userEvent.click(await screen.findByRole("button", { name: "新建会话" }));
    const title = screen.getByLabelText("会话标题");
    await userEvent.type(title, "首次会话");
    const createButton = screen.getByRole("button", { name: "创建会话" });
    await userEvent.click(createButton);
    expect((createButton as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(createButton);
    expect(createCalls).toBe(1);
    resolveFirstCreate(json({ error: "internal_error" }, 500));
    expect(await screen.findByText("创建结果未确认，请重试")).toBeTruthy();
    await userEvent.click(createButton);
    await waitFor(() => expect(createCalls).toBe(2));
    expect(keys[0]).toBe(keys[1]);
    await userEvent.clear(title);
    await userEvent.type(title, "变更后的会话");
    await userEvent.click(createButton);
    expect(await screen.findByRole("heading", { name: "变更后的会话" })).toBeTruthy();
    expect(keys[2]).not.toBe(keys[1]);
  });

  it("serializes fallback actions and reuses the failed action key", async () => {
    const keys: string[] = [];
    const urls: string[] = [];
    let resolveFirst!: (response: Response) => void;
    const first = new Promise<Response>((resolve) => { resolveFirst = resolve; });
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "POST" && (url.endsWith("/retry-summary") || url.endsWith("/local-summary"))) {
        urls.push(url); keys.push(new Headers(init.headers).get("Idempotency-Key")!);
        if (urls.length === 1) return first;
        return json({ job: { id: "job" } }, 201);
      }
      const response = baseRead(url);
      if (response) return response;
      throw new Error(`unexpected ${url}`);
    }));
    renderPath();
    const retry = await screen.findByRole("button", { name: "重试 Dify 汇总" });
    const local = screen.getByRole("button", { name: "生成本地事实摘要" });
    await userEvent.click(retry);
    expect((retry as HTMLButtonElement).disabled).toBe(true);
    expect((local as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(retry);
    await userEvent.click(local);
    expect(urls).toHaveLength(1);
    await userEvent.type(screen.getByLabelText("问题"), "编辑中的问题");
    resolveFirst(json({ error: "internal_error" }, 500));
    expect(await screen.findByText("降级操作结果未确认，请重试")).toBeTruthy();
    expect((retry as HTMLButtonElement).disabled).toBe(false);
    expect((local as HTMLButtonElement).disabled).toBe(false);
    await userEvent.click(retry);
    await waitFor(() => expect(urls).toHaveLength(2));
    expect(keys[1]).toBe(keys[0]);
    expect((retry as HTMLButtonElement).disabled).toBe(true);
    expect((local as HTMLButtonElement).disabled).toBe(true);
  });

  it("does not let a deferred submit from the previous session mutate the new composer", async () => {
    const secondSession = { ...session, id: ids.session2, title: "第二会话" };
    let secondHistoryCalls = 0;
    let resolveSubmit!: (response: Response) => void;
    const pendingSubmit = new Promise<Response>((resolve) => { resolveSubmit = resolve; });
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === `/api/books/${ids.book}/query-sessions`) return json({ sessions: [session, secondSession] });
      if (url.endsWith(`/query-sessions/${ids.session2}`)) return json({ session: secondSession });
      if (url.endsWith(`/query-sessions/${ids.session2}/turns?limit=50`)) { secondHistoryCalls += 1; return json({ turns: [], nextCursor: null }); }
      if (url.endsWith("/turn-preview")) return json({ book: { id: ids.book, title: book.title }, group: { id: ids.group, key: group.key, name: group.name }, defaultRange: { startChapter: 2, endChapter: 10 }, effectiveRange: { startChapter: 2, endChapter: 10 }, queryableChapterCount: 8, coverageGaps: [], executionVersions: { summaryWorkflowVersion: "summary-v1", recallPolicyVersion: "query-recall-v1" }, estimatedQueuePosition: 1, scopeHash: "a".repeat(64) });
      if (url.endsWith(`/query-sessions/${ids.session}/turns`) && init?.method === "POST") return pendingSubmit;
      const response = baseRead(url);
      if (response) return response;
      throw new Error(`unexpected ${url}`);
    }));
    const { client } = renderPath();
    client.setQueryData(["query", ids.book, "session", ids.session2], { session: secondSession });
    const question = await screen.findByLabelText("问题");
    await userEvent.type(question, "旧会话问题");
    await userEvent.click(screen.getByRole("button", { name: "预览问题范围" }));
    await userEvent.click(await screen.findByRole("button", { name: "发送问题" }));
    await userEvent.click(screen.getByText(secondSession.title, { selector: "strong" }).closest("button")!);
    expect(await screen.findByRole("heading", { name: secondSession.title })).toBeTruthy();
    const newQuestion = screen.getByLabelText("问题");
    await userEvent.type(newQuestion, "新会话问题");
    resolveSubmit(json({ turn: { ...turn, status: "queued" }, job: { id: "job" } }, 201));
    await waitFor(() => expect(secondHistoryCalls).toBeGreaterThan(1));
    expect((newQuestion as HTMLTextAreaElement).value).toBe("新会话问题");
    expect((screen.getByRole("button", { name: "预览问题范围" }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText("提交结果未确认，请重试")).toBeNull();
  });

  it("renders selected evidence and trace, exposes fallback actions and invalidates query keys on SSE", async () => {
    let historyCalls = 0;
    let detailCalls = 0;
    const fallbacks: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith(`/api/books/${ids.book}/query-sessions/${ids.session}/turns?`)) historyCalls += 1;
      if (url.endsWith(`/turns/${ids.turn}`)) detailCalls += 1;
      if (init?.method === "POST" && (url.endsWith("/retry-summary") || url.endsWith("/local-summary"))) { fallbacks.push(url); return json({ job: { id: `job-${fallbacks.length}` } }, 201); }
      const response = baseRead(url);
      if (response) return response;
      throw new Error(`unexpected ${url}`);
    }));
    renderPath();
    expect(await screen.findByText("陈平安选择留下守城")).toBeTruthy();
    expect(screen.queryByText("另一人物离开城池")).toBeNull();
    await userEvent.click(screen.getByRole("tab", { name: "候选召回" }));
    expect(screen.getByText("另一人物离开城池")).toBeTruthy();
    expect(screen.getByText(/目标不匹配/)).toBeTruthy();
    await userEvent.click(screen.getByRole("tab", { name: "执行 Trace" }));
    expect(screen.getByText("query-recall-v1")).toBeTruthy();
    expect(screen.getByText("陈十一")).toBeTruthy();
    expect(screen.getByText("他")).toBeTruthy();
    expect(screen.getByText("人物")).toBeTruthy();
    expect(screen.getByText("2", { selector: "dd" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "重试 Dify 汇总" }));
    await userEvent.click(screen.getByRole("button", { name: "生成本地事实摘要" }));
    expect(fallbacks).toHaveLength(1);
    const before = { historyCalls, detailCalls };
    FakeEventSource.instance.emit({ jobId: "job", type: "progress" });
    await waitFor(() => expect(historyCalls).toBeGreaterThan(before.historyCalls));
    await waitFor(() => expect(detailCalls).toBeGreaterThan(before.detailCalls));
  });

  it("uses an accessible session drawer and bottom evidence panel on the compact workspace", async () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const response = baseRead(String(input));
      if (response) return response;
      throw new Error(`unexpected ${String(input)}`);
    }));
    renderPath();
    await screen.findByRole("heading", { name: "陈平安研究" });
    const drawerButton = screen.getByRole("button", { name: "打开会话列表" });
    await userEvent.click(drawerButton);
    const drawer = screen.getByRole("dialog", { name: "研究会话" });
    const closeDrawer = within(drawer).getByRole("button", { name: "关闭会话列表" });
    expect(document.activeElement).toBe(closeDrawer);
    await userEvent.tab({ shift: true });
    expect(document.activeElement).toBe(within(drawer).getAllByRole("button").at(-1));
    await userEvent.tab();
    expect(document.activeElement).toBe(closeDrawer);
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "研究会话" })).toBeNull();
    expect(document.activeElement).toBe(drawerButton);
    const workspace = screen.getByTestId("query-workspace");
    expect(workspace.className).toContain("evidence-closed");
    expect(screen.getByTestId("query-composer")).toBeTruthy();
    const evidenceButton = screen.getByRole("button", { name: "展开证据面板" });
    await userEvent.click(evidenceButton);
    expect(workspace.className).toContain("evidence-open");
    expect(screen.getByRole("region", { name: "本轮证据" })).toBeTruthy();
    expect(screen.getByTestId("query-evidence-sheet").className).toContain("query-evidence-sheet");
    expect(screen.getByLabelText("问题")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "收起证据面板" }));
    expect(screen.queryByRole("region", { name: "本轮证据" })).toBeNull();
  });

  it("collapses desktop evidence and provides linked keyboard-operable tabs", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const response = baseRead(String(input));
      if (response) return response;
      throw new Error(`unexpected ${String(input)}`);
    }));
    renderPath();
    await screen.findByText("陈平安选择留下守城");
    const used = screen.getByRole("tab", { name: "采用证据" });
    const candidates = screen.getByRole("tab", { name: "候选召回" });
    expect(used.tabIndex).toBe(0);
    expect(candidates.tabIndex).toBe(-1);
    expect(used.getAttribute("aria-controls")).toBe(screen.getByRole("tabpanel").id);
    used.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(candidates);
    expect(candidates.getAttribute("aria-selected")).toBe("true");
    await userEvent.keyboard("{ArrowLeft}");
    expect(document.activeElement).toBe(used);
    await userEvent.click(screen.getByRole("button", { name: "收起桌面证据面板" }));
    expect(screen.queryByRole("region", { name: "本轮证据" })).toBeNull();
    expect(screen.getByRole("button", { name: "展开桌面证据面板" })).toBeTruthy();
  });
});
