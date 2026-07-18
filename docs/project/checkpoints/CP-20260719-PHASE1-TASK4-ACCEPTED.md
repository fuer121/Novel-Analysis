---
checkpoint_id: CP-20260719-PHASE1-TASK4-ACCEPTED
task_id: PHASE1-TASK4
status: accepted
recorded_at: 2026-07-19T01:48:04+08:00
branch: refactor/phase1-task4-jobs
base_commit: e6d52c93b5bf4b40aeb940d72206599d1ce8780a
head_commit: f3a949524f5d04a8ed7235e70b921dbdc65d0bbe
supersedes: none
---

# Phase 1 Task 4 Accepted

## Scope

接受 Phase 1 Task 4 的 PostgreSQL 持久化示例任务创建、任务列表与详情、pause/resume/cancel 控制、事件和审计事务、resume outbox 写入、cancel step/attempt 清理，以及 session、exact Origin、CSRF 和 Idempotency-Key 写保护

同时接受质量审查后对控制幂等域与 PostgreSQL 微秒级 keyset pagination 的修复，不包含 Task 5 pg-boss dispatcher、Worker、Web、schema/migration、legacy、Dify Workflow、依赖升级、正式数据或部署操作

## Evidence

- 创建事务原子写入 job、两个 ordered steps、created event 与 pending outbox；强制 outbox 失败时四类记录全部回滚
- `(requested_by, request_id)` 唯一约束保证并发重复创建收敛到同一任务，真实 PostgreSQL 并发回归确认只有一组 step、event 与 outbox
- 列表与详情只从产品数据库读取公开字段，经共享 Zod schema 输出；API object 与 repository 重建后仍能查询持久化任务
- 控制事务先锁定 job，再执行 owner/admin 授权、actor + action + key 幂等判断与状态迁移；精确重复控制只产生一条 event 与一条 audit
- pause 转为 paused，resume 转为 queued 并追加 pending outbox，cancel 转为 cancelled 并在同一事务取消未完成 step 与 running attempt
- 终态或非法迁移不修改 job 且不写 audit；强制 audit 失败时 job、event 与 resume outbox 全部回滚
- 控制幂等碰撞定向 RED 复现 cross-action 与 cross-actor stale replay，修复后同 key 的不同 actor/action 独立执行，精确并发重放保持单一效果
- pagination 定向 RED 复现 JavaScript Date 丢失 PostgreSQL 微秒导致漏行，修复后 cursor 使用 canonical job ID，并由 PostgreSQL 子查询保留原始 `created_at` 边界与 UUID tiebreak
- API 写路由统一要求 active session、exact Origin、current CSRF 与非空有界 Idempotency-Key；公开响应与错误不暴露 request ID、lease owner、queue ID、token hash、config snapshot 或内部错误栈
- 规格初审与修复后复审均为 APPROVED；代码质量复审为 APPROVED，无未解决 Critical 或 Important finding
- 总控独立验证通过：Task 4 focused integration 20/20、完整 PostgreSQL integration 83/83、contracts 16/16、Contracts/Jobs/API typecheck、完整 ESLint 与 `git diff --check`
- 完整 `npm run verify` 通过：legacy 112、contracts 5、new unit 80、manifest 1、project-source 40，project source check 有效
- 测试后 `novel_test_%` 数据库与连接均为 0；主工作区 `.DS_Store` 哈希保持 `217e9f0a83b73518ad0a15a09faee9ab28c262f9`

## Accepted Result

`PHASE1-TASK4` 满足已批准的 Task 4 验收标准，branch head `f3a949524f5d04a8ed7235e70b921dbdc65d0bbe` 被接受，可发布 PR

`PHASE1-TASK5` 在 Task 4 合并到 `main` 并创建 merged Checkpoint 前保持 blocked

阶段实现基线 `baseline_commit` 保持 `be49f4ccd312a269ee4c7419c6d9d08407df2c21`，仅在 Phase 1 全部实现通过 `GATE-PHASE1-IMPLEMENTATION-ACCEPTED` 后更新

## Deferred Items

- 项目既有 npm audit 风险未在本任务处理
- GitHub Actions 依赖固定完整 SHA 未在本任务处理
- 当前没有 job 删除路径；后续引入 retention 或删除策略时，需要明确处理 cursor anchor 已删除的行为
