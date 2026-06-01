# 小说章节安全分析台

独立本地 Web 服务：用自托管 Dify 分批获取章节原文，只获取一次；章节正文和 GPT 分析结果加密落本地 SQLite；后续不同 Prompt 的 GPT 分析直接读取本地加密章节库。

## 项目基线

当前项目现状、关键决策、安全边界、运行配置和中长期迭代计划统一维护在：

```text
docs/PROJECT_CONTROL_BASELINE.md
```

后续任何架构、运行、合规或路线图变化，都以该文件为唯一真实信息源并持续更新。

## 安全边界

- 章节正文不写明文文件、不进浏览器 localStorage、不出现在普通日志。
- SQLite 只明文保存元数据：`book_id`、章节号、标题、长度、HMAC、状态、时间。
- 正文和分析结果使用 AES-256-GCM 加密。
- HMAC-SHA256 用主密钥计算，不保存普通明文 hash。
- 主密钥默认存 macOS Keychain：`novel-chapter-gpt-service / master-key`。
- OpenAI Responses API 调用强制 `store: false`。
- 服务不使用 OpenAI Files、Vector Stores、Assistants、Threads、Batch、background mode。

严格使用真实版权原文前，请确认 OpenAI 项目已启用 ZDR 或 MAM，并把 `OPENAI_RETENTION_MODE` 设置为 `zdr` 或 `mam`。未设置时，后端会阻止真实章节分析。

## 准备

```bash
cp .env.example .env
```

编辑 `.env`：

```bash
DIFY_API_BASE=http://127.0.0.1:5001/v1
DIFY_CHAPTER_WORKFLOW_API_KEY=app-你的自托管Dify章节工作流Key
DIFY_L1_WORKFLOW_API_KEY=app-你的L1工作流Key
DIFY_L2_WORKFLOW_API_KEY=app-你的L2工作流Key
DIFY_L1_WORKFLOW_VERSION=v1
DIFY_L2_WORKFLOW_VERSION=v1
L1_INDEX_PROVIDER=dify
L2_INDEX_PROVIDER=dify
OPENAI_API_KEY=sk-你的OpenAIKey
OPENAI_MODEL=gpt-5.5
OPENAI_RETENTION_MODE=zdr
HOST=0.0.0.0
PORT=5174
DATA_DIR=./data
IMPORT_BATCH_SIZE=10
OPENAI_CHAPTER_CONCURRENCY=1
OPENAI_PROXY_URL=
OPENAI_API_BASE=https://api.openai.com/v1
```

如果服务器所在网络不能直连 `api.openai.com`，可把 `OPENAI_PROXY_URL` 设置为本机或 VPN 的 HTTP 代理，例如 `http://127.0.0.1:7897`。如需使用 OpenAI 兼容网关，`OPENAI_API_BASE` 必须指向你确认合规、可承载版权章节内容的地址。

把 `dify-workflows/minimal-chapter-fetch.workflow.yml` 导入自托管 Dify，并发布为 Workflow API。该工作流只负责返回章节原文 JSON，不接 LLM。

L1/L2 索引默认也支持由 Dify Workflow 承接单章执行（后端调度不变）：

- `dify-workflows/l1-route-index.workflow.yml`
- `dify-workflows/l2-fact-index.workflow.yml`

两者都使用后端动态传入 `index_prompt`，不在 Dify 里固化 Prompt。  
如果需要回退旧执行链，可把 `L1_INDEX_PROVIDER` 或 `L2_INDEX_PROVIDER` 改成 `openai`。

## 启动

```bash
npm install
npm run dev
```

前端默认：

```text
http://127.0.0.1:5173
```

后端 API：

```text
http://127.0.0.1:5174
```

## 局域网访问

构建前端后用后端服务托管整个网站：

```bash
npm run build
npm run start:lan
```

同一局域网设备打开：

```text
http://你的本机局域网IP:5174
```

例如本机 IP 是 `172.16.75.46` 时，访问 `http://172.16.75.46:5174`。只在可信局域网/VPN 内使用，不要暴露到公网。

## 本机预览环境

开发新版但不想重启线上局域网服务时，可以启动只绑定本机的预览环境：

```bash
npm run preview:local
```

预览地址：

```text
http://127.0.0.1:5194/
```

预览环境使用 `data-preview/` 和 `dist-preview/`。`data-preview/` 是从正式 `data/novel-chapters.sqlite` 复制出来的一次性快照，预览里的导入、L1、分析任务不会写入正式数据库，也不会影响 `5184` 线上服务。

如果只想刷新预览数据副本：

```bash
npm run preview:prepare-data
```

如果在非交互式环境中确认覆盖预览数据：

```bash
npm run preview:prepare-data -- --force
```

## API

- `POST /api/books/imports`：创建章节导入任务，支持 `book_name` 与 `book_id` 绑定；同一 `book_id` 不能绑定不同书名。
- `GET /api/imports/:id`：查询导入任务。
- `GET /api/imports/:id/events`：导入任务 SSE。
- `GET /api/books/:bookId/chapters`：只返回章节元数据。
- `POST /api/analyses`：创建 GPT 分析任务，支持 `name`、`chapter_indexes` 和任务级 Prompt/Schema。
- `GET /api/analyses`：读取分析任务列表。
- `GET /api/analyses/:id`：读取分析结果和任务级 Prompt/Schema 快照。
- `GET /api/analyses/:id/events`：分析任务 SSE。
- `DELETE /api/analyses/:id`：删除单个分析任务及其加密结果。
- `GET/PUT /api/prompts`：读取和保存默认 Prompt/Schema，支持字段表和原始 JSON Schema 双模式。
- `GET/POST /api/prompt-groups`：读取和新建 Prompt 组，支持名称和分类。
- `GET/PUT/DELETE /api/prompt-groups/:id`：查看、编辑和删除单个 Prompt 组。
- `POST /api/books/:bookId/delete`：删除一本书的本地数据。

## 页面

- `/`：分析任务中心。创建、运行、查看、复制和删除分析任务，可从已导入章节中按范围勾选具体章节。
- `/library`：书籍章节库。导入书籍章节、查看章节元数据、删除本地书籍数据。
- `/prompts`：Prompt 库。新建、编辑、删除和分类管理多组逐章 Prompt/汇总 Prompt。

## 自托管 Dify 建议

建议至少检查这些配置：

```text
DEBUG=false
ENABLE_REQUEST_LOGGING=false
WORKFLOW_LOG_CLEANUP_ENABLED=true
WORKFLOW_LOG_RETENTION_DAYS=1
```

同时把 Dify Docker/Postgres 数据卷放在 FileVault 或等效磁盘加密分区，只绑定本机、内网或 VPN。

## 测试

```bash
npm test
npm run build
```

测试覆盖：

- Dify 分批和章节输出解析。
- AES-GCM 加密、HMAC、SQLite 明文扫描。
- OpenAI 请求断言 `store:false` 且不含 `background`。
- 导入 3 章、二次导入跳过、GPT 分析不重复调用 Dify。
