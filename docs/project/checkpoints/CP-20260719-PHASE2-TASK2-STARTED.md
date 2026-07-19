---
checkpoint_id: CP-20260719-PHASE2-TASK2-STARTED
task_id: PHASE2-TASK2
status: accepted
recorded_at: 2026-07-19T22:37:23+08:00
branch: refactor/phase2-task2-persistence
base_commit: 153f6464139d579b5835c5bc68658287a18cfeaf
head_commit: 153f6464139d579b5835c5bc68658287a18cfeaf
supersedes: none
---

# Phase 2 Task 2 Started

## Scope

启动已批准计划中的 Library And Index Persistence，固定实现基线和 task contract

允许新增 migration 003、database library repositories、内容加密模块、对应 PostgreSQL integration tests、library API-facing contracts 与导出入口

禁止 API 路由、Worker、Job executor、Dify 调用、Workflow YAML、正式数据、SQLite 迁移、部署、切换、query session、连续提问和 Phase 2 Gate 变化

## Evidence

- Phase 2 plan 已由 `GATE-PHASE2-PLAN-APPROVED` 接受
- Task 0、Task 1 与 L2 DSL 对齐均已合并；用户重新导入后真实 Dify smoke 已通过
- 当前 `main` 与 `origin/main` 均为 `153f6464139d579b5835c5bc68658287a18cfeaf`
- `baseline_status` 为 `current`，Pending Feedback 明确 Task 2 已解锁
- Task 2 固定采用 Subagent-Driven Development、严格 TDD、独立规格审查、独立质量审查和总控验证
- 主工作区用户 `.DS_Store` 修改存在且必须保持未触碰

## Task Contract

- migration 必须在空 PostgreSQL 数据库完整运行，并验证设计要求的外键、唯一性、状态约束和查询索引
- 正文与 fact 只以加密字段持久化，明文 sentinel 不得出现在普通列、查询结果或捕获日志
- AES-256-GCM 使用注入的 32-byte key 和显式 key version，错误密钥长度、未知版本与篡改 tag 必须 fail-closed
- repositories 只实现书库、source、加密章节、版本、index group、L1/L2 coverage 与 fact review pagination
- API-facing contracts 不得暴露 ciphertext、nonce、tag 或非用户所需 hash
- 所有数据库语义必须由真实 PostgreSQL integration tests 验证，不得用 mock 替代

## Accepted Result

Task 2 可在独立 worktree 基于固定 SHA `153f6464139d579b5835c5bc68658287a18cfeaf` 开始实施

本 checkpoint 不接受任何实现结果，不更新 implementation baseline，也不提前解锁 Task 3
