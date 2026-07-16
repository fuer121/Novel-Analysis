# Novel Analysis Foundation and Contracts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking

**Goal:** 在不改变现有应用行为的前提下建立新架构的 workspace、共享任务契约、领域状态机、Dify Workflow hash 清单和双轨 CI

**Architecture:** 旧应用继续从根目录 `src/`、`server/` 和 `test/service.test.js` 运行。新代码只进入 `packages/contracts` 与 `packages/domain`，根 package 负责编排旧验证和新验证，为阶段 1 的 API、Worker 与 PostgreSQL 奠定稳定契约

**Tech Stack:** Node.js 26、npm workspaces、TypeScript、Zod、Vitest、Node test、ESLint、Vite、GitHub Actions

---

## File Map

### Existing files to modify

- `package.json`：增加 workspace 和旧、新双轨脚本
- `package-lock.json`：记录 TypeScript、Vitest、Zod 与 workspace 依赖
- `eslint.config.js`：让 TypeScript package 文件进入 lint 范围

### Files to create

- `tsconfig.base.json`：所有新 TypeScript package 的严格编译基线
- `vitest.config.ts`：新 package 测试入口
- `docs/architecture/legacy-contract-baseline.md`：旧行为边界与验证证据
- `test/contracts/workspace-config.test.js`：workspace 配置契约
- `test/contracts/dify-normalization.contract.test.js`：旧 Dify 输出归一化契约
- `test/fixtures/dify/chapter-output.json`：章节 Workflow fixture
- `test/fixtures/dify/l1-output.json`：L1 Workflow fixture
- `test/fixtures/dify/l2-output.json`：L2 Workflow fixture
- `test/dify-workflow-manifest.test.js`：Workflow 文件 hash 契约
- `scripts/generate-dify-workflow-manifest.mjs`：稳定生成 manifest
- `dify-workflows/manifest.json`：五条仓库 Workflow 的内容 hash
- `packages/contracts/package.json`：共享契约 package
- `packages/contracts/tsconfig.json`：contracts TypeScript 配置
- `packages/contracts/src/job-contract.ts`：任务、scope 与事件 Schema
- `packages/contracts/src/index.ts`：contracts 公共出口
- `packages/contracts/src/job-contract.test.ts`：契约单元测试
- `packages/domain/package.json`：领域规则 package
- `packages/domain/tsconfig.json`：domain TypeScript 配置
- `packages/domain/src/jobs/job-state.ts`：持久化任务状态转换规则
- `packages/domain/src/jobs/job-state.test.ts`：状态机单元测试
- `packages/domain/src/index.ts`：domain 公共出口
- `.github/workflows/ci.yml`：旧应用与新 packages 双轨验证

## Task 1: Record And Protect The Legacy Baseline

**Files:**
- Create: `docs/architecture/legacy-contract-baseline.md`
- Modify: `package.json:6-20`

- [ ] **Step 1: Install the current repository exactly from the lockfile**

Run:

```bash
npm ci
```

Expected: command exits 0 and does not change `package-lock.json`

- [ ] **Step 2: Run the current test suite before changing scripts**

Run:

```bash
npm test
```

Expected: 112 tests pass, 0 fail

- [ ] **Step 3: Run current lint and build before changing scripts**

Run:

```bash
npm run lint
npm run build
```

Expected: both commands exit 0

- [ ] **Step 4: Write the legacy baseline document**

Create `docs/architecture/legacy-contract-baseline.md` with exactly this content:

````markdown
# Legacy Contract Baseline

Date: 2026-07-16

The legacy application remains the behavior reference until each capability is replaced by an approved phase

## Required commands

```bash
npm run test:legacy
npm run lint:legacy
npm run build:legacy
```

## Baseline evidence

- `test/service.test.js` contains 112 Node tests
- Vite builds the root React application
- ESLint checks root `src`, `server`, and `test` JavaScript
- SQLite, in-memory tasks, and Dify adapters remain unchanged in phase 0

## Protected behavior areas

- chapter import batching and normalization
- AES-256-GCM and HMAC storage boundaries
- L1 and L2 freshness signatures
- specialized L2 admission rules
- L2 query recall, chunking, fallback, and trace
- advanced analysis snapshots, merge, and resume

Phase 0 may add contract fixtures and new packages but must not change these behaviors
````

- [ ] **Step 5: Add explicit legacy scripts without changing their commands**

Modify the `scripts` object in `package.json` so these entries exist while all current runtime scripts remain:

```json
{
  "test:legacy": "node --test test/service.test.js",
  "lint:legacy": "eslint src server test/service.test.js",
  "build:legacy": "vite build",
  "verify:legacy": "npm run test:legacy && npm run lint:legacy && npm run build:legacy"
}
```

- [ ] **Step 6: Verify the explicit legacy command**

Run:

```bash
npm run verify:legacy
```

Expected: 112 tests pass, lint exits 0, Vite build exits 0

- [ ] **Step 7: Commit the protected baseline**

```bash
git add package.json docs/architecture/legacy-contract-baseline.md
git commit -m "test: record legacy contract baseline"
```

## Task 2: Add The Workspace And TypeScript Toolchain

**Files:**
- Create: `test/contracts/workspace-config.test.js`
- Create: `tsconfig.base.json`
- Create: `vitest.config.ts`
- Modify: `package.json:1-40`
- Modify: `package-lock.json`

- [ ] **Step 1: Write the failing workspace configuration contract**

Create `test/contracts/workspace-config.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const packageJson = JSON.parse(await fs.readFile(new URL("../../package.json", import.meta.url), "utf8"));
const tsconfig = JSON.parse(await fs.readFile(new URL("../../tsconfig.base.json", import.meta.url), "utf8"));

test("root package declares the new workspace without moving the legacy app", () => {
  assert.deepEqual(packageJson.workspaces, ["apps/*", "packages/*"]);
  assert.equal(packageJson.scripts["test:legacy"], "node --test test/service.test.js");
  assert.equal(packageJson.scripts["test:new"], "vitest run");
  assert.equal(
    packageJson.scripts["typecheck:new"],
    "tsc -p packages/contracts/tsconfig.json && tsc -p packages/domain/tsconfig.json",
  );
});

test("TypeScript baseline is strict and emits no JavaScript during verification", () => {
  assert.equal(tsconfig.compilerOptions.strict, true);
  assert.equal(tsconfig.compilerOptions.noEmit, true);
  assert.equal(tsconfig.compilerOptions.module, "NodeNext");
  assert.equal(tsconfig.compilerOptions.moduleResolution, "NodeNext");
});
```

- [ ] **Step 2: Run the contract to verify it fails**

Run:

```bash
node --test test/contracts/workspace-config.test.js
```

Expected: FAIL because `tsconfig.base.json` does not exist or `workspaces` is missing

- [ ] **Step 3: Add root workspace scripts and configuration**

Add this top-level property to `package.json` after `private`:

```json
"workspaces": [
  "apps/*",
  "packages/*"
]
```

Add these scripts while retaining the legacy and runtime scripts:

```json
{
  "test:contracts": "node --test test/contracts/*.test.js",
  "test:new": "vitest run",
  "typecheck:new": "tsc -p packages/contracts/tsconfig.json && tsc -p packages/domain/tsconfig.json",
  "verify:new": "npm run typecheck:new && npm run test:contracts && npm run test:new"
}
```

Create `tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "types": ["node"]
  }
}
```

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["packages/**/*.test.ts"],
    passWithNoTests: false,
  },
});
```

- [ ] **Step 4: Install the new root development tools**

Run:

```bash
npm install --save-dev typescript vitest @types/node
```

Expected: `package.json` and `package-lock.json` contain the three development dependencies

- [ ] **Step 5: Run the workspace configuration contract**

Run:

```bash
node --test test/contracts/workspace-config.test.js
```

Expected: 2 tests pass

- [ ] **Step 6: Verify the legacy application still passes**

Run:

```bash
npm run verify:legacy
```

Expected: 112 legacy tests pass, lint and build exit 0

- [ ] **Step 7: Commit the workspace toolchain**

```bash
git add package.json package-lock.json tsconfig.base.json vitest.config.ts test/contracts/workspace-config.test.js
git commit -m "chore: add TypeScript workspace toolchain"
```

## Task 3: Define Shared Job Contracts

**Files:**
- Create: `packages/contracts/package.json`
- Create: `packages/contracts/tsconfig.json`
- Create: `packages/contracts/src/job-contract.ts`
- Create: `packages/contracts/src/index.ts`
- Create: `packages/contracts/src/job-contract.test.ts`
- Modify: `package-lock.json`

- [ ] **Step 1: Create the contracts package metadata**

Create `packages/contracts/package.json`:

```json
{
  "name": "@novel-analysis/contracts",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "test": "vitest run src",
    "typecheck": "tsc -p tsconfig.json"
  },
  "dependencies": {
    "zod": "^4.0.0"
  }
}
```

Create `packages/contracts/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 2: Write the failing contract tests**

Create `packages/contracts/src/job-contract.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  JobEventSchema,
  JobScopeSchema,
  PublicJobSchema,
} from "./job-contract.js";

const validJob = {
  id: "f57f4ce9-a990-40f4-bf93-452b2a4d003a",
  type: "l2-index",
  status: "running",
  requestedBy: "9d3fcceb-5fb8-4aa5-8db7-8ce32ecbca24",
  scope: {
    bookId: "215243",
    startChapter: 1,
    endChapter: 120,
    indexGroupKeys: ["items"],
    mode: "missing",
  },
  progress: {
    total: 120,
    completed: 40,
    failed: 1,
    skipped: 12,
    current: "第 53 章",
  },
  createdAt: "2026-07-16T10:00:00.000Z",
  updatedAt: "2026-07-16T10:05:00.000Z",
};

describe("job contracts", () => {
  it("accepts a complete public L2 job", () => {
    expect(PublicJobSchema.parse(validJob)).toEqual(validJob);
  });

  it("rejects a reversed chapter range", () => {
    expect(() => JobScopeSchema.parse({
      bookId: "215243",
      startChapter: 120,
      endChapter: 1,
    })).toThrow(/endChapter/);
  });

  it("rejects a book job without a book id", () => {
    expect(() => PublicJobSchema.parse({
      ...validJob,
      scope: { startChapter: 1, endChapter: 120 },
    })).toThrow();
  });

  it("accepts a migration job with migration scope", () => {
    expect(PublicJobSchema.parse({
      ...validJob,
      type: "migration",
      scope: {
        migrationId: "482723a2-92bd-47aa-aa7b-254350e92831",
        sourceLabel: "正式 SQLite 快照",
      },
    }).type).toBe("migration");
  });

  it("rejects an unknown status", () => {
    expect(() => PublicJobSchema.parse({ ...validJob, status: "waiting" })).toThrow();
  });

  it("accepts a persisted progress event", () => {
    expect(JobEventSchema.parse({
      id: 17,
      jobId: validJob.id,
      type: "progress",
      createdAt: "2026-07-16T10:05:00.000Z",
      payload: { completed: 40, total: 120 },
    }).type).toBe("progress");
  });
});
```

- [ ] **Step 3: Run the contracts test to verify it fails**

Run:

```bash
npx vitest run packages/contracts/src/job-contract.test.ts
```

Expected: FAIL because `job-contract.ts` does not exist

- [ ] **Step 4: Implement the complete shared job contract**

Create `packages/contracts/src/job-contract.ts`:

```ts
import { z } from "zod";

export const JOB_TYPES = [
  "import",
  "l1-index",
  "l2-index",
  "query",
  "advanced-analysis",
  "migration",
] as const;

export const JOB_STATUSES = [
  "queued",
  "running",
  "retrying",
  "paused",
  "completed",
  "failed",
  "cancelled",
] as const;

export const JOB_EVENT_TYPES = [
  "created",
  "running",
  "progress",
  "warning",
  "retrying",
  "paused",
  "completed",
  "failed",
  "cancelled",
] as const;

export const JobTypeSchema = z.enum(JOB_TYPES);
export const JobStatusSchema = z.enum(JOB_STATUSES);
export const JobEventTypeSchema = z.enum(JOB_EVENT_TYPES);

export type JobType = z.infer<typeof JobTypeSchema>;
export type JobStatus = z.infer<typeof JobStatusSchema>;
export type JobEventType = z.infer<typeof JobEventTypeSchema>;

export const BookJobScopeSchema = z.object({
  bookId: z.string().trim().min(1),
  startChapter: z.number().int().positive().optional(),
  endChapter: z.number().int().positive().optional(),
  chapterIndexes: z.array(z.number().int().positive()).optional(),
  indexGroupKeys: z.array(z.string().trim().min(1)).optional(),
  mode: z.enum(["all", "missing", "retry_failed"]).optional(),
}).superRefine((scope, context) => {
  if (
    scope.startChapter !== undefined
    && scope.endChapter !== undefined
    && scope.endChapter < scope.startChapter
  ) {
    context.addIssue({
      code: "custom",
      path: ["endChapter"],
      message: "endChapter must be greater than or equal to startChapter",
    });
  }
});

export const MigrationJobScopeSchema = z.object({
  migrationId: z.string().uuid(),
  sourceLabel: z.string().trim().min(1),
});

export const JobScopeSchema = z.union([
  BookJobScopeSchema,
  MigrationJobScopeSchema,
]);

export type BookJobScope = z.infer<typeof BookJobScopeSchema>;
export type MigrationJobScope = z.infer<typeof MigrationJobScopeSchema>;
export type JobScope = z.infer<typeof JobScopeSchema>;

export const JobProgressSchema = z.object({
  total: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  current: z.string(),
});

const PublicJobFields = {
  id: z.string().uuid(),
  status: JobStatusSchema,
  requestedBy: z.string().uuid(),
  progress: JobProgressSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
};

export const PublicJobSchema = z.discriminatedUnion("type", [
  z.object({
    ...PublicJobFields,
    type: z.enum([
      "import",
      "l1-index",
      "l2-index",
      "query",
      "advanced-analysis",
    ]),
    scope: BookJobScopeSchema,
  }),
  z.object({
    ...PublicJobFields,
    type: z.literal("migration"),
    scope: MigrationJobScopeSchema,
  }),
]);

export type PublicJob = z.infer<typeof PublicJobSchema>;

export const JobEventSchema = z.object({
  id: z.number().int().positive(),
  jobId: z.string().uuid(),
  type: JobEventTypeSchema,
  createdAt: z.string().datetime(),
  payload: z.record(z.string(), z.unknown()),
});

export type JobEvent = z.infer<typeof JobEventSchema>;
```

Create `packages/contracts/src/index.ts`:

```ts
export * from "./job-contract.js";
```

- [ ] **Step 5: Install workspace dependencies**

Run:

```bash
npm install
```

Expected: npm links `@novel-analysis/contracts` and records Zod in `package-lock.json`

- [ ] **Step 6: Run the contract tests and typecheck**

Run:

```bash
npx vitest run packages/contracts/src/job-contract.test.ts
npx tsc -p packages/contracts/tsconfig.json
```

Expected: 6 tests pass and TypeScript exits 0

- [ ] **Step 7: Commit shared contracts**

```bash
git add packages/contracts package-lock.json
git commit -m "feat: define shared job contracts"
```

## Task 4: Implement The Domain Job State Machine

**Files:**
- Create: `packages/domain/package.json`
- Create: `packages/domain/tsconfig.json`
- Create: `packages/domain/src/jobs/job-state.ts`
- Create: `packages/domain/src/jobs/job-state.test.ts`
- Create: `packages/domain/src/index.ts`
- Modify: `package-lock.json`

- [ ] **Step 1: Create the domain package metadata**

Create `packages/domain/package.json`:

```json
{
  "name": "@novel-analysis/domain",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "test": "vitest run src",
    "typecheck": "tsc -p tsconfig.json"
  },
  "dependencies": {
    "@novel-analysis/contracts": "*"
  }
}
```

Create `packages/domain/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 2: Write the failing state transition tests**

Create `packages/domain/src/jobs/job-state.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  InvalidJobTransitionError,
  assertJobTransition,
  canTransitionJob,
} from "./job-state.js";

describe("job state transitions", () => {
  it.each([
    ["queued", "running"],
    ["queued", "paused"],
    ["queued", "cancelled"],
    ["running", "retrying"],
    ["running", "paused"],
    ["running", "completed"],
    ["running", "failed"],
    ["running", "cancelled"],
    ["retrying", "running"],
    ["retrying", "paused"],
    ["retrying", "failed"],
    ["retrying", "cancelled"],
    ["paused", "queued"],
    ["paused", "running"],
    ["paused", "cancelled"],
    ["failed", "queued"],
  ] as const)("allows %s -> %s", (from, to) => {
    expect(canTransitionJob(from, to)).toBe(true);
    expect(() => assertJobTransition(from, to)).not.toThrow();
  });

  it.each([
    ["queued", "completed"],
    ["paused", "completed"],
    ["completed", "running"],
    ["failed", "completed"],
    ["cancelled", "running"],
  ] as const)("rejects %s -> %s", (from, to) => {
    expect(canTransitionJob(from, to)).toBe(false);
    expect(() => assertJobTransition(from, to)).toThrow(InvalidJobTransitionError);
  });
});
```

- [ ] **Step 3: Run the state tests to verify they fail**

Run:

```bash
npx vitest run packages/domain/src/jobs/job-state.test.ts
```

Expected: FAIL because `job-state.ts` does not exist

- [ ] **Step 4: Implement the state machine**

Create `packages/domain/src/jobs/job-state.ts`:

```ts
import type { JobStatus } from "@novel-analysis/contracts";

const transitions: Readonly<Record<JobStatus, ReadonlySet<JobStatus>>> = {
  queued: new Set(["running", "paused", "cancelled"]),
  running: new Set(["retrying", "paused", "completed", "failed", "cancelled"]),
  retrying: new Set(["running", "paused", "failed", "cancelled"]),
  paused: new Set(["queued", "running", "cancelled"]),
  completed: new Set(),
  failed: new Set(["queued"]),
  cancelled: new Set(),
};

export class InvalidJobTransitionError extends Error {
  constructor(
    public readonly from: JobStatus,
    public readonly to: JobStatus,
  ) {
    super(`Invalid job transition: ${from} -> ${to}`);
    this.name = "InvalidJobTransitionError";
  }
}

export function canTransitionJob(from: JobStatus, to: JobStatus): boolean {
  return transitions[from].has(to);
}

export function assertJobTransition(from: JobStatus, to: JobStatus): void {
  if (!canTransitionJob(from, to)) {
    throw new InvalidJobTransitionError(from, to);
  }
}
```

Create `packages/domain/src/index.ts`:

```ts
export * from "./jobs/job-state.js";
```

- [ ] **Step 5: Install and link the domain workspace**

Run:

```bash
npm install
```

Expected: npm links `@novel-analysis/domain` and updates `package-lock.json`

- [ ] **Step 6: Run all new package checks**

Run:

```bash
npm run typecheck:new
npm run test:new
```

Expected: TypeScript exits 0 and all contracts and domain tests pass

- [ ] **Step 7: Commit the job state machine**

```bash
git add packages/domain package-lock.json
git commit -m "feat: add persistent job state rules"
```

## Task 5: Add Stable Dify Workflow Version Manifests

**Files:**
- Modify: `dify-workflows/analysis-chapter.workflow.yml`
- Modify: `dify-workflows/analysis-summary.workflow.yml`
- Modify: `dify-workflows/minimal-chapter-fetch.workflow.yml`
- Modify: `dify-workflows/l1-route-index.workflow.yml`
- Modify: `dify-workflows/l2-fact-index.workflow.yml`
- Create: `scripts/generate-dify-workflow-manifest.mjs`
- Create: `test/dify-workflow-manifest.test.js`
- Create: `dify-workflows/manifest.json`
- Modify: `package.json:6-30`

- [ ] **Step 1: Export the current online Dify workflows into the tracked paths**

From the active Dify environment, export each published Workflow and replace the matching tracked file:

```text
分析分章执行 -> dify-workflows/analysis-chapter.workflow.yml
分析汇总执行 -> dify-workflows/analysis-summary.workflow.yml
小说章节原文最小获取 -> dify-workflows/minimal-chapter-fetch.workflow.yml
L1 章节线索索引 -> dify-workflows/l1-route-index.workflow.yml
L2 事实索引 -> dify-workflows/l2-fact-index.workflow.yml
```

Expected: each file is a complete Dify DSL export from the active environment, not a remembered or hand-edited reconstruction

- [ ] **Step 2: Scan exported DSL files for embedded credentials**

Run:

```bash
rg -n 'app-[A-Za-z0-9_-]{8,}|sk-[A-Za-z0-9_-]{8,}|Bearer [A-Za-z0-9._-]+' dify-workflows/*.yml
```

Expected: no output; if output appears, remove the credential from Dify configuration or the export before continuing

- [ ] **Step 3: Write the failing manifest contract**

Create `test/dify-workflow-manifest.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";

const root = new URL("../", import.meta.url);

test("Dify workflow manifest matches every tracked workflow export", async () => {
  const manifest = JSON.parse(await fs.readFile(new URL("dify-workflows/manifest.json", root), "utf8"));
  assert.deepEqual(Object.keys(manifest.workflows), [
    "analysis_chapter",
    "analysis_summary",
    "chapter_import",
    "l1_index",
    "l2_index",
  ]);

  for (const entry of Object.values(manifest.workflows)) {
    const content = await fs.readFile(new URL(entry.file, root));
    const sha256 = crypto.createHash("sha256").update(content).digest("hex");
    assert.equal(entry.sha256, sha256, `${entry.file} hash changed; regenerate the manifest`);
  }
});
```

- [ ] **Step 4: Run the manifest test to verify it fails**

Run:

```bash
node --test test/dify-workflow-manifest.test.js
```

Expected: FAIL because `dify-workflows/manifest.json` does not exist

- [ ] **Step 5: Implement the deterministic manifest generator**

Create `scripts/generate-dify-workflow-manifest.mjs`:

```js
import crypto from "node:crypto";
import fs from "node:fs/promises";

const root = new URL("../", import.meta.url);
const manifestUrl = new URL("dify-workflows/manifest.json", root);

const workflows = {
  analysis_chapter: "dify-workflows/analysis-chapter.workflow.yml",
  analysis_summary: "dify-workflows/analysis-summary.workflow.yml",
  chapter_import: "dify-workflows/minimal-chapter-fetch.workflow.yml",
  l1_index: "dify-workflows/l1-route-index.workflow.yml",
  l2_index: "dify-workflows/l2-fact-index.workflow.yml",
};

const entries = {};

for (const [target, file] of Object.entries(workflows)) {
  const content = await fs.readFile(new URL(file, root));
  entries[target] = {
    file,
    sha256: crypto.createHash("sha256").update(content).digest("hex"),
  };
}

await fs.writeFile(manifestUrl, `${JSON.stringify({ schemaVersion: 1, workflows: entries }, null, 2)}\n`);
```

Add these scripts to `package.json`:

```json
{
  "dify:manifest": "node scripts/generate-dify-workflow-manifest.mjs",
  "dify:manifest:check": "node --test test/dify-workflow-manifest.test.js"
}
```

- [ ] **Step 6: Generate and verify the manifest**

Run:

```bash
npm run dify:manifest
npm run dify:manifest:check
```

Expected: `manifest.json` contains five targets and the test passes

- [ ] **Step 7: Verify regeneration is stable**

Run:

```bash
npm run dify:manifest
git diff --exit-code dify-workflows/manifest.json
```

Expected: no diff after the second generation

- [ ] **Step 8: Commit the online exports and Workflow manifest**

```bash
git add package.json scripts/generate-dify-workflow-manifest.mjs test/dify-workflow-manifest.test.js dify-workflows
git commit -m "chore: track Dify workflow hashes"
```

## Task 6: Add Legacy Dify Normalization Fixtures

**Files:**
- Create: `test/fixtures/dify/chapter-output.json`
- Create: `test/fixtures/dify/l1-output.json`
- Create: `test/fixtures/dify/l2-output.json`
- Create: `test/contracts/dify-normalization.contract.test.js`

- [ ] **Step 1: Create the chapter fixture**

Create `test/fixtures/dify/chapter-output.json`:

```json
{
  "chapters": [
    { "chapter_index": 31, "title": "剑匣", "content": "宁姚取出剑匣。" },
    { "sortid": 32, "chapter_title": "飞剑", "text": "一柄飞剑掠空而过。" }
  ]
}
```

- [ ] **Step 2: Create the L1 fixture**

Create `test/fixtures/dify/l1-output.json`:

```json
{
  "result": "{\"route_schema_version\":\"l1-route-v1\",\"route_summary\":\"宁姚与飞剑相关\",\"route_entities\":[{\"name\":\"宁姚\",\"type\":\"character\",\"aliases\":[],\"role\":\"核心人物\",\"note\":\"持剑者\"}],\"route_keywords\":[\"宁姚\",\"飞剑\"],\"signals\":[{\"category\":\"item\",\"strength\":0.9,\"entities\":[\"宁姚\"],\"keywords\":[\"飞剑\"],\"reason\":\"关键物件\"}],\"category_scores\":{\"item\":0.9},\"has_major_signal\":true,\"confidence\":0.9}"
}
```

- [ ] **Step 3: Create the L2 fixture**

Create `test/fixtures/dify/l2-output.json`:

```json
{
  "output": {
    "chapter_index": 31,
    "chapter_title": "剑匣",
    "facts": [
      {
        "category": "item",
        "entity": "剑匣",
        "aliases": [],
        "tags": ["武器"],
        "related_entities": ["宁姚"],
        "fact_type": "ownership",
        "fact": "宁姚持有剑匣。",
        "evidence": ["宁姚取出剑匣"],
        "importance": 0.8,
        "confidence": 0.9
      }
    ]
  }
}
```

- [ ] **Step 4: Write the contract test against the legacy adapter**

Create `test/contracts/dify-normalization.contract.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

process.env.DIFY_API_BASE = "http://127.0.0.1:9999/v1";
process.env.DIFY_CHAPTER_WORKFLOW_API_KEY = "app-contract";

const dify = await import("../../server/dify.js");

async function fixture(name) {
  return JSON.parse(await fs.readFile(new URL(`../fixtures/dify/${name}.json`, import.meta.url), "utf8"));
}

test("legacy chapter normalization remains a new-adapter contract", async () => {
  const chapters = dify.normalizeDifyChapterOutput(
    await fixture("chapter-output"),
    { bookId: "215243", startChapter: 31, endChapter: 32 },
  );
  assert.deepEqual(chapters.map((chapter) => chapter.chapter_index), [31, 32]);
  assert.deepEqual(chapters.map((chapter) => chapter.chapter_title), ["剑匣", "飞剑"]);
});

test("legacy L1 normalization remains a new-adapter contract", async () => {
  const output = dify.normalizeDifyL1Output(await fixture("l1-output"));
  assert.equal(output.route_schema_version, "l1-route-v1");
  assert.equal(output.route_entities[0].name, "宁姚");
  assert.equal(output.category_scores.item, 0.9);
});

test("legacy L2 normalization remains a new-adapter contract", async () => {
  const output = dify.normalizeDifyL2Output(await fixture("l2-output"));
  assert.equal(output.chapter_index, 31);
  assert.equal(output.facts.length, 1);
  assert.equal(output.facts[0].entity, "剑匣");
  assert.equal(output.facts[0].category, "item");
});
```

- [ ] **Step 5: Run the new Dify contract suite**

Run:

```bash
npm run test:contracts
```

Expected: workspace, manifest, and three normalization contracts pass

- [ ] **Step 6: Verify the original Dify tests remain green**

Run:

```bash
npm run test:legacy
```

Expected: all 112 legacy tests pass

- [ ] **Step 7: Commit Dify contract fixtures**

```bash
git add test/contracts/dify-normalization.contract.test.js test/fixtures/dify
git commit -m "test: freeze Dify normalization contracts"
```

## Task 7: Extend ESLint And Add Dual-Track CI

**Files:**
- Modify: `eslint.config.js:7-30`
- Modify: `package.json:6-30`
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Extend ESLint to the new TypeScript packages**

Install TypeScript ESLint:

```bash
npm install --save-dev typescript-eslint
```

Add this import to `eslint.config.js`:

```js
import tseslint from "typescript-eslint";
```

Add this config entry before the final closing array bracket:

```js
{
  files: ["packages/**/*.ts"],
  extends: [js.configs.recommended, ...tseslint.configs.recommended],
  languageOptions: {
    parser: tseslint.parser,
    parserOptions: {
      projectService: true,
      tsconfigRootDir: import.meta.dirname,
    },
    globals: globals.node,
  },
  rules: {
    "no-unused-vars": "off",
    "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_" }],
  },
}
```

Update `globalIgnores` to include generated caches:

```js
globalIgnores(["dist", "data", "node_modules", "**/*.tsbuildinfo"])
```

- [ ] **Step 2: Define the final root verification scripts**

Set these root scripts in `package.json`:

```json
{
  "test": "npm run test:legacy && npm run test:contracts && npm run test:new",
  "lint": "eslint .",
  "verify:new": "npm run typecheck:new && npm run test:contracts && npm run test:new",
  "verify": "npm run verify:legacy && npm run verify:new && npm run dify:manifest:check"
}
```

- [ ] **Step 3: Run lint to catch configuration errors**

Run:

```bash
npm run lint
```

Expected: ESLint exits 0 for legacy JavaScript and new TypeScript packages

- [ ] **Step 4: Create the GitHub Actions workflow**

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  verify:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 26
          cache: npm
      - run: npm ci
      - run: npm run verify
      - run: npm run lint
      - run: git diff --check
```

- [ ] **Step 5: Run the complete local verification**

Run:

```bash
npm run verify
npm run lint
git diff --check
```

Expected: legacy tests, legacy build, contracts, domain tests, typecheck, manifest check, lint, and diff check all exit 0

- [ ] **Step 6: Review the changed file boundary**

Run:

```bash
git status --short
git diff --stat
```

Expected: only phase 0 workspace, contracts, fixtures, manifest, CI, lockfile, and baseline documentation are changed

- [ ] **Step 7: Commit CI and final phase 0 scripts**

```bash
git add .github/workflows/ci.yml eslint.config.js package.json package-lock.json
git commit -m "ci: verify legacy and new architecture contracts"
```

## Task 8: Phase 0 Completion Gate

**Files:**
- Modify only if verification exposes a phase 0 defect

- [ ] **Step 1: Reinstall from the committed lockfile**

Run:

```bash
rm -rf node_modules
npm ci
```

Expected: clean dependency installation exits 0 and `git status --short` remains empty

- [ ] **Step 2: Run every phase 0 verification command**

Run:

```bash
npm run verify:legacy
npm run verify:new
npm run dify:manifest:check
npm run lint
git diff --check
```

Expected: every command exits 0, with 112 legacy tests and all new tests passing

- [ ] **Step 3: Confirm no legacy production behavior changed**

Run:

```bash
git diff 1f28851 -- src server public vite.config.js
```

Expected: no output

- [ ] **Step 4: Confirm the expected commit sequence**

Run:

```bash
git log --oneline --decorate -7
```

Expected: phase 0 contains focused commits for baseline, toolchain, contracts, state rules, Workflow hashes, fixtures, and CI

- [ ] **Step 5: Record the phase completion in the implementation handoff**

The handoff must include

- exact verification commands and pass counts
- final commit hashes
- any dependency version selected by npm
- confirmation that no root legacy production file changed
- the actual interfaces exported by `@novel-analysis/contracts` and `@novel-analysis/domain`
- inputs required before writing the phase 1 detailed plan
