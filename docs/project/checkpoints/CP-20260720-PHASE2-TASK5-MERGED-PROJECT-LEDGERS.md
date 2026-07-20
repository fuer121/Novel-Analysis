---
checkpoint_id: CP-20260720-PHASE2-TASK5-MERGED-PROJECT-LEDGERS
task_id: GOV-PROJECT-LEDGERS
status: accepted
recorded_at: 2026-07-20T18:26:15+08:00
branch: codex/governance-ledgers
base_commit: 2f342c743dd95a462ce696aca6895e31b8012375
head_commit: 2f342c743dd95a462ce696aca6895e31b8012375
supersedes: none
---

# Phase 2 Task 5 Merged And Project Ledgers Accepted

## Scope

- 记录 Task 5 PR #62 已合并并完成 post-merge 验证
- 将已完成的 Phase 1 与 Phase 2 历史任务迁移到阶段 ledger
- 将 `PROJECT.md` 收敛为当前状态、有效决策、风险与下一 Gate 的入口
- 为项目源校验增加 `Phase Ledgers` 必需区段

## Evidence

- PR #62 merge SHA 为 `2f342c743dd95a462ce696aca6895e31b8012375`，CI 通过
- Task 5 post-merge scope selector 32/32、focused PostgreSQL 5/5、project source 41/41 通过
- Task 5 合并前完整验证 legacy 112/112、new 232 通过且 1 跳过、integration 202/202、workspace 5/5、contracts 7/7，build、lint、typecheck 与 Dify manifest 通过
- ledger 仅移动入口引用，不删除或修改 accepted checkpoint 和 decision
- Task 6 仅登记为 ready，本 checkpoint 不启动实现

## Accepted Result

Task 5 已合并，Phase 1 与 Phase 2 历史记录由阶段 ledger 承载，`PROJECT.md` 保留当前有效状态并解锁 Task 6 的 started contract

implementation baseline 仍为 `820b30a1cfae0b0a19be9fa763f44801742d38e9`，Phase 2 Gate 与验收标准未变化
