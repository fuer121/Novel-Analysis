---
checkpoint_id: CP-20260719-PHASE2-TASK0-ACCEPTED
task_id: PHASE2-TASK0
status: accepted
recorded_at: 2026-07-19T16:52:10+08:00
branch: refactor/phase2-task0-contracts
base_commit: 7656951b392ceb72344c29344dffa904bc767294
head_commit: a4c1393222f9b5e907152e21de6f55b724a03273
supersedes: none
---

# Phase 2 Task 0 Accepted

## Scope

接受 Task 0 的 Dify golden contracts、JobStep 粒度实验、freshness signature matrix 与 DEC-0003，并允许在 PR #30 CI 及合并条件满足后按 DEC-0002 合并

本 checkpoint 不更新实现基线，不授权 Task 1 提前实施，也不授权正式数据、部署、切换、Phase 3 或修改线上 Workflow YAML

## Evidence

- 实现 SHA `a4c1393222f9b5e907152e21de6f55b724a03273`，相对 base 为单提交且严格包含 12 个授权文件
- Dify contract 使用旧系统真实 chapter/L1/L2 payload，覆盖 direct JSON string、direct object、result、text、output 和 data
- strict canonicalization 拒绝部分数字、小数索引、错误类型、缺核心字段与非法 category，错误对象不包含 provider raw body
- freshness tests 逐字段验证 L1 排除 L2-only 字段，L2 包含 L1 signature、admission 和 index-group config
- 两候选分别在 3、100、3000 章真实 PostgreSQL 落库，逐组测量 transaction、row count、list/detail/aggregate 20 reads、retry、event 与 outbox
- 总控 3000 章复测：one-chapter 3000 rows，client/PostgreSQL 53.993/50ms，aggregate p95 0.618ms，retry 1501-1501
- 总控 3000 章复测：fixed-100 30 rows，client/PostgreSQL 3.789/2ms，aggregate p95 0.293ms，retry 1501-1600
- one-chapter 满足创建低于 5s、聚合 p95 低于 500ms、1 created event、1 initial outbox、initial replay 低于 10 events 和单章精确重试门槛
- focused unit 74/74、PostgreSQL integration 6/6、完整新架构 168/168、治理测试 40/40 通过
- `typecheck:new`、lint、`project:check`、`git diff --check` 和受保护路径 scope audit 通过
- 独立规格审查在修复 legacy compatibility 后批准
- 独立质量审查在修复 strict canonicalization 与双候选数据库实验后批准，无 Critical、Important 或 Minor finding

## Accepted Result

Task 0 接受一章一个 JobStep，并以 DEC-0003 固化该决策。PR #30 仍须等待 GitHub CI 成功且满足 DEC-0002 才能合并

如果后续规模验证否决当前门槛，必须停止 Phase 2、修订计划并重新通过 `GATE-PHASE2-PLAN-APPROVED`

## Remaining Risks

- Worker kill、pause 与 cancel 的真实重复工作范围留在 Task 8 恢复验收中验证
- 实现基线保持 `820b30a1cfae0b0a19be9fa763f44801742d38e9`，Task 0 合并不代表 Phase 2 最终验收
