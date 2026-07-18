---
checkpoint_id: CP-20260719-PHASE1-TASK5-ACCEPTED
task_id: PHASE1-TASK5
status: accepted
recorded_at: 2026-07-19T02:20:55+08:00
branch: refactor/phase1-task5-outbox
base_commit: b4b8c92232d195ba53ae6e18d5f204f95c9cfdd4
head_commit: e1815baff5799fd214b77fef325cae696d4273b9
supersedes: none
---

# Phase 1 Task 5 Accepted

## Scope

接受 Phase 1 Task 5 的 pg-boss v12 factory boundary，以及 product `job_outbox` 的 claim、事务外 send、owner-guarded mark/release dispatcher

不包含 Task 6 step lease、attempt、Worker、executor、job status 变更、schema/migration、依赖升级、legacy、Dify Workflow、正式数据或部署操作

## Evidence

- claim 事务按 `available_at, id` 确定性选择 pending、已到 available time 且无 live claim 的记录，使用 `FOR UPDATE SKIP LOCKED`
- claim owner 使用 dispatcher ID 与随机 UUID 组合，30 秒有界 expiry 使用 PostgreSQL `now()` 计算并持久化
- pg-boss `send(topic, { jobId, outboxId }, { singletonKey: outbox:<outboxId> })` 在 claim 事务提交后调用，不复制 outbox 内部 payload
- send 成功后由独立事务按 row ID、精确 claim owner 与 pending 状态 guarded mark；stale claimant 无法错误标记 delivered
- send 失败由 guarded release 清理本 claim 且不标记 delivered；release 失败仍可由有界 expiry 恢复
- send 成功但 mark 失败时记录保持 pending，同一 outbox 重试保持同一 topic、outbox ID 与 singleton key
- 并发 dispatcher 对单一 eligible row 只有一个 claim/send，live claim、future row、delivered row 均不被领取，expired claim 可恢复
- 独立数据库 observer 在 sender callback 内可见已提交 claim，证明网络调用不在 product transaction 内
- dispatcher 不读取或修改 job status，不读取 pg-boss schema 作为产品状态；公开消息只含 `jobId` 与 `outboxId`
- pg-boss 12.26.1 factory 与 `send` 类型已核对；`send` 返回 null 代表同 key singleton 已存在，仍进入 guarded mark
- 规格审查与代码质量审查均为 APPROVED，无未解决 Critical、Important 或阻塞性 finding
- 总控独立验证通过：Task 5 focused integration 9/9、完整 PostgreSQL integration 92/92、Jobs typecheck、完整 ESLint 与 `git diff --check`
- 完整 `npm run verify` 通过：legacy 112、contracts 5、new unit 80、manifest 1、project-source 40，project source check 有效
- 测试后 `novel_test_%` 数据库与连接均为 0；主工作区 `.DS_Store` 哈希保持 `217e9f0a83b73518ad0a15a09faee9ab28c262f9`

## Accepted Result

`PHASE1-TASK5` 满足已批准的 Task 5 验收标准，branch head `e1815baff5799fd214b77fef325cae696d4273b9` 被接受，可发布 PR

`PHASE1-TASK6` 在 Task 5 合并到 `main` 并创建 merged Checkpoint 前保持 blocked

阶段实现基线 `baseline_commit` 保持 `be49f4ccd312a269ee4c7419c6d9d08407df2c21`，仅在 Phase 1 全部实现通过 `GATE-PHASE1-IMPLEMENTATION-ACCEPTED` 后更新

## Deferred Items

- Task 6 Worker runtime 必须显式创建并真实验证支持 singleton key 去重的 pg-boss queue policy；默认 `standard` policy 不提供该物理去重
- release claim 也失败时当前错误会覆盖原 send error，但记录仍可由 claim expiry 恢复；后续可用 `AggregateError` 提升诊断性
- 后续压力验证补充多行被锁时的 `SKIP LOCKED` progress 与真实 expiry/reclaim race
- 项目既有 npm audit 风险与 GitHub Actions 完整 SHA 固定未在本任务处理
