# 项目级唯一信源与总控机制设计

状态：已完成逐节确认，待书面规格复核

日期：2026-07-17

## 1. 目标

为小说分析重构项目建立仓库内、版本化、可追溯的项目级唯一信源，使后续总控 Agent、执行 Agent 和审查 Agent 不依赖项目线程上下文也能确定当前基线、有效决策、阶段状态、任务进度、风险和下一验收闸门

该机制同时负责收集任务反馈、核验证据、更新基线和控制依赖任务启动条件

## 2. 核心原则

- `docs/project/PROJECT.md` 是唯一的当前决策入口
- 总控 Agent 是 `PROJECT.md` 的唯一写入者
- 执行 Agent 只提交结构化反馈，不直接修改当前项目基线
- 当前状态与历史证据分离，证据附件不能与 `PROJECT.md` 竞争权威地位
- 完成状态必须由 Git、测试、PR、CI、用户验收或数据审计证据支持
- 线程上下文可以帮助理解，但不能作为后续决策依据
- 冲突不能被静默覆盖，必须暂停受影响任务并完成纠正 checkpoint
- 首期机制保持轻量，不建设项目管理后台、数据库或复杂生成系统

## 3. 信息架构

```text
AGENTS.md
docs/project/
├── PROJECT.md
├── checkpoints/
├── decisions/
└── templates/
    └── checkpoint.md
```

### 3.1 `docs/project/PROJECT.md`

项目级唯一信源，后续 Agent 必须先读取该文件，再按其中链接读取设计、计划、checkpoint、decision 或 handoff

文件只保存当前有效信息

- 权威元数据
- 当前 Git、数据与 Workflow 基线
- 当前阶段和验收状态
- 活跃任务控制表
- 当前生效决策
- 当前风险、技术债务和 blocker
- 待核验反馈
- 下一验收闸门
- 最近接受的 checkpoint
- 证据索引
- 更新触发器和陈旧判定

### 3.2 `docs/project/checkpoints/`

保存经过总控核验的任务反馈、验证结果、用户验收和阶段结论

已接受 checkpoint 不原地改写。发现事实错误时创建新的纠正 checkpoint，并通过 `supersedes` 指向被替代记录

### 3.3 `docs/project/decisions/`

保存会影响后续产品、架构、数据、安全、迁移或交付判断的重大决策

每条决策记录状态、来源、时间、置信度、影响范围和替代关系。`PROJECT.md` 只列当前生效决策及链接

### 3.4 `docs/project/templates/checkpoint.md`

定义执行 Agent 的反馈契约，至少包含

- checkpoint ID 和任务 ID
- scope 与禁止事项
- base、head 和分支
- 实际改动
- 验证命令与结果
- 与计划的偏差
- 风险、blocker 和待决策项
- 用户反馈或验收证据
- 建议下一步
- 是否请求总控接受

### 3.5 根目录 `AGENTS.md`

只保存协作流程规则，不复制项目状态和决策

- 所有 Agent 开始任务前必须读取 `PROJECT.md`
- 总控 Agent 才能更新 `PROJECT.md`
- 执行 Agent 必须按模板提交反馈
- 基线陈旧或冲突时不得启动依赖任务
- 完成声明必须附带新鲜验证证据

### 3.6 旧基线与 README

现有 `docs/PROJECT_CONTROL_BASELINE.md` 标记为旧单机系统历史实现基线，并指向新入口，不继续承载重构项目当前状态

README 的项目基线入口改为 `docs/project/PROJECT.md`

## 4. 权限模型

### 4.1 总控 Agent

总控 Agent 负责

- 从唯一信源建立任务上下文
- 下发任务 ID、scope、base commit、成功标准和禁止事项
- 收集执行 Agent 反馈
- 独立核验 diff、测试、Git、PR、CI、数据和用户反馈
- 接受、拒绝或要求修订 checkpoint
- 更新 `PROJECT.md`
- 控制依赖任务何时可以启动

### 4.2 执行 Agent

执行 Agent 负责

- 在指定 base 和 scope 内实施任务
- 保留用户已有改动
- 运行约定验证
- 说明所有偏差、风险和未完成项
- 按模板返回反馈

执行 Agent 不得

- 直接更新 `PROJECT.md`
- 自行扩大 scope
- 将 Agent 自述当作完成证据
- 在基线冲突时继续启动依赖任务

### 4.3 审查 Agent

审查 Agent 提供规格、质量、安全或阶段验收意见，只产生审查证据，不直接改变当前基线

总控 Agent 核验审查结论后决定是否接受并更新唯一信源

## 5. 权威与冲突规则

权威顺序按事实类型拆分

| 事实类型 | 权威顺序 |
| --- | --- |
| 产品方向与取舍 | 用户明确确认 > `PROJECT.md` 当前生效决策 > accepted decision/spec |
| 当前实现行为 | 代码与自动化测试 > accepted checkpoint/handoff >说明文档 |
| Git 与交付状态 | 远端 Git、PR、CI >本地分支 > Agent 自述 |
| Dify Workflow 行为 | 用户确认的最新线上导出 YAML 与 manifest hash >适配代码推断 >历史文档 |
| 数据迁移事实 | 迁移审计结果 >数据库快照统计 >计划估算 |

用户在当前线程确认的新决策必须先由总控写入 decision 或 checkpoint，并更新 `PROJECT.md`，依赖该决策的后续任务才可启动

发生冲突时

1. 将 `baseline_status` 标记为 `conflicted` 或 `blocked`
2. 记录冲突双方、证据、影响任务和所需确认
3. 暂停所有依赖任务
4. 经核验或用户确认后创建纠正 checkpoint
5. 更新 `PROJECT.md` 并恢复符合条件的任务

## 6. `PROJECT.md` 数据模型

文件顶部使用机器可读 YAML front matter

```yaml
project_id: novel-analysis-refactor
source_version: 1
baseline_commit: be49f4ccd312a269ee4c7419c6d9d08407df2c21
baseline_status: current
updated_at: 2026-07-17T17:00:00+08:00
updated_by: controller-agent
current_phase: phase-1-planning
last_checkpoint: CP-20260717-PHASE0-MERGED
next_gate: GATE-PHASE1-PLAN-APPROVED
```

`baseline_commit` 表示最近被接受和验证的实现基线，不要求等于包含 `PROJECT.md` 自身的治理文档提交。`PROJECT.md` 的文档版本由 Git 历史隐式追踪，避免文件自引用最新 commit 造成无限更新循环

`baseline_status` 允许

- `current`
- `stale`
- `conflicted`
- `blocked`

任务主状态允许

- `planned`
- `ready`
- `in_progress`
- `review`
- `accepted`
- `merged`

异常状态允许

- `blocked`
- `cancelled`
- `superseded`

活跃任务表至少记录

- task ID
- phase
- scope
- owner 或 Agent
- branch
- base 与 head
- status
- depends_on
- checkpoint
- next action

## 7. Checkpoint 生命周期

Checkpoint 状态统一为

```text
submitted -> validating -> accepted
                       \-> rejected
accepted -> superseded
```

- `submitted`：执行 Agent 已提交反馈，尚未独立核验
- `validating`：总控正在核验代码、测试、范围或用户反馈
- `accepted`：证据充分，可以更新当前项目状态
- `rejected`：证据不足、scope 不符或验收失败，不改变当前基线
- `superseded`：后续纠正记录已替代该 checkpoint

只有 `accepted` checkpoint 可以推进依赖任务或改变 `PROJECT.md` 的当前状态

## 8. 持续更新流程

```text
总控读取 PROJECT.md
-> 下发带 task ID、scope、base 和验收标准的任务
-> 执行 Agent 提交结构化反馈
-> 总控独立核验
-> 接受或拒绝 checkpoint
-> 更新 PROJECT.md
-> 提交并合并
-> 核对远端 main merge commit
-> 若实现基线变化则更新 baseline_commit
-> 启动满足依赖条件的下一任务
```

强制更新触发器

- PR 合并或基线提交变化
- 用户确认、推翻或替代重大决策
- 阶段验收通过或失败
- 任务 scope、依赖、风险或 blocker 变化
- 新增安全、迁移或数据完整性问题
- 线上 Workflow YAML 基线重新导出
- 用户反馈改变验收标准

若 `baseline_commit` 之后出现受控代码、配置、Workflow、数据契约或已接受决策变化，而 `PROJECT.md` 尚未核验和吸收这些变化，基线自动视为 `stale`，不得启动依赖该变化的任务

只修改 `PROJECT.md`、checkpoint、decision、README 指针或 Agent 协作规则的治理提交不使实现基线失效。总控仍需记录治理提交和合并状态，但不把治理文件自身的 commit 回写为新的 `baseline_commit`

## 9. 首轮落地范围

首轮实施包含

- 创建 `docs/project/PROJECT.md`
- 创建 checkpoint、decision 和 template 目录
- 写入 Phase 0 已合并的 accepted checkpoint
- 写入项目治理 decision
- 新增根 `AGENTS.md`
- 标记旧 `PROJECT_CONTROL_BASELINE.md` 为历史实现基线
- 更新 README 唯一信源入口
- 新增轻量校验脚本和 CI 命令
- 将 Phase 1 详细计划列为下一验收闸门

首轮实施不包含

- 项目管理后台
- 数据库存储
- 复杂状态生成器
- 历史线程批量导入
- 为每笔局部提交生成 checkpoint
- Phase 0 业务代码修改

## 10. 自动校验

首期校验只覆盖低成本、确定性规则

- `PROJECT.md` 和必需 front matter 字段存在
- `baseline_commit` 为 40 位十六进制 Git SHA
- 所有 checkpoint ID 唯一
- `PROJECT.md` 引用的 checkpoint、decision、spec、plan 和 handoff 文件存在
- 状态值属于允许集合
- `last_checkpoint` 对应已接受记录
- 工作流 manifest 引用存在

CI 不自动修改 `PROJECT.md`，也不从线程或 Git 历史猜测产品决策

## 11. 验收标准

- 新 Agent 不读取线程，也能从 `PROJECT.md` 确定当前 commit、阶段、有效决策、风险和下一步
- `baseline_commit` 是验收时最近被接受和验证的实现提交，并且是 `origin/main` 的祖先或当前提交
- `baseline_commit` 之后若只存在治理文档提交，基线仍可保持 `current`
- Phase 0 PR、CI、handoff、设计和路线图均可追溯
- 执行 Agent 有统一反馈模板，但不能直接更新当前基线
- accepted、rejected 和 superseded 的处理无歧义
- CI 能发现缺字段、无效引用、重复 checkpoint ID、非法 commit 格式和非法状态
- 旧基线不会继续被误读为当前多人重构架构
- 未修改 Phase 0 业务代码和五个 Dify YAML 基线

## 12. 初始项目状态

首轮实施以以下事实初始化唯一信源

- 仓库：`fuer121/Novel-Analysis`
- 默认分支：`main`
- Phase 0 merge commit：`be49f4ccd312a269ee4c7419c6d9d08407df2c21`
- Phase 0 PR：`https://github.com/fuer121/Novel-Analysis/pull/1`
- Phase 0 CI：通过
- 当前阶段：Phase 1 详细计划准备
- 下一验收闸门：Phase 1 详细计划完成评审
- 当前旧应用仍是兼容性基线，不是重构后前端
- 五个仓库 YAML 是用户确认的当前线上最新导出和 manifest 基线

## 13. 已知风险

- 现有 `docs/PROJECT_CONTROL_BASELINE.md` 内容较长，标记历史状态时必须保留其实现参考价值
- 根 `AGENTS.md` 只能约束遵循仓库说明的 Agent，不能替代代码审查和 CI
- 轻量校验只能发现结构问题，不能判断产品决策是否正确
- Phase 0 已记录的 npm audit 风险、Actions SHA 固定、任务进度约束和状态机测试增强仍需在项目基线中持续追踪
