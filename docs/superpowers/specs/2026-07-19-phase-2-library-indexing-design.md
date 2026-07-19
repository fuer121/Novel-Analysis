# Phase 2 Library And Indexing Design

## 1. Goal

Phase 2 交付共享书库、章节导入、L1 章节路由与 L2 专项事实索引的完整数据准备主链路，并复用 Phase 1 已合并的认证、PostgreSQL、任务、outbox、lease recovery、SSE 与任务中心

Phase 2 不交付 L2 连续提问、高级分析、旧 SQLite 正式迁移、部署或旧系统切换

## 2. Delivery Strategy

采用纵向主链路方式推进，每个任务同时完成必要的 contract、Repository、executor、API 和验证，不按数据库、后端、前端分层堆积到最后才集成

实施前增加 Task 0，先关闭三个最高不确定性：

1. 从五个线上 YAML、旧 fixture 与旧调用代码提取 Dify golden contract
2. 用 3、100、3000 章验证动态 JobStep 粒度和事件规模
3. 用显式决策矩阵固定章节、L1、L2 的新鲜度与失效传播

Task 0 只提交 contract、fixture、实验测试与决策证据，不实现书库业务页面

## 3. Architecture Boundaries

```text
Web book workspace
  -> API scope preview and job creation
  -> business repository transaction + job/outbox
  -> Worker executor
  -> Dify chapter/L1/L2 adapter
  -> validated encrypted result transaction
  -> job_events/SSE + coverage projection
```

- Dify adapter 只负责 HTTP 调用、错误归类和响应归一化，不读写数据库
- Repository 只负责业务数据、事务、签名比较和 coverage 查询，不调用 Dify
- Worker executor 连接 JobStep、Repository 与 adapter，网络调用不进入数据库事务
- API 负责 RBAC、scope 预览、配置快照和任务创建
- Web 只使用相对 API、持久化任务状态与 coverage，不复制业务选择规则
- `jobs`、`job_steps`、`job_events` 与业务表是状态真相源，pg-boss 仍只负责唤醒
- 不在生产 main 中加入 test adapter、barrier 或环境变量测试开关

## 4. Dify Contract

Phase 2 只建设三个目标：

| Target | Input | Validated output |
| --- | --- | --- |
| `chapter-import` | source ID、章节范围、分页 cursor、版本快照 | 章节号、标题、正文、上游标识 |
| `l1-index` | 章节正文、Prompt 版本、Workflow 版本 | 紧凑章节路由 |
| `l2-index` | 正文、紧凑 L1 路由、索引组、Prompt 版本 | 候选 facts 与候选主体 |

每个目标必须具备：

- 从当前五个 YAML 生成或核验的声明版本与 DSL hash
- 与旧 fixture 一致的正常、空结果、结构错误和 envelope 变体 golden cases
- 与旧调用代码一致的分页、超时、限流、网络失败与脱敏错误分类
- 独立 fake adapter，用于 executor、恢复与浏览器验收
- 一次非生产真实 Dify smoke，验证 request mapping 与响应归一化，不写正式业务数据

分章分析和汇总分析 adapter 留到后续阶段，不在 Phase 2 提前建设

## 5. Step Granularity Experiment

Task 0 必须比较至少两个候选：

- 一章一个 JobStep
- 固定批次一个 JobStep，批次内保存逐章提交点

实验数据规模为 3、100、3000 章，记录：

- steps、attempts、events 与 outbox 数量
- 创建任务、coverage 查询与任务详情延迟
- 单章失败后的重试范围
- pause、cancel 与 Worker kill 后的最大重复工作
- SSE replay 事件量

选择规则：优先保证单章幂等与准确重试；只有一章一步在 3000 章规模上违反明确性能门槛时才采用批次步骤

性能门槛必须在 Phase 2 implementation plan 中给出本机可复现命令和数值，不允许写为“性能合理”

## 6. Data Model

| Object | Responsibility |
| --- | --- |
| `books` | 共享书籍元数据、状态和创建信息 |
| `book_sources` | Dify 来源标识、章节范围和非密钥配置 |
| `chapters` | 章节元数据、正文 HMAC、正文密文和来源版本 |
| `prompt_versions` | L1/L2 不可变 Prompt 版本与 hash |
| `workflow_versions` | Dify target、contract version、DSL hash 与启用状态 |
| `index_groups` | L2 专项定义、范围、Prompt 绑定和状态 |
| `l1_indexes` | 章节路由、输入签名、状态和版本引用 |
| `l2_chapter_statuses` | 每组每章的状态、输入签名和失败分类 |
| `l2_facts` | 检索元数据、加密 fact body 与来源章节 |
| `l2_subjects` | 经准入验证的主体、别名和 Prompt 隔离信息 |

章节正文与 fact body 使用 AES-256-GCM 加密，密文、nonce、tag 和 key version 显式存储；密钥不进入数据库、任务 scope、事件、审计或日志

Phase 2 不创建 query、analysis 或 legacy migration 表

## 7. Freshness And Signatures

执行签名至少包含：

- adapter contract version
- Workflow DSL hash
- Prompt content hash
- 章节正文 HMAC
- 上游 source version
- 输出 Schema version
- 准入规则 version
- 索引组配置 hash
- 上游 L1 signature，针对 L2

Task 0 必须提交失效矩阵，逐项定义字段变化后哪些对象保持 fresh、变为 stale 或必须重建

关键约束：

- 章节正文变化使对应 L1 与所有相关 L2 stale
- L1 Prompt、Workflow 或 Schema 变化使 L1 stale，并使依赖其 signature 的 L2 stale
- L2 Prompt、Workflow、Schema、准入规则或索引组配置变化只使对应索引组 stale
- 章节标题或编号是否参与正文 freshness 必须由矩阵固定，不能由实现者临时决定
- stale 结果保留可审计版本，不静默覆盖或伪装为 missing

## 8. Main Workflows

### 8.1 Book And Import

1. member 创建书籍并配置 source ID、章节范围和是否自动进入 L1
2. API 返回 scope preview，包括预计请求范围和当前已存在章节
3. 用户确认后，业务记录、job、steps、scope snapshot 与 outbox 在事务中创建
4. Worker 调用 chapter adapter，完整校验后计算 HMAC、加密并提交章节
5. 签名匹配的章节跳过，失败章节保留精确缺口
6. 只有创建任务时明确选择自动 L1，导入完成后才创建 L1 job

### 8.2 L1

1. API 预览 fresh、missing、failed、stale 与预计执行数量
2. job 冻结 Prompt、Workflow、Schema 与 adapter contract version
3. Worker 只领取选中的缺失或过期章节
4. adapter 输出归一化和 Schema 校验成功后提交 `l1_indexes`
5. coverage 与任务统计显示完成、失败、跳过和剩余缺口

### 8.3 L2

1. 用户选择索引组、章节范围与 `all / missing / retry_failed`
2. API 返回模式计算后的执行集合和跳过集合
3. `force` 只能重建模式已选择的集合，不能扩大范围
4. Worker 读取章节密文和紧凑 L1 路由，调用 L2 adapter
5. 候选 facts 先通过 Schema，再通过专项准入规则
6. facts、subjects、chapter status、coverage 与步骤完成在明确事务边界提交
7. 事实审阅显示来源章节、结构化元数据、准入状态和解密后的授权内容

## 9. Scope Contract

L2 scope 必须通过完整矩阵测试：

```text
mode: all | missing | retry_failed
force: false | true
chapter status: fresh | missing | failed | stale | outside-range
```

- `all` 选择用户确认范围内所有 eligible 章节
- `missing` 只选择没有完成状态的章节
- `retry_failed` 只选择失败章节
- `force` 只改变选中章节是否允许重建，不改变选择集合
- `outside-range` 永远不能进入任务
- scope preview 与创建任务必须使用同一个纯函数或同一个 Repository query contract
- preview 结果需要携带版本或 hash；底层状态变化后创建任务必须重新计算并返回冲突，不能静默扩大范围

## 10. Web Experience

Phase 2 使用单一书籍工作区：

- 概览：章节、L1 coverage、L2 索引组、最近任务和缺口
- 章节导入：source、范围、预计新增、跳过与失败
- L1 路由：fresh、missing、failed、stale 和执行范围
- L2 事实：索引组、scope 模式、预计执行/跳过、coverage 与事实审阅

交互约束：

- 任务创建前展示真实 scope，不把当前 UI 筛选误当全量
- 执行后展示完成、失败、跳过与剩余缺口
- 切页后任务继续，书籍工作区与全局任务中心读取同一 API 状态
- L2 不默认全量，必须明确选择索引组、章节范围和模式
- 事实在当前书籍上下文原位审阅
- 1440/1280 使用高密度工作台；390 保留查看、状态和分步配置，宽表受控横向滚动

## 11. Failure Semantics

| Type | Behavior |
| --- | --- |
| 配置失败 | 任务创建前拒绝，不创建 outbox |
| Provider 失败 | 脱敏分类，按明确策略重试 |
| 结构失败 | 不提交章节或 facts，记录精确 chapter failure |
| 业务拒绝 | 记录准入统计，不冒充 Provider failure |

- 单章输出完整校验后才提交
- 部分成功保留已验证章节，但 job 必须显示缺口
- pause 在章节或批次提交边界生效
- cancel 丢弃尚未提交的返回结果
- Worker recovery 只复用签名与 output reference 均匹配的完成步骤

## 12. Scale And Security Verification

- Golden contract：YAML、旧 fixture、旧调用代码三方一致
- Repository integration：真实 PostgreSQL、事务、coverage 与加密字段
- Executor integration：fake adapter、重试、结构错误、pause/cancel 与迟到完成
- Scope matrix：三种 mode、force 与五种 chapter status 全矩阵
- Scale：3、100、3000 章以及约 70000 facts 的合成元数据
- Browser：1440、1280、768、390 的 scope、切页任务状态和事实审阅
- Recovery：API restart、Worker kill、lease expiry、outbox replay 与 SQL 单效果
- Security：正文、fact、密钥、Dify credential 不进入日志、普通列、事件、审计或错误响应

正式旧 SQLite 数据不进入 Phase 2 测试，规模验证使用不含真实正文的合成元数据

## 13. Task Decomposition

1. Task 0：Dify golden contract、step 粒度实验和 freshness 矩阵
2. Dify chapter/L1/L2 adapter 与 fake
3. 书库、章节、版本和索引数据模型
4. 建书与章节导入垂直链路
5. L1 构建、签名和 coverage
6. L2 索引组与 scope 选择 contract
7. L2 executor、加密 facts、subjects 与准入
8. 书籍工作区、coverage 与事实审阅
9. 规模测试、独立恢复 demo 与 Phase 2 acceptance

每个任务必须先完成 focused tests、规格审查和质量审查，再允许下一个任务使用其 contract

## 14. Gate

`GATE-PHASE2-PLAN-APPROVED` 只批准实施计划，不授权正式数据迁移、部署或旧系统切换

Phase 2 implementation acceptance 必须证明：

- 测试书通过 fake adapter 完成建书、导入、可选自动 L1 和用户选择的 L2
- API restart、切页与 Worker recovery 后 job、coverage 和缺口正确
- 旧 chapter、L1、L2 fixture 在新 adapter contract 上通过
- scope preview 与实际执行集合一致
- 相同 concurrency key 的重复任务被阻止或合并
- 正文和 facts 明文不进入普通数据库列、日志、事件或错误响应
- 规模测试满足 Task 0 固定的门槛

任何 Gate 失败必须返回引入该行为的原任务修复，最终验收任务不得跨边界修补 Tasks 0-8
