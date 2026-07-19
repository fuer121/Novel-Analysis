---
checkpoint_id: CP-20260719-PHASE2-L2-DSL-ALIGNMENT-ACCEPTED
task_id: PHASE2-L2-DSL-ALIGNMENT
status: accepted
recorded_at: 2026-07-19T22:17:51+08:00
branch: fix/l2-workflow-output-alignment
base_commit: d81c08d39e24635b27f85e4cacf9302e53b74cfc
head_commit: 60ae42a62e98a7e9035e5c5caad06a162edea3fe
supersedes: none
---

# Phase 2 L2 DSL Alignment Accepted

## Scope

接受仓库 L2 Workflow 输出对齐、对应 manifest 更新、最小 contract 测试与真实 smoke 专用 timeout，并允许实现 PR 在本治理记录先合并且 DEC-0002 条件满足后合并

本 checkpoint 不授权线上 Dify 导入、真实数据、contract 放宽、adapter 补值、Task 2 实施范围变化、Phase 2 Gate 变化、部署或切换

## Evidence

- 实现 SHA `60ae42a62e98a7e9035e5c5caad06a162edea3fe` 相对 base 为单提交且恰好修改四个授权文件
- TDD RED 证明旧 DSL 与默认 smoke timeout 均不满足新增 contract；GREEN 为 2/2 通过
- L2 code node 的章节字段来自 start node，模型只提供 `facts`，无效输出继续返回 raw 并由 adapter fail-closed
- End 节点、LLM、Prompt、edges、coordinates、accepted contract、normalizer 与 adapter 60 秒 timeout 均未变化
- manifest 五项独立重算匹配，且相对 base 只有 `workflows.l2_index.sha256` 变化
- Dify package 24 passed、1 个真实 smoke skipped；new tests 192 passed、1 skipped；legacy 112/112 通过
- package typecheck、legacy lint/build、full lint、项目源 40/40、`project:check`、manifest check、`git diff --check` 与 protected-path audit 通过
- 独立规格审查批准，无 finding
- 独立质量审查直接执行 YAML 内嵌 Python 的成功与 fail-closed 分支后批准，无 finding
- 未读取、输出或提交本地 Dify 凭证，未调用或修改线上 Dify

## Accepted Result

仓库 L2 DSL 对齐实现已接受。实现 PR 仍须在本治理记录合并后通过 GitHub CI，并满足 DEC-0002 才能合并

## Remaining Risks

- 用户尚未手动导入仓库 DSL，线上 L2 仍是旧行为，真实 L2 smoke 尚未通过
- 本地源码 contract 与独立 Python 执行不能替代 Dify 导入器和线上运行时验证
- 实现基线保持 `820b30a1cfae0b0a19be9fa763f44801742d38e9`，本修正不代表 Phase 2 最终验收
