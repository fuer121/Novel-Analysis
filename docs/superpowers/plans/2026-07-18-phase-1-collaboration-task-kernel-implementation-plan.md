# Phase 1 Collaboration And Task Kernel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付可用测试飞书身份登录、由 PostgreSQL 持久化并由独立 Worker 可恢复执行示例任务的新 API、Worker 与最小 Web 任务中心

**Architecture:** 保持模块化单体和单一 PostgreSQL 数据源，API 只通过 application service 调用 repository，domain 不依赖 HTTP、SQL 或 pg-boss。`jobs`、`job_steps`、`job_attempts`、`job_events` 是产品任务状态唯一真相源；任务与 `job_outbox` 同事务提交，dispatcher 只向 pg-boss 投递唤醒消息，Worker 通过数据库租约和幂等键领取步骤。Web 只消费共享 Zod 契约和 API/SSE，不读取队列内部状态

**Tech Stack:** Node.js、TypeScript 6、Express 5、Zod 4、Kysely、PostgreSQL 17、pg-boss、React 19、React Router 7、TanStack Query 5、Vitest、Supertest、Playwright

---

## 1. Scope And Success Boundary

本计划只实现 Phase 1。共享契约增加专用 `system-demo` 类型和固定 scope `{ scenario: "phase-1-recovery" }`，执行器只等待数据库内可控的两个步骤并写入事件，不读取 SQLite、不调用 Dify、不创建书籍或索引数据。它不会复用 `migration` 类型，避免提前引入 Phase 5 语义

阶段结束时必须可独立演示以下闭环

1. 使用测试飞书身份完成 OAuth state 校验并登录已启用本地成员
2. 成员创建一个无外部模型依赖的示例任务
3. 浏览器刷新和 API 进程重启后，任务仍由 PostgreSQL 查询得到
4. Worker 在第一步持有租约时被终止，租约到期后由新 Worker 恢复第二次 attempt 并完成，且步骤效果只写入一次
5. 重复 outbox 投递和重复 pg-boss 消息不产生重复步骤效果或重复终态事件
6. 成员不能访问成员管理接口，也不能控制他人任务；管理员可以，并且暂停、继续、取消均产生审计记录
7. 新 API、Worker、集成测试和演示脚本完全不导入 `server/db.js`，不打开任何 SQLite 文件

明确排除以下内容

- `books`、`chapters`、`index_groups`、L1、L2、query session、analysis 数据模型与页面
- Dify client、五条 Workflow 的新执行器或在线配置管理
- SQLite 迁移器、双写、旧任务 Map 适配
- 旧根目录应用重构、旧 112 个测试修改、五个 `dify-workflows/*.yml` 修改
- npm 安全公告修复、GitHub Actions SHA 固定或无关依赖升级

## 2. Dependency Direction

```text
apps/web -> packages/contracts
apps/api -> packages/contracts -> packages/domain
apps/api -> packages/database + packages/jobs
apps/worker -> packages/database + packages/jobs -> packages/domain
packages/jobs -> packages/database + packages/domain + packages/contracts
packages/database -> Kysely/pg only
packages/domain -> packages/contracts only
```

禁止反向依赖：`packages/domain` 不导入 Express/Kysely/pg-boss，`packages/database` 不导入 apps，`packages/jobs` 不导入 API 路由，Web 不导入 database/jobs。OAuth adapter 位于 `apps/api`，其 fake 通过依赖注入替换，不在生产代码里根据任意请求参数绕过认证

## 3. File Responsibility Map

| Path | Responsibility |
| --- | --- |
| `compose.yaml` | 固定本地和测试 PostgreSQL 服务与健康检查 |
| `.env.phase1.example` | 新 API/Worker/Web 所需的非密钥示例配置 |
| `packages/database/src/db.ts` | Kysely 数据库类型、连接创建与销毁 |
| `packages/database/src/migrate.ts` | 唯一 migration runner |
| `packages/database/src/migrations/001_collaboration.ts` | users、identity、session、audit schema |
| `packages/database/src/migrations/002_jobs.ts` | jobs、steps、attempts、events、outbox schema |
| `packages/database/src/testing/postgres.ts` | 真实 PostgreSQL 测试库创建、迁移、清理 |
| `packages/domain/src/auth/rbac.ts` | admin/member 权限决策 |
| `packages/contracts/src/job-contract.ts` | progress 总量不变量与公开 API 契约 |
| `packages/jobs/src/job-repository.ts` | 任务查询、创建、状态迁移和事件原子写入 |
| `packages/jobs/src/outbox-dispatcher.ts` | outbox claim、pg-boss send、delivered 标记 |
| `packages/jobs/src/step-leases.ts` | 步骤领取、续租、完成、过期恢复和 attempt |
| `packages/jobs/src/example-executor.ts` | Phase 1 两步示例任务，不依赖任何外部模型 |
| `apps/api/src/auth/*` | OAuth adapter、state、session cookie、CSRF 与鉴权 middleware |
| `apps/api/src/routes/*` | auth、admin members、jobs、SSE HTTP 映射 |
| `apps/api/src/app.ts` | Express composition root，不包含业务规则 |
| `apps/worker/src/main.ts` | pg-boss consumer、dispatcher 与 lease recovery 生命周期 |
| `apps/web/src/features/auth/*` | 登录和当前用户查询 |
| `apps/web/src/features/task-center/*` | 任务列表、详情、控制和 SSE 缓存投影 |
| `apps/web/src/app/*` | Router、QueryClient、全局壳与权限导航 |
| `test/phase1/*` | 跨进程 PostgreSQL、API、Worker、重启与安全集成测试 |

## 4. Security And Transaction Boundaries

- OAuth `state` 为 32 字节随机值，只在服务端保存其 SHA-256，5 分钟过期、单次消费，并把回跳路径限制为站内相对路径
- OAuth adapter 只返回飞书稳定身份 `unionId`、显示名和头像；只有 `auth_identities(provider, subject)` 已映射且 `users.status = 'active'` 才可创建 session
- session token 使用 32 字节随机值，数据库只存 SHA-256；生产 Cookie 名为 `__Host-na_session`，属性固定 `HttpOnly; Secure; SameSite=Lax; Path=/`。纯 HTTP 集成测试显式使用 `na_session_test` 且关闭 `Secure`，不能以生产 Cookie 名发送不符合 `__Host-` 规则的 Cookie
- 所有写接口要求同源 `Origin`，并要求 `X-CSRF-Token` 与 session 行内的 CSRF token hash 匹配；OAuth callback 只接受 state/code，不接受 session cookie 作为授权依据
- RBAC 在 application service 入口执行，路由隐藏不能代替服务端校验；成员只能控制 `requested_by` 为自己的任务，管理员可控制全部任务
- 成员变更与任务控制在同一个数据库事务内写业务状态和 `audit_logs`；审计 metadata 只存 ID、动作、from/to，不存 Cookie、OAuth code、正文或密钥
- 创建任务事务只写 `jobs`、初始 `job_steps`、`job_events(created)`、`job_outbox`。事务提交后 dispatcher 才调用 pg-boss；任何数据库事务都不跨网络调用
- dispatcher 以 `FOR UPDATE SKIP LOCKED` claim outbox；`pg-boss.send` 使用稳定 singleton key `outbox:<outbox_id>`。投递后更新 `delivered_at`，崩溃导致重投时仍由 singleton key 和步骤 claim 双重去重
- Worker 收到消息后只把它视为唤醒信号。步骤效果以 `job_steps.idempotency_key` 唯一，领取时原子设置 lease；完成步骤、完成 attempt、写 progress/event、必要时推进 job 均在同一事务
- Worker 网络外调用在 Phase 1 不存在；未来外部调用必须位于租约事务之外。Phase 1 recovery 只证明过期 lease 可重新领取并产生新 attempt，完成效果不重复
- SSE 的游标是 `job_events.id`。初次连接从 `Last-Event-ID` 或 `after` 恢复数据库事件，再通过短轮询读取新行；API 内存只保存连接，不保存产品进度

## 5. Dependency Selection Rule

只添加 Phase 1 直接使用的包。实施当天先运行 `npm view <package> version`，把结果与本计划记录的已核验版本比较；若仍一致，使用 `npm install --save-exact`，若不同则停下记录差异，不自动选择更新版本。2026-07-18 已核验版本为 Kysely `0.29.4`、pg `8.22.0`、pg-boss `12.26.1`、cookie-parser `1.4.7`、helmet `8.3.0`、React Router DOM `7.18.1`、TanStack Query `5.101.2`、Supertest `7.2.2`、`@types/express` `5.0.6`、tsx `4.23.1`、Testing Library React `16.3.2`、Testing Library jest-dom `6.9.1`、jsdom `29.1.1`、Playwright Test `1.61.1`。保留现有 React `19.2.6`、React DOM `19.2.6`、Express `5.2.1`、Zod `4.4.3`、Lucide React `1.16.0`、TypeScript、Vite、Vitest 版本，不运行 `npm update` 或 `npm audit fix`

PostgreSQL 使用 `postgres:17.5-bookworm`，首次拉取后以 `docker image inspect postgres:17.5-bookworm --format '{{index .RepoDigests 0}}'` 记录本机解析出的 digest；若 tag 不可用则停止，不静默换 major/minor

## 6. Task Sequence

### Task 1: Close Phase 0 Contract Invariants

**Files:**
- Modify: `packages/contracts/src/job-contract.ts`
- Modify: `packages/contracts/src/job-contract.test.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/domain/src/jobs/job-state.test.ts`

- [ ] **Step 1: Write the failing progress and exhaustive transition tests**

Add these cases to `packages/contracts/src/job-contract.test.ts`

```ts
it.each([
  { total: 1, completed: 2, failed: 0, skipped: 0, current: "" },
  { total: 3, completed: 2, failed: 1, skipped: 1, current: "" },
])("rejects progress counters beyond total: %o", (progress) => {
  expect(() => JobProgressSchema.parse(progress)).toThrow(/completed \+ failed \+ skipped/);
});

it("accepts progress whose accounted counters equal total", () => {
  expect(JobProgressSchema.parse({
    total: 3, completed: 1, failed: 1, skipped: 1, current: "完成",
  })).toMatchObject({ total: 3, completed: 1, failed: 1, skipped: 1 });
});
```

Also add the dedicated Phase 1 demo contract and a parsing test

```ts
export const SystemDemoJobScopeSchema = z.strictObject({
  scenario: z.literal("phase-1-recovery"),
});

expect(PublicJobSchema.parse({
  ...validJob,
  type: "system-demo",
  scope: { scenario: "phase-1-recovery" },
}).type).toBe("system-demo");
```

Add `"system-demo"` to `JOB_TYPES`, add `SystemDemoJobScopeSchema` to `JobScopeSchema`, add a `system-demo` branch to `PublicJobSchema`, and re-export its inferred `SystemDemoJobScope` type from `packages/contracts/src/index.ts`. Do not weaken either existing strict scope schema

Replace the five rejected pairs in `packages/domain/src/jobs/job-state.test.ts` with a generated exhaustive matrix and explicit diagnostic assertions

```ts
const statuses = [
  "queued", "running", "retrying", "paused", "completed", "failed", "cancelled",
] as const;
const allowed = new Set([
  "queued:running", "queued:paused", "queued:cancelled",
  "running:retrying", "running:paused", "running:completed", "running:failed", "running:cancelled",
  "retrying:running", "retrying:paused", "retrying:failed", "retrying:cancelled",
  "paused:queued", "paused:running", "paused:cancelled", "failed:queued",
]);
const rejected = statuses.flatMap((from) =>
  statuses.filter((to) => !allowed.has(`${from}:${to}`)).map((to) => [from, to] as const),
);

it("enumerates exactly 33 rejected transitions", () => {
  expect(rejected).toHaveLength(33);
});

it.each(rejected)("rejects %s -> %s with stable diagnostics", (from, to) => {
  expect(canTransitionJob(from, to)).toBe(false);
  try {
    assertJobTransition(from, to);
    throw new Error("expected assertJobTransition to throw");
  } catch (error) {
    expect(error).toBeInstanceOf(InvalidJobTransitionError);
    expect(error).toMatchObject({
      name: "InvalidJobTransitionError",
      from,
      to,
      message: `Invalid job transition: ${from} -> ${to}`,
    });
  }
});
```

- [ ] **Step 2: Run the focused tests and confirm the progress cases fail**

Run: `npm run test:new -- packages/contracts/src/job-contract.test.ts packages/domain/src/jobs/job-state.test.ts`

Expected: progress cases fail because `JobProgressSchema` accepts accounted counters greater than `total`; the matrix reports 33 rejected pairs

- [ ] **Step 3: Add the minimal progress invariant**

Replace `JobProgressSchema` with

```ts
export const JobProgressSchema = z.object({
  total: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  current: z.string(),
}).superRefine((progress, context) => {
  if (progress.completed + progress.failed + progress.skipped > progress.total) {
    context.addIssue({
      code: "custom",
      path: ["completed"],
      message: "completed + failed + skipped must be less than or equal to total",
    });
  }
});
```

- [ ] **Step 4: Verify contracts and domain**

Run: `npm run typecheck:new && npm run test:new`

Expected: typecheck exits 0; all contract/domain tests pass, including 33 rejected transitions and error fields

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/job-contract.ts packages/contracts/src/job-contract.test.ts packages/contracts/src/index.ts packages/domain/src/jobs/job-state.test.ts
git commit -m "fix: enforce job progress invariants"
```

### Task 2: Add Phase 1 Workspaces And PostgreSQL Environment

**Files:**
- Create: `compose.yaml`
- Create: `.env.phase1.example`
- Create: `packages/database/package.json`
- Create: `packages/database/tsconfig.json`
- Create: `packages/jobs/package.json`
- Create: `packages/jobs/tsconfig.json`
- Create: `apps/api/package.json`
- Create: `apps/api/tsconfig.json`
- Create: `apps/worker/package.json`
- Create: `apps/worker/tsconfig.json`
- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `vitest.config.ts`
- Create: `vitest.integration.config.ts`
- Modify: `eslint.config.js`
- Modify: `.gitignore`
- Create: `test/contracts/phase1-workspaces.contract.test.js`

- [ ] **Step 1: Add a failing workspace contract test**

Create `test/contracts/phase1-workspaces.contract.test.js`

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("phase 1 workspaces expose required verification scripts", async () => {
  const root = JSON.parse(await readFile(new URL("../../package.json", import.meta.url)));
  for (const script of ["db:migrate", "test:integration", "typecheck:phase1", "verify:phase1"]) {
    assert.equal(typeof root.scripts[script], "string", `missing ${script}`);
  }
  for (const path of ["../../apps/api/package.json", "../../apps/worker/package.json", "../../apps/web/package.json", "../../packages/database/package.json", "../../packages/jobs/package.json"]) {
    const workspace = JSON.parse(await readFile(new URL(path, import.meta.url)));
    assert.equal(workspace.private, true);
  }
});
```

- [ ] **Step 2: Confirm the workspace test fails**

Run: `node --test test/contracts/phase1-workspaces.contract.test.js`

Expected: FAIL with `missing db:migrate` or `ENOENT` for the first absent workspace

- [ ] **Step 3: Create workspace manifests, then install only approved exact dependencies**

Create the ten package/tsconfig files listed above before invoking npm. Package names are exactly `@novel-analysis/database`, `@novel-analysis/jobs`, `@novel-analysis/api`, `@novel-analysis/worker`, and `@novel-analysis/web`; each package is private ESM, each has `typecheck: tsc -p tsconfig.json`, and Web additionally has `test: vitest run` and `build: vite build`. The API/Worker/Jobs manifests declare only the workspace packages they import using `"*"`

Run the version checks from section 5, then run

```bash
npm install --save-exact -w packages/database kysely@0.29.4 pg@8.22.0
npm install --save-exact -D -w packages/database @types/pg@8.20.0
npm install --save-exact -w packages/jobs pg-boss@12.26.1
npm install --save-exact -w apps/api express@5.2.1 zod@4.4.3 cookie-parser@1.4.7 helmet@8.3.0
npm install --save-exact -D -w apps/api @types/express@5.0.6 @types/cookie-parser@1.4.10 supertest@7.2.2 @types/supertest@7.2.1
npm install --save-exact -w apps/web react@19.2.6 react-dom@19.2.6 react-router-dom@7.18.1 @tanstack/react-query@5.101.2 lucide-react@1.16.0
npm install --save-exact -D -w apps/web @testing-library/react@16.3.2 @testing-library/jest-dom@6.9.1 jsdom@29.1.1
npm install --save-exact -D tsx@4.23.1 @playwright/test@1.61.1
```

Each new workspace uses `"type": "module"`, `"private": true`, local workspace dependencies as `"*"`, and `tsconfig.json` extending `../../tsconfig.base.json`. Add root scripts

```json
{
  "db:migrate": "tsx packages/database/src/migrate.ts",
  "test:integration": "vitest run --config vitest.integration.config.ts",
  "typecheck:phase1": "npm run typecheck -w packages/database && npm run typecheck -w packages/jobs && npm run typecheck -w apps/api && npm run typecheck -w apps/worker && npm run typecheck -w apps/web",
  "verify:phase1": "npm run typecheck:phase1 && npm run test:new && npm run test:integration && npm run build -w apps/web"
}
```

Extend ESLint TypeScript files to `['packages/**/*.ts', 'apps/**/*.{ts,tsx}']`, browser globals only for `apps/web`, and Vitest unit includes to `packages/**/*.test.ts` plus `apps/**/*.test.ts`

Create `vitest.integration.config.ts`

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "packages/**/*.integration.test.ts",
      "apps/**/*.integration.test.ts",
    ],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
```

- [ ] **Step 4: Add the isolated PostgreSQL service**

Create `compose.yaml`

```yaml
services:
  postgres:
    image: postgres:17.5-bookworm
    environment:
      POSTGRES_USER: novel
      POSTGRES_PASSWORD: novel_dev_only
      POSTGRES_DB: novel_analysis
    ports:
      - "127.0.0.1:55432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U novel -d novel_analysis"]
      interval: 2s
      timeout: 3s
      retries: 20
    volumes:
      - phase1-postgres:/var/lib/postgresql/data
volumes:
  phase1-postgres:
```

Create `.env.phase1.example` with `DATABASE_URL=postgres://novel:novel_dev_only@127.0.0.1:55432/novel_analysis`, `TEST_DATABASE_URL=postgres://novel:novel_dev_only@127.0.0.1:55432/postgres`, `APP_ORIGIN=https://novel.test`, `SESSION_COOKIE_SECURE=true`, `FEISHU_AUTHORIZE_URL=https://accounts.feishu.cn/open-apis/authen/v1/authorize`, `FEISHU_TOKEN_URL=https://open.feishu.cn/open-apis/authen/v2/oauth/token`, `FEISHU_CLIENT_ID=cli_replace_me`, and `FEISHU_CLIENT_SECRET=replace_me`. These are inert example values, not real secrets. Add `.env.phase1` and Playwright artifacts to `.gitignore`

- [ ] **Step 5: Verify clean workspace resolution and PostgreSQL health**

Run: `npm ci && npm ls --workspaces --depth=0 && docker compose up -d postgres && docker compose exec -T postgres pg_isready -U novel -d novel_analysis`

Expected: all commands exit 0; final output contains `accepting connections`; `npm ls` has no invalid peer/dependency markers

Run: `node --test test/contracts/phase1-workspaces.contract.test.js`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add compose.yaml .env.phase1.example .gitignore package.json package-lock.json vitest.config.ts eslint.config.js vitest.integration.config.ts test/contracts/phase1-workspaces.contract.test.js apps packages/database packages/jobs
git commit -m "chore: add phase 1 runtime workspaces"
```

### Task 3: Build Real PostgreSQL Migration And Test Harness

**Files:**
- Create: `packages/database/src/db.ts`
- Create: `packages/database/src/migrate.ts`
- Create: `packages/database/src/migrations/index.ts`
- Create: `packages/database/src/migrations/001_collaboration.ts`
- Create: `packages/database/src/testing/postgres.ts`
- Create: `packages/database/src/collaboration.integration.test.ts`
- Create: `packages/database/src/index.ts`

- [ ] **Step 1: Write the failing real-database migration test**

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createIsolatedDatabase } from "./testing/postgres.js";

const testDb = createIsolatedDatabase("collaboration");
beforeAll(() => testDb.start());
afterAll(() => testDb.stop());

describe("collaboration migration", () => {
  it("creates collaboration tables and rejects duplicate identities", async () => {
    const names = await testDb.tableNames();
    expect(names).toEqual(expect.arrayContaining(["users", "auth_identities", "sessions", "oauth_states", "audit_logs"]));
    const userId = await testDb.insertUser({ role: "member", status: "active" });
    await testDb.insertIdentity(userId, "feishu", "union-1");
    await expect(testDb.insertIdentity(userId, "feishu", "union-1")).rejects.toMatchObject({ code: "23505" });
  });
});
```

- [ ] **Step 2: Confirm migration test fails before tables exist**

Run: `TEST_DATABASE_URL=postgres://novel:novel_dev_only@127.0.0.1:55432/novel_analysis_test npm run test:integration -- packages/database/src/collaboration.integration.test.ts`

Expected: FAIL because `createIsolatedDatabase` or migration `001_collaboration` is absent

- [ ] **Step 3: Implement connection, isolation and collaboration migration**

`createIsolatedDatabase(name)` must connect to the admin database, create a random database named `na_test_<name>_<hex>`, run Kysely `Migrator`, and terminate all connections before dropping it in `stop()`. Never fall back to SQLite or an in-memory adapter

Migration `001_collaboration.ts` must emit the equivalent of this complete schema

```sql
create type user_role as enum ('admin', 'member');
create type user_status as enum ('active', 'disabled');
create table users (
  id uuid primary key,
  display_name text not null,
  avatar_url text,
  role user_role not null,
  status user_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table auth_identities (
  id uuid primary key,
  user_id uuid not null references users(id) on delete cascade,
  provider text not null check (provider = 'feishu'),
  subject text not null,
  created_at timestamptz not null default now(),
  unique (provider, subject)
);
create table sessions (
  id uuid primary key,
  user_id uuid not null references users(id) on delete cascade,
  token_hash text not null unique,
  csrf_token_hash text not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index sessions_active_lookup on sessions(token_hash, expires_at) where revoked_at is null;
create table oauth_states (
  state_hash text primary key,
  return_to text not null check (return_to like '/%'),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create table audit_logs (
  id bigint generated always as identity primary key,
  actor_user_id uuid references users(id),
  action text not null,
  target_type text not null,
  target_id text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_created_at on audit_logs(created_at desc);
```

The down migration drops tables in reverse foreign-key order and then drops both enum types. `migrate.ts` exits nonzero on migration error and always destroys the pool

- [ ] **Step 4: Verify migration up, down, and fresh up**

Run: `npm run test:integration -- packages/database/src/collaboration.integration.test.ts`

Expected: PASS against a real PostgreSQL database

Run: `DATABASE_URL=postgres://novel:novel_dev_only@127.0.0.1:55432/novel_analysis npm run db:migrate`

Expected: exit 0 and report migration `001_collaboration` applied; a second run reports no pending migration

- [ ] **Step 5: Commit**

```bash
git add packages/database/src
git commit -m "feat: add collaboration database schema"
```

### Task 4: Implement Sessions, OAuth State, And Feishu Adapter

**Files:**
- Create: `apps/api/src/config.ts`
- Create: `apps/api/src/auth/crypto-tokens.ts`
- Create: `apps/api/src/auth/feishu-adapter.ts`
- Create: `apps/api/src/auth/feishu-http-adapter.ts`
- Create: `apps/api/src/auth/feishu-fake.ts`
- Create: `apps/api/src/auth/auth-service.ts`
- Create: `apps/api/src/auth/session-middleware.ts`
- Create: `apps/api/src/routes/auth.ts`
- Create: `apps/api/src/app.ts`
- Create: `apps/api/src/auth/auth.integration.test.ts`

- [ ] **Step 1: Write failing OAuth security tests**

Use Supertest with `FeishuFake({ "valid-code": { unionId: "union-admin", displayName: "测试管理员" } })`. Insert one active mapped admin and assert

```ts
it("consumes state once and issues only hashed server-side sessions", async () => {
  const start = await request(app).get("/api/auth/feishu/start?returnTo=/tasks").expect(302);
  const state = new URL(start.headers.location).searchParams.get("state");
  const callback = await request(app).get(`/api/auth/feishu/callback?code=valid-code&state=${state}`).expect(302);
  expect(callback.headers["set-cookie"][0]).toMatch(/^na_session_test=.*HttpOnly.*SameSite=Lax/);
  await request(app).get(`/api/auth/feishu/callback?code=valid-code&state=${state}`).expect(400);
  expect(await db.selectFrom("sessions").select("token_hash").executeTakeFirstOrThrow())
    .not.toMatchObject({ token_hash: callback.headers["set-cookie"][0].split("=")[1].split(";")[0] });
});

it.each(["unknown-code", "disabled-code", "unmapped-code"])("rejects %s without a session", async (code) => {
  const state = await issueState(app);
  const response = await request(app).get(`/api/auth/feishu/callback?code=${code}&state=${state}`);
  expect([401, 403]).toContain(response.status);
  expect(response.headers["set-cookie"]).toBeUndefined();
});
```

Also assert an expired state, altered state, absolute `returnTo`, revoked session, and expired session are rejected

- [ ] **Step 2: Confirm authentication tests fail**

Run: `npm run test:integration -- apps/api/src/auth/auth.integration.test.ts`

Expected: FAIL because the auth application and adapter interfaces do not exist

- [ ] **Step 3: Implement the adapter and service boundary**

Use this interface exactly

```ts
export interface FeishuIdentity {
  unionId: string;
  displayName: string;
  avatarUrl: string | null;
}
export interface FeishuOAuthAdapter {
  authorizationUrl(input: { state: string; redirectUri: string }): URL;
  exchangeCode(input: { code: string; redirectUri: string }): Promise<FeishuIdentity>;
}
```

`AuthService.startLogin(returnTo)` validates `returnTo` with `/^\/(?!\/)/`, creates 32 random bytes, stores only `sha256(state)`, and returns the adapter URL. `finishLogin` atomically consumes a live state with the following predicate and returning column, exchanges the code, joins identity to active user, creates random session and CSRF values, stores only their hashes, and returns raw values once to the route

```sql
update oauth_states
set consumed_at = now()
where state_hash = $1 and consumed_at is null and expires_at > now()
returning return_to;
```

`FeishuHttpAdapter` uses configured endpoints, `client_id`, `client_secret`, an AbortSignal timeout, checks `response.ok`, validates response JSON with a local Zod schema, and throws sanitized error codes without embedding code, secret, or provider response body. `FeishuFake` exists only as a constructor-injected test utility; production `main.ts` always constructs the HTTP adapter

- [ ] **Step 4: Set cookie and CSRF-safe session middleware**

The callback derives `cookieName` as `__Host-na_session` when `sessionCookieSecure` is true and `na_session_test` otherwise, then sets

```ts
response.cookie(cookieName, result.sessionToken, {
  httpOnly: true,
  secure: config.sessionCookieSecure,
  sameSite: "lax",
  path: "/",
  maxAge: config.sessionTtlMs,
});
response.redirect(303, result.returnTo);
```

`GET /api/auth/me` returns `{ user: { id, displayName, role }, csrfToken }`; logout requires CSRF, revokes the row, clears the same cookie attributes, and returns 204. `createApp(dependencies)` initially composes Helmet, a `64kb` JSON limit, cookie parsing, request ID, auth middleware, and auth routes; later tasks extend this same composition root

- [ ] **Step 5: Verify auth and secret redaction**

Run: `npm run test:integration -- apps/api/src/auth/auth.integration.test.ts`

Expected: PASS; only active mapped identity logs in, state cannot be replayed, raw session token is absent from PostgreSQL, and error bodies contain no OAuth code/client secret

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/config.ts apps/api/src/auth apps/api/src/routes/auth.ts apps/api/src/app.ts
git commit -m "feat: add secure Feishu session authentication"
```

### Task 5: Add RBAC, Member Administration, And Audit

**Files:**
- Create: `packages/domain/src/auth/rbac.ts`
- Create: `packages/domain/src/auth/rbac.test.ts`
- Modify: `packages/domain/src/index.ts`
- Create: `apps/api/src/auth/authorize.ts`
- Create: `apps/api/src/bootstrap-admin.ts`
- Create: `apps/api/src/routes/admin-members.ts`
- Create: `apps/api/src/routes/admin-members.integration.test.ts`
- Modify: `apps/api/src/app.ts`

- [ ] **Step 1: Write failing domain and HTTP authorization tests**

```ts
it.each([
  ["member", "members:manage", false],
  ["member", "system:configure", false],
  ["member", "audit:read", false],
  ["admin", "members:manage", true],
  ["admin", "system:configure", true],
  ["admin", "audit:read", true],
] as const)("%s / %s => %s", (role, permission, expected) => {
  expect(hasPermission(role, permission)).toBe(expected);
});
```

Integration tests assert unauthenticated `401`, member `403`, admin `201` when creating a mapped member, duplicate Feishu subject `409`, and that role/status changes produce one audit row with actor, target and before/after only. Bootstrap tests assert an empty database creates exactly one active admin mapped to the configured Feishu union ID, rerunning with the same ID is idempotent, and running with a different ID after any user exists exits nonzero without changes

- [ ] **Step 2: Confirm tests fail**

Run: `npm run test:new -- packages/domain/src/auth/rbac.test.ts && npm run test:integration -- apps/api/src/routes/admin-members.integration.test.ts`

Expected: first command FAIL because RBAC module is absent; after adding only the domain module, HTTP test still FAIL because admin routes are absent

- [ ] **Step 3: Implement explicit permission matrix and transaction**

```ts
export const PERMISSIONS = ["members:manage", "system:configure", "audit:read", "jobs:control:any"] as const;
export type Permission = typeof PERMISSIONS[number];
export type UserRole = "admin" | "member";
const matrix: Record<UserRole, ReadonlySet<Permission>> = {
  admin: new Set(PERMISSIONS),
  member: new Set(),
};
export const hasPermission = (role: UserRole, permission: Permission) => matrix[role].has(permission);
```

Implement `GET /api/admin/members`, `POST /api/admin/members`, and `PATCH /api/admin/members/:id`. All require `members:manage`; both writes additionally require same-origin and CSRF. User/identity changes and `audit_logs` insert share one Kysely transaction; disabling a user also revokes all active sessions in that transaction. The GET response returns only user ID, display name, role, status, masked Feishu subject, and timestamps

Implement `bootstrap-admin.ts` as a one-time deployment command requiring `BOOTSTRAP_FEISHU_UNION_ID` and `BOOTSTRAP_ADMIN_NAME`. It takes PostgreSQL advisory transaction lock `71006101`, counts users, creates one active admin plus its Feishu identity only when the count is zero, returns success when the sole matching admin already exists, and refuses every other nonempty state. It writes `system.bootstrap_admin` audit metadata without storing environment values beyond the mapped subject already required by `auth_identities`

- [ ] **Step 4: Verify service-side denial and audit atomicity**

Run: `npm run test:new -- packages/domain/src/auth/rbac.test.ts && npm run test:integration -- apps/api/src/routes/admin-members.integration.test.ts`

Expected: PASS; member request changes zero rows and writes zero audit rows, admin changes one target and writes one audit row

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/auth packages/domain/src/index.ts apps/api/src/auth/authorize.ts apps/api/src/bootstrap-admin.ts apps/api/src/routes/admin-members.ts apps/api/src/routes/admin-members.integration.test.ts apps/api/src/app.ts
git commit -m "feat: enforce member administration RBAC"
```

### Task 6: Add Persistent Job Schema And Atomic Repository

**Files:**
- Create: `packages/database/src/migrations/002_jobs.ts`
- Modify: `packages/database/src/migrations/index.ts`
- Create: `packages/jobs/src/job-repository.ts`
- Create: `packages/jobs/src/job-repository.integration.test.ts`
- Create: `packages/jobs/src/index.ts`

- [ ] **Step 1: Write failing repository transaction tests**

Test that `createExampleJob` creates exactly one job, two ordered steps, one `created` event and one pending outbox row. Force an event insert failure inside a test transaction and assert none of the four tables retains rows. Call twice with the same request id and assert the same job is returned

```ts
const first = await repository.createExampleJob({ requestedBy, requestId: "req-001" });
const second = await repository.createExampleJob({ requestedBy, requestId: "req-001" });
expect(second.id).toBe(first.id);
expect(await counts(db)).toEqual({ jobs: 1, steps: 2, events: 1, outbox: 1 });
```

- [ ] **Step 2: Confirm the repository test fails**

Run: `npm run test:integration -- packages/jobs/src/job-repository.integration.test.ts`

Expected: FAIL because migration `002_jobs` and repository are absent

- [ ] **Step 3: Implement the complete Phase 1 job schema**

Migration `002_jobs.ts` emits equivalent SQL

```sql
create type job_status as enum ('queued','running','retrying','paused','completed','failed','cancelled');
create type job_step_status as enum ('queued','running','completed','failed','cancelled');
create table jobs (
  id uuid primary key,
  type text not null,
  status job_status not null,
  requested_by uuid not null references users(id),
  request_id text not null,
  scope jsonb not null,
  config_snapshot jsonb not null default '{}'::jsonb,
  concurrency_key text not null,
  progress jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (requested_by, request_id)
);
create unique index jobs_active_concurrency on jobs(concurrency_key)
  where status in ('queued','running','retrying','paused');
create table job_steps (
  id uuid primary key,
  job_id uuid not null references jobs(id) on delete cascade,
  position integer not null check (position > 0),
  kind text not null,
  status job_step_status not null default 'queued',
  input_signature text not null,
  idempotency_key text not null unique,
  output_ref jsonb,
  lease_owner text,
  lease_expires_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_id, position)
);
create index job_steps_claim on job_steps(status, lease_expires_at, position);
create table job_attempts (
  id uuid primary key,
  step_id uuid not null references job_steps(id) on delete cascade,
  attempt_no integer not null check (attempt_no > 0),
  worker_id text not null,
  status text not null check (status in ('running','completed','abandoned','failed')),
  error_code text,
  error_message text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (step_id, attempt_no)
);
create table job_events (
  id bigint generated always as identity primary key,
  job_id uuid not null references jobs(id) on delete cascade,
  type text not null,
  dedupe_key text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (job_id, dedupe_key)
);
create index job_events_resume on job_events(job_id, id);
create table job_outbox (
  id uuid primary key,
  job_id uuid not null references jobs(id) on delete cascade,
  topic text not null,
  payload jsonb not null,
  available_at timestamptz not null default now(),
  claimed_by text,
  claim_expires_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now()
);
create index job_outbox_pending on job_outbox(available_at, created_at) where delivered_at is null;
```

The example job has type `system-demo`, scope `{ scenario: "phase-1-recovery" }`, concurrency key `phase1-demo:<requestedBy>:<requestId>`, progress `{ total: 2, completed: 0, failed: 0, skipped: 0, current: "等待执行" }`, and steps `prepare`/`finish` with SHA-256 input signatures and stable idempotency keys `<jobId>:1` and `<jobId>:2`

- [ ] **Step 4: Verify atomicity and migration rollback**

Run: `npm run test:integration -- packages/jobs/src/job-repository.integration.test.ts`

Expected: PASS; exact counts are 1/2/1/1 after duplicate request, and forced transaction failure leaves 0 rows

- [ ] **Step 5: Commit**

```bash
git add packages/database/src/migrations packages/jobs/src/job-repository.ts packages/jobs/src/job-repository.integration.test.ts packages/jobs/src/index.ts
git commit -m "feat: persist jobs events and outbox atomically"
```

### Task 7: Implement Audited Task Controls

**Files:**
- Modify: `packages/jobs/src/job-repository.ts`
- Create: `packages/jobs/src/job-controls.integration.test.ts`
- Create: `apps/api/src/routes/jobs.ts`
- Create: `apps/api/src/routes/jobs.integration.test.ts`
- Modify: `apps/api/src/app.ts`

- [ ] **Step 1: Write failing ownership, transition, CSRF and audit tests**

Cover member-own pause/resume/cancel, member-other `403`, admin-other success, invalid transition `409`, missing/wrong Origin `403`, missing/wrong CSRF `403`, missing/blank `Idempotency-Key` `400`, and rollback when audit insert fails. Assert audit actions exactly `job.pause`, `job.resume`, `job.cancel` with `{ from, to, requestId }`

- [ ] **Step 2: Confirm controls fail before implementation**

Run: `npm run test:integration -- packages/jobs/src/job-controls.integration.test.ts apps/api/src/routes/jobs.integration.test.ts`

Expected: FAIL because `controlJob` and `/api/jobs/:id/{pause,resume,cancel}` do not exist

- [ ] **Step 3: Implement control transitions in one transaction**

Lock the job `for update`, authorize owner or `jobs:control:any`, map pause to `paused`, resume to `queued`, and cancel to `cancelled`, call `assertJobTransition`, update job, add deduplicated event key `control:<action>:<Idempotency-Key>`, insert audit log with the same request ID, and enqueue an outbox wake only for resume. Repeating the same control key returns the already recorded result without a second event/audit row. Return 404 without revealing ownership when job does not exist; return structured `409 { code: "INVALID_JOB_TRANSITION", from, to }`

Routes are exactly

```text
POST /api/jobs/:id/pause
POST /api/jobs/:id/resume
POST /api/jobs/:id/cancel
```

- [ ] **Step 4: Verify all control and audit cases**

Run: `npm run test:integration -- packages/jobs/src/job-controls.integration.test.ts apps/api/src/routes/jobs.integration.test.ts`

Expected: PASS; every successful control has one audit row, every denied/failed control has none

- [ ] **Step 5: Commit**

```bash
git add packages/jobs/src/job-repository.ts packages/jobs/src/job-controls.integration.test.ts apps/api/src/routes/jobs.ts apps/api/src/routes/jobs.integration.test.ts apps/api/src/app.ts
git commit -m "feat: add audited task controls"
```

### Task 8: Dispatch Transactional Outbox Through pg-boss

**Files:**
- Create: `packages/jobs/src/boss.ts`
- Create: `packages/jobs/src/outbox-dispatcher.ts`
- Create: `packages/jobs/src/outbox-dispatcher.integration.test.ts`
- Modify: `packages/jobs/src/index.ts`

- [ ] **Step 1: Write failing duplicate-delivery integration test**

Start real pg-boss against the isolated PostgreSQL database, create one example job, dispatch, clear `delivered_at` to simulate a crash after send, dispatch again, then subscribe and assert one logical wake key

```ts
expect(await dispatcher.dispatchBatch()).toBe(1);
await simulateCrashAfterSend(db, job.id);
expect(await dispatcher.dispatchBatch()).toBe(1);
expect(await receivedWakeKeys(boss, job.id)).toEqual([`outbox:${outboxId}`]);
```

- [ ] **Step 2: Confirm dispatcher test fails**

Run: `npm run test:integration -- packages/jobs/src/outbox-dispatcher.integration.test.ts`

Expected: FAIL because boss factory and dispatcher are absent

- [ ] **Step 3: Implement claim/send/mark boundaries**

`dispatchBatch()` claims up to 20 due rows in a short transaction using `for update skip locked`, setting `claimed_by` and a 30-second `claim_expires_at`. After commit it sends each message to queue `job-wake` with `{ jobId, outboxId }`, retry limit 3, expire 5 minutes, and singleton key `outbox:<id>`. A separate transaction marks `delivered_at`; send failure clears the claim and leaves delivery pending

Create pg-boss with schema `pgboss`, `application_name=novel-analysis-worker`, and no destructive schema drop in runtime or test teardown

- [ ] **Step 4: Verify repeated dispatch and queue isolation**

Run: `npm run test:integration -- packages/jobs/src/outbox-dispatcher.integration.test.ts`

Expected: PASS; repeated outbox dispatch yields one logical wake, outbox is marked delivered, and no product status is read from pg-boss tables

- [ ] **Step 5: Commit**

```bash
git add packages/jobs/src/boss.ts packages/jobs/src/outbox-dispatcher.ts packages/jobs/src/outbox-dispatcher.integration.test.ts packages/jobs/src/index.ts
git commit -m "feat: dispatch job outbox through pg-boss"
```

### Task 9: Add Step Leases, Idempotent Example Executor, And Recovery

**Files:**
- Create: `packages/jobs/src/step-leases.ts`
- Create: `packages/jobs/src/example-executor.ts`
- Create: `packages/jobs/src/lease-recovery.integration.test.ts`
- Modify: `packages/jobs/src/index.ts`

- [ ] **Step 1: Write failing lease recovery test**

Use a controllable clock. Worker A claims step 1 and is terminated without completing. Before expiry Worker B gets no step. After expiry Worker B claims the same step as attempt 2, attempt 1 becomes `abandoned`, completes both steps, and a duplicate wake changes no counts

```ts
expect(await leases.claimNext(job.id, "worker-a", now)).toMatchObject({ attemptNo: 1, kind: "prepare" });
expect(await leases.claimNext(job.id, "worker-b", plus(now, 29_000))).toBeNull();
expect(await leases.claimNext(job.id, "worker-b", plus(now, 31_000))).toMatchObject({ attemptNo: 2, kind: "prepare" });
await executor.runToBoundary(job.id, "worker-b");
await executor.runToBoundary(job.id, "worker-b");
await executor.runToBoundary(job.id, "worker-b");
expect(await jobSnapshot(job.id)).toMatchObject({ status: "completed", progress: { total: 2, completed: 2 } });
expect(await attemptStatuses(job.id)).toEqual(["abandoned", "completed", "completed"]);
expect(await terminalEvents(job.id)).toHaveLength(1);
```

- [ ] **Step 2: Confirm recovery test fails**

Run: `npm run test:integration -- packages/jobs/src/lease-recovery.integration.test.ts`

Expected: FAIL because lease claiming and executor are absent

- [ ] **Step 3: Implement atomic lease claims and completions**

`claimNext` locks the first incomplete step only when all earlier positions are completed and job status is queued/running/retrying. A running step is reclaimable only when `lease_expires_at <= now`. Claim updates job to running, increments `attempt_count`, abandons any open prior attempt, inserts the new running attempt and sets a 30-second lease in one transaction

`completeStep` requires matching owner and unexpired lease, sets stable `output_ref = { kind, idempotencyKey }`, completes attempt, increments progress once, and emits dedupe key `step:<stepId>:completed`. If no steps remain it sets job completed and emits `job:completed`; otherwise it writes a wake outbox row. A repeated completion returns the existing output without changing progress

`ExampleExecutor` handles only `prepare` and `finish`, writes no table outside the task tables, and never imports Dify, crypto, legacy server, or SQLite code

- [ ] **Step 4: Verify recovery, idempotency and state source**

Run: `npm run test:integration -- packages/jobs/src/lease-recovery.integration.test.ts`

Expected: PASS; two completed step effects, three attempts, one abandoned attempt, one completed event, no duplicate progress

Run: `rg -n "server/db|sqlite|better-sqlite|dify" apps/api apps/worker packages/database packages/jobs test/phase1 || true`

Expected: no output

- [ ] **Step 5: Commit**

```bash
git add packages/jobs/src/step-leases.ts packages/jobs/src/example-executor.ts packages/jobs/src/lease-recovery.integration.test.ts packages/jobs/src/index.ts
git commit -m "feat: recover expired worker leases"
```

### Task 10: Compose API And Worker Processes

**Files:**
- Modify: `apps/api/src/app.ts`
- Create: `apps/api/src/main.ts`
- Create: `apps/worker/src/worker.ts`
- Create: `apps/worker/src/main.ts`
- Create: `apps/worker/src/worker.integration.test.ts`
- Modify: `apps/api/package.json`
- Modify: `apps/worker/package.json`
- Modify: `package.json`

- [ ] **Step 1: Write failing process-composition test**

Create a job through the API app, start Worker runtime with injected IDs and 100ms dispatcher/recovery intervals, wait for completed status from repository, stop and restart the runtime, and assert no new attempts or events appear. Add a health test proving API health does not require Worker memory

- [ ] **Step 2: Confirm composition test fails**

Run: `npm run test:integration -- apps/worker/src/worker.integration.test.ts`

Expected: FAIL because API and Worker composition roots are absent

- [ ] **Step 3: Implement independent lifecycle roots**

`createApp(dependencies)` wires Helmet, JSON size limit `64kb`, cookie parser, request ID, auth, same-origin/CSRF, auth/admin/jobs routes and an error mapper. `main.ts` builds production dependencies and handles SIGTERM by closing HTTP server and database

`createWorkerRuntime` starts pg-boss, subscribes `job-wake`, runs dispatcher and expired-lease recovery intervals, and exposes idempotent `start()`/`stop()`. Message acknowledgment occurs after `runToBoundary`; unfinished jobs enqueue the next wake through job outbox. SIGTERM stops new claims, waits at most 10 seconds for current boundary, then closes boss/database without changing product status in memory

Add scripts `dev:api`, `dev:worker`, `start:api`, `start:worker`; do not replace legacy `dev` or `start`

- [ ] **Step 4: Verify independent API and Worker**

Run: `npm run test:integration -- apps/worker/src/worker.integration.test.ts`

Expected: PASS; completed task remains completed across runtime restart and health endpoint responds with Worker stopped

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/app.ts apps/api/src/main.ts apps/api/package.json apps/worker/src apps/worker/package.json package.json
git commit -m "feat: compose independent API and worker runtimes"
```

### Task 11: Project SSE From Persisted Job Events

**Files:**
- Create: `apps/api/src/routes/job-events.ts`
- Create: `apps/api/src/routes/job-events.integration.test.ts`
- Modify: `apps/api/src/app.ts`

- [ ] **Step 1: Write failing resume and authorization tests**

Seed event IDs 1 through 4, connect with `Last-Event-ID: 2`, and assert only 3 and 4 arrive in ascending order. Restart the app instance against the same database, append event 5, reconnect after 4, and assert 5 arrives. Assert unauthenticated `401`; all members may read shared task events, while the payload never contains session/OAuth fields

- [ ] **Step 2: Confirm SSE test fails**

Run: `npm run test:integration -- apps/api/src/routes/job-events.integration.test.ts`

Expected: FAIL with 404 for `/api/job-events`

- [ ] **Step 3: Implement database-cursor SSE**

Expose `GET /api/job-events?after=<positive integer>`. Prefer `Last-Event-ID` when both are present. Send headers `text/event-stream`, `no-cache, no-transform`, `X-Accel-Buffering: no`; query `job_events where id > cursor order by id limit 100`, write `id`, `event: job`, and a `JobEventSchema` JSON payload, then poll every 500ms. Send `: keepalive` every 15 seconds and clear both timers on close

No EventEmitter or in-memory replay buffer may be a source. Each poll reads PostgreSQL and applies the authenticated shared-library visibility rule

- [ ] **Step 4: Verify resume across API recreation**

Run: `npm run test:integration -- apps/api/src/routes/job-events.integration.test.ts`

Expected: PASS; no duplicate IDs, correct database order, and event 5 is recovered after creating a new app instance

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/job-events.ts apps/api/src/routes/job-events.integration.test.ts apps/api/src/app.ts
git commit -m "feat: stream persisted job events over SSE"
```

### Task 12: Add Job API Contracts And Persistent Queries

**Files:**
- Modify: `packages/contracts/src/job-contract.ts`
- Modify: `packages/contracts/src/job-contract.test.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/jobs/src/job-repository.ts`
- Modify: `apps/api/src/routes/jobs.ts`
- Create: `apps/api/src/routes/job-queries.integration.test.ts`

- [ ] **Step 1: Write failing request/response and restart tests**

Define and test `CreateExampleJobRequestSchema`, `JobListResponseSchema`, and `JobDetailResponseSchema`. Through API create a job with `Idempotency-Key: demo-001`, recreate the Express app with the same database, then assert `GET /api/jobs` and `GET /api/jobs/:id` return the persisted job and ordered events/steps. Reject missing/blank idempotency key with 400

- [ ] **Step 2: Confirm query tests fail**

Run: `npm run test:new -- packages/contracts/src/job-contract.test.ts && npm run test:integration -- apps/api/src/routes/job-queries.integration.test.ts`

Expected: contracts fail before schemas exist; after schemas, integration fails before query routes are complete

- [ ] **Step 3: Add exact API surface**

```text
POST /api/jobs/example        -> 201 or existing 200, PublicJob
GET  /api/jobs?limit=50       -> { items: PublicJob[], nextCursor: string | null }
GET  /api/jobs/:id            -> { job: PublicJob, steps: PublicJobStep[], events: JobEvent[] }
```

List uses keyset `(created_at,id)` descending, maximum limit 100. Public mappers parse every response through shared Zod schemas. They expose no lease owner, token hash, pg-boss ID, OAuth state or internal error stack. Task creation requires authenticated active user, same-origin and CSRF

- [ ] **Step 4: Verify API restart persistence and response redaction**

Run: `npm run test:new -- packages/contracts/src/job-contract.test.ts && npm run test:integration -- apps/api/src/routes/job-queries.integration.test.ts`

Expected: PASS; recreated API reads the same job, duplicate idempotency key returns same ID, serialized response contains none of `leaseOwner`, `tokenHash`, `clientSecret`, `pgboss`

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src packages/jobs/src/job-repository.ts apps/api/src/routes/jobs.ts apps/api/src/routes/job-queries.integration.test.ts
git commit -m "feat: expose persistent job APIs"
```

### Task 13: Build Minimal Web Shell, Login, And Task Center

**Files:**
- Create: `apps/web/index.html`
- Create: `apps/web/vite.config.ts`
- Create: `apps/web/src/main.tsx`
- Create: `apps/web/src/app/router.tsx`
- Create: `apps/web/src/app/AppShell.tsx`
- Create: `apps/web/src/app/query-client.ts`
- Create: `apps/web/src/app/styles.css`
- Create: `apps/web/src/shared/api.ts`
- Create: `apps/web/src/features/auth/LoginPage.tsx`
- Create: `apps/web/src/features/auth/useCurrentUser.ts`
- Create: `apps/web/src/features/task-center/TaskCenterPage.tsx`
- Create: `apps/web/src/features/task-center/TaskDetailPage.tsx`
- Create: `apps/web/src/features/task-center/useJobEvents.ts`
- Create: `apps/web/src/features/task-center/task-center.test.tsx`
- Create: `apps/web/src/features/admin/AdminMembersPage.tsx`
- Create: `apps/web/src/features/admin/admin-members.test.tsx`

- [ ] **Step 1: Write failing task-center behavior tests**

With mocked fetch/EventSource assert unauthenticated users see `使用飞书登录`, authenticated members see `任务中心`, list data survives route navigation through TanStack Query, `created/progress/completed` SSE invalidates job queries, members do not see `系统管理`, admins see and can load the masked member list, and the create button sends CSRF plus `Idempotency-Key`

- [ ] **Step 2: Confirm Web tests fail**

Run: `npm run test -w apps/web`

Expected: FAIL because router, features and task center do not exist

- [ ] **Step 3: Implement the feature-organized shell**

Routes are `/login`, `/tasks`, `/tasks/:jobId`, and `/admin/members`. The final route is admin-only and renders the Phase 1 member table from `GET /api/admin/members`, with display name, role, status, masked Feishu identity and enable/disable action wired to the audited PATCH endpoint. Do not add `/books`, `/l1`, `/l2`, query, analysis, book cards, sample books or Dify controls

The shell is a restrained light workbench: 56px header, 220px desktop navigation, thin borders, cobalt primary action, semantic green/amber/red statuses, 8px maximum radius, stable table columns and no gradients. At 768px navigation collapses to an icon menu; at 390px task rows become labeled key/value rows without horizontal text overlap

`TaskCenterPage` renders type, creator, state, `completed + failed + skipped / total`, current step, created time, and failure summary. It provides `创建示例任务`; detail provides pause/resume/cancel only when the current role/owner allows it. All writes use the current session CSRF token, same-origin credentials, and a fresh UUID `Idempotency-Key` retained for that mutation's retries

- [ ] **Step 4: Verify tests, typecheck and production build**

Run: `npm run test -w apps/web && npm run typecheck -w apps/web && npm run build -w apps/web`

Expected: all exit 0; Vite produces `apps/web/dist`; tests confirm role-aware navigation and SSE cache refresh

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "feat: add collaboration shell and task center"
```

### Task 14: Add Full Cross-Process Recovery Demo And Playwright Smoke

**Files:**
- Create: `test/phase1/fixtures/feishu-users.ts`
- Create: `test/phase1/helpers/processes.ts`
- Create: `test/phase1/recovery.e2e.test.ts`
- Create: `test/phase1/task-center.spec.ts`
- Create: `playwright.config.ts`
- Create: `vitest.e2e.config.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Write the failing independent demo**

The e2e test creates a fresh PostgreSQL database, migrates, seeds a mapped admin and configures the API with a test-only composition root using `FeishuFake`. It starts API and Web, logs in through the fake OAuth redirect, creates a task, pauses and resumes it to prove controls before Worker startup, captures its ID, reloads, terminates API and starts a new API, verifies the same ID, starts Worker, terminates it after attempt 1 begins, advances/waits past the 30-second lease, starts a new Worker, and waits for completed

Assert final database facts: 1 job, 2 completed steps, 3 attempts with one abandoned, 1 `job:completed` event, no pending outbox, and exactly one `job.pause` plus one `job.resume` audit row. Search captured logs for session token, fake OAuth code, client secret and reject any match

- [ ] **Step 2: Confirm the demo fails before orchestration exists**

Run: `npm run test:phase1:e2e`

Expected: FAIL because Playwright config/process helpers are absent

- [ ] **Step 3: Implement deterministic process controls**

Add root scripts

```json
{
  "test:phase1:e2e": "vitest run --config vitest.e2e.config.ts test/phase1/recovery.e2e.test.ts",
  "test:phase1:ui": "playwright test test/phase1/task-center.spec.ts"
}
```

Run: `npx playwright install chromium`

Expected: Chromium for Playwright `1.61.1` installs successfully; do not install unrelated browser projects

Helpers allocate unused localhost ports, wait on `/api/health`, send SIGTERM then SIGKILL only after 10 seconds, capture bounded redacted logs, and always stop processes/drop the test database in `finally`. The fake adapter is passed by the e2e-only launcher; `apps/api/src/main.ts` remains wired to `FeishuHttpAdapter`

Playwright checks login, create, refresh, task detail, and admin/member navigation at desktop 1440x900 and mobile 390x844. It asserts no horizontal document overflow and no overlapping header/navigation/task controls

- [ ] **Step 4: Run the independent recovery and UI demos**

Run: `npm run test:phase1:e2e`

Expected: PASS after a real Worker termination and lease expiry; final task is completed with exactly one terminal event

Run: `npm run test:phase1:ui`

Expected: PASS for Chromium desktop and mobile projects; screenshots/traces are retained only on failure

- [ ] **Step 5: Commit**

```bash
git add test/phase1 playwright.config.ts vitest.e2e.config.ts package.json package-lock.json
git commit -m "test: prove phase 1 restart recovery"
```

### Task 15: Run Phase Gate And Scope Audit

**Files:**
- Modify only if a preceding verification exposes a Phase 1 defect: files already named in Tasks 1-14

- [ ] **Step 1: Prove migrations on a fresh real database**

Run: `docker compose down -v && docker compose up -d postgres && docker compose exec -T postgres pg_isready -U novel -d novel_analysis && DATABASE_URL=postgres://novel:novel_dev_only@127.0.0.1:55432/novel_analysis npm run db:migrate`

Expected: PostgreSQL reports accepting connections and migrations `001_collaboration` and `002_jobs` complete from an empty volume; the pg-boss schema is created later only when the Worker runtime starts

- [ ] **Step 2: Run Phase 0 and Phase 1 verification**

```bash
npm run verify:legacy
npm run verify:new
npm run dify:manifest:check
npm run test:project-source
npm run project:check
npm run verify:phase1
npm run test:phase1:e2e
npm run test:phase1:ui
npm run lint
git diff --check
```

Expected: every command exits 0; legacy reports exactly 112 passing tests; five Workflow manifest checks stay unchanged; PostgreSQL integration, recovery e2e, Playwright, typecheck, lint and production Web build pass

- [ ] **Step 3: Prove forbidden dependencies and legacy assets are unchanged**

```bash
if rg -n "server/db|sqlite|better-sqlite|dify" apps/api apps/worker packages/database packages/jobs test/phase1; then exit 1; fi
git diff 089ecd189c584620a0f9441cbf1a47cfbcd10097 -- test/service.test.js dify-workflows/*.yml
git diff --name-only 089ecd189c584620a0f9441cbf1a47cfbcd10097 -- server src
```

Expected: all three commands exit 0 and produce no output. The first proves Phase 1 runtime has no old SQLite or Dify dependency; the second proves the legacy 112-test file and five YAML exports are byte-unchanged; the third proves legacy implementation directories are untouched

- [ ] **Step 4: Review acceptance evidence against this matrix**

| Acceptance | Primary evidence |
| --- | --- |
| 产品任务表是唯一状态源 | Tasks 6, 9, 11, 12 integration tests; pg-boss never serialized to API |
| 重复投递幂等 | Tasks 6, 8, 9 duplicate request/outbox/wake tests |
| lease recovery | Tasks 9 and 14 with abandoned attempt and single effect |
| admin/member RBAC | Tasks 5, 7 and 13 domain/HTTP/UI tests |
| task control audit | Task 7 atomic audit assertions |
| refresh/API restart visibility | Tasks 11, 12 and 14 recreated-app/process evidence |
| Worker restart completion | Tasks 9, 10 and 14 process recovery evidence |
| Feishu whitelist and session security | Task 4 state replay, hash, cookie, revoke tests |
| CSRF/origin boundary | Tasks 4 and 7 rejection matrix |
| no legacy SQLite | Task 15 import scan and legacy diff |
| Phase 0 deferred invariants | Task 1 progress and all 33 rejected pairs |
| legacy 112 and five YAML unchanged | Task 15 fresh verification and base diff |

Expected: each row has a passing command artifact from the same final commit; any missing or conflicting evidence stops the gate and is reported to the controller

- [ ] **Step 5: Commit verification-only fixes, if any**

If verification required scoped fixes, stage only the named Phase 1 files and commit

```bash
git add apps packages test package.json package-lock.json compose.yaml .env.phase1.example .gitignore eslint.config.js vitest.config.ts vitest.integration.config.ts vitest.e2e.config.ts playwright.config.ts
git commit -m "fix: satisfy phase 1 acceptance gate"
```

If no fix was required, do not create an empty commit

## 7. Implementation Handoff Requirements

Each implementing agent must report the exact task number, base commit, changed paths, fresh command output, `git status --short`, `git diff --check`, and commit SHA. The controller must reject a task if it changes `docs/project/PROJECT.md`, any accepted checkpoint/decision, legacy `server/` or `src/`, `test/service.test.js`, or the five Workflow YAML files

Do not begin Phase 2 from this plan. After Task 15 passes, return evidence for `GATE-PHASE1-PLAN-APPROVED` and the subsequent Phase 1 implementation acceptance process; only the controller may update project source or unlock the next phase
