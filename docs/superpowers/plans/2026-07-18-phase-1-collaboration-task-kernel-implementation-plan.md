# Phase 1 Collaboration And Task Kernel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付可通过测试飞书身份登录、由 PostgreSQL 持久化、由独立 Worker 可恢复执行示例任务的新 API、Worker 与最小 Web 任务中心

**Architecture:** 系统保持模块化单体与单一 PostgreSQL 数据源，API 负责身份、权限与 HTTP 映射，domain 负责规则，database 负责 Kysely 事务与 migration，jobs 负责任务生命周期，Worker 只消费唤醒消息并执行持久化步骤。`jobs`、`job_steps`、`job_attempts`、`job_events` 是产品任务状态唯一真相源，pg-boss 不向前端提供状态

**Tech Stack:** Node.js、TypeScript、Express、Zod、Kysely、PostgreSQL、pg-boss、React、React Router、TanStack Query、Vitest、Supertest

---

## 1. Approval And Execution Order

本文件当前只用于计划审查，禁止据此提前实施

执行顺序固定为：本计划审查 → 用户确认且总控接受 `GATE-PHASE1-PLAN-APPROVED` → 按顺序实施 8 个任务 → Task 8 汇总 Phase 1 implementation acceptance checkpoint evidence → 总控核验后再决定是否进入 Phase 2

Task 8 不是兜底修复任务。任何验证失败都必须返回引入该行为的原任务修复、重新提交并重跑其 focused verification，不能在 Task 8 跨文件补丁式修复

## 2. Phase Boundary

Phase 1 独立演示必须完成

- 测试飞书身份登录已映射且启用的本地成员，并创建无外部模型依赖的示例任务
- 浏览器刷新与 API 重启后任务仍可查询同一 job
- Worker 在持有步骤 lease 时终止，lease 到期后新 Worker 创建新 attempt 并恢复完成
- 重复 outbox 投递、重复队列消息和迟到完成只产生一次步骤效果与一次终态事件
- member 不能管理成员或控制他人任务，admin 可以且控制操作产生审计

本阶段明确不做

- books/chapters/L1/L2/query/analysis 数据模型与页面，以及 Dify adapter/Workflow/模型配置
- SQLite 迁移、双写、旧任务 Map、旧根目录重构、旧 112 测试或五个 Workflow YAML 修改
- 浏览器视觉验收、部署拓扑设计、npm 安全公告、供应链或无关依赖升级

## 3. Dependency Direction

```text
apps/web -> packages/contracts
apps/api -> packages/contracts + packages/domain + packages/database + packages/jobs
apps/worker -> packages/database + packages/jobs
packages/jobs -> packages/contracts + packages/domain + packages/database
packages/database -> Kysely + pg
packages/domain -> packages/contracts
```

禁止反向依赖：domain 不导入 Express、Kysely 或 pg-boss，database/jobs 不导入 apps，Web 不导入 database/jobs，API/Worker 不导入 `server/db.js` 或任何 SQLite 模块

## 4. Cross-Task Invariants

### 4.1 Authentication And CSRF

- OAuth state 使用 32 字节随机值，数据库只存 SHA-256，5 分钟过期且只能消费一次
- OAuth callback 只在飞书身份映射到 active 本地用户后创建 session
- session token 使用 32 字节随机值，数据库只存 SHA-256
- 生产 session Cookie 固定 `HttpOnly + Secure + SameSite=Lax + Path=/`；HTTP 集成测试使用独立测试 Cookie 名，不能伪造不合规的 `__Host-` Cookie
- callback 不生成或传递 CSRF 原始值，只设置 session Cookie 并跳转固定站内路径，URL 与日志不含 code、session 或 CSRF token
- callback 后 Web 调用同源 `GET /api/auth/me`，服务端锁 session 行，生成新的 CSRF 原始值、覆盖其 hash，并通过 `Cache-Control: no-store` JSON 返回；浏览器只保存在内存
- 每次 `/me` 都轮换 CSRF hash，旧 token 失效；服务端永远不从 hash 还原原始值
- `/me` 不开放 CORS，拒绝 `Sec-Fetch-Site: cross-site`，存在 Origin 时必须与 `APP_ORIGIN` 相等，因此跨站请求不能读取或轮换 token
- 所有写接口校验 Origin，并对 `X-CSRF-Token` 做 SHA-256 后 timing-safe compare
- 重新登录仅在新身份验证成功后撤销浏览器携带的旧 session；注销校验当前 CSRF 后撤销 session 并清 Cookie
- OAuth code、Cookie、token、client secret、完整 provider body 不进入 URL、错误响应、审计或普通日志

### 4.2 Job State And Locking

- 控制与步骤完成都先锁 `jobs` 行，再锁 `job_steps`，禁止相反锁序
- 完成事务持锁后重查 job 状态
- paused 只允许提交当前已完成步骤边界，不推进 job、不创建下一步 outbox
- cancelled 丢弃迟到完成，不增加 progress，不覆盖取消状态
- completed、failed、cancelled 均为不可覆盖终态
- pause 不中断当前外部请求，只在步骤边界生效；cancel 保留已提交步骤效果但阻止未提交效果

### 4.3 Queue And Transaction Boundaries

- 创建任务时 jobs、steps、created event、outbox 必须同一事务提交
- dispatcher 的 claim、send、mark 分为三个边界，pg-boss 网络调用不在数据库事务内
- outbox ID、步骤 idempotency key、event dedupe key 都稳定且唯一
- pg-boss 消息只是唤醒信号，Worker 必须回到产品表领取步骤
- lease 领取、attempt 创建、步骤完成、progress 与 event 更新使用显式 PostgreSQL 事务

### 4.4 Test Database

- 所有 integration test 使用真实 PostgreSQL，不使用 SQLite 或内存数据库替身
- `TEST_DATABASE_URL` 统一指向内置管理库 `/postgres`
- 测试 harness 从管理连接创建随机 disposable database，运行全部 Kysely migrations，结束时终止连接并删除数据库
- compose 只创建开发库 `novel_analysis`；`postgres` 管理库由 PostgreSQL 自带
- 默认 Vitest unit config 排除 `*.integration.test.ts`、`*.e2e.test.ts` 与 `test/phase1/**`
- 每个预期失败的 integration test 先确认 `pg_isready` 成功，失败必须来自目标模块或行为尚未实现，不能把连接失败当作红灯

## 5. File Responsibility Map

| Area | Files | Responsibility |
| --- | --- | --- |
| Contracts | `packages/contracts/src/job-contract.ts` | 公开 job/progress/event/API Zod 契约 |
| Domain | `packages/domain/src/jobs/job-state.ts`, `packages/domain/src/auth/rbac.ts` | 状态迁移和权限规则 |
| Database | `packages/database/src/**` | Kysely 类型、连接、migrations、测试 harness |
| Jobs | `packages/jobs/src/**` | repository、controls、outbox、lease、executor |
| API | `apps/api/src/**` | OAuth/session/CSRF、RBAC、jobs、SSE 路由 |
| Worker | `apps/worker/src/**` | dispatcher、consumer、recovery 生命周期 |
| Web | `apps/web/src/app/**`, `apps/web/src/features/**` | 全局壳、登录、任务中心、最小成员管理 |
| Acceptance | `test/phase1/**` | 真实进程重启和恢复演示 |

## 6. Implementation Tasks

### Task 1: Foundation Contracts And Workspaces

**Scope:** 补齐 Phase 0 延迟契约并建立 Phase 1 workspace/toolchain，不实现数据库或运行时行为
**Files:**
- Modify: `packages/contracts/src/job-contract.ts`, `packages/contracts/src/job-contract.test.ts`, `packages/contracts/src/index.ts`
- Modify: `packages/domain/src/jobs/job-state.test.ts`
- Create: `packages/database/package.json`, `packages/database/tsconfig.json`, `packages/jobs/package.json`, `packages/jobs/tsconfig.json`
- Create: `apps/api/package.json`, `apps/api/tsconfig.json`, `apps/worker/package.json`, `apps/worker/tsconfig.json`
- Create: `apps/web/package.json`, `apps/web/tsconfig.json`, `vitest.integration.config.ts`
- Modify: `vitest.config.ts`
- Modify: `eslint.config.js`
- Modify: `package.json`, `package-lock.json`

**Contracts And Rules:**

- `JobProgress.completed + failed + skipped <= total`
- 状态迁移测试枚举 7×7 全矩阵，16 个 allowed 与 33 个 rejected 精确覆盖
- 每个 rejected case 断言 error `name`、`from`、`to`、`message`
- 示例任务只要求属于共享 job 契约、无外部依赖且可由测试 executor 执行，不在本计划锁死长期公开类型名
- 只增加 Kysely、pg、pg-boss、API/Web 测试与运行所需直接依赖
- 实施时记录每个新增包的精确版本并使用 `--save-exact`，审查 lock diff；复用现有 React、Express、Zod、TypeScript、Vite、Vitest，不运行 `npm update` 或 `npm audit fix`
- `test:new` 只收集 unit tests，`test:integration` 显式设置 `/postgres` 管理 URL

- [ ] **Write failing tests:** progress 超总量和 33 个拒绝迁移
- [ ] **Confirm failure:** `npm run test:new -- packages/contracts/src/job-contract.test.ts packages/domain/src/jobs/job-state.test.ts`
- [ ] **Implement minimum:** 收紧 Zod invariant，建立 workspace/config/scripts，安装精确依赖
- [ ] **Focused verification:**

```bash
npm run typecheck:new
npm run test:new
node --test test/contracts/*.test.js
npm ls --workspaces --depth=0
```

**Acceptance:** progress 越界被拒绝；16/33 状态对完整；unit 不收集 integration/e2e；workspace graph 无 invalid dependency

**Commit boundary:** `git commit -m "chore: establish phase 1 workspaces"`

### Task 2: PostgreSQL Schema And Kysely Migrations

**Scope:** 建立开发/测试 PostgreSQL、Kysely 连接、版本化 migrations 与 disposable database harness
**Files:**
- Create: `compose.yaml`, `.env.phase1.example`
- Modify: `.gitignore`
- Create: `packages/database/src/db.ts`, `packages/database/src/migrate.ts`, `packages/database/src/index.ts`
- Create: `packages/database/src/migrations/index.ts`, `packages/database/src/migrations/001_collaboration.ts`, `packages/database/src/migrations/002_jobs.ts`
- Create: `packages/database/src/testing/postgres.ts`, `packages/database/src/schema.integration.test.ts`

**Schema Contract:**

```sql
users(id, display_name, avatar_url, role, status, created_at, updated_at)
auth_identities(id, user_id, provider, subject, created_at, unique(provider, subject))
sessions(id, user_id, token_hash unique, csrf_token_hash nullable, expires_at, revoked_at, created_at, last_seen_at)
audit_logs(id bigint identity, actor_user_id, action, target_type, target_id, metadata jsonb, created_at)
jobs(id, type, status, requested_by, request_id, scope jsonb, config_snapshot jsonb,
     concurrency_key, progress jsonb, created_at, updated_at, unique(requested_by, request_id))
job_steps(id, job_id, position, kind, status, input_signature, idempotency_key unique,
          output_ref jsonb, lease_owner, lease_expires_at, attempt_count, created_at, updated_at,
          unique(job_id, position))
job_attempts(id, step_id, attempt_no, worker_id, status, error_code, error_message,
             started_at, finished_at, unique(step_id, attempt_no))
job_events(id bigint identity, job_id, type, dedupe_key, payload jsonb, created_at,
           unique(job_id, dedupe_key))
job_outbox(id, job_id, topic, payload jsonb, available_at, claimed_by,
           claim_expires_at, delivered_at, created_at)
```

`role` 只允许 admin/member，用户 status 只允许 active/disabled，job status 与共享契约一致。active concurrency key 使用 partial unique index。session、event cursor、step claim、pending outbox 建必要索引。down migration 按外键逆序删除并清理 enum/type

**Transaction And Harness Rules:**

- `createDatabase(url)` 只接受 PostgreSQL URL并显式 destroy pool
- migration runner 使用 Kysely Migrator，失败非零退出，重复执行无变更
- harness 拒绝非 `/postgres` 的 `TEST_DATABASE_URL`
- 每个 integration file 使用独立随机数据库，不共享表清理状态
- 测试覆盖 up、down、fresh up、唯一约束、外键和 partial unique index

- [ ] **Write failing test:** 断言全部表、约束与 migration round trip
- [ ] **Confirm environment:** `docker compose up -d postgres && docker compose exec -T postgres pg_isready -U novel -d postgres`
- [ ] **Confirm failure:** `npm run test:integration -- packages/database/src/schema.integration.test.ts`
- [ ] **Implement minimum:** compose、连接、两条 migration、harness
- [ ] **Focused verification:**

```bash
npm run test:integration -- packages/database/src/schema.integration.test.ts
DATABASE_URL="$DATABASE_URL" npm run db:migrate
DATABASE_URL="$DATABASE_URL" npm run db:migrate
```

**Acceptance:** 真实 PostgreSQL 从空库完成 migration；第二次无 pending migration；测试库创建/销毁无残留连接；没有 SQLite import

**Commit boundary:** `git commit -m "feat: add phase 1 PostgreSQL schema"`

### Task 3: OAuth, Session, RBAC And Audit

**Scope:** 实现飞书 adapter/fake、白名单登录、server-side session、CSRF/Origin、admin/member RBAC、成员管理与审计
**Files:**
- Create: `packages/domain/src/auth/rbac.ts`, `packages/domain/src/auth/rbac.test.ts`
- Modify: `packages/domain/src/index.ts`
- Create: `apps/api/src/config.ts`, `apps/api/src/app.ts`, `apps/api/src/bootstrap-admin.ts`
- Create: `apps/api/src/auth/feishu-adapter.ts`, `apps/api/src/auth/feishu-http-adapter.ts`, `apps/api/src/auth/feishu-fake.ts`
- Create: `apps/api/src/auth/auth-service.ts`, `apps/api/src/auth/session-middleware.ts`, `apps/api/src/auth/csrf.ts`, `apps/api/src/auth/authorize.ts`
- Create: `apps/api/src/routes/auth.ts`, `apps/api/src/routes/admin-members.ts`
- Create: `apps/api/src/auth/auth.integration.test.ts`, `apps/api/src/routes/admin-members.integration.test.ts`

**OAuth And Session Contract:**

```ts
interface FeishuOAuthAdapter {
  authorizationUrl(input: { state: string; redirectUri: string }): URL;
  exchangeCode(input: { code: string; redirectUri: string }): Promise<{
    unionId: string; displayName: string; avatarUrl: string | null;
  }>;
}

interface AuthService {
  startLogin(returnTo: string): Promise<URL>;
  finishLogin(code: string, state: string, priorSessionToken?: string): Promise<{
    sessionToken: string; returnTo: string;
  }>;
  currentUserAndRotateCsrf(sessionToken: string): Promise<{
    user: { id: string; displayName: string; role: "admin" | "member" };
    csrfToken: string;
  }>;
  logout(sessionToken: string): Promise<void>;
}
```

`finishLogin` 单次消费 state，交换 code，查询 `auth_identities -> users` 且要求 active，生成 session 原始值并只存 hash。callback 只设置 session Cookie 后 303 到校验过的站内 `returnTo`，不把 token 写进 URL

`GET /api/auth/me` 锁有效 session，生成新 CSRF 原始值，覆盖 hash并返回用户与原始值。任何写请求都校验 Origin 与当前 hash。旧 token、过期/revoked session、disabled 用户一律拒绝

**RBAC And Audit Contract:**

- member 可查看共享任务、创建任务、控制自己的任务
- admin 额外拥有 members:manage、jobs:control:any、audit:read
- `GET/POST/PATCH /api/admin/members` 服务端要求 admin
- 成员变更、session 强制撤销和 audit insert 同事务
- 首个管理员脚本仅在 users 为空时创建配置中的飞书 identity；同一 identity 重跑幂等，任何其他非空状态拒绝

- [ ] **Write failing tests:** state replay、未映射/disabled、session hash、Cookie 属性、/me CSRF 轮换、旧 token、Origin、重登/注销、日志脱敏、member 403、admin 审计原子性
- [ ] **Confirm environment:** PostgreSQL readiness command from Task 2
- [ ] **Confirm failure:** `npm run test:integration -- apps/api/src/auth/auth.integration.test.ts apps/api/src/routes/admin-members.integration.test.ts`
- [ ] **Implement minimum:** adapter/service/middleware/routes/bootstrap 与显式事务
- [ ] **Focused verification:**

```bash
npm run test:new -- packages/domain/src/auth/rbac.test.ts
npm run test:integration -- apps/api/src/auth/auth.integration.test.ts apps/api/src/routes/admin-members.integration.test.ts
npm run typecheck -w apps/api
```

**Acceptance:** OAuth state 与白名单边界有效；数据库只有 token hash；callback URL/日志无 token；/me 能轮换且不从 hash 还原；member 无管理权限；成功管理操作有且仅有一条审计，失败操作无审计

**Commit boundary:** `git commit -m "feat: add secure collaboration authentication"`

### Task 4: Persistent Job API And Audited Controls

**Scope:** 实现示例任务创建、列表/详情、状态控制、事件和审计事务，不接入 pg-boss
**Files:**
- Modify: `packages/contracts/src/job-contract.ts`, `packages/contracts/src/job-contract.test.ts`, `packages/contracts/src/index.ts`
- Create: `packages/jobs/src/job-repository.ts`, `packages/jobs/src/job-controls.ts`, `packages/jobs/src/index.ts`
- Create: `packages/jobs/src/job-repository.integration.test.ts`, `packages/jobs/src/job-controls.integration.test.ts`, `packages/jobs/src/control-completion-race.integration.test.ts`
- Create: `apps/api/src/routes/jobs.ts`, `apps/api/src/routes/jobs.integration.test.ts`
- Modify: `apps/api/src/app.ts`

**API Contract:**

```text
POST /api/jobs/example
GET  /api/jobs?limit=<bounded>&cursor=<optional>
GET  /api/jobs/:id
POST /api/jobs/:id/pause
POST /api/jobs/:id/resume
POST /api/jobs/:id/cancel
```

所有写请求要求 session、Origin、CSRF 与 `Idempotency-Key`。创建任务在一个事务写 job、ordered steps、created event、pending outbox。重复创建 key 返回同一 job。公开响应通过共享 Zod schema，不暴露 lease owner、token hash、queue ID、内部错误栈

**Control Transaction:**

```text
BEGIN
SELECT job FOR UPDATE
authorize owner OR admin
assert domain transition
UPDATE job
INSERT job_event ON CONFLICT(job_id, dedupe_key) DO NOTHING
INSERT audit_log with actor/action/from/to/request_id
resume only: INSERT job_outbox
COMMIT
```

pause -> paused，resume -> queued，cancel -> cancelled。cancel 同事务把未完成 step/open attempt 标记 cancelled。控制和未来 `completeStep` 均按 job→step 锁序

**Race Tests:**

- pause 先持 job lock：完成只落当前步骤，job 保持 paused，无 next outbox
- cancel 先持 job lock：迟到完成返回 discarded，不增加 progress，不覆盖 cancelled
- completion 先持 job lock：非最终步骤完成后 pause 生效；最终完成后等待中的控制返回 invalid transition
- completed/failed/cancelled 上的任何控制或迟到完成均不能改变终态

- [ ] **Write failing tests:** 创建原子回滚/重复 key、API 重建后查询、owner/admin matrix、控制审计、四组并发 ordering
- [ ] **Confirm environment:** PostgreSQL readiness command from Task 2
- [ ] **Confirm failure:** `npm run test:integration -- packages/jobs/src/job-repository.integration.test.ts packages/jobs/src/job-controls.integration.test.ts`
- [ ] **Implement minimum:** repository、controls、API mapper 与统一锁序
- [ ] **Focused verification:**

```bash
npm run test:integration -- packages/jobs/src/job-repository.integration.test.ts packages/jobs/src/job-controls.integration.test.ts packages/jobs/src/control-completion-race.integration.test.ts
npm run test:integration -- apps/api/src/routes/jobs.integration.test.ts
```

**Acceptance:** 产品表是唯一状态源；创建全有或全无；重复请求不重复；refresh/API object recreation 可查询；RBAC 正确；每次成功控制只有一条 audit；终态不可覆盖

**Commit boundary:** `git commit -m "feat: persist jobs and audited controls"`

### Task 5: Transactional Outbox And pg-boss Dispatcher

**Scope:** 将 pending outbox 可靠投递为 pg-boss 唤醒消息，不执行步骤
**Files:**
- Create: `packages/jobs/src/boss.ts`, `packages/jobs/src/outbox-dispatcher.ts`, `packages/jobs/src/outbox-dispatcher.integration.test.ts`
- Modify: `packages/jobs/src/index.ts`

**Idempotency Boundary:**

```text
claim transaction:
  SELECT pending outbox FOR UPDATE SKIP LOCKED
  UPDATE claimed_by, claim_expires_at
  COMMIT

outside transaction:
  pg-boss send(topic, { jobId, outboxId }, singletonKey = outbox:<outboxId>)

mark transaction:
  UPDATE delivered_at WHERE id = outboxId
  COMMIT
```

send 失败时释放或等待 claim expiry，保留 pending。send 成功后 mark 前崩溃会重投同一 outbox ID；queue singleton 与 Worker 步骤 claim 双重去重。dispatcher 不读写 job status，不从 pg-boss 表投影产品状态，不在数据库事务内做网络调用

- [ ] **Write failing tests:** 并发 dispatcher 不重复 claim、send failure 保留 pending、send 后 mark 前崩溃重投、重复 wake 保持同一 logical outbox key
- [ ] **Confirm environment:** PostgreSQL readiness command from Task 2
- [ ] **Confirm failure:** `npm run test:integration -- packages/jobs/src/outbox-dispatcher.integration.test.ts`
- [ ] **Implement minimum:** boss factory 与 claim/send/mark dispatcher
- [ ] **Focused verification:**

```bash
npm run test:integration -- packages/jobs/src/outbox-dispatcher.integration.test.ts
npm run typecheck -w packages/jobs
```

**Acceptance:** job/outbox 原子创建；网络不在事务；重复 dispatcher 不产生不同逻辑消息；失败可重试；产品状态不依赖 pg-boss schema

**Commit boundary:** `git commit -m "feat: dispatch transactional job outbox"`

### Task 6: Lease Recovery And Worker Runtime

**Scope:** 实现步骤 lease、attempt、幂等完成、示例 executor、独立 Worker 与确定性中断测试
**Files:**
- Create: `packages/jobs/src/step-leases.ts`, `packages/jobs/src/example-executor.ts`, `packages/jobs/src/lease-recovery.integration.test.ts`
- Modify: `packages/jobs/src/index.ts`
- Create: `apps/worker/src/worker.ts`, `apps/worker/src/main.ts`, `apps/worker/src/worker.integration.test.ts`
- Modify: `apps/worker/package.json`

**Lease Contract:**

```ts
interface ExecutionBarrier {
  afterAttemptStarted(input: {
    jobId: string; stepId: string; attemptId: string; attemptNo: number;
  }): Promise<void>;
}

interface StepLeaseService {
  claimNext(jobId: string, workerId: string, now: Date): Promise<ClaimedStep | null>;
  completeStep(claim: ClaimedStep, output: unknown): Promise<{
    disposition: "completed" | "already-completed" | "paused-boundary" |
      "discarded-cancelled" | "terminal-noop";
  }>;
}
```

claim 事务先锁 job，再选择第一个满足前序完成的 step。未过期 running lease 不可领取；过期 lease 可由新 worker 领取，旧 running attempt 标 abandoned，新 attempt_no 加一

complete 事务先锁 job 再锁 step，验证 owner/lease/idempotency。running 状态完成 step、attempt、progress、event并按需 outbox；paused 只提交当前边界；cancelled 丢弃迟到输出；终态 no-op；重复 complete 返回已有结果且计数不变

示例 executor 只执行数据库内可控步骤，不导入 Dify、旧 server、crypto 或 SQLite。Worker 启动 boss consumer、dispatcher 与 expired lease recovery，SIGTERM 停止新 claim 并在当前步骤边界关闭

确定性中断测试通过构造参数注入 `ExecutionBarrier`：attempt 与 lease 提交后 barrier 通知测试父进程并阻塞，父进程确认 attempt 1 已持久化后终止 Worker。生产 `main.ts` 始终注入 no-op barrier，不读取测试开关，不暴露 HTTP 控制入口

- [ ] **Write failing tests:** 未过期拒领、过期新 attempt、旧 attempt abandoned、重复完成单效果、paused/cancelled/terminal 迟到完成、runtime restart 无新增效果
- [ ] **Confirm environment:** PostgreSQL readiness command from Task 2
- [ ] **Confirm failure:** `npm run test:integration -- packages/jobs/src/lease-recovery.integration.test.ts apps/worker/src/worker.integration.test.ts`
- [ ] **Implement minimum:** lease service、executor、runtime 与 test-only barrier injection
- [ ] **Focused verification:**

```bash
npm run test:integration -- packages/jobs/src/lease-recovery.integration.test.ts
npm run test:integration -- packages/jobs/src/control-completion-race.integration.test.ts apps/worker/src/worker.integration.test.ts
npm run typecheck -w apps/worker
```

**Acceptance:** attempt 1 中断后只有过期 lease 可恢复；attempt 2 完成；迟到 attempt 1 不覆盖；每个步骤一个 output/event/progress 效果；Worker restart 后完成任务；生产无测试控制入口

**Commit boundary:** `git commit -m "feat: recover jobs from expired worker leases"`

### Task 7: Persisted SSE And Minimal Web

**Scope:** 从 job_events 投影 SSE，并交付登录完成页、全局壳、任务中心、任务详情和最小成员管理，不建设书库/L1/L2 页面
**Files:**
- Create: `apps/api/src/routes/job-events.ts`, `apps/api/src/routes/job-events.integration.test.ts`, `apps/api/src/main.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/package.json`
- Create: `apps/web/index.html`, `apps/web/vite.config.ts`, `apps/web/src/main.tsx`
- Create: `apps/web/src/app/router.tsx`, `apps/web/src/app/AppShell.tsx`, `apps/web/src/app/query-client.ts`, `apps/web/src/app/styles.css`
- Create: `apps/web/src/shared/api.ts`, `apps/web/src/shared/csrf-memory.ts`
- Create: `apps/web/src/features/auth/LoginPage.tsx`, `apps/web/src/features/auth/AuthCompletePage.tsx`, `apps/web/src/features/auth/useCurrentUser.ts`
- Create: `apps/web/src/features/task-center/TaskCenterPage.tsx`, `apps/web/src/features/task-center/TaskDetailPage.tsx`, `apps/web/src/features/task-center/useJobEvents.ts`
- Create: `apps/web/src/features/admin/AdminMembersPage.tsx`
- Create: `apps/web/src/features/task-center/task-center.test.tsx`

**SSE Contract:**

- `GET /api/job-events` 需要 active session
- 游标来自 `Last-Event-ID` 或 query `after`，读取 `job_events where id > cursor order by id`
- 每个事件通过共享 `JobEventSchema` 映射，内部 lease/token/queue 字段不进入 payload
- API 内存只保存连接，不保存 replay buffer或任务进度
- API object/process 重建后同一 cursor 从 PostgreSQL 继续，不重复已确认 ID

**Web Contract:**

- 路由仅 `/login`、`/auth/complete`、`/tasks`、`/tasks/:id`、`/admin/members`
- `/auth/complete` 调用 `/api/auth/me` 获取并内存保存轮换后的 CSRF，再 replace 到校验过的 returnTo
- 所有 API 使用相对 `/api`、same-origin credentials；写请求带当前 CSRF 与稳定 Idempotency-Key
- 收到 `CSRF_STALE` 只允许重新 `/me` 一次，并使用同一个 Idempotency-Key 重放
- SSE 事件使 TanStack Query 的 jobs/detail cache 失效，页面刷新仍以 API 数据为准
- member 不渲染 admin 导航且服务端仍强制 RBAC
- 任务中心显示类型、创建人、状态、progress、当前步骤、时间、失败摘要与允许的控制
- 不添加 books、L1、L2、query、analysis、Dify 配置或样例业务数据

- [ ] **Write failing tests:** SSE cursor/API recreation/unauthorized，登录完成 CSRF、任务创建/刷新/cache invalidation、admin/member 导航
- [ ] **Confirm environment:** PostgreSQL readiness command from Task 2
- [ ] **Confirm failure:** `npm run test:integration -- apps/api/src/routes/job-events.integration.test.ts && npm run test -w apps/web`
- [ ] **Implement minimum:** persisted projection、API main、feature-organized Web
- [ ] **Focused verification:**

```bash
npm run test:integration -- apps/api/src/routes/job-events.integration.test.ts
npm run test -w apps/web
npm run typecheck -w apps/api
npm run typecheck -w apps/web
npm run build -w apps/web
```

**Acceptance:** SSE 从 DB cursor 恢复；API 重启不丢事件；Web 刷新可见任务；CSRF 只在内存；角色导航正确；生产 build 通过；没有 Phase 2 页面

**Commit boundary:** `git commit -m "feat: add persisted task center projection"`

### Task 8: Independent Recovery Demo And Phase 1 Acceptance

**Scope:** 只新增独立进程 demo/test 与汇总证据，不修改 Tasks 1-7 的实现文件
**Files:**
- Create: `test/phase1/fixtures/feishu-users.ts`, `test/phase1/recovery.e2e.test.ts`
- Create: `test/phase1/helpers/processes.ts`, `test/phase1/helpers/test-api-main.ts`, `test/phase1/helpers/controlled-worker-main.ts`
- Create: `vitest.e2e.config.ts`
- Modify: `package.json`

**Deterministic Demo Sequence:**

1. 从 `/postgres` 创建随机数据库并运行 migrations
2. seed 一个 mapped active admin 与一个 mapped active member
3. test-only API composition 注入 Feishu fake；生产 main 仍固定 HTTP adapter
4. 登录 admin，创建恢复任务并 pause/resume；创建第二任务并 cancel；登录 member 验证管理和他人控制被拒绝，记录恢复 job ID
5. 重建 API 进程，使用同一 PostgreSQL 查询到同一 job ID
6. 启动带 test-only barrier 的 Worker A
7. barrier 在 attempt 1 与 lease 提交后通过父进程握手报告 started，父进程随后终止 Worker A
8. 数据库确认 lease 已过期后启动生产构图等价、no-op barrier 的 Worker B
9. Worker B 创建 attempt 2 并完成全部步骤，再重放相同 outbox/wake 验证无新增效果
10. 查询最终表与日志，验证单效果、审计和脱敏

测试握手只存在 `test/phase1` composition，不能由环境变量让生产 main 切换 adapter/barrier，也不能通过任意 HTTP 请求触发 Worker 阻塞或终止

**Final Assertions:**

- refresh/API restart 后 job 可见且 ID 不变
- attempt 1 abandoned，恢复 attempt 为新记录
- 每个 step 只有一个 output_ref、一个 completed event、一次 progress 增量
- job 只有一个 completed 终态事件
- 重复 wake/outbox 不增加 attempt 或效果
- member 管理成员与控制他人任务均被拒绝
- pause/resume/cancel 成功控制各自有准确 audit；失败控制无 audit
- 捕获日志不含 OAuth code、session/CSRF token、Cookie、client secret

- [ ] **Write failing demo:** 先写完整进程生命周期与最终 SQL assertions
- [ ] **Confirm environment:** PostgreSQL readiness command from Task 2
- [ ] **Confirm failure:** `npm run test:phase1:e2e` 因 test process composition 尚不存在而失败，不接受连接失败
- [ ] **Implement minimum:** 只实现 `test/phase1/**`、e2e config 与 script
- [ ] **Run focused demo:** `npm run test:phase1:e2e`

**Acceptance:** 测试飞书登录、API restart visibility、Worker kill/recovery、outbox/lease 幂等、RBAC/audit、日志脱敏在一个真实 PostgreSQL 独立 demo 中通过

**Commit boundary:** `git commit -m "test: prove phase 1 restart recovery"`

## 7. Phase 1 Implementation Acceptance

Task 8 通过后，在同一 implementation head 收集新鲜证据

```bash
npm run verify:legacy
npm run verify:new
npm run dify:manifest:check
npm run test:project-source
npm run project:check
npm run test:integration
npm run test:phase1:e2e
npm run lint
npm run typecheck:phase1
npm run build -w apps/web
git diff --check
```

Expected results

- legacy 恰好 112 tests passed；contracts/domain unit、真实 PostgreSQL integration、独立 recovery demo 全部通过
- typecheck、lint、Web build、migration 与 Workflow manifest check 通过，五个 YAML byte-unchanged
- API/Worker/database/jobs 无 `server/db`、SQLite 或 Dify import；legacy 路径与项目治理记录未修改

Scope commands

```bash
test -n "$PHASE1_BASE"
if rg -n "server/db|sqlite|better-sqlite|dify" apps/api apps/worker packages/database packages/jobs test/phase1; then exit 1; fi
git diff --exit-code "$PHASE1_BASE" HEAD -- server src test/service.test.js dify-workflows/*.yml
git diff --exit-code "$PHASE1_BASE" HEAD -- docs/project/PROJECT.md docs/project/checkpoints docs/project/decisions
```

`PHASE1_BASE` 必须取自总控批准实施时 task contract 的完整 base commit SHA，不由执行 Agent 自行推断

若任一命令失败，停止 acceptance，回到负责该行为的 Task 1-7 修复并重新提交，Task 8 不得修改实现文件；所有命令通过后，执行 Agent 向总控提交 Phase 1 implementation acceptance checkpoint evidence，包括每个 task commit SHA、changed paths、fresh command output、scope audit 与已知风险，只有总控核验该 checkpoint 后才能决定 Phase 2 是否解锁
