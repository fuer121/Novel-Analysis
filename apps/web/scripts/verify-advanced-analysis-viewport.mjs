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
const run = {
  id: ids.run,
  bookId: ids.book,
  templateVersionId: ids.templateVersion,
  jobId: ids.job,
  mode: "balanced",
  startChapter: 1,
  endChapter: 20,
  status: "completed",
  completedParts: 4,
  totalParts: 4,
  createdAt: now,
  updatedAt: now,
  parts: [{ id: ids.part, position: 1, kind: "chapter-review", status: "completed", errorCode: null, createdAt: now, updatedAt: now }],
  result: {
    items: [{ name: "陈平安", turningPoint: "选择守城", chapters: [5, 8] }, "补充观察"],
    summary: "人物关系稳定",
    confidence: 0.82,
  },
  diagnostics: [],
};

export const acceptedAnalysisViewports = [
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
  { width: 768, height: 800 },
  { width: 390, height: 760 },
];

function fixture(pathname) {
  if (pathname === "/api/auth/me") return { user, csrfToken: "viewport-csrf" };
  if (pathname === `/api/books/${ids.book}`) return { book };
  if (pathname === `/api/books/${ids.book}/index-groups`) return { indexGroups: [group] };
  if (pathname === `/api/books/${ids.book}/analysis-templates`) return { templates: [template] };
  if (pathname === `/api/books/${ids.book}/analysis-templates/${ids.template}`) return { template: templateDetail };
  if (pathname === `/api/books/${ids.book}/advanced-analysis`) return { runs: [run] };
  if (pathname === `/api/books/${ids.book}/advanced-analysis/${ids.run}`) return { run };
  return null;
}

function assert(condition, message, details) {
  if (!condition) throw new Error(`${message}: ${JSON.stringify(details)}`);
}

async function installFixtures(page) {
  await page.addInitScript(() => {
    class SilentEventSource {
      onmessage = null;
      onerror = null;
      close() {}
    }
    Object.defineProperty(window, "EventSource", { configurable: true, value: SilentEventSource });
  });
  await page.route("**/api/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    const body = fixture(pathname);
    await route.fulfill({
      status: body ? 200 : 404,
      contentType: "application/json",
      body: JSON.stringify(body ?? { error: "not_found" }),
    });
  });
}

async function inspectGeometry(page) {
  return page.evaluate(() => {
    const root = document.documentElement;
    const body = document.body;
    const viewportWidth = root.clientWidth;
    const allowedHorizontalScroll = ".data-table-wrap, .workspace-tabs";
    const visible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    };
    const overflow = [...document.querySelectorAll("body *")].flatMap((element) => {
      if (!(element instanceof HTMLElement) || !visible(element) || element.closest(allowedHorizontalScroll)) return [];
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const leavesViewport = rect.left < -1 || rect.right > viewportWidth + 1;
      const leaksContent = element.scrollWidth > element.clientWidth + 1 && style.overflowX === "visible";
      return leavesViewport || leaksContent ? [{ selector: element.className || element.tagName, left: rect.left, right: rect.right, clientWidth: element.clientWidth, scrollWidth: element.scrollWidth }] : [];
    });
    const pairs = [
      ["workspace heading", ".book-workspace > .workspace-heading", "workspace tabs", ".book-workspace > .workspace-tabs"],
      ["workspace tabs", ".book-workspace > .workspace-tabs", "analysis title", ".advanced-analysis-page > .analysis-page-title"],
      ["analysis title", ".advanced-analysis-page > .analysis-page-title", "analysis toolbar", ".advanced-analysis-page > .analysis-toolbar"],
      ["analysis toolbar", ".advanced-analysis-page > .analysis-toolbar", "analysis layout", ".advanced-analysis-page > .analysis-layout"],
      ["run heading", ".analysis-run-detail > .analysis-section-heading", "run progress", ".analysis-run-detail > .analysis-progress-row"],
      ["run progress", ".analysis-run-detail > .analysis-progress-row", "run controls", ".analysis-run-detail > .analysis-controls"],
      ["run metrics", ".analysis-run-detail > .analysis-run-metrics", "run parts", ".analysis-run-detail > .analysis-parts"],
      ["run parts", ".analysis-run-detail > .analysis-parts", "analysis result", ".analysis-run-detail > .analysis-result"],
    ];
    const overlaps = pairs.flatMap(([leftName, leftSelector, rightName, rightSelector]) => {
      const left = document.querySelector(leftSelector);
      const right = document.querySelector(rightSelector);
      if (!(left instanceof HTMLElement) || !(right instanceof HTMLElement) || !visible(left) || !visible(right)) return [];
      const a = left.getBoundingClientRect();
      const b = right.getBoundingClientRect();
      const width = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const height = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      return width > 1 && height > 1 ? [{ left: leftName, right: rightName, width, height }] : [];
    });
    return {
      rootScroll: root.scrollWidth - root.clientWidth,
      bodyScroll: body.scrollWidth - body.clientWidth,
      overflow,
      overlaps,
    };
  });
}

async function verifyDrawerFocus(page, viewport) {
  const trigger = page.getByRole("button", { name: "模板与任务", exact: true });
  const visible = await trigger.isVisible();
  assert(visible === (viewport.width <= 900), "drawer trigger visibility does not match the responsive boundary", { viewport, visible });
  if (!visible) return null;
  await trigger.click();
  await page.getByRole("dialog", { name: "模板与任务" }).waitFor();
  await page.waitForFunction(() => document.activeElement?.textContent?.trim() === "关闭模板与任务列表");
  await page.keyboard.press("Escape");
  await page.getByRole("dialog", { name: "模板与任务" }).waitFor({ state: "detached" });
  const restored = await trigger.evaluate((element) => document.activeElement === element);
  assert(restored, "drawer did not restore focus to its trigger", viewport);
  return true;
}

export async function verifyAdvancedAnalysisViewport(page, options = {}) {
  const baseUrl = options.baseUrl ?? "http://127.0.0.1:4176";
  const screenshotDir = options.screenshotDir ?? "/tmp";
  await installFixtures(page);
  const results = [];

  for (const viewport of acceptedAnalysisViewports) {
    await page.setViewportSize(viewport);
    await page.goto(`${baseUrl}/books/${ids.book}/analysis?run=${ids.run}`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "高级分析" }).waitFor();
    await page.getByRole("region", { name: "分析结果" }).waitFor();
    const geometry = await inspectGeometry(page);
    assert(geometry.rootScroll === 0, "document root has horizontal scroll", { viewport, ...geometry });
    assert(geometry.bodyScroll === 0, "document body has horizontal scroll", { viewport, ...geometry });
    assert(geometry.overflow.length === 0, "unintended element overflow detected", { viewport, ...geometry });
    assert(geometry.overlaps.length === 0, "component overlap detected", { viewport, ...geometry });
    const screenshot = `${screenshotDir}/phase4-task6-worker-correction-${viewport.width}.png`;
    await page.screenshot({ path: screenshot, fullPage: true });
    const drawerFocusRestored = await verifyDrawerFocus(page, viewport);
    let drawerScreenshot = null;
    if (drawerFocusRestored) {
      await page.getByRole("button", { name: "模板与任务", exact: true }).click();
      drawerScreenshot = `${screenshotDir}/phase4-task6-worker-correction-${viewport.width}-drawer.png`;
      await page.screenshot({ path: drawerScreenshot, fullPage: true });
      await page.keyboard.press("Escape");
    }
    results.push({ viewport: [viewport.width, viewport.height], ...geometry, drawerFocusRestored, screenshot, drawerScreenshot });
  }

  return results;
}
