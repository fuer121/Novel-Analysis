---
decision_id: DEC-0020
status: accepted
recorded_at: 2026-07-23T17:17:52+08:00
confidence: high
scope: phase5-task6-capacity-isolation
supersedes: none
---

# Phase 5 Local Isolated Capacity Benchmark

## Context

PHASE5-TASK6在空闲本地宿主单独运行时连续五次通过批准threshold，但两条相同scale命令并行运行时均失败，且原report profile无法表达宿主争用状态

Task 6证据只用于批准的5至20人LAN目标与repository-level受控验证，不是生产容量承诺，也不应为本阶段引入dedicated CI infrastructure

## Decision

- 采用方案A，将Task 6 capacity evidence定义为专用空闲本地宿主上的手动benchmark
- 同一repository同一时间只允许一个scale run，使用跨process的single-instance lock在测量前fail closed
- 第二个并发scale run必须返回明确的isolation error，不得生成或覆盖性能PASS/FAIL report
- machine-readable report必须记录isolation mode、lock acquisition与benchmark contract version
- reproduction文档必须声明宿主空闲、禁止并行benchmark、测试PostgreSQL健康、controlled provider与非生产承诺
- standard CI继续运行普通verify，不自动执行受宿主噪声影响的scale suite
- threshold、dataset、warmup、用户并发、nearest-rank算法与生产代码均保持不变
- 修复background startup成功路径未清理timeout的资源卫生问题

## Consequences

- Task 6只增加test harness、report schema、root scale command与直接测试范围内的隔离约束
- 独立质量复审必须并行启动两条scale命令，证明恰有一个获得lock，另一个在测量前fail closed，且成功run仍满足全部threshold
- 本决策不允许dedicated CI runner、production code、migration、index、cache、queue policy、真实Dify、生产流量或threshold调整

## Evidence

- [Task 6 quality blocked](../checkpoints/CP-20260723-PHASE5-TASK6-QUALITY-BLOCKED.md)
- 空闲本地宿主五次审计browse p95最大329.648ms，5/5 PASS
- 并行两次相同命令browse p95分别963.839ms与1025.618ms，2/2 FAIL

## Source

用户于2026-07-23在A/B/C方案中明确选择“A”
