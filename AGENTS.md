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
- core allowed modules
- mechanical adjacent scope
- base commit
- success criteria
- prohibited changes
- required verification
- escalation conditions

Mechanical adjacent scope 默认包含直接对应测试、类型与导出入口、migration registry、既有模块 runtime wiring，以及新增 migration 必须更新的 schema roundtrip test

Mechanical adjacent change 必须与已批准行为存在直接因果关系，不能引入新模块、新业务语义或新的用户可见能力

新数据对象或表、新外部依赖、新认证或权限语义、新 API 产品能力、Gate、验收标准、任务顺序、正式数据或线上操作仍必须停止并确认

当 `baseline_status` 为 `stale`、`conflicted` 或 `blocked` 时，不得启动依赖任务

## Worktree Lifecycle

- 每个 active task 原则上只保留一个实现 worktree
- 新 worktree 默认位于 `~/.config/codex/worktrees/Novel-Analysis/`
- 临时治理、审查和 post-merge worktree 在对应 PR 合并后立即删除
- merged checkpoint 后删除该任务全部已合并 worktree 与本地分支，并在阶段结束执行 `git worktree prune`
- 删除前必须确认 worktree clean、HEAD 已进入 `main`、分支已推送且 PR 已合并
- dirty、未推送、未合并或证据冲突时必须停止，禁止强制删除

## Governance Nodes

- 常规 task 原则上最多使用 Started Contract、Implementation Acceptance、Merged Checkpoint 三类治理节点
- Merged Checkpoint 可与下一任务 Started Contract 合并
- 直接测试、package export、migration registry、类型导出和既有模块 wiring 不单独建立 correction PR，在 accepted checkpoint 记录实际 scope
- 架构、数据、migration 策略、安全、权限、凭证、Gate、验收标准、正式数据、部署、切换或不可逆操作必须单独暂停确认

## Verification Roles

- 实现 Agent：RED/GREEN、focused tests、lint、typecheck、scope audit
- 规格审查：契约矩阵、focused tests、遗漏行为检查
- 质量审查：targeted reproduction、并发与错误路径检查
- 总控：合并前完整 new、legacy、integration、project source
- CI：仓库标准完整验证
- Post-merge：focused smoke、project source、主线 SHA 与 clean 状态

修改共享基础设施、数据库 transaction、lease、outbox、安全或身份链路，或出现全局回归与证据冲突时，扩大验证范围

## Completion Evidence

- 完成声明必须包含新鲜命令输出、scope 审查以及 Git 或 CI 证据
- 证据冲突时必须停止并上报总控 Agent

## Source Discipline

不得在本文件复制当前项目状态、commit、阶段或风险，避免形成第二信源
