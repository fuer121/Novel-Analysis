# 小说章节安全分析台：项目基线

最后更新：2026-06-02，Asia/Shanghai

本文档是当前项目的唯一真实信息源。后续只要涉及项目目标、架构、安全边界、运行配置、接口面、关键决策或工作区边界变化，都必须同步更新本文档。

## 1. 项目身份

- 产品名称：Novel Chapter GPT Service / 小说章节安全分析台
- 正式工作区：`/Users/staff/Desktop/Vibe coding/novel-chapter-gpt-service`
- 远程仓库：`git@github.com:fuer121/Dify-Flow.git`
- 默认分支：`main`
- 当前工作分支：以 `git branch --show-current` 实时结果为准
- 当前基线提交：以 `git log -1 --oneline` 实时结果为准

## 2. 工作区边界

- 唯一正式开发与运行目录是当前工作区。
- 历史重复工作区 `Dify 工作流模板创建` 不再作为开发、运行或提测目录使用。
- 旧工作区只允许作为一次性内容回收来源，不能继续承载新的代码或文档真相。
- 索引存储设计的专题说明统一维护在 `docs/L1_L2_INDEX_STORAGE.md`。

## 3. 产品目标

本项目是一个本地运行、可在可信局域网访问的小说章节分析服务，目标如下：

- 通过自托管 Dify 工作流批量获取小说章节原文，章节只导入一次。
- 章节正文导入后立即加密落本地 SQLite，不在前端明文展示。
- 后续不同 Prompt、不同分析任务复用本地章节库，不重复回源拉取正文。
- 用可复用的 L1/L2 索引缩短长篇小说分析路径。
- 把版权原文、Prompt 和分析结果尽量限制在本地受控边界内。

当前产品定位是本地/内网自用工具，不是公网 SaaS。

## 4. 当前技术基线

### 4.1 运行栈

- Node.js ESM 服务端
- Express 5
- React 19 + Vite 8
- SQLite 本地存储
- 自托管 Dify Workflow 作为章节导入、L1、L2 和分析的可选执行器
- OpenAI Responses API 作为 L1/L2/分析的可选执行器

### 4.2 目录责任

- `src/`：前端应用
- `server/`：服务端接口、任务编排、SQLite、加密与外部调用
- `test/`：Node 原生测试
- `dify-workflows/`：需要导入自托管 Dify 的工作流定义
- `docs/`：项目控制与专题设计文档
- `data/`：正式环境 SQLite 数据目录
- `data-preview/`：本机预览环境的数据快照目录
- `dist/`：正式前端构建产物
- `dist-preview/`：预览前端构建产物

## 5. 运行配置基线

### 5.1 默认端口与目录

由 `server/config.js` 定义：

- `HOST` 默认 `0.0.0.0`
- `PORT` 默认 `5174`
- `DATA_DIR` 默认 `./data`
- `STATIC_DIR` 默认 `./dist`
- `APP_ENV` 默认 `production`

### 5.2 必要环境变量

章节导入与 Dify 路径：

- `DIFY_API_BASE`
- `DIFY_CHAPTER_WORKFLOW_API_KEY`
- `DIFY_L1_WORKFLOW_API_KEY`
- `DIFY_L2_WORKFLOW_API_KEY`
- `DIFY_ANALYSIS_CHAPTER_WORKFLOW_API_KEY`
- `DIFY_ANALYSIS_SUMMARY_WORKFLOW_API_KEY`
- `DIFY_L1_WORKFLOW_VERSION`
- `DIFY_L2_WORKFLOW_VERSION`
- `DIFY_ANALYSIS_CHAPTER_WORKFLOW_VERSION`
- `DIFY_ANALYSIS_SUMMARY_WORKFLOW_VERSION`
- `IMPORT_BATCH_SIZE`

执行器开关：

- `L1_INDEX_PROVIDER`，允许 `dify` 或 `openai`
- `L2_INDEX_PROVIDER`，允许 `dify` 或 `openai`
- `ANALYSIS_PROVIDER`，允许 `dify` 或 `openai`

OpenAI 路径：

- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `OPENAI_RETENTION_MODE`
- `OPENAI_API_BASE`
- `OPENAI_PROXY_URL`
- `OPENAI_CHAPTER_CONCURRENCY`
- `OPENAI_REQUEST_TIMEOUT_MS`
- `OPENAI_MAX_RETRIES`

密钥存储：

- `KEYCHAIN_SERVICE` 默认 `novel-chapter-gpt-service`
- `KEYCHAIN_ACCOUNT` 默认 `master-key`

### 5.3 环境变量样例源

以 `.env.example` 为准。任何新增配置必须先同步更新 `.env.example`。

## 6. 启动与发布基线

### 6.1 本地开发

```bash
npm install
npm run dev
```

行为：

- 前端 Vite 开发服务默认监听 `http://127.0.0.1:5173`
- 后端 API 默认监听 `http://127.0.0.1:5174`
- `npm run dev` 会并行启动前后端

### 6.2 正式局域网服务

```bash
npm run build
npm run start:lan
```

行为：

- 后端监听 `0.0.0.0:5174`
- 同时托管 API 和构建后的前端页面
- 仅允许在可信局域网或 VPN 中使用，不允许暴露到公网

### 6.3 本机预览环境

```bash
npm run preview:local
```

行为：

- 预览服务绑定 `127.0.0.1:5194`
- 使用 `data-preview/` 和 `dist-preview/`
- `data-preview/` 由 `scripts/prepare-preview-data.js` 从正式库复制快照
- 预览环境写入不会影响正式 `data/`
- 预览环境复用同一主密钥，因此能解密从正式库复制过来的密文

### 6.4 预览数据刷新

```bash
npm run preview:prepare-data
```

强制覆盖：

```bash
npm run preview:prepare-data -- --force
```

## 7. 当前页面基线

由 `src/App.jsx` 和页面文件定义，当前正式页面为：

- `/`：分析任务中心
- `/library`：书籍章节库
- `/prompts`：Prompt 与索引规则管理
- `/diagnostics`：系统诊断页

页面职责：

- 分析任务中心：创建、运行、续跑、查看与删除分析任务
- 书籍章节库：创建书籍、导入章节、查看元数据、删除书籍、启动 L1/L2 准备
- Prompt 管理：管理书籍级分析模板、L1 规则与 L2 索引组规则
- 系统诊断：查看运行时配置、任务状态、数据库规模与书籍索引概览

## 8. 当前 API 基线

### 8.1 运行与诊断

- `GET /api/config`
- `GET /api/health`
- `GET /api/diagnostics`
- `GET /api/openai/test`
- `GET /api/dify/test`
- `GET /api/tasks`

### 8.2 书籍与导入

- `GET /api/books`
- `POST /api/books`
- `POST /api/books/imports`
- `GET /api/imports/:id`
- `GET /api/imports/:id/events`
- `POST /api/imports/:id/cancel`
- `POST /api/imports/:id/pause`
- `POST /api/imports/:id/resume`
- `GET /api/books/:bookId/chapters`
- `POST /api/books/:bookId/delete`

### 8.3 L1 章节线索索引

- `POST /api/books/:bookId/l1-indexes`
- `GET /api/l1-indexes/:id`
- `GET /api/l1-indexes/:id/events`
- `POST /api/l1-indexes/:id/cancel`
- `POST /api/l1-indexes/:id/pause`
- `POST /api/l1-indexes/:id/resume`
- `GET /api/books/:bookId/l1-indexes/coverage`
- `GET /api/books/:bookId/l1-indexes/chapters`
- `GET /api/books/:bookId/l1-indexes/windows`

### 8.4 L2 事实索引

- `GET /api/books/:bookId/index-groups`
- `POST /api/books/:bookId/index-groups`
- `PUT /api/books/:bookId/index-groups/:groupKey`
- `DELETE /api/books/:bookId/index-groups/:groupKey`
- `POST /api/books/:bookId/l2-indexes`
- `GET /api/l2-indexes/:id`
- `GET /api/l2-indexes/:id/events`
- `POST /api/l2-indexes/:id/cancel`
- `POST /api/l2-indexes/:id/pause`
- `POST /api/l2-indexes/:id/resume`
- `GET /api/books/:bookId/l2-indexes/coverage`
- `GET /api/books/:bookId/l2-facts`
- `GET /api/books/:bookId/index-prompts`
- `PUT /api/books/:bookId/index-prompts`

### 8.5 分析任务

- `POST /api/analyses`
- `GET /api/analyses`
- `GET /api/analyses/:id`
- `DELETE /api/analyses/:id`
- `GET /api/analyses/:id/events`
- `POST /api/analyses/:id/resume-run`
- `POST /api/analyses/:id/cancel`
- `POST /api/analyses/:id/pause`
- `POST /api/analyses/:id/resume`

### 8.6 Prompt 与规则

- `GET /api/prompts`
- `PUT /api/prompts`
- `GET /api/index-prompts`
- `PUT /api/index-prompts`
- `GET /api/prompt-groups`
- `POST /api/prompt-groups`
- `GET /api/prompt-groups/:id`
- `PUT /api/prompt-groups/:id`
- `DELETE /api/prompt-groups/:id`
- `GET /api/prompt-guides/templates`
- `POST /api/prompt-guides/generate`
- `POST /api/prompt-guides/optimize`

## 9. 数据与存储基线

### 9.1 SQLite 主库

主库文件位置：

- `data/novel-chapters.sqlite`

核心表：

- `books`
- `chapters`
- `prompt_settings`
- `prompt_groups`
- `book_index_prompts`
- `book_index_groups`
- `analysis_runs`
- `analysis_chapters`
- `analysis_summary_parts`
- `l1_chapter_indexes`
- `l1_window_indexes`
- `l2_chapter_statuses`
- `l2_facts`

### 9.2 存储责任

- `chapters`：保存章节元数据和加密正文
- `analysis_runs`：保存分析任务元数据和最终结果密文
- `analysis_chapters`：保存逐章分析结果密文
- `analysis_summary_parts`：保存汇总分块结果密文与追踪摘要
- `l1_chapter_indexes`：保存章节级线索索引
- `l2_chapter_statuses` 与 `l2_facts`：保存事实索引状态与事实项

### 9.3 兼容性原则

- 数据库 schema 演进通过 `server/db.js` 内的建表与补列逻辑兜底。
- 若新增表、列、索引或迁移步骤，必须同步更新本文件和相关测试。

## 10. 安全边界基线

### 10.1 明确保护目标

- 小说章节正文
- 分析 Prompt 快照
- 逐章分析结果
- 汇总结果

### 10.2 已落实约束

- 章节正文使用 AES-256-GCM 加密后再写 SQLite。
- 分析逐章结果、汇总分块结果和最终结果使用 AES-256-GCM 加密写库。
- 章节内容校验使用 HMAC-SHA256，不保存正文明文 hash。
- 主密钥默认存放于 macOS Keychain。
- 前端只显示元数据，不提供整章正文查看能力。
- 运行诊断页只展示元数据，不展示正文、密钥、Prompt 密文或 L2 加密事实正文。
- OpenAI Responses API 调用强制 `store: false`。

### 10.3 当前有意识接受的边界

- `l1_chapter_indexes` 当前按现有实现保存章节线索索引，不等同于正文，但仍应视为敏感派生内容。
- `l2_facts` 当前是可查询事实索引层，属于可复用分析中间层，需要继续按敏感内容对待。

### 10.4 禁止项

以下能力当前明确不使用：

- OpenAI Files
- Vector Stores
- Assistants
- Threads
- Batch
- background mode

### 10.5 合规开关

- 在分析真实版权章节前，`OPENAI_RETENTION_MODE` 必须明确设置为 `zdr` 或 `mam`。
- 未设置时，后端必须拒绝真实章节分析请求。
- 若 `OPENAI_API_BASE` 指向 OpenAI 兼容网关，使用前必须单独确认该网关的保留策略与合规边界。

## 11. Dify 工作流基线

当前仓库内维护的工作流文件：

- `dify-workflows/minimal-chapter-fetch.workflow.yml`
- `dify-workflows/l1-route-index.workflow.yml`
- `dify-workflows/l2-fact-index.workflow.yml`
- `dify-workflows/analysis-chapter.workflow.yml`
- `dify-workflows/analysis-summary.workflow.yml`

约束：

- 章节导入工作流只负责返回章节原文 JSON，不承担 LLM 分析。
- L1、L2 和分析工作流由后端动态传入 Prompt，不在 Dify 内固化业务 Prompt。
- 工作流版本号变化通过对应 `DIFY_*_WORKFLOW_VERSION` 参与执行签名与失效控制。

## 12. 测试与验证基线

项目最小验证命令：

```bash
npm test
npm run build
```

当前测试重点覆盖：

- Dify 批次构建与输出归一化
- L1/L2 工作流输出归一化
- AES-GCM 加密与 SQLite 明文扫描
- 汇总分块密文存储与追踪摘要
- 诊断接口不泄露正文或敏感索引内容
- OpenAI 请求满足 `store: false`
- 书籍绑定约束、任务与数据层核心行为

## 13. 文档维护规则

- `README.md` 面向使用者，描述安装、运行和页面入口。
- 本文件面向项目控制，负责记录当前真实边界与关键约束。
- `docs/L1_L2_INDEX_STORAGE.md` 面向索引存储专题设计。
- 当三者冲突时，应先修正文档漂移，再以本文件为控制真相源。
