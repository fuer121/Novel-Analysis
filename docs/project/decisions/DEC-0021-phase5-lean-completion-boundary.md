---
decision_id: DEC-0021
status: accepted
recorded_at: 2026-07-23T19:33:51+08:00
confidence: high
scope: phase5-tasks6-8-lean-completion
supersedes: DEC-0020
---

# Phase 5 Lean Completion Boundary

## Context

Phase 5 Tasks 1–5已经建立迁移正确性、readiness与rebuild recovery能力，但Task 6开发机容量证据持续受宿主时序影响，并产生明显高于用户价值的重复测试与治理成本

审计同时确认Task 7过早固定目标服务器细节，Task 8计划重复表达既有业务验证，严格串行顺序使环境相关时序阻塞独立的本地工具工作

## Decision

- Task 6保留并发正确性、queue priority、single-instance isolation、cleanup与machine-readable timing report
- development-machine p95只作为indicative evidence，不再作为Phase 5 tools merge threshold
- browse `<500ms`、submit `<1000ms`与status propagation `<2000ms`硬标准移动到真实目标服务器isolated rehearsal Gate
- Task 7只实现environment-neutral single-server reference、基础fail-closed preflight与操作checklist
- certificate expiry、clock skew、disk/backup capacity与target-specific commands延后到deployment Gate
- Task 8改为thin evidence aggregator，不新增重复business E2E或在CI运行scale timing
- Task 6 correction review与Task 7可以独立推进，Task 8仍依赖两者accepted
- 正式Gate顺序、数据与安全边界保持不变

## Consequences

- DEC-0020的single-instance lock、truthful reporting与非生产承诺继续有效
- DEC-0020要求development-machine threshold PASS作为quality approval条件的部分被本决策替代
- Task 6不得以本决策隐藏或重写已有FAIL report
- 本决策不授权production snapshot、real Dify、Feishu callback、UAT、deployment或cutover
- 后续常规Task恢复Started、Accepted、Merged三个治理节点上限

## Evidence

- [Phase 5 capacity revalidation blocked](../checkpoints/CP-20260723-PHASE5-TASK6-CAPACITY-REVALIDATION-BLOCKED.md)
- [Phase 5 lean completion plan](../../superpowers/plans/2026-07-23-phase-5-lean-completion-plan.md)
- Phase 5审计：Task 6累计9个提交、6个checkpoint与多轮时序复跑，仍不能形成生产容量承诺

## Source

用户于2026-07-23明确要求“基于审计后的建议推进”

