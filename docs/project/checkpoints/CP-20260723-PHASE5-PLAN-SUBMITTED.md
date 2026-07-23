---
checkpoint_id: CP-20260723-PHASE5-PLAN-SUBMITTED
task_id: PHASE5-PLAN
status: submitted
recorded_at: 2026-07-23T09:59:41+08:00
branch: codex/phase5-plan
base_commit: f71782e5a35ae694092a2e336a91c0b1221a1993
head_commit: f71782e5a35ae694092a2e336a91c0b1221a1993
supersedes: none
---

# Phase 5 Plan Submitted

## Scope

提交 Phase 5 选择性迁移、重建、性能、UAT 与切换实施计划，等待 `GATE-PHASE5-PLAN-APPROVED` 决策

本 checkpoint 不接受实施结果，不解锁正式快照、旧密钥、飞书配置、UAT、部署或切换

## Evidence

- 计划以已接受的 Phase 5 设计与 `DEC-0017` 为唯一范围基线
- 计划压缩为 8 个顺序任务，每项包含 core modules、mechanical scope、prohibited changes、RED/GREEN、验证命令和升级条件
- 迁移工具只读取 SQLite，只迁移书籍、来源信息与章节，并保留进程内重加密、每书事务、manifest 与 100% 硬校验
- 用户明确选择持久化 `library-rebuild` 批次 Job，复用 Job、Step、lease 与 outbox，不新增业务表
- 重建批次使用仓库级 indexing baseline，从零建立 L1/L2，服务端与 Web 对未完成书籍 fail-closed
- 容量测试、单机 preflight、UAT 与 cutover runbook 均保留正式操作 Gate
- 计划自审未发现 spec coverage、占位符或类型命名冲突

## Risks And Blockers

- indexing baseline 的 Prompt 文本、基础组 scope 和当前 DSL hash 将随计划 Gate 一并审批，实施中出现语义差异必须停止
- `library-rebuild` defer 涉及 transaction、lease 与 outbox，必须扩大集成与恢复验证
- 性能阈值未通过时不得降低门槛，必须暂停并报告真实证据

## Accepted Result

计划可进入 Gate 复核，只有用户明确批准 `GATE-PHASE5-PLAN-APPROVED` 后才能按 Task Contract 启动 Task 1
