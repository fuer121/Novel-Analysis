---
checkpoint_id: CP-20260723-PHASE5-TASK6-ISOLATION-CORRECTION
task_id: PHASE5-TASK6
status: accepted
recorded_at: 2026-07-23T17:17:52+08:00
branch: codex/phase5-task6
base_commit: 66e1f4d5d4ea98b611dc6556c748234e077f82a3
head_commit: e7608c1d4e3c70756254e36d9d88ac37c987fc26
supersedes: none
---

# Phase 5 Task 6 Isolation Correction

## Scope

以DEC-0020修正PHASE5-TASK6 benchmark execution contract并解除quality blocker

## Correction Contract

- 新增跨process single-instance fail-closed lock与targeted concurrent-run test
- report记录local-idle-host isolation mode、lock acquisition与contract version
- concurrent loser在测量和report写入前失败，不污染winner evidence
- 文档明确手动、空闲本地宿主、非生产承诺与standard CI不运行scale
- 修复background-start timeout成功路径未清理问题
- 不改变threshold、dataset、warmup、并发、percentile或生产语义

## Prohibited Changes

禁止dedicated CI runner、production code、migration、index、cache、queue policy、真实Dify、生产流量、正式数据、部署、切换或threshold调整

## Evidence

- [DEC-0020](../decisions/DEC-0020-phase5-local-isolated-capacity-benchmark.md)
- [Quality blocker](CP-20260723-PHASE5-TASK6-QUALITY-BLOCKED.md)
- 用户明确选择方案A

## Accepted Result

PHASE5-TASK6恢复in_progress，由原implementer增量TDD修复后依次执行规格与质量复审；Task 7、Task 8与所有正式操作仍锁定
