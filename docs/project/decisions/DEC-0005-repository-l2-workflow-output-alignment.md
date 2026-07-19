---
decision_id: DEC-0005
status: accepted
recorded_at: 2026-07-19T22:17:51+08:00
confidence: high
scope: repository-l2-workflow-output-alignment
supersedes: none
---

# Repository L2 Workflow Output Alignment

## Context

真实 Dify smoke 已证明 chapter-import 与 l1-index 通过，但线上 l2-index 只返回 `facts`，缺少 accepted contract 要求的 `chapter_index` 与 `chapter_title`

用户选择保持 accepted adapter contract 不变，让仓库 L2 Workflow 使用可信输入补齐章节绑定，并明确限定只提交仓库 DSL，后续由用户手动导入 Dify

## Decision

- 允许修改仓库 `dify-workflows/l2-fact-index.workflow.yml`，由规范输出 code node 从 Workflow 开始节点接收 `chapter_index` 与 `chapter_title`
- 模型只提供 `facts`；规范输出只在模型结果为 object 且 `facts` 为 array 时构造 `chapter_index`、`chapter_title`、`facts` 三字段结果
- 章节号和标题必须来自 Workflow 输入，不信任模型生成的同名字段
- 无效 JSON、错误顶层类型、缺失或非 array 的 `facts` 以及章节号转换失败必须保持 fail-closed
- End 节点继续输出 `result` string，accepted adapter contract、normalizer、Prompt、事实语义与 adapter 60 秒单请求 timeout 保持不变
- 真实 smoke 的三个顺序调用可为该测试单独使用 200 秒 Vitest timeout
- 本次授权只覆盖仓库 DSL、对应 manifest、最小 contract 测试和 smoke test timeout，不授权修改线上 Dify

## Evidence

- 用户明确选择方案 A，并确认“只提交仓库 DSL，之后由我导入 Dify”
- 批准设计为 `docs/superpowers/specs/2026-07-19-l2-workflow-output-alignment-design.md`
- 批准实施计划为 `docs/superpowers/plans/2026-07-19-l2-workflow-output-alignment-implementation-plan.md`
- 实现 commit `60ae42a62e98a7e9035e5c5caad06a162edea3fe` 严格限定为四个授权文件
- 独立规格审查与独立质量审查均通过，无 Critical、Important 或 Minor finding
- 总控验证确认 contract、manifest、Dify package、new、legacy、项目源、typecheck、lint、build 与 scope audit 全部通过

## Consequences

- 仓库 L2 DSL 与 accepted contract 已对齐，但在用户手动导入前不得表述为线上已生效
- 用户导入 DSL 后必须重新执行真实 l2-index smoke，成功前线上 L2 blocker 保持有效
- 该修正不改变 Phase 2 Gate、验收标准、实现基线或 Task 2 的既定 contract
- 任何自动导入、线上发布、正式数据调用、contract 放宽或 adapter 补值均超出本决策，必须暂停并重新确认

## Source

本决策来源于用户对方案 A、仓库内完整修正和手动导入边界的明确确认，以及实现与双重独立审查证据
