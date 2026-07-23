---
decision_id: DEC-0019
status: accepted
recorded_at: 2026-07-23T14:36:00+08:00
confidence: high
scope: phase5-task5-rebuild-reorder
supersedes: none
---

# Phase 5 Rebuild Reorder Temporary Positions

## Context

PHASE5-TASK5批准计划要求重排时先写temporary negative positions，再写最终positive positions

现有`job_steps` schema同时具有`(job_id, position)`即时唯一约束与`position >= 0` CHECK，且Task 5禁止migration，因此negative intermediate state在当前schema上必然失败

## Decision

- 采用方案A，以当前locked Step set的最大position为边界，将全部Step先移动到严格高于该边界的无冲突positive temporary range，再写入最终连续顺序
- parent Job与完整Step set必须先在同一transaction内加锁并重新验证
- 仍只允许完整ordered set、`queued`且`attempt_count = 0`的Steps参与重排
- temporary与final更新以及单一audit event必须在同一transaction提交，任一步失败则全部回滚
- 实现必须检查temporary position计算不会超过PostgreSQL integer范围并fail closed
- 本修正不允许started Step重排、部分集合重排、新table、migration、schema约束变化或用户可见语义变化

## Consequences

- Task 5实现与测试将positive temporary range作为唯一批准的collision-avoidance strategy
- 规格审查与质量审查必须验证即时唯一约束下的任意排列、overflow fail-closed、事务回滚与单一audit行为
- 计划中仅`negative temporary positions`这一实现细节被本决策替代，其余Task 5合同与验收标准保持不变

## Evidence

- [Task 5 reorder correction](../checkpoints/CP-20260723-PHASE5-TASK5-REORDER-CORRECTION.md)
- `packages/database/src/migrations/002_jobs.ts`定义`job_steps_job_id_position_unique`与`job_steps_position_check (position >= 0)`

## Source

用户于2026-07-23在了解方案A与方案B后明确回复“A”
