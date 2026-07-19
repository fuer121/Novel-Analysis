---
checkpoint_id: CP-20260719-PHASE1-TASK8-SUBMITTED
task_id: PHASE1-TASK8
status: submitted
recorded_at: 2026-07-19T15:15:59+08:00
branch: refactor/phase1-task8-recovery-demo
base_commit: 28aa15d96c52ad3d571c015fe017eb0172eb5296
head_commit: b1593b534a3d58b9a5a674a9a992ea6a32bd2699
supersedes: none
---

# Phase 1 Task 8 Submitted

## Scope

提交 Phase 1 独立进程恢复 demo 与 `GATE-PHASE1-IMPLEMENTATION-ACCEPTED` 的新鲜验收证据，等待总控与用户作正式 Gate 判定

本 checkpoint 不接受 Gate、不更新 `baseline_commit`、不解锁 Phase 2，也不授权部署、正式数据或其他不可逆操作

## Evidence

- Task 8 从不可变实现基线 `28aa15d96c52ad3d571c015fe017eb0172eb5296` 产生单一提交 `b1593b534a3d58b9a5a674a9a992ea6a32bd2699`
- 变更精确限制为 `package.json`、`vitest.e2e.config.ts` 与五个 `test/phase1/**` 文件，未修改 Tasks 1-7、lockfile、legacy、五个 Workflow YAML 或治理文件
- RED 由 test process composition 缺失产生，PostgreSQL readiness 已通过，不是数据库连接失败
- 真实随机 PostgreSQL 运行 migrations，mapped active admin/member 只存在于 test composition
- admin 登录、创建任务、pause/resume、cancel 均成功并产生精确 audit；member 管理成员与控制他人任务均被拒绝且不产生 audit
- API 独立进程重建后仍查询到相同 job ID
- Worker A 通过真实 PgBoss、OutboxDispatcher 与 JobWorker consumer，在 attempt 1 与 lease 提交后发出 test-only barrier 握手并被父进程 SIGKILL
- 数据库确认 lease 过期后，Worker B 使用生产等价 no-op barrier、真实 PgBoss、dispatcher、consumer 与 recovery timer 创建 attempt 2 并完成
- 相同 outbox delivery 与 wake 被真实重放；原 consumer handler 完成后才发出确定性 `replay-consumed` 握手，不依赖固定时长 sleep
- 握手后 fresh SQL 深比较 attempts、steps/output_ref/attempt_count、events/progress/completed、outbox delivery/claims、job status/progress 与 audit，证明无新增或改写效果
- 真实 Feishu HTTP adapter error boundary 产生非空允许日志，同时排除 OAuth code、session、CSRF、Cookie 与 client secret 原值
- readiness hang/early exit 由 helper 自行 SIGKILL 并等待退出；cleanup 双失败保留 AggregateError；stop timer 会 unref 并在 finally 清除
- 最终规格审查 APPROVED，最终质量审查 APPROVED，无 Critical、Important、Minor 或阻塞性 finding
- `npm run verify:legacy` 通过，legacy 恰好 112 tests
- `npm run verify:new` 通过，contracts 5 tests、new 94 tests
- `npm run dify:manifest:check` 1/1、`npm run test:project-source` 40/40 与 `npm run project:check` 通过
- `npm run test:integration` 11 files、144/144 tests 通过
- `npm run test:phase1:e2e` 2/2 tests 通过
- 完整 lint、`typecheck:phase1`、Web production build 与 `git diff --check` 通过
- 用户确认范围 Gate 采用基线感知等价审计：新增代码关键词扫描与 import 定向扫描均为空；基线既有 `sqlite:///tmp/database.sqlite` 仅用于验证 PostgreSQL URL 拒绝行为
- legacy、五个 Workflow YAML、治理文件与 `package-lock.json` 相对 Task 8 base 均 byte-unchanged
- 无 Task 8 API、Worker 或 Vitest 残留进程；本 demo 创建的随机数据库已删除
- 管理库仍有两个本任务开始前已存在、当前零连接且归属未知的 `novel_test_*` 数据库；前后集合一致，未擅自删除或修改

## Submitted Result

Task 8 实现、审查和 Phase 1 验收命令均已完成，现提交 `GATE-PHASE1-IMPLEMENTATION-ACCEPTED` 正式判定

在用户明确确认 Gate 前，Task 8 保持 `review`，`baseline_commit` 保持 `be49f4ccd312a269ee4c7419c6d9d08407df2c21`，Phase 2 保持 blocked

## Deferred Items

- PostgreSQL BIGINT event ID 当前映射为 JavaScript `number`，后续 contract 演进需要单独授权
- 两个未知归属的既有 `novel_test_*` 数据库不属于 Task 8 产物，未做破坏性清理
- 项目既有 npm audit 风险与 GitHub Actions 完整 SHA 固定不在 Phase 1 Gate 范围内
