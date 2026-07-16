# Novel Analysis Refactor Roadmap

> **For agentic workers:** Each phase requires its own detailed implementation plan before code changes begin. Use `subagent-driven-development` or `executing-plans` only against the current approved phase plan

**Goal:** 将当前单用户 SQLite 应用分阶段重构为支持 5 至 20 人协作的小说分析系统，同时保护章节、L1、L2 和 Prompt 资产

**Architecture:** 目标系统是模块化单体，React + TypeScript 前端、Express + TypeScript API、独立 Worker 进程和 PostgreSQL 数据源。产品任务表是状态真相源，transactional outbox 将任务投递给 `pg-boss`，Dify 保持为外部 Workflow 执行层

**Tech Stack:** React 19、TypeScript、React Router、TanStack Query、React Hook Form、Zod、Radix primitives、Express 5、Kysely、PostgreSQL、pg-boss、Vitest、Node test、Playwright

---

## 1. 路线图原则

- 每个阶段必须产生可运行、可测试、可回退的增量
- 新代码在 `apps/` 与 `packages/` 中建设，旧根目录应用在正式切换前保持可运行
- 不在开发期做新旧系统双写
- 旧行为先通过契约测试和 golden cases 固化，再替换实现
- 每个阶段结束后更新项目基线和下一阶段输入契约
- 后续详细计划只能依赖已经落地并验证的文件、类型和 API
- 任何影响 Dify 语义、密文或迁移的阶段都必须有独立验收闸门

## 2. 阶段依赖

```mermaid
flowchart LR
  P0["阶段 0 基础契约与工程骨架"] --> P1["阶段 1 协作与任务内核"]
  P1 --> P2["阶段 2 书库与索引"]
  P2 --> P3["阶段 3 L2 连续提问"]
  P3 --> P4["阶段 4 高级分析与旧历史"]
  P4 --> P5["阶段 5 迁移与正式切换"]
```

阶段顺序是强依赖关系，不允许先实现提问页面再补任务与证据模型

## 3. 阶段 0：基础契约与工程骨架

### 目标

在不改变旧应用行为的前提下建立 npm workspace、TypeScript 构建、共享任务契约、领域状态机、Dify Workflow hash 清单和 CI 双轨验证

### 产物

- 根 workspace 与 TypeScript 基础配置
- `packages/contracts`
- `packages/domain`
- 旧应用 112 个测试的独立验证命令
- Dify 五条当前线上导出 Workflow manifest
- Dify 输出归一化契约 fixtures
- 同时运行旧应用与新 packages 的 CI

### 验收

- 旧 `server/` 与 `src/` 没有行为修改
- 旧 112 个测试全部通过
- 旧 lint 与 build 通过
- 新 contracts 与 domain 类型检查、单元测试通过
- Workflow manifest 与仓库 YAML hash 一致
- 仓库 YAML 已由当前线上 Dify 导出覆盖并通过凭据扫描
- `npm ci` 可从干净环境恢复全部依赖

### 详细计划

`docs/superpowers/plans/2026-07-16-foundation-contracts-implementation-plan.md`

## 4. 阶段 1：协作、PostgreSQL 与任务内核

### 目标

交付可登录、可鉴权、可持久化任务、可重启恢复的新 API 与 Worker 最小系统

### 主要范围

- `apps/api` 与 `apps/worker`
- PostgreSQL 本地开发与测试环境
- Kysely schema 与版本化 migration
- users、auth_identities、sessions、audit_logs
- jobs、job_steps、job_attempts、job_events、job_outbox
- pg-boss dispatcher 与 Worker lease
- 飞书 OAuth adapter 和测试替身
- 管理员与成员 RBAC
- SSE 任务事件投影
- 新 Web 全局壳、登录和任务中心最小版本

### 可独立演示

管理员通过飞书测试身份登录，创建一个无外部模型依赖的示例任务，刷新页面和重启 API 后任务仍可见，重启 Worker 后任务可以继续并完成

### 验收

- 产品任务表是唯一状态真相源
- outbox 重复投递不会重复执行步骤
- Worker 中断后 lease 可恢复
- 普通成员无法管理成员和系统配置
- 所有任务控制写入 audit log
- API 与 Worker 不依赖旧 SQLite 单例

### 计划创建时机

阶段 0 合并且 contracts 与状态机接口稳定后

## 5. 阶段 2：书库、导入、L1 与 L2

### 目标

交付书籍工作区和完整数据准备主链路，使用新任务内核调用现有 Dify Workflow

### 主要范围

- books、book_sources、chapters
- prompt_versions、workflow_versions
- index_groups、l1_indexes、l2_chapter_statuses、l2_facts、l2_subjects
- 章节导入任务
- L1 任务
- L2 `all / missing / retry_failed` 任务
- HMAC、执行签名和新鲜度
- 神奇生物等专项准入规则移植
- 共享书库、书籍概览和数据准备 UI
- L1/L2 coverage、事实审阅和 scope 确认

### 可独立演示

成员创建一本测试书，通过 Dify stub 导入章节，自动进入 L1，再选择一个 L2 索引组构建事实，切页和重启后任务与覆盖率保持正确

### 验收

- 旧 Dify import、L1、L2 fixture 契约在新 adapter 上通过
- 新鲜章节跳过逻辑与旧系统一致
- `missing` 与 `retry_failed` 不因 force 扩大范围
- 相同并发键的重复任务被阻止或合并
- 页面执行前展示真实 scope，执行后展示完成、失败、跳过和缺口
- 章节和 L2 fact 明文不进入日志与普通数据库列

### 计划创建时机

阶段 1 合并且 Repository、JobStep、Dify adapter 接口稳定后

## 6. 阶段 3：L2 连续提问

### 目标

交付以书籍为上下文的研究会话、每轮独立召回、证据快照和三栏提问工作区

### 主要范围

- query_sessions、query_turns、turn_evidence
- 单目标、集合与普通查询意图
- 章节窗口候选扫描
- 结构字段、关键词、别名和覆盖策略
- 每轮精简会话上下文
- Dify summary 调用、分块和本地事实降级
- 回答、证据、章节、缺口和 trace 原位展示
- 视觉方向 D 的桌面与窄屏适配

### 可独立演示

成员在一本已建索引的书内创建研究会话，连续提问两轮，第二轮能理解追问但重新召回事实，每轮证据和降级状态独立可查看

### 验收

- 上一轮模型回答不进入事实证据集合
- 每个回答事实可以追踪到 turn_evidence
- 目标查询、集合查询和后段章节召回 golden cases 不低于旧基线
- Dify 失败时降级结果清楚标记，不伪装正常回答
- 10 个用户可同时提交提问并按交互配额执行
- 1440、1280、768 和 390 像素视口无重叠

### 计划创建时机

阶段 2 合并且 L2 Repository 与 coverage 契约稳定后

## 7. 阶段 4：高级分析与旧历史

### 目标

将现有模板分析迁移到新任务内核，并提供旧 Analysis 历史只读归档

### 主要范围

- 新 analysis_runs 与 analysis_parts
- `fast_index / balanced / precision / full_text`
- Prompt、Schema、索引和模式快照
- 分章、分块、字段拆分和保真 merge
- 暂停、取消和续跑
- legacy_analysis_runs 只读查询
- 结构化表格、Markdown 和导出
- 书籍工作区高级分析入口

### 可独立演示

成员从书籍工作区创建一个新高级分析任务并查看结构化结果，同时能够打开一个旧 Analysis 归档但不能错误续跑

### 验收

- 四种模式读取 L1、L2 和原文的边界不变
- Prompt 与 Schema 快照参与复用
- Worker 中断后只重跑未完成 part
- 旧历史数量、结果和诊断可读取
- 旧历史 API 不暴露 resume 操作

### 计划创建时机

阶段 3 合并且 query 证据、结果展示与任务恢复模式稳定后

## 8. 阶段 5：迁移、性能、UAT 与切换

### 目标

完成 SQLite 到 PostgreSQL 的安全迁移、全量校验、团队 UAT 和一次性正式切换

### 主要范围

- 只读 SQLite 迁移器
- 进程内解密与目标密钥重加密
- migration manifest
- 全量章节 HMAC 与密文校验
- L1/L2/Prompt/旧 Analysis 数量与内容校验
- golden query 对比
- 20 用户浏览与 10 用户提问负载测试
- HTTPS 固定域名与飞书正式回调
- 维护模式、最终增量迁移、入口切换和观察期

### 可独立演示

从正式库快照迁移到全新 PostgreSQL，在不访问旧数据库的情况下完成核心链路 smoke、数据审计和多人 UAT

### 验收

- 设计文档第 17 和 19 节全部门槛通过
- 任何迁移硬性校验失败都会阻止切换
- 正式切换前旧 live task 为零
- 2 小时观察期内核心链路、登录和任务恢复稳定
- 旧服务停止后保留不可变数据库、密钥和配置备份

### 计划创建时机

阶段 4 合并并完成至少一次生产规模快照演练后

## 9. 跨阶段强制门槛

每个阶段结束必须运行

```bash
npm run verify:legacy
npm run verify:new
npm run dify:manifest:check
git diff --check
```

从阶段 1 开始增加 PostgreSQL integration tests

从阶段 2 开始增加 Dify adapter contract tests

从阶段 3 开始增加 Playwright 与视觉截图

从阶段 5 开始增加全量 migration 和负载测试

## 10. 设计覆盖矩阵

| 设计章节 | 实施阶段 |
| --- | --- |
| 当前行为保护与 Dify 版本 | 阶段 0 |
| 模块结构与共享契约 | 阶段 0 |
| PostgreSQL、任务模型与 outbox | 阶段 1 |
| 飞书认证、RBAC、安全与审计 | 阶段 1 |
| 全局壳、任务中心与视觉 token | 阶段 1 |
| 书库、章节、L1、L2 与 Prompt | 阶段 2 |
| 数据准备交互与真实 scope | 阶段 2 |
| 连续提问、召回、证据与降级 | 阶段 3 |
| 三栏提问工作区与响应式布局 | 阶段 3 |
| 高级分析与旧历史归档 | 阶段 4 |
| SQLite 迁移、校验与切换 | 阶段 5 |
| 多人性能、UAT 与观察期 | 阶段 5 |

每个设计章节都有唯一主要交付阶段，跨阶段验收仍由第 9 节统一执行

## 11. 计划治理

- 每个阶段开始前创建独立 `docs/superpowers/plans/YYYY-MM-DD-<phase>.md`
- 计划必须引用上一个阶段已经存在的文件和类型
- 计划必须包含逐步 failing test、实现、验证和提交点
- 若上阶段接口改变，先更新总体设计与路线图，再写下阶段计划
- 不在总体路线图中虚构后续尚未落地的函数签名
- 正式切换计划必须由迁移演练产生的真实数据规模和耗时校准
