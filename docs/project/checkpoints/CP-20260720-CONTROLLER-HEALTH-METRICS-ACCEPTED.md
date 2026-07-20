---
checkpoint_id: CP-20260720-CONTROLLER-HEALTH-METRICS-ACCEPTED
task_id: GOV-CONTROLLER-HEALTH
status: accepted
recorded_at: 2026-07-20T19:04:32+08:00
branch: codex/controller-health
base_commit: 4d1e60fc177fc44740eaf26843fe9ad11d037cd3
head_commit: 4d1e60fc177fc44740eaf26843fe9ad11d037cd3
supersedes: none
---

# Controller Health Metrics Accepted

## Scope

- 新增只读 `controller:health` 命令，复用 workspace audit 汇总工作区、分支、依赖副本与仓库内 worktree 占用
- 增加 `PROJECT.md` 行数与 Active Work 行数指标
- 将健康报告追加到 post-merge verification
- 保持指标为观察证据，不设置阈值、不自动清理、不联网、不改变失败策略

## Evidence

- TDD RED：模块缺失首先产生 `ERR_MODULE_NOT_FOUND`，多表格回归测试首先得到错误计数 `6 !== 1`
- focused tests 3/3 通过，workspace tests 5/5 通过
- project source tests 42/42、`project:check`、`verify:post-merge` 与 `git diff --check` 通过
- 默认文本与 `--json` 均能输出稳定字段，当前项目源为 102 行且 Active Work 为 1 行
- 规格审查无 finding，结论 `APPROVED`
- 质量审查的一个 Important 多表格计数 finding 已修复，复验无 finding，结论 `APPROVED`
- Scope audit 仅包含健康脚本、直接测试、npm wiring、本计划、checkpoint 与总控持有的 `PROJECT.md` 更新

## Accepted Result

Stage 7 总控健康指标机制符合 DEC-0007，可作为每次 post-merge checkpoint 的只读现场证据

本 checkpoint 不改变 implementation baseline、Task 6 状态、Phase 2 Gate 或验收标准
