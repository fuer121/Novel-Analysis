# Agent 协作规则

## Required Reading

- 规划、实施、审查、调试前必须先阅读 `docs/project/PROJECT.md`
- 按当前任务 scope 阅读 `docs/project/PROJECT.md` 链接的相关文档
- 线程不是项目信源，不得以线程内容替代项目文档

## Write Authority

- 只有总控 Agent 能更新 `docs/project/PROJECT.md`
- 执行 Agent 必须使用 `docs/project/templates/checkpoint.md` 返回反馈
- 审查 Agent 必须返回结构化 findings，每条包含 severity、file/line、evidence 和 verdict，由总控 Agent 决定是否形成 checkpoint
- 执行 Agent 和审查 Agent 不能直接修改当前治理状态或 accepted 记录，只能向总控 Agent 提交反馈与证据
- 执行 Agent 仍可在 task contract 的 allowed scope 内实施变更
- 执行 Agent 和审查 Agent 不能自行将决策标记为 accepted，也不能自行解锁依赖

## Record Immutability

- accepted checkpoint 和 accepted decision 不得被任何 Agent 原地改写
- 发现错误时，由总控 Agent 创建新的 correction 记录，通过 `supersedes` 指向旧记录，再更新 `docs/project/PROJECT.md`

## Task Contract

每个委派任务必须包含以下内容

- task ID
- allowed scope
- base commit
- success criteria
- prohibited changes
- required verification

当 `baseline_status` 为 `stale`、`conflicted` 或 `blocked` 时，不得启动依赖任务

## Completion Evidence

- 完成声明必须包含新鲜命令输出、scope 审查以及 Git 或 CI 证据
- 证据冲突时必须停止并上报总控 Agent

## Source Discipline

不得在本文件复制当前项目状态、commit、阶段或风险，避免形成第二信源
