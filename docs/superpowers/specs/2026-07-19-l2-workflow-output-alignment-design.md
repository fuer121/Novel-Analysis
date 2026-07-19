# L2 Workflow Output Alignment Design

## Goal

让仓库中的 L2 Dify Workflow 输出满足已接受的 Phase 2 contract，确保每组 facts 具有不可缺失的章节绑定信息

## Context

VPN 开启后的真实 smoke 已证明 chapter-import 与 l1-index 全链路通过

l2-index 的 Workflow API 返回 HTTP 200，`outputs.result` 是合法 JSON，但内部只有 `facts`，缺少 contract 要求的 `chapter_index` 与 `chapter_title`，因此 adapter 按设计 fail-closed 为 `provider_invalid_response`

用户明确选择保持 contract 不变并修正 L2 Workflow，同时限定本次只提交仓库 DSL，由用户后续手动导入 Dify，不授权线上发布

## Design

修改 `dify-workflows/l2-fact-index.workflow.yml` 的“规范输出”代码节点

该节点新增两个来自 Workflow 开始节点的可信输入：

- `chapter_index`
- `chapter_title`

模型继续只负责生成 `facts`。规范输出节点解析模型 JSON 后，只构造以下顶层结构：

```json
{
  "chapter_index": 221,
  "chapter_title": "Synthetic chapter",
  "facts": []
}
```

章节字段来自 Workflow 输入，不采用模型生成值。`facts` 必须来自模型解析结果中的同名字段

如果模型输出不是合法 JSON、不是 object、缺少 `facts` 或 `facts` 不是 array，节点不得生成看似有效的默认事实结构，现有 adapter contract 必须继续 fail-closed

End 节点仍只输出 `result` string，不修改 Dify envelope、adapter normalizer 或 accepted contract

## Smoke Timeout

`packages/dify/src/http-adapter.test.ts` 的真实 smoke 使用三个顺序调用，每个 adapter timeout 为 60 秒

只为该 smoke test 设置 200 秒 Vitest timeout，普通单元测试和 adapter timeout 保持不变

## Manifest

Workflow YAML 修改后必须使用现有 manifest 工具更新对应 SHA256，并验证其余四个 Workflow 记录不发生漂移

## Verification

- YAML 可由结构化 parser 解析
- manifest check 通过且只有 L2 Workflow hash 变化
- 本地 contract fixture 证明规范输出包含章节字段和 facts
- Dify package tests、new tests、legacy tests、typecheck、lint 与 diff check 通过
- smoke 命令在缺少显式凭证时继续 skip，不意外联网

仓库 DSL 变更不能证明线上 Workflow 已生效。真实 L2 smoke 只能在用户手动导入新 DSL 后重新执行

## Scope

允许修改：

- `dify-workflows/l2-fact-index.workflow.yml`
- `dify-workflows/manifest.json`
- `packages/dify/src/http-adapter.test.ts`
- 对应的最小 Workflow 输出 contract 测试文件
- 项目决策、checkpoint 与 `PROJECT.md`

禁止修改：

- 其他四个 Workflow YAML
- accepted Dify contract 与 normalizer
- L2 Prompt、事实分类、召回、admission 或数据库语义
- 线上 Dify 配置、正式数据、部署与切换

## Acceptance

- 仓库 L2 DSL 规范输出严格包含 `chapter_index`、`chapter_title`、`facts`
- 章节字段来自 Workflow 输入，事实字段来自模型输出
- 非法模型输出保持 fail-closed
- smoke test timeout 足以覆盖三个顺序调用
- 所有本地验证与 CI 通过
- 交付说明明确要求用户导入 DSL 后再做真实 smoke
