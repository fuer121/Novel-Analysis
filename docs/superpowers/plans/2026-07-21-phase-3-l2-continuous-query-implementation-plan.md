# Phase 3 L2 Continuous Query Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付一本书、一个 L2 索引组范围内的连续研究会话，每轮重新召回并保存独立证据，支持可恢复汇总、明确降级和响应式问答工作区

**Architecture:** 新增独立 Query 垂直模块，复用现有 PostgreSQL、ContentCipher、L2 repository、JobStep、lease、outbox、pg-boss 和 SSE。Query 使用独立 `jobs.query.wake` 交互队列，现有 `analysis-summary` DSL 通过扩展 TypeScript Dify adapter 接入，旧回答正文不进入意图、召回或汇总输入

**Tech Stack:** TypeScript、Kysely、PostgreSQL、Express、pg-boss、Zod、React、TanStack Query、Vitest、Testing Library、Playwright

---

## 1. 批准边界

### Core Allowed Modules

- `packages/contracts/src/query-contract.ts`
- `packages/contracts/src/dify-contract.ts`
- `packages/dify/src/**`
- `packages/database/src/migrations/006_continuous_queries.ts`
- `packages/database/src/query/**`
- `packages/database/src/db.ts`
- `packages/database/src/library/index-repository.ts`
- `packages/domain/src/query/**`
- `packages/jobs/src/query/**`
- `packages/jobs/src/boss.ts`
- `packages/jobs/src/outbox-dispatcher.ts`
- `apps/api/src/routes/query-sessions.ts`
- `apps/api/src/app.ts`
- `apps/worker/src/query-executor.ts`
- `apps/worker/src/worker.ts`
- `apps/worker/src/main.ts`
- `apps/web/src/features/query/**`
- `apps/web/src/app/router.tsx`
- `apps/web/src/features/library/BookWorkspacePage.tsx`
- `apps/web/src/app/styles.css`
- `test/phase3/**`
- Phase 3 Vitest 配置与 root test/typecheck scripts

### Mechanical Adjacent Scope

- 直接对应测试、类型与 package export
- migration registry 与 schema roundtrip fixtures
- 现有 runtime wiring、测试 fake 和 manifest-derived test fixture
- `useJobEvents` 对 query keys 的直接失效

### Prohibited Changes

- 新增第六个 Dify Workflow、修改仓库 DSL 或凭证文件
- embeddings、向量数据库、新消息系统或新外部依赖
- 多索引组会话、单轮跨索引组召回或成员级分享 ACL
- 高级分析、旧 Analysis 迁移、正式数据操作、部署或切换
- 修改现有 L1/L2 索引语义、事实准入或 Phase 2 Gate

### Escalation Conditions

- 现有 `analysis-summary` DSL 不能在不修改 DSL 的情况下满足已确认输入/输出契约
- 召回 golden cases 需要读取旧回答正文或新增 embeddings
- 交互队列隔离需要替换 pg-boss、Job 状态机、lease 或 outbox 协议
- schema/index 不能在 10 用户并发与既定 read threshold 下工作
- 发现问题、回答、fact 正文或凭证进入普通列、事件、outbox、attempt error 或日志
- 需要改变会话分享、管理员权限、Gate 或验收标准

## 2. 文件结构

| 单元 | 责任 |
| --- | --- |
| `query-contract.ts` | API、turn 状态、意图与证据的公共 Zod 契约 |
| `006_continuous_queries.ts` | Query tables、约束、索引与 summary workflow target |
| `query-repository.ts` | 密文会话/turn、分享授权与不可变证据持久化 |
| `intent.ts` | 最近三轮问题到结构化意图的确定性解析 |
| `recall-policy.ts` | 单目标、集合、普通查询候选排序与采用/淘汰结论 |
| `query-job.ts` | preview、scope hash、事务式 job 创建与 fallback attempt |
| `query-sessions.ts` | authenticated Query HTTP API 与 RBAC |
| `query-executor.ts` | 召回、证据提交、Dify 汇总、本地摘要与错误归一化 |
| `worker.ts` | background 与 interactive wake queue 消费隔离 |
| `QueryWorkspacePage.tsx` | 会话左栏、问答上区、证据下区和移动端抽屉 |

## 3. 实施任务

### Task 1: Query 与 analysis-summary 契约

**Files:**

- Create: `packages/contracts/src/query-contract.ts`
- Create: `packages/contracts/src/query-contract.test.ts`
- Modify: `packages/contracts/src/dify-contract.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/dify/src/adapter.ts`
- Modify: `packages/dify/src/http-adapter.ts`
- Modify: `packages/dify/src/fake-adapter.ts`
- Modify: `packages/dify/src/normalizers.ts`
- Test: `packages/dify/src/http-adapter.test.ts`

- [ ] **Step 1: 写失败的 Query 公共契约测试**

```ts
import { describe, expect, it } from "vitest";
import { QueryIntentSchema, QueryTurnSchema } from "./query-contract.js";

describe("query contracts", () => {
  it("rejects facts and answer text from the intent snapshot", () => {
    expect(QueryIntentSchema.safeParse({
      kind: "single-target",
      target: "陈平安",
      aliases: [],
      referents: ["他"],
      fact: "旧回答里的结论",
    }).success).toBe(false);
  });

  it("exposes awaiting fallback separately from completion", () => {
    const parsed = QueryTurnSchema.parse({
      id: "00000000-0000-4000-8000-000000000001",
      sessionId: "00000000-0000-4000-8000-000000000002",
      createdBy: "00000000-0000-4000-8000-000000000003",
      question: "之后发生了什么？",
      startChapter: 420,
      endChapter: 860,
      status: "awaiting_fallback",
      answer: null,
      degradation: null,
      sourceStats: { candidates: 12, used: 8, excluded: 4, gaps: 1 },
    });
    expect(parsed.status).toBe("awaiting_fallback");
  });
});
```

- [ ] **Step 2: 运行 RED**

Run: `npm test -w packages/contracts -- query-contract.test.ts`

Expected: FAIL，`query-contract.js` 不存在

- [ ] **Step 3: 定义最小公共类型**

```ts
export const QueryIntentSchema = z.strictObject({
  kind: z.enum(["single-target", "collection", "general"]),
  target: z.string().trim().min(1).nullable(),
  aliases: z.array(z.string().trim().min(1)).max(20),
  referents: z.array(z.string().trim().min(1)).max(20),
  categories: z.array(z.string().trim().min(1)).max(20).default([]),
  keywords: z.array(z.string().trim().min(1)).max(50).default([]),
});

export const QUERY_TURN_STATUSES = [
  "queued", "running", "awaiting_fallback", "completed",
  "degraded", "failed", "cancelled",
] as const;

export const QuerySourceStatsSchema = z.strictObject({
  candidates: z.number().int().nonnegative(),
  used: z.number().int().nonnegative(),
  excluded: z.number().int().nonnegative(),
  gaps: z.number().int().nonnegative(),
});
```

`QuerySessionSchema` 必须公开 `visibility: "private" | "team"`、默认范围和 `canManage`，`QueryEvidenceSchema` 必须公开 fact 引用、章节、正文、rank、recallReason、disposition 与 exclusionReason

- [ ] **Step 4: 写 analysis-summary adapter RED**

```ts
it("calls the tracked analysis-summary workflow contract", async () => {
  const fetch = vi.fn(async () => new Response(JSON.stringify({
    data: { outputs: { result: "基于证据的回答" } },
  }), { status: 200 }));
  const adapter = new HttpDifyAdapter({
    fetch,
    baseUrl: "https://dify.test/v1",
    credentials: {
      "chapter-import": "chapter-key",
      "l1-index": "l1-key",
      "l2-index": "l2-key",
      "analysis-summary": "summary-key",
    },
    timeoutMs: 100,
  });
  await expect(adapter.runAnalysisSummary({
    invocationKey: "turn-1:attempt-1",
    taskType: "l2_query",
    prompt: "只依据证据回答",
    contextJson: JSON.stringify({ question: "之后呢？", evidence: [] }),
  })).resolves.toEqual({ text: "基于证据的回答" });
});
```

- [ ] **Step 5: 扩展现有 target，不新增 DSL**

```ts
export type DifyTarget = "chapter-import" | "l1-index" | "l2-index" | "analysis-summary";

export type AnalysisSummaryInput = {
  invocationKey: string;
  taskType: "l2_query";
  prompt: string;
  contextJson: string;
};

export type AnalysisSummaryOutput = { text: string };

export interface DifyAdapter {
  runChapterImport(input: ChapterImportInput): Promise<ChapterImportOutput>;
  runL1Index(input: L1IndexInput): Promise<L1IndexOutput>;
  runL2Index(input: L2IndexInput): Promise<L2IndexOutput>;
  runAnalysisSummary(input: AnalysisSummaryInput): Promise<AnalysisSummaryOutput>;
}
```

HTTP inputs 必须精确映射已跟踪 DSL 的 `task_type`、`prompt`、`context_json`，其余已有字段传空字符串或 `false` 字符串，输出只接受非空 `outputs.result`

`runAnalysisSummary` 对 timeout、network、429 和 5xx 最多执行三次 adapter-level attempt，对 invalid response 不重试；测试使用 fake timers，不降低现有 timeout

- [ ] **Step 6: GREEN 与回归验证**

Run: `npm test -w packages/contracts && npm test -w packages/dify && npm run typecheck:new`

Expected: Query contracts 与四个 Dify targets 全部 PASS，已有三个 target 行为不变

- [ ] **Step 7: Commit**

```bash
git add packages/contracts packages/dify
git commit -m "feat: define continuous query contracts"
```

**Acceptance:** Query public types 拒绝事实型意图字段，TypeScript adapter 能调用仓库已有 `analysis-summary` DSL 契约，未修改任何 YAML

### Task 2: Query schema、密文 repository 与分享权限

**Files:**

- Create: `packages/database/src/migrations/006_continuous_queries.ts`
- Create: `packages/database/src/query/query-repository.ts`
- Create: `packages/database/src/query/query-repository.integration.test.ts`
- Modify: `packages/database/src/migrations/index.ts`
- Modify: `packages/database/src/db.ts`
- Modify: `packages/database/src/library/index-repository.ts`
- Modify: `packages/database/src/index.ts`
- Modify: `packages/database/src/schema.integration.test.ts`

- [ ] **Step 1: 写 schema 与 transaction RED**

```ts
it("rolls back a turn and its evidence together", async () => {
  await expect(database.transaction().execute(async (tx) => {
    const repository = createQueryRepository(tx, cipher);
    const turn = await repository.createTurn(turnInput);
    await repository.commitEvidence({ turnId: turn.id, evidence: [candidate] });
    throw new Error("rollback");
  })).rejects.toThrow("rollback");
  expect(await database.selectFrom("query_turns").select("id").execute()).toEqual([]);
  expect(await database.selectFrom("turn_evidence").select("id").execute()).toEqual([]);
});
```

再写以下 RED：密文 roundtrip、单组/范围约束、私有读取拒绝、团队共享可读、共享成员不能管理会话、证据二次提交拒绝

- [ ] **Step 2: 运行 RED**

Run: `npm run test:integration -- packages/database/src/query/query-repository.integration.test.ts`

Expected: FAIL，migration 与 repository 不存在

- [ ] **Step 3: 添加 migration**

`query_sessions` 使用以下边界：

```ts
type QuerySessionRow = {
  id: string;
  book_id: string;
  group_id: string;
  created_by: string;
  visibility: "private" | "team";
  default_start_chapter: number;
  default_end_chapter: number;
  title_ciphertext: Buffer;
  title_nonce: Buffer;
  title_tag: Buffer;
  title_key_version: string;
  archived_at: Date | null;
};
```

`query_turns` 保存 question/answer 密文字段、`question_hmac`、范围、intent/source/gap/config JSON、execution signature、`evidence_snapshot_hash`、status、job/attempt 引用和 degradation，`turn_evidence` 保存 `turn_id + fact_id` 唯一引用、rank、reason、disposition 与 exclusion reason

Migration 必须给 `query_sessions(book_id, created_by, updated_at, id)`、`query_turns(session_id, created_at, id)` 和 `turn_evidence(turn_id, disposition, rank)` 建索引，并把 `workflow_versions_target_check` 扩展到 `analysis-summary`

- [ ] **Step 4: 实现 repository 公共边界**

```ts
export function createQueryRepository(db: DatabaseExecutor, cipher: ContentCipher) {
  return {
    createSession(input: CreateQuerySessionInput): Promise<QuerySession>,
    listVisibleSessions(input: { bookId: string; actor: QueryActor }): Promise<QuerySession[]>,
    updateSession(input: ManageQuerySessionInput): Promise<QuerySession>,
    archiveSession(input: ManageQuerySessionInput): Promise<void>,
    createTurn(input: CreateQueryTurnInput): Promise<QueryTurn>,
    commitEvidence(input: CommitTurnEvidenceInput): Promise<void>,
    completeTurn(input: CompleteTurnInput): Promise<QueryTurn>,
    getTurn(input: { turnId: string; actor: QueryActor }): Promise<QueryTurnDetail>,
  };
}
```

所有解密只发生在 repository 返回授权对象时，普通 query 不得 select 密文字段后自行解密

- [ ] **Step 5: GREEN、migration roundtrip 与 plaintext scan**

Run: `npm run test:integration -- packages/database/src/query/query-repository.integration.test.ts packages/database/src/schema.integration.test.ts`

Expected: PASS，down/up roundtrip 后三个 Query tables 与 target constraint 一致

Run: `npm run typecheck:phase2 && git diff --check`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/database
git commit -m "feat: persist encrypted query sessions"
```

**Acceptance:** session/title/question/answer 密文 roundtrip，分享规则由 repository 服务端执行，turn 与 evidence 事务回滚无孤儿记录

### Task 3: 意图与三类召回策略

**Files:**

- Create: `packages/domain/src/query/intent.ts`
- Create: `packages/domain/src/query/intent.test.ts`
- Create: `packages/domain/src/query/recall-policy.ts`
- Create: `packages/domain/src/query/recall-policy.test.ts`
- Modify: `packages/domain/src/index.ts`
- Create: `test/phase3/fixtures/legacy-query-golden.ts`

- [ ] **Step 1: 把旧基线固化为独立 golden fixture**

```ts
export const QUERY_GOLDEN = [
  { name: "single target alias", question: "陈平安/平安后来的飞剑变化", kind: "single-target", mustUse: ["chen-later"] },
  { name: "collection", question: "各境界最强的人分别是谁", kind: "collection", mustCoverWindows: [1, 2, 3] },
  { name: "broad collection", question: "有哪些重要法宝", kind: "collection", forbiddenTarget: "重要法宝" },
  { name: "late chapter", question: "陈平安最后获得了什么", kind: "single-target", mustUse: ["late-fact"] },
] as const;
```

- [ ] **Step 2: 写意图隔离 RED**

```ts
it("resolves a pronoun from questions without reading prior answers", () => {
  const intent = resolveQueryIntent({
    question: "他后来有什么变化？",
    recentQuestions: ["陈平安第一次获得飞剑是什么时候？"],
    knownSubjects: [{ subjectKey: "chen", displayName: "陈平安", aliases: ["平安"] }],
  });
  expect(intent.target).toBe("chen");
  expect(JSON.stringify(intent)).not.toContain("上一轮模型回答");
});
```

- [ ] **Step 3: 写召回 RED**

```ts
it.each(QUERY_GOLDEN)("matches $name", (golden) => {
  const result = recallFacts(buildRecallInput(golden));
  expect(result.kind).toBe(golden.kind);
  for (const id of golden.mustUse ?? []) expect(result.used.map((fact) => fact.id)).toContain(id);
  if (golden.forbiddenTarget) expect(result.intent.target).not.toBe(golden.forbiddenTarget);
});
```

另写窗口扫描不能在早期候选上限停止、目标事实优先、候选上限、稳定排序和 exclusion reason 测试

- [ ] **Step 4: 运行 RED**

Run: `npm test -w packages/domain -- query`

Expected: FAIL，intent 与 recall policy 不存在

- [ ] **Step 5: 实现纯函数边界**

```ts
export function resolveQueryIntent(input: {
  question: string;
  recentQuestions: readonly string[];
  knownSubjects: readonly KnownSubject[];
}): QueryIntent;

export function recallFacts(input: {
  intent: QueryIntent;
  windows: readonly RecallWindow[];
  maxCandidates: number;
  maxUsed: number;
}): { candidates: RankedFact[]; used: RankedFact[]; gaps: RecallGap[] };
```

`recentQuestions` 在入口强制 `slice(-3)`，函数签名不接受 prior answers，三类策略使用显式分支和稳定 tie-breaker `chapterIndex, factId`

- [ ] **Step 6: GREEN 与 legacy parity**

Run: `npm test -w packages/domain && npm run test:legacy`

Expected: 新 golden 全部 PASS，legacy 112/112 保持通过

- [ ] **Step 7: Commit**

```bash
git add packages/domain test/phase3/fixtures
git commit -m "feat: add deterministic query recall policies"
```

**Acceptance:** 单目标、集合、普通和后段章节 golden 通过，旧回答在类型与运行时都不能成为召回输入

### Task 4: 会话 API、preview 与事务式 Query job

**Files:**

- Create: `packages/jobs/src/query/query-job.ts`
- Create: `packages/jobs/src/query/query-job.integration.test.ts`
- Modify: `packages/jobs/src/index.ts`
- Create: `apps/api/src/routes/query-sessions.ts`
- Create: `apps/api/src/routes/query-sessions.integration.test.ts`
- Modify: `apps/api/src/app.ts`

- [ ] **Step 1: 写权限与 preview RED**

覆盖以下矩阵：私有 owner/admin 200、其他 member 404，共享 member 200 且可创建自己的 turn，非 owner 修改 session 403，成员控制他人 turn 403，范围扩大 400，scope hash 漂移 409

```ts
it("rejects a turn range wider than the session default", async () => {
  const response = await request(app)
    .post(`/api/books/${bookId}/query-sessions/${sessionId}/turn-preview`)
    .set(authHeaders(member))
    .send({ question: "之后呢？", startChapter: 1, endChapter: 1001 });
  expect(response.status).toBe(400);
  expect(response.body).toEqual({ error: "invalid_request" });
});
```

- [ ] **Step 2: 写 transaction 与 idempotency RED**

```ts
it("creates turn, job, step and interactive outbox atomically", async () => {
  const created = await service.createTurn({ ...input, requestId: "request-1" });
  expect(created.turn.status).toBe("queued");
  expect(await selectCounts(database, created.turn.id)).toEqual({ turns: 1, jobs: 1, steps: 1, outbox: 1 });
  await expect(service.createTurn({ ...input, requestId: "request-1", question: "changed" }))
    .rejects.toBeInstanceOf(QueryIdempotencyConflictError);
  expect((await database.selectFrom("job_outbox").select("topic").executeTakeFirstOrThrow()).topic).toBe("jobs.query.wake");
});
```

- [ ] **Step 3: 运行 RED**

Run: `npm run test:integration -- packages/jobs/src/query apps/api/src/routes/query-sessions.integration.test.ts`

Expected: FAIL，Query service/router 不存在

- [ ] **Step 4: 实现 service 契约**

```ts
export class QueryJobService {
  preview(input: QueryPreviewInput): Promise<QueryPreview>;
  createTurn(input: QueryCreateInput): Promise<{ turn: QueryTurn; job: PublicJob }>;
  retrySummary(input: QueryFallbackInput): Promise<PublicJob>;
  requestLocalSummary(input: QueryFallbackInput): Promise<PublicJob>;
}
```

scope hash 必须包含 session/group/range、问题 HMAC、L2 coverage signatures、summary workflow version、recall policy version和最近三轮问题 HMAC，不包含明文

create transaction 插入一个 `l2-query` job、一个 `l2-query` step 与 `jobs.query.wake` outbox，fallback job 使用 `query-summary-retry` 或 `query-local-summary` step 并引用原 evidence snapshot version

- [ ] **Step 5: 实现 HTTP API**

最小路由：

```text
GET    /api/books/:bookId/query-sessions
POST   /api/books/:bookId/query-sessions
GET    /api/books/:bookId/query-sessions/:sessionId
PATCH  /api/books/:bookId/query-sessions/:sessionId
POST   /api/books/:bookId/query-sessions/:sessionId/archive
POST   /api/books/:bookId/query-sessions/:sessionId/turn-preview
POST   /api/books/:bookId/query-sessions/:sessionId/turns
GET    /api/books/:bookId/query-sessions/:sessionId/turns/:turnId
POST   /api/books/:bookId/query-sessions/:sessionId/turns/:turnId/retry-summary
POST   /api/books/:bookId/query-sessions/:sessionId/turns/:turnId/local-summary
```

所有写路由使用现有 CSRF 与 `Idempotency-Key`，错误只返回稳定 code

- [ ] **Step 6: GREEN 与 scope audit**

Run: `npm run test:integration -- packages/jobs/src/query apps/api/src/routes/query-sessions.integration.test.ts && npm run typecheck:phase1 && npm run lint`

Expected: PASS，现有 books/index/jobs routes 行为不变

- [ ] **Step 7: Commit**

```bash
git add packages/jobs apps/api
git commit -m "feat: add query sessions and turn submission"
```

**Acceptance:** preview 与明确确认存在，范围不能扩大，分享/RBAC 在服务端执行，turn/job/step/outbox 事务一致且重试幂等

### Task 5: Query executor、fallback 与交互队列恢复

**Files:**

- Create: `apps/worker/src/query-executor.ts`
- Create: `apps/worker/src/query-executor.integration.test.ts`
- Modify: `apps/worker/src/worker.ts`
- Modify: `apps/worker/src/worker.test.ts`
- Modify: `apps/worker/src/main.ts`
- Modify: `packages/jobs/src/boss.ts`
- Modify: `packages/jobs/src/outbox-dispatcher.ts`

- [ ] **Step 1: 写 executor RED**

```ts
it("commits evidence and encrypted answer once", async () => {
  const result = await executor.execute(claim);
  expect(result.disposition).toBe("completed");
  expect(await evidenceFor(turnId)).toMatchObject([
    { factId: factA.id, disposition: "used", rank: 1 },
    { factId: factB.id, disposition: "excluded", exclusionReason: "candidate_budget" },
  ]);
  expect(await decryptedAnswer(turnId)).toBe("基于证据的回答");
});
```

再写 no-evidence 不调用 Dify、provider failure 进入 `awaiting_fallback`、retry 复用 evidence version、本地摘要进入 `degraded`、旧回答 sentinel 不进入 Dify calls

- [ ] **Step 2: 写交互队列与 recovery RED**

```ts
it("consumes query wakes while the background consumer is occupied", async () => {
  await worker.start();
  backgroundGate.hold();
  await boss.send("jobs.wake", backgroundJob, { singletonKey: "background" });
  await boss.send("jobs.query.wake", queryJob, { singletonKey: "interactive" });
  await waitForTurnStatus(database, turnId, "completed");
  expect(await jobStatus(backgroundJob.jobId)).toBe("running");
});
```

再写 Dify boundary lease expiry、Worker B 恢复、Worker A late result、exact outbox replay，断言一个 answer/evidence snapshot 和 attempts `abandoned, completed`

- [ ] **Step 3: 运行 RED**

Run: `npm run test:integration -- apps/worker/src/query-executor.integration.test.ts apps/worker/src/worker.test.ts`

Expected: FAIL，Query executor 与 interactive consumer 不存在

- [ ] **Step 4: 实现 executor 状态机**

```ts
export class QueryExecutor {
  constructor(private readonly options: {
    database: DatabaseConnection;
    repository: ReturnType<typeof createQueryRepository>;
    indexRepository: ReturnType<typeof createIndexRepository>;
    dify: DifyAdapter;
  }) {}

  execute(claim: ClaimedStep): Promise<{ disposition: CompletionDisposition | "failed" }>;
}
```

executor 在 Dify 调用前读取并冻结 evidence version，提交时重新验证 claim、turn status 与 evidence version，迟到结果返回 `already-completed` 或 `terminal-noop`

- [ ] **Step 5: 实现双 queue 消费**

```ts
export const BACKGROUND_WAKE_QUEUE = "jobs.wake";
export const INTERACTIVE_WAKE_QUEUE = "jobs.query.wake";

await boss.createQueue(BACKGROUND_WAKE_QUEUE, { policy: "exclusive" });
await boss.createQueue(INTERACTIVE_WAKE_QUEUE, { policy: "exclusive" });
await boss.work(BACKGROUND_WAKE_QUEUE, { teamSize: 1 }, handleWake);
await boss.work(INTERACTIVE_WAKE_QUEUE, { teamSize: queryConcurrency }, handleWake);
```

两条 queue 使用独立 pg-boss consumer registration，仍共享同一个 `JobWorker`、lease service、dispatcher 和 shutdown；stop 必须等待两个 consumer 与 active promises

`WorkerBoss.work` 的本地接口必须匹配 pg-boss `work(name, options, handler)`，`queryConcurrency` 从 `QUERY_CONCURRENCY` 读取，缺省为 10，只接受 1 至 20 的安全整数

- [ ] **Step 6: runtime config 保持索引可独立启动**

新增 `parseQueryRuntimeConfig` 读取 `DIFY_ANALYSIS_SUMMARY_KEY`，缺失时只使 Query step 返回 `configuration_error`，不得让现有 chapter/L1/L2 Worker 启动失败

- [ ] **Step 7: GREEN 与高风险完整验证**

Run: `npm run test:integration && npm run test:phase1:e2e && npm run test:phase2:e2e && npm run lint && npm run typecheck:phase2`

Expected: integration、Phase 1/2 recovery 与新 Query recovery 全部 PASS

- [ ] **Step 8: Commit**

```bash
git add apps/worker packages/jobs
git commit -m "feat: execute recoverable query turns"
```

**Acceptance:** Query 不被 background consumer 占满，Dify failure 保留证据并等待用户选择，lease/outbox/late result 只提交一个结果

### Task 6: 连续提问响应式工作区

**Files:**

- Create: `apps/web/src/features/query/QueryWorkspacePage.tsx`
- Create: `apps/web/src/features/query/QuerySessionList.tsx`
- Create: `apps/web/src/features/query/QueryConversation.tsx`
- Create: `apps/web/src/features/query/QueryEvidencePanel.tsx`
- Create: `apps/web/src/features/query/query-api.ts`
- Create: `apps/web/src/features/query/query.test.tsx`
- Modify: `apps/web/src/app/router.tsx`
- Modify: `apps/web/src/features/library/BookWorkspacePage.tsx`
- Modify: `apps/web/src/features/task-center/useJobEvents.ts`
- Modify: `apps/web/src/app/styles.css`

- [ ] **Step 1: 写工作区 RED**

```tsx
it("keeps conversation and adopted evidence visible in place", async () => {
  renderPath(`/books/${book.id}/query`);
  await userEvent.click(await screen.findByRole("button", { name: "新建研究会话" }));
  await userEvent.type(screen.getByLabelText("会话名称"), "陈平安成长线");
  await userEvent.click(screen.getByRole("button", { name: "创建会话" }));
  expect(await screen.findByRole("heading", { name: "陈平安成长线" })).toBeTruthy();
  expect(screen.getByRole("tab", { name: "采用证据" }).getAttribute("aria-selected")).toBe("true");
  expect(screen.getByText("第 486 章")).toBeTruthy();
});
```

再写 preview 后才能发送、scope_changed 重新确认、共享权限控件、`awaiting_fallback` 双动作、移动端会话抽屉、SSE query keys invalidation 和切页返回恢复

- [ ] **Step 2: 运行 RED**

Run: `npm test -w apps/web -- query.test.tsx`

Expected: FAIL，Query route/components 不存在

- [ ] **Step 3: 实现 API hooks 与页面状态**

```ts
export const queryKeys = {
  sessions: (bookId: string) => ["book", bookId, "query-sessions"] as const,
  session: (bookId: string, sessionId: string) => ["book", bookId, "query-session", sessionId] as const,
  turn: (bookId: string, sessionId: string, turnId: string) => ["book", bookId, "query-session", sessionId, "turn", turnId] as const,
};
```

提交按钮只在新鲜 preview 后出现，同一不确定提交重用 idempotency key，新 preview 轮换 key

- [ ] **Step 4: 实现桌面与窄屏结构**

桌面使用 `240px minmax(0, 1fr)`，右侧使用 `minmax(260px, 58%) minmax(170px, 42%)`，证据区支持收起与受限高度调整

移动端不使用嵌套页面，会话列表为单层抽屉，证据区固定底部并可展开，输入区始终位于问答区域末端

- [ ] **Step 5: GREEN、build 与响应式检查**

Run: `npm test -w apps/web && npm run typecheck -w apps/web && npm run build -w apps/web && npm run lint`

Expected: Web tests、typecheck、production build 与 lint PASS

使用 Playwright 检查 1440x900、1280x800、768x1024、390x844，断言 `document.documentElement.scrollWidth === document.documentElement.clientWidth` 且没有 framework error overlay

- [ ] **Step 6: Commit**

```bash
git add apps/web
git commit -m "feat: add continuous query workspace"
```

**Acceptance:** 会话、问答与证据原位可用，fallback 双动作明确，移动端不重叠，页面切换不丢服务器任务状态

### Task 7: Phase 3 独立验收、并发与安全证据

**Files:**

- Create: `test/phase3/continuous-query.e2e.test.ts`
- Create: `test/phase3/query-recovery.e2e.test.ts`
- Create: `test/phase3/query-scale.integration.test.ts`
- Create: `test/phase3/helpers/phase3-harness.ts`
- Create: `vitest.phase3.config.ts`
- Modify: `package.json`

- [ ] **Step 1: 写独立 RED demo**

启动 disposable PostgreSQL、真实 Express composition、真实 JobWorker/pg-boss 和 Dify fake，创建一书一组后发起两轮问题

RED 必须因 Query composition 缺失而失败，不能因 PostgreSQL、fixture 或凭证不可用失败

- [ ] **Step 2: 证明两轮连续提问**

```ts
expect(first.intent.target).toBe("chen-ping-an");
expect(second.intent.target).toBe("chen-ping-an");
expect(second.evidenceVersion).not.toBe(first.evidenceVersion);
expect(second.difyInput).not.toContain(first.answer);
expect(second.evidence.every((item) => item.turnId === second.id)).toBe(true);
```

断言第二轮理解“他”，但重新召回；采用、候选、淘汰、缺口和 trace 可分别读取

- [ ] **Step 3: 证明失败选择与重启**

让 summary fake 在 provider retry 后失败，断言 `awaiting_fallback`，重启 API/Worker 后仍可选择再次调用或本地摘要，两个分支都复用相同 evidence version

- [ ] **Step 4: 证明 10 用户与队列隔离**

同时提交 10 个用户的 Query job，并保持一个 background index step 被 barrier 阻塞，断言所有 Query job 在本地验收阈值内进入 terminal/awaiting state，且没有重复 answer/evidence snapshot

计划阈值：10 个 fake-provider Query turns 的本地 p95 完成时间小于 2 秒，单个会话/turn/evidence HTTP read p95 小于 500ms

- [ ] **Step 5: 证明 plaintext 与 credential 隔离**

使用 chapter、fact、question、answer、session title、credential 六类唯一 sentinel，扫描 jobs scope/config/progress、steps output、events、outbox、attempts、audit metadata、captured API/Worker logs 和普通 Query JSON 列

受控 provider error 的原始 message 必须包含全部 sentinel，最终只允许稳定错误码

- [ ] **Step 6: 完整验证**

```bash
npm run verify:legacy
npm run verify:new
npm run dify:manifest:check
npm run test:project-source
npm run project:check
npm run test:integration
npm run test:phase1:e2e
npm run test:phase2:e2e
npm run test:phase3:e2e
npm run lint
npm run typecheck:phase3
npm run build -w apps/web
git diff --check
```

- [ ] **Step 7: scope audit**

确认 legacy `server/`、`src/`、`test/service.test.js`、五个 YAML、正式数据、部署文件、DEC-0001/0002 与 package lock 无计划外变化

扫描新增行与 import，确认没有 SQLite、embeddings、Phase 4 analysis routes、新 DSL、生产 test hook、明文凭证或跨索引组能力

- [ ] **Step 8: Commit**

```bash
git add test/phase3 vitest.phase3.config.ts package.json
git commit -m "test: prove phase 3 continuous queries"
```

**Acceptance:** 两轮追问重新召回并独立留证，10 用户交互队列通过，重启/replay/late result 收敛，错误与普通持久化无明文，四个视口可用

## 4. Gate 顺序

1. `GATE-PHASE3-PLAN-APPROVED` 明确通过
2. Task 1-7 按依赖顺序实施，每个 task 使用 Started Contract、Implementation Acceptance、Merged Checkpoint
3. Task 7 合并并完成 controller post-merge verification
4. 用户明确判定 `GATE-PHASE3-IMPLEMENTATION-ACCEPTED`

任何 task 不得自行通过阶段 Gate，Phase 3 Gate 不授权 Phase 4、正式迁移、部署或切换
