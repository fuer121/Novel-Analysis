---
checkpoint_id: CP-20260720-PHASE2-TASK4-ACCEPTED
task_id: PHASE2-TASK4
status: accepted
recorded_at: 2026-07-20T11:43:12+08:00
branch: refactor/phase2-task4-l1
base_commit: f8a7291f3c5bd1fb2300573368a267b52c31d228
head_commit: c2733e25f8bce5283a3d2482dbf59bc47c0333b1
supersedes: none
---

# Phase 2 Task 4 Accepted

## Scope

接受 Recoverable L1 Build And Coverage 实现，并允许实现 PR 在本治理记录先合并且 DEC-0002 条件满足后合并

本 checkpoint 不授权 Task 5、Web、query、analysis、正式数据、部署、切换或 Phase 2 Gate 变化

## Evidence

- 实现 SHA `c2733e25f8bce5283a3d2482dbf59bc47c0333b1` 相对固定 base 为单提交，精确修改 16 个 corrected allowed paths
- coverage 将每章唯一归入 fresh、missing、failed、stale，并使用 Task 0 L1 signature matrix 的全部字段判定 freshness
- coverage、preview、manual create 与 auto handoff 复用 selector、scopeHash、snapshot、steps 与 outbox 创建语义
- create 在 book lock 的事务中重算 scope，变化时零副作用拒绝；exact replay 基于冻结请求语义，不受执行后 coverage 变化影响
- job snapshot 冻结 Prompt 正文与 hash、Workflow、Schema、adapter contract 以及章节 freshness 输入，每章一个 JobStep
- Task 3 legacy queued handoff 可由 completed import production replay 原位恢复；严格 legacy 重复展开不产生重复 steps 或 outbox，残缺 snapshot fail-closed
- Worker 显式分派 `l1-index`，通过 `DIFY_L1_WORKFLOW_API_KEY` 装配 adapter，未配置与部分配置均 fail-closed 且错误脱敏
- executor 在 provider 前后重验 freshness，只在内存解密单章并完整校验 accepted L1 output
- L1 current/history、step output reference、progress、event 与依赖 L2 stale 在同一事务中提交；迟到、重复、取消与 lease 校验保持单效果
- scope、event、audit、日志、错误与 output reference 不含章节正文、route body 或 Prompt 正文
- migration `004` 可逆并兼容已有空正文 Prompt 行；空正文禁止创建可执行 L1 job，新 Prompt 正文与 content hash 必须一致
- focused PostgreSQL 56/56、new 200 passed 与 1 skipped、legacy 112/112、项目源 40/40 全部通过
- schema migration 13/13、Phase 1 typecheck、full lint、legacy lint/build、`project:check` 与 `git diff --check` 全部通过
- 独立规格审查结论为 `SPEC COMPLIANT`，无任何级别 finding
- 独立质量审查两次拒绝并闭环四个 Important 与一个 Minor finding，最终结论为 `QUALITY APPROVED`，无未解决 finding
- 未调用真实 Dify，未读取凭证，未修改 L2、Web、Workflow YAML、正式数据或治理记录

## Accepted Result

Task 4 实现已接受，实现 PR 仍须 GitHub CI 成功且满足 DEC-0002 才能合并

## Remaining Risks

- legacy placeholder 恢复由 completed import exact replay 驱动，不做启动时全库主动扫描
- 并发 replay 依赖 book/job row lock 与唯一约束，当前没有独立双请求 barrier test
- 完整 JobWorker 多步 L1/outbox traversal 与 L1 专项 lease expiry 场景由后续 Phase 2 端到端验收补充，底层 lease/attempt 竞态内核已有通用测试
- migration 004 保留已有空正文 Prompt 版本，这些版本按设计 fail-closed，后续必须创建有效不可变 Prompt 版本
- 既有 npm audit 风险未变且不在本任务范围
- implementation baseline 保持 `820b30a1cfae0b0a19be9fa763f44801742d38e9`，Task 4 合并不代表 Phase 2 最终验收
