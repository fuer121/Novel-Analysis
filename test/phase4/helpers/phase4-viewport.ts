export type Phase4ViewportEvidence = {
  viewport: [number, number];
  rootScroll: number;
  bodyScroll: number;
  overflow: unknown[];
  overlaps: unknown[];
  missing: unknown[];
  internalClipping: unknown[];
  drawerFocusRestored: boolean | null;
  screenshot: string;
  drawerScreenshot: string | null;
  controlsAccessible: boolean;
};

type Locator = {
  isVisible(): Promise<boolean>;
};

type BrowserPage = {
  setViewportSize(viewport: { width: number; height: number }): Promise<void>;
  goto(url: string, options: { waitUntil: "networkidle" }): Promise<unknown>;
  getByRole(role: string, options: { name: string; exact?: boolean }): Locator;
};

type Browser = {
  newPage(): Promise<BrowserPage>;
  close(): Promise<void>;
};

type Chromium = {
  launch(options: { executablePath: string }): Promise<Browser>;
};

async function availablePort(): Promise<number> {
  const server = createNetServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not allocate a Web port");
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

function playwrightModule(): string {
  if (process.env.PLAYWRIGHT_MODULE) return process.env.PLAYWRIGHT_MODULE;
  const root = join(homedir(), ".npm", "_npx");
  const candidates = existsSync(root) ? readdirSync(root).flatMap((entry) => {
    const directory = join(root, entry, "node_modules", "playwright-core");
    const packageFile = join(directory, "package.json");
    if (!existsSync(packageFile)) return [];
    const packageJson = JSON.parse(readFileSync(packageFile, "utf8")) as { version?: string };
    return packageJson.version?.includes("-") ? [] : [{ directory, version: packageJson.version ?? "" }];
  }) : [];
  const selected = candidates.sort((left, right) => right.version.localeCompare(left.version, undefined, { numeric: true }))[0];
  if (!selected) throw new Error("Existing Playwright runtime not found; set PLAYWRIGHT_MODULE");
  return pathToFileURL(join(selected.directory, "index.mjs")).href;
}

function chromeExecutable(): string {
  const candidates = [
    process.env.PLAYWRIGHT_EXECUTABLE_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ].filter((value): value is string => Boolean(value));
  const selected = candidates.find(existsSync);
  if (!selected) throw new Error("Existing Chrome executable not found; set PLAYWRIGHT_EXECUTABLE_PATH");
  return selected;
}

function startWeb(port: number): { child: ChildProcess; logs: string[] } {
  const logs: string[] = [];
  const child = spawn(process.execPath, [
    resolve("node_modules/vite/bin/vite.js"),
    "apps/web",
    "--host", "127.0.0.1",
    "--port", String(port),
    "--strictPort",
  ], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
  child.stdout?.on("data", (chunk) => logs.push(String(chunk)));
  child.stderr?.on("data", (chunk) => logs.push(String(chunk)));
  return { child, logs };
}

async function waitForWeb(origin: string, process: { child: ChildProcess; logs: string[] }): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (process.child.exitCode !== null || process.child.signalCode !== null) throw new Error(`Web exited before readiness\n${process.logs.join("")}`);
    try {
      if ((await fetch(origin)).status === 200) return;
    } catch {
      // The server is still starting
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for Web readiness\n${process.logs.join("")}`);
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  child.kill("SIGTERM");
  let timeout: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      exited,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error("Timed out stopping Phase 4 Web")), 5_000);
        timeout.unref();
      }),
    ]);
  } catch (error) {
    child.kill("SIGKILL");
    await exited;
    throw error;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function verifyPhase4Viewports(): Promise<Phase4ViewportEvidence[]> {
  const port = await availablePort();
  const origin = `http://127.0.0.1:${port}`;
  const web = startWeb(port);
  let browser: Browser | undefined;
  try {
    await waitForWeb(origin, web);
    const runtime = await import(playwrightModule()) as { chromium?: Chromium; default?: { chromium?: Chromium } };
    const chromium = runtime.chromium ?? runtime.default?.chromium;
    if (!chromium) throw new Error("Existing Playwright runtime does not export Chromium");
    browser = await chromium.launch({ executablePath: chromeExecutable() });
    const page = await browser.newPage();
    const screenshotDir = mkdtempSync(join(tmpdir(), "phase4-task7-viewports-"));
    const raw = await verifyAdvancedAnalysisViewport(page, { baseUrl: origin, screenshotDir }) as Omit<Phase4ViewportEvidence, "controlsAccessible">[];
    const controls = new Map<string, boolean>();
    for (const viewport of acceptedAnalysisViewports) {
      await page.setViewportSize(viewport);
      await page.goto(`${origin}/books/00000000-0000-4000-8000-000000000010/analysis?run=00000000-0000-4000-8000-000000000040`, { waitUntil: "networkidle" });
      const visible = await Promise.all([
        page.getByRole("tab", { name: "新任务", exact: true }).isVisible(),
        page.getByRole("tab", { name: "旧历史", exact: true }).isVisible(),
        page.getByRole("region", { name: "分析结果", exact: true }).isVisible(),
        page.getByRole("button", { name: "删除任务", exact: true }).isVisible(),
      ]);
      controls.set(`${viewport.width}x${viewport.height}`, visible.every(Boolean));
    }
    return raw.map((item) => ({
      ...item,
      controlsAccessible: controls.get(`${item.viewport[0]}x${item.viewport[1]}`) ?? false,
    }));
  } finally {
    await browser?.close();
    await stopChild(web.child);
  }
}
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createServer as createNetServer } from "node:net";

// @ts-expect-error The accepted Task 6 verifier is a checked JavaScript module without declarations
import { acceptedAnalysisViewports, verifyAdvancedAnalysisViewport } from "../../../apps/web/scripts/verify-advanced-analysis-viewport.mjs";
