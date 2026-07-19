---
decision_id: DEC-0003
status: accepted
recorded_at: 2026-07-19T16:31:00+08:00
confidence: high
scope: phase-2-job-step-granularity
supersedes: none
---

# Phase 2 JobStep Granularity

## Decision

Phase 2 章节导入、L1 与 L2 章节级任务采用一章一个 JobStep

任务创建在单个有界 PostgreSQL transaction 中写入全部章节步骤，只写一个 `created` event 和一个 initial outbox，不按章节数写初始事件或 outbox

失败重试只选择失败章节对应的单个 JobStep，初始 SSE replay 只包含任务级创建事件，章节进度通过聚合查询读取

## Measurements

实现者在 disposable PostgreSQL 中分别为一章一步和固定 100 章批次创建 3、100、3000 章实验数据，使用 `performance.now()` 和 PostgreSQL `clock_timestamp()` 测量有界 transaction

| 候选 | 章节数 | Rows | Client transaction | PostgreSQL measurement |
| --- | ---: | ---: | ---: | ---: |
| 一章一步 | 3 | 3 | 4.630 ms | 4 ms |
| 一章一步 | 100 | 100 | 6.975 ms | 6 ms |
| 一章一步 | 3000 | 3000 | 59.716 ms | 56 ms |
| 固定 100 章批次 | 3 | 1 | 3.343 ms | 2 ms |
| 固定 100 章批次 | 100 | 1 | 8.374 ms | 3 ms |
| 固定 100 章批次 | 3000 | 30 | 3.488 ms | 3 ms |

每组数据分别连续执行 20 次 list、detail 与 aggregate query，3000 章结果如下

| 候选 | List p95 | Detail p95 | Aggregate p95 |
| --- | ---: | ---: | ---: |
| 一章一步 | 0.953 ms | 0.426 ms | 0.879 ms |
| 固定 100 章批次 | 0.343 ms | 0.358 ms | 0.347 ms |

扩展双候选实验前，implementer 首轮一章一步测量得到 3000 steps client transaction 65.261 ms、PostgreSQL measurement 63 ms、aggregate p95 0.994 ms，controller 独立复跑得到 58.335 ms、55 ms 和 1.208 ms

双候选实验均由 SQL 验证每个 job 只创建一个 `created` event 和一个 initial outbox，initial replay 查询只返回一个 job-level event

SQL 将一个 step 标为 `failed` 且 `attempt_count = 1` 后，retry selection 只返回该 step，选择前后全体 step 的数据库 fingerprint 不变，其余 steps 均保持 `completed` 且 `attempt_count = 0`

一章一步失败范围为单章 1501，固定批次失败范围为 1501 至 1600，证明固定批次一次 retry selection 覆盖最多 100 章

## Alternatives Rejected

拒绝固定 100 章一个 JobStep、批次内保存逐章提交点的候选模型

该模型在 3000 章时使用 30 steps，transaction 与查询更快，但真实失败 step 的签名范围覆盖 100 章，需要额外维护批次内提交点才能实现单章精确重试

一章一步在同等规模下使用 3000 steps，失败 step 的真实范围为一章，能直接复用现有 JobStep status、attempt 与精确 retry selection，且 transaction 和三类查询实测均远低于性能门槛，因此批次模型降低 rows 与延迟的收益不足以抵消批次内提交点复杂度

Task 0 未验证真实 Worker kill、pause 或 cancel runtime，这些行为及其最大重复工作仍是 Task 8 必须验收的恢复风险，不作为本决策的已验证结论

## Revalidation Gate

若未来可复现环境中出现以下任一条件，必须停止依赖该粒度决策的实施，不得自行切换为批次 JobStep，并重新通过 `GATE-PHASE2-PLAN-APPROVED`

- 3000 steps 单个有界 transaction 达到或超过 5 秒
- detail/progress aggregate query 连续 20 次测量的 p95 达到或超过 500 ms
- 任务创建需要按章节写初始 event 或 outbox
- 单章失败无法精确重试一个章节
- initial SSE replay 估算达到或超过 10 events

## Source

本决策来源于 Phase 2 Task 0 的 PostgreSQL integration experiment，以及 controller 对 focused tests、integration tests、两类计时、事件和 outbox 数量、精确重试与 SSE replay 的独立复跑验证
