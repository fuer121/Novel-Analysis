---
checkpoint_id: CP-20260722-PHASE4-TASK4-ACCEPTED
task_id: PHASE4-TASK4
status: accepted
recorded_at: 2026-07-22T12:47:48+08:00
branch: codex/phase4-task4-analysis-worker
base_commit: 08b423bf50c88ac7afd94b8af309cc5ece34fdbe
head_commit: 1921577ab8773b96919a6688640fedcca232af30
supersedes: none
---

# Phase 4 Task 4 Accepted

## Scope

接受 Phase 4 基于加密执行快照的四模式 Worker executor、可恢复分层汇总、attempt 与 lease 权威校验以及 outbox 到 Worker 的运行时接线

实际 scope 为 accepted Task Contract 直接授权的十三个 Worker、Jobs 与测试 fixture 文件，没有新 migration、当前索引回退、L2 历史版本库、API 产品能力、Web、依赖、Dify DSL、正式数据或部署变更

## Evidence

- 四种模式只从 Task 3 冻结快照选择来源，fast、balanced、precision 与 full-text 边界及 golden budget 通过
- 章节结果、分层结果与最终结果均加密持久化，分层 batch 固定为 20，最终结果在完成前经过冻结 Schema 校验
- part 与 final commit 使用当前 attempt 和数据库时钟 lease 权威校验，过期、替代或签名不匹配的尝试不能提交
- exact completed checkpoint 可在 crash、lease recovery、重复 wake 与 outbox replay 后复用，不重复调用 provider
- pause 只在安全边界生效，pause 后 cancel、queued cancel、late attempt、partial failure 与 corrupt checkpoint 均得到稳定终态或可恢复结果
- corrupt checkpoint 返回稳定脱敏错误，不进入无限重试，checkpoint position 使用最小未占用 int32 值避免 PostgreSQL integer 溢出
- 真实 create → outbox → dispatcher → `jobs.wake` → Worker 链路通过，Query 继续独立使用 `jobs.query.wake`，没有遗留孤立 topic
- plaintext sentinel、scope、diff 与 runtime wiring 审计通过，敏感快照和 provider payload 未进入普通 Job、event、outbox、日志或错误
- 最终规格审查与质量审查在 `1921577ab8773b96919a6688640fedcca232af30` 均 APPROVED，无未解决 finding
- 总控完整验证通过：legacy 112、new 361 with 1 skipped、integration 315、project source 42、workspace 5
- lint、全 workspace typecheck、legacy build、Dify manifest、project check、`git diff --check`、scope 与 plaintext audit 通过
- PR #117 CI `verify` 通过，当前状态 open、mergeable、clean

## Accepted Result

PHASE4-TASK4 实现已接受，可以合并 PR #117

本 checkpoint 不解锁 Task 5，Task 5 只在实现 PR merged checkpoint 合并后解锁

## Deferred Items

- legacy history read-only API 属于 Task 5
- Web、独立验收、正式数据、部署、UAT、切换与 Phase 4 Gate 仍保持锁定
