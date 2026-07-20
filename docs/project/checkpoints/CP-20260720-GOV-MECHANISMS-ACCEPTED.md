---
checkpoint_id: CP-20260720-GOV-MECHANISMS-ACCEPTED
task_id: GOV-MECHANISMS
status: accepted
recorded_at: 2026-07-20T17:26:09+08:00
branch: codex/governance-mechanisms
base_commit: fc80285e69a97e3d979054f36439a6d4c097104e
head_commit: 24c8a683dbd899214791e132b125cd5587c23322
supersedes: none
---

# Governance Mechanisms Accepted

## Scope

- 标准化 Task Contract 与 Checkpoint 模板
- 增加模板结构的项目源校验
- 增加只读 `workspace:audit`
- 增加默认 dry-run 的保守 `workspace:cleanup`
- 增加 implementation、controller 与 post-merge 分层验证命令

## Evidence

- `npm run test:project-source`：41/41 通过
- `npm run test:workspace`：5/5 通过
- `npm run verify:implementation`：lint 与 Phase 1 全量 typecheck 通过
- `npm run verify:post-merge`：项目源检查与 workspace audit 通过
- `npm run verify:controller`：legacy 112/112、new 200 通过且 1 跳过、integration 197/197、contracts 7/7、Dify manifest、build、lint、typecheck 与项目源检查全部通过
- `npm run workspace:cleanup`：dry-run 正确拒绝未合并、未推送且 dirty 的当前治理 worktree
- `git diff --check`：通过
- Scope audit：仅涉及治理模板、治理校验、workspace 工具、直接测试和 package scripts，未修改业务实现、数据模型、安全策略、Gate 或验收标准

## Accepted Result

阶段 1 至阶段 4 的治理机制实现符合 DEC-0007，可进入 PR 与 CI 核验；Task 5 必须在治理 PR 合并并完成 merged checkpoint 后启动
