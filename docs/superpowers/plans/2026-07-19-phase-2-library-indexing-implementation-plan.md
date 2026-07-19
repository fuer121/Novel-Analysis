# Phase 2 Library And Indexing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付共享书库、章节导入、L1 路由和 L2 专项事实索引的可恢复主链路，并在任务执行前后展示真实 scope 与 coverage

**Architecture:** 复用 Phase 1 PostgreSQL job/outbox/lease/SSE 内核，以 contract-first Dify adapter 连接 chapter、L1、L2 三类线上 Workflow。业务 Repository 负责事务、加密和 freshness，Worker executor 负责单章执行，API 与 Web 共享同一 scope contract

**Tech Stack:** Node.js、TypeScript、Express、Zod、Kysely、PostgreSQL、pg-boss、React、React Router、TanStack Query、Vitest、Supertest、Node crypto

---

## 1. Approval And Global Boundaries

本计划只能在 `GATE-PHASE2-PLAN-APPROVED` 通过后实施

Phase 2 base 必须由总控在 Gate checkpoint 中写入完整 main implementation SHA，执行 Agent 不得自行推断

本阶段禁止：

- query session、query turn、连续提问、turn evidence
- 高级分析、旧 Analysis 归档与导出
- 读取或迁移正式 SQLite 数据
- 部署、正式数据写入、旧系统维护模式或入口切换
- 修改五个线上 Workflow YAML
- 在生产 API/Worker main 中加入 fake、barrier 或环境变量测试开关

Task 0 后续默认采用“一章一个 JobStep”。如果 Task 0 的规模门槛否决该模型，停止 Phase 2，修订本计划并重新通过 `GATE-PHASE2-PLAN-APPROVED`，不得在执行中静默改为批次步骤

每个任务固定采用：实现者自检 -> 规格审查 -> 质量审查 -> 总控 checkpoint。任一行为失败必须回到引入它的任务修复，Task 8 不得跨任务打补丁

## 2. Stable File Map

| Boundary | Files |
| --- | --- |
| Dify contracts | `packages/contracts/src/dify-contract.ts`, `packages/dify/**` |
| Freshness and scope | `packages/domain/src/library/**` |
| Persistent model | `packages/database/src/migrations/003_library_indexing.ts`, `packages/database/src/library/**` |
| Job creation/execution | `packages/jobs/src/library/**`, `apps/worker/src/library-executor.ts` |
| HTTP API | `apps/api/src/routes/books.ts`, `apps/api/src/routes/index-groups.ts` |
| Web workspace | `apps/web/src/features/library/**` |
| Phase acceptance | `test/phase2/**`, `vitest.phase2.config.ts` |

Files created in an earlier task may be modified only by a later task when this plan lists them explicitly

## 3. Task 0: Contract, Granularity And Freshness Decisions

**Files:**

- Create: `packages/contracts/src/dify-contract.ts`
- Create: `packages/contracts/src/dify-contract.test.ts`
- Modify: `packages/contracts/src/index.ts`
- Create: `packages/domain/src/library/freshness.ts`
- Create: `packages/domain/src/library/freshness.test.ts`
- Create: `packages/domain/src/library/step-granularity.ts`
- Create: `packages/domain/src/library/step-granularity.test.ts`
- Modify: `packages/domain/src/index.ts`
- Create: `test/phase2/fixtures/dify-golden.ts`
- Create: `test/phase2/step-granularity.integration.test.ts`
- Create: `docs/project/decisions/DEC-0003-phase2-step-granularity.md`
- Modify: `vitest.integration.config.ts`

- [ ] **Step 1: Extract three-target golden cases**

Define Zod schemas for `chapter-import`, `l1-index`, and `l2-index`. Fixtures must include the exact envelope variants currently accepted by `server/dify.js` and `test/service.test.js`: direct object, `result`, `text`, `output`, and `data`

```ts
export const DifyTargetSchema = z.enum(["chapter-import", "l1-index", "l2-index"]);
export type DifyTarget = z.infer<typeof DifyTargetSchema>;

export const ChapterImportOutputSchema = z.object({
  chapters: z.array(z.object({
    chapterIndex: z.number().int().positive(),
    chapterTitle: z.string(),
    content: z.string(),
    upstreamId: z.string().optional(),
  })),
  nextCursor: z.string().nullable(),
});
```

- [ ] **Step 2: Confirm golden RED**

Run:

```bash
npm run test:new -- packages/contracts/src/dify-contract.test.ts
```

Expected: FAIL because the new schemas and normalizers do not exist, while legacy Dify fixture tests remain green

- [ ] **Step 3: Implement normalized contracts**

Normalizers accept only declared envelope variants and return typed output. Malformed JSON, missing chapter indexes, duplicate chapter indexes and invalid L2 fact objects must return a structural error code, never raw provider bodies

- [ ] **Step 4: Write the freshness matrix**

Use one explicit function per downstream object

```ts
export type FreshnessInputs = {
  sourceVersion: string;
  chapterHmac: string;
  promptHash: string;
  workflowDslHash: string;
  adapterContractVersion: string;
  schemaVersion: string;
  admissionVersion?: string;
  indexGroupConfigHash?: string;
  l1Signature?: string;
};

export function buildL1Signature(input: FreshnessInputs): string;
export function buildL2Signature(input: FreshnessInputs): string;
```

Tests enumerate each field changing independently and assert `fresh` or `stale`. L2 tests prove L1 signature, admission version and index-group config participate; L1 tests prove L2-only fields do not participate

- [ ] **Step 5: Run the granularity experiment**

The integration test inserts synthetic 3, 100 and 3000 chapter jobs for both candidates without正文 content. Measure transaction time, row counts and list/detail query time using PostgreSQL `clock_timestamp()` and `performance.now()`

Pass criteria for one-chapter-per-step on the approved local PostgreSQL environment:

- 3000 steps created in one bounded transaction within 5 seconds
- job detail/progress aggregate query p95 below 500 ms across 20 reads
- task creation emits one created event and one initial outbox row, not 3000 events/outbox rows
- retry selection identifies one failed chapter without recreating unrelated steps
- estimated SSE replay for initial creation stays below 10 events

- [ ] **Step 6: Record DEC-0003**

Record measured numbers, chosen granularity, rejected alternative and the mandatory plan-reapproval condition. Status may be `accepted` only after controller verification

- [ ] **Step 7: Verify and commit**

```bash
npm run test:new -- packages/contracts/src/dify-contract.test.ts packages/domain/src/library
npm run test:integration -- test/phase2/step-granularity.integration.test.ts
npm run typecheck:new
npm run lint
git diff --check
git commit -m "test: fix phase 2 contracts and step granularity"
```

**Acceptance:** 三类 golden contract 通过；freshness 矩阵无隐含字段；3000 章实测满足门槛；DEC-0003 接受一章一步。否则停止并重提计划

## 4. Task 1: Dify Adapter And Fake

**Files:**

- Create: `packages/dify/package.json`
- Create: `packages/dify/tsconfig.json`
- Create: `packages/dify/src/adapter.ts`
- Create: `packages/dify/src/http-adapter.ts`
- Create: `packages/dify/src/fake-adapter.ts`
- Create: `packages/dify/src/normalizers.ts`
- Create: `packages/dify/src/http-adapter.test.ts`
- Create: `packages/dify/src/index.ts`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `vitest.config.ts`

- [ ] **Step 1: Write failing adapter tests**

Cover request mapping, `blocking` response mode, declared inputs, direct/enveloped output, timeout, HTTP 429/5xx, network failure, malformed JSON and redaction

```ts
export interface DifyAdapter {
  runChapterImport(input: ChapterImportInput): Promise<ChapterImportOutput>;
  runL1Index(input: L1IndexInput): Promise<L1IndexOutput>;
  runL2Index(input: L2IndexInput): Promise<L2IndexOutput>;
}
```

- [ ] **Step 2: Confirm RED**

```bash
npm run test -w packages/dify
```

Expected: FAIL because the workspace and adapter do not exist

- [ ] **Step 3: Implement the minimum HTTP adapter**

Inject `fetch`, base URL and per-target credential. Never log request inputs, provider body or credential. Return stable error codes: `provider_timeout`, `provider_rate_limited`, `provider_unavailable`, `provider_invalid_response`

- [ ] **Step 4: Implement deterministic fake**

The fake accepts scripted responses by target and invocation key. It must support delayed resolution and typed failures without reading environment variables

- [ ] **Step 5: Add a manual non-production smoke command**

Create no production code path. Document a test command that requires explicit `DIFY_SMOKE_*` variables and skips when absent. It may call each of the three targets with synthetic non-sensitive inputs and must not write PostgreSQL

- [ ] **Step 6: Verify and commit**

```bash
npm run test -w packages/dify
npm run typecheck -w packages/dify
npm run lint
npm run verify:legacy
git diff --check
git commit -m "feat: add phase 2 Dify adapters"
```

**Acceptance:** 新 adapter 通过 golden cases，fake 可控制恢复测试，敏感输入与 provider body 不进入日志；未实现 analysis targets

## 5. Task 2: Library And Index Persistence

**Files:**

- Create: `packages/database/src/migrations/003_library_indexing.ts`
- Modify: `packages/database/src/migrations/index.ts`
- Modify: `packages/database/src/db.ts`
- Create: `packages/database/src/library/content-encryption.ts`
- Create: `packages/database/src/library/library-repository.ts`
- Create: `packages/database/src/library/index-repository.ts`
- Create: `packages/database/src/library/library.integration.test.ts`
- Create: `packages/database/src/library/index.integration.test.ts`
- Modify: `packages/database/src/index.ts`
- Create: `packages/contracts/src/library-contract.ts`
- Create: `packages/contracts/src/library-contract.test.ts`
- Modify: `packages/contracts/src/index.ts`

- [ ] **Step 1: Write schema and encryption RED tests**

Assert the exact tables from the design, FKs, uniqueness by book/chapter and group/chapter, version references, status checks, and that plaintext sentinel values are absent from queried rows and captured logs

```ts
export interface ContentCipher {
  encrypt(plaintext: string): { ciphertext: Buffer; nonce: Buffer; tag: Buffer; keyVersion: string };
  decrypt(input: EncryptedContent): string;
}
```

- [ ] **Step 2: Confirm RED**

```bash
npm run test:integration -- packages/database/src/library
```

Expected: FAIL because migration 003 and repositories do not exist

- [ ] **Step 3: Implement migration 003**

Use Kysely schema APIs and SQL only for partial/index features. Do not store plaintext body/fact columns. Add indexes for book overview, chapter range, L1 coverage, L2 group coverage and fact review pagination

- [ ] **Step 4: Implement injected content encryption**

Use Node AES-256-GCM with injected 32-byte key and explicit key version. Reject wrong key length, tampered tag and unknown key version. No environment access inside repository modules

- [ ] **Step 5: Implement repositories and contracts**

Repository methods cover create/list/get book, upsert source, insert encrypted chapter, version creation, index-group creation, L1/L2 coverage and paginated fact review. API-facing contracts exclude ciphertext, nonce, tag and hashes not needed by users

- [ ] **Step 6: Verify migration roundtrip and commit**

```bash
npm run test:integration -- packages/database/src/library packages/database/src/schema.integration.test.ts
npm run test:new -- packages/contracts/src/library-contract.test.ts
npm run typecheck -w packages/database
npm run lint
git diff --check
git commit -m "feat: persist encrypted library indexes"
```

**Acceptance:** 所有业务表、约束和 coverage query 通过真实 PostgreSQL；正文与 fact sentinel 不出现在普通列或日志；migration 可在空库完整运行

## 6. Task 3: Book Creation And Chapter Import Slice

**Files:**

- Create: `packages/jobs/src/library/import-job.ts`
- Create: `packages/jobs/src/library/import-job.integration.test.ts`
- Create: `apps/worker/src/library-executor.ts`
- Create: `apps/worker/src/library-executor.integration.test.ts`
- Modify: `apps/worker/src/worker.ts`
- Modify: `apps/worker/src/main.ts`
- Create: `apps/api/src/routes/books.ts`
- Create: `apps/api/src/routes/books.integration.test.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/config.ts`
- Modify: `packages/jobs/src/index.ts`

- [ ] **Step 1: Write scope preview and transaction RED tests**

Preview returns requested, existing-fresh, existing-stale and executable chapter counts plus a `scopeHash`. Job creation must recompute the same selection and return `scope_changed` on hash mismatch

- [ ] **Step 2: Confirm RED**

```bash
npm run test:integration -- packages/jobs/src/library/import-job.integration.test.ts apps/api/src/routes/books.integration.test.ts
```

- [ ] **Step 3: Implement book and import endpoints**

Routes:

```text
POST /api/books
GET  /api/books
GET  /api/books/:id
POST /api/books/:id/import-preview
POST /api/books/:id/import-jobs
```

member and admin may create/import. Stable Idempotency-Key remains required. Book/source update and import job creation use separate explicit transactions; job, one-step-per-selected-chapter, created event and initial outbox use one transaction

- [ ] **Step 4: Implement import executor**

The step output is a chapter reference, never plaintext. Validate adapter output, compute HMAC, encrypt and commit chapter plus output reference. Adapter failure leaves no chapter row. Signature-matching chapter becomes skipped without provider call

- [ ] **Step 5: Add explicit auto-L1 handoff flag**

Snapshot `autoStartL1` at import job creation. Only a fully completed import creates the L1 job; partial failure exposes gaps and does not silently start L1

- [ ] **Step 6: Verify recovery and commit**

```bash
npm run test:integration -- packages/jobs/src/library/import-job.integration.test.ts apps/worker/src/library-executor.integration.test.ts apps/api/src/routes/books.integration.test.ts
npm run typecheck:phase1
npm run lint
git diff --check
git commit -m "feat: add recoverable chapter import"
```

**Acceptance:** preview equals execution; duplicate concurrency key is blocked/merged; plaintext absent; pause/cancel/recovery preserve single chapter effects; automatic L1 occurs only when explicitly selected and import completes

## 7. Task 4: L1 Build And Coverage

**Files:**

- Create: `packages/jobs/src/library/l1-job.ts`
- Create: `packages/jobs/src/library/l1-job.integration.test.ts`
- Modify: `apps/worker/src/library-executor.ts`
- Modify: `apps/worker/src/library-executor.integration.test.ts`
- Modify: `apps/api/src/routes/books.ts`
- Modify: `apps/api/src/routes/books.integration.test.ts`
- Modify: `packages/database/src/library/index-repository.ts`
- Modify: `packages/database/src/library/index.integration.test.ts`

- [ ] **Step 1: Write freshness and coverage RED tests**

Coverage partitions every chapter exactly once into `fresh | missing | failed | stale`. Changing each Task 0 L1 signature field makes only expected rows stale

- [ ] **Step 2: Implement L1 preview and job creation**

```text
GET  /api/books/:id/l1-coverage
POST /api/books/:id/l1-preview
POST /api/books/:id/l1-jobs
```

Preview and creation share the same selector and scope hash. Freeze Prompt, Workflow, Schema and adapter versions in job config snapshot

- [ ] **Step 3: Implement L1 executor**

Decrypt one chapter in memory, call adapter, validate normalized route, and atomically upsert `l1_indexes`, step output reference, progress and event. Never place route body or chapter text in event payload

- [ ] **Step 4: Verify stale/skip/recovery and commit**

```bash
npm run test:integration -- packages/jobs/src/library/l1-job.integration.test.ts apps/worker/src/library-executor.integration.test.ts apps/api/src/routes/books.integration.test.ts packages/database/src/library/index.integration.test.ts
npm run lint
npm run typecheck:phase1
git diff --check
git commit -m "feat: build recoverable L1 indexes"
```

**Acceptance:** fresh chapters skip provider; stale/missing selection correct; failure creates precise gap; duplicate/late completion produces one L1 row and one progress effect

## 8. Task 5: L2 Index Groups And Scope Contract

**Files:**

- Create: `packages/domain/src/library/l2-scope.ts`
- Create: `packages/domain/src/library/l2-scope.test.ts`
- Modify: `packages/domain/src/index.ts`
- Create: `packages/jobs/src/library/l2-job.ts`
- Create: `packages/jobs/src/library/l2-job.integration.test.ts`
- Create: `apps/api/src/routes/index-groups.ts`
- Create: `apps/api/src/routes/index-groups.integration.test.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `packages/database/src/library/index-repository.ts`

- [ ] **Step 1: Write the full scope matrix**

Enumerate `3 modes x 2 force values x 5 statuses`, plus range boundaries. Assert `force` never changes membership and `outside-range` is never selected

```ts
export function selectL2Scope(input: {
  mode: "all" | "missing" | "retry_failed";
  force: boolean;
  startChapter: number;
  endChapter: number;
  chapters: ChapterIndexState[];
}): { execute: number[]; skip: ScopeSkip[] };
```

- [ ] **Step 2: Implement index-group API**

```text
POST /api/books/:bookId/index-groups
GET  /api/books/:bookId/index-groups
GET  /api/books/:bookId/index-groups/:id/coverage
POST /api/books/:bookId/index-groups/:id/l2-preview
POST /api/books/:bookId/index-groups/:id/l2-jobs
```

Creating or editing a group binds immutable Prompt/Workflow versions and computes config hash. Preview returns execute/skip counts and a scope hash

- [ ] **Step 3: Implement transactional L2 job creation**

Recompute scope under transaction. Reject changed scope. Use concurrency key containing book, group, range, mode and frozen execution signature. Create one step per selected chapter

- [ ] **Step 4: Verify and commit**

```bash
npm run test:new -- packages/domain/src/library/l2-scope.test.ts
npm run test:integration -- packages/jobs/src/library/l2-job.integration.test.ts apps/api/src/routes/index-groups.integration.test.ts
npm run lint
npm run typecheck:phase1
git diff --check
git commit -m "feat: define L2 scope and index groups"
```

**Acceptance:** scope matrix exhaustive; preview and execution identical; `missing`/`retry_failed` cannot expand through force; concurrency duplicates blocked/merged

## 9. Task 6: L2 Executor, Facts And Admission

**Files:**

- Create: `packages/domain/src/library/l2-admission.ts`
- Create: `packages/domain/src/library/l2-admission.test.ts`
- Modify: `packages/domain/src/index.ts`
- Modify: `apps/worker/src/library-executor.ts`
- Modify: `apps/worker/src/library-executor.integration.test.ts`
- Modify: `packages/database/src/library/index-repository.ts`
- Modify: `packages/database/src/library/index.integration.test.ts`

- [ ] **Step 1: Port fixed golden admission cases**

Move only behavior required by current golden fixtures, including magical-creature exclusions, uncertain candidate promotion, artifact/material rejection and Prompt isolation. Do not import legacy database or task code

- [ ] **Step 2: Confirm admission RED**

```bash
npm run test:new -- packages/domain/src/library/l2-admission.test.ts
```

- [ ] **Step 3: Implement L2 executor**

Decrypt chapter and load compact L1 route, call adapter, validate Schema, run admission, encrypt accepted fact bodies and atomically replace the chapter/group result version. Structural failure commits no facts; business rejection commits status and counts without provider error

- [ ] **Step 4: Verify idempotency and history**

Tests prove duplicate completion, expired attempt and replay do not duplicate facts, subjects, coverage, progress or events. Stale prior result remains auditable until the replacement transaction commits

- [ ] **Step 5: Verify and commit**

```bash
npm run test:new -- packages/domain/src/library/l2-admission.test.ts
npm run test:integration -- apps/worker/src/library-executor.integration.test.ts packages/database/src/library/index.integration.test.ts
npm run verify:legacy
npm run lint
npm run typecheck:phase1
git diff --check
git commit -m "feat: persist admitted L2 facts"
```

**Acceptance:** golden admission parity; encrypted fact storage; precise provider/structure/business failure semantics; recovery and replay yield one effect

## 10. Task 7: Book Workspace And Fact Review

**Files:**

- Create: `apps/web/src/features/library/LibraryPage.tsx`
- Create: `apps/web/src/features/library/BookWorkspacePage.tsx`
- Create: `apps/web/src/features/library/BookOverview.tsx`
- Create: `apps/web/src/features/library/ImportPanel.tsx`
- Create: `apps/web/src/features/library/L1Panel.tsx`
- Create: `apps/web/src/features/library/L2Panel.tsx`
- Create: `apps/web/src/features/library/FactReview.tsx`
- Create: `apps/web/src/features/library/library.test.tsx`
- Modify: `apps/web/src/app/router.tsx`
- Modify: `apps/web/src/app/AppShell.tsx`
- Modify: `apps/web/src/app/styles.css`
- Modify: `apps/web/src/shared/api.ts`
- Modify: `apps/web/src/features/task-center/useJobEvents.ts`

- [ ] **Step 1: Write workflow interaction tests**

Cover library list, book creation, preserved selected book context, import preview, explicit auto-L1, L1 coverage, L2 group/mode/range preview, scope-change conflict, task creation, SSE invalidation and paginated fact review

- [ ] **Step 2: Confirm Web RED**

```bash
npm run test -w apps/web
```

- [ ] **Step 3: Implement routes and shared navigation**

```text
/books
/books/:bookId/overview
/books/:bookId/import
/books/:bookId/l1
/books/:bookId/l2
```

The sidebar contains 书库、任务中心 and admin-only 成员管理. Book workspace tabs preserve `bookId`; users do not reselect a book between import/L1/L2

- [ ] **Step 4: Implement scope-first panels**

Each write flow requires successful preview and explicit confirmation. Display requested, execute, skip, fresh, missing, failed and stale counts before submission. On `scope_changed`, invalidate preview and require reconfirmation

- [ ] **Step 5: Implement responsive fact review**

Desktop uses dense tables and unframed page sections. Mobile uses staged controls and local table scrolling. Fact body is fetched only for authorized review and never stored outside query cache

- [ ] **Step 6: Browser verification**

Use the in-app Browser at 1440x900, 1280x800, 768x1024 and 390x844. Verify no root overflow, stable controls, scope counts, task continuity after navigation and fact review readability

- [ ] **Step 7: Verify and commit**

```bash
npm run test -w apps/web
npm run typecheck -w apps/web
npm run build -w apps/web
npm run lint
git diff --check
git commit -m "feat: add the book indexing workspace"
```

**Acceptance:** one-book context persists; scope is explicit before execution; task/coverage refresh through API/SSE; mobile and desktop browser QA pass; no Phase 3 route exists

## 11. Task 8: Scale, Recovery And Phase 2 Acceptance

**Files:**

- Create: `test/phase2/library-indexing.e2e.test.ts`
- Create: `test/phase2/scale.integration.test.ts`
- Create: `test/phase2/helpers/test-api-main.ts`
- Create: `test/phase2/helpers/controlled-worker-main.ts`
- Create: `test/phase2/helpers/processes.ts`
- Create: `vitest.phase2.config.ts`
- Modify: `package.json`

- [ ] **Step 1: Write the independent RED demo**

The test creates a disposable PostgreSQL database, starts test-only API and Worker compositions, uses Dify fake, and initially fails because Phase 2 composition is absent, not because PostgreSQL is unavailable

- [ ] **Step 2: Prove the vertical workflow**

Create a book, preview and import three chapters, auto-start L1, create one L2 group, preview `missing`, run L2, navigate/restart API and assert the same book, jobs and coverage

- [ ] **Step 3: Prove recovery and scope**

Kill Worker A after a Dify call boundary and committed lease, wait for DB-confirmed expiry, start Worker B and assert one chapter/L1/L2 effect. Replay same outbox and wake through real pg-boss, wait for consumer completion and compare final SQL snapshots

- [ ] **Step 4: Prove scale**

Insert synthetic metadata for 3000 chapters and 70000 facts, without real正文. Assert Task 0 thresholds for coverage, book overview, fact pagination and job detail

- [ ] **Step 5: Run full Phase 2 verification**

```bash
npm run verify:legacy
npm run verify:new
npm run dify:manifest:check
npm run test:project-source
npm run project:check
npm run test:integration
npm run test:phase1:e2e
npm run test:phase2:e2e
npm run lint
npm run typecheck:phase2
npm run build -w apps/web
git diff --check
```

- [ ] **Step 6: Run the scope audit**

With controller-provided `PHASE2_BASE`:

```bash
git diff --exit-code "$PHASE2_BASE" HEAD -- server src test/service.test.js dify-workflows/*.yml
git diff --exit-code "$PHASE2_BASE" HEAD -- docs/project/decisions/DEC-0001-project-governance.md docs/project/decisions/DEC-0002-automated-pull-request-authority.md
git diff "$PHASE2_BASE" HEAD -- package-lock.json
```

Inspect the lockfile diff and confirm it contains only the authorized `packages/dify` workspace metadata and dependencies. Any unrelated lockfile drift blocks acceptance

Also scan only added lines and import statements for `server/db`, SQLite imports, analysis/query routes and production test hooks. Baseline rejection tests containing the word `sqlite` are not violations

- [ ] **Step 7: Commit**

```bash
git add test/phase2 vitest.phase2.config.ts package.json
git commit -m "test: prove phase 2 library indexing"
```

**Acceptance:** test book completes import/L1/L2; scope preview equals actual execution; API/Worker restart and replay produce one effect; scale thresholds pass; no plaintext or credential leakage; Phase 3 and migration remain absent

## 12. Final Gate

Task 8 submits evidence only. The controller must independently verify every command, changed path, task commit, review result, process/database cleanup and known risk before requesting `GATE-PHASE2-IMPLEMENTATION-ACCEPTED`

Passing Phase 2 does not authorize Phase 3 implementation, formal data migration, deployment or legacy cutover
