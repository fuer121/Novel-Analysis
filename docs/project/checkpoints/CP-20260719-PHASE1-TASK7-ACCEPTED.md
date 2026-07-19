---
checkpoint_id: CP-20260719-PHASE1-TASK7-ACCEPTED
task_id: PHASE1-TASK7
status: accepted
recorded_at: 2026-07-19T10:35:46+08:00
branch: refactor/phase1-task7-web
base_commit: 84c3770f29ad97bcb1f4b71ce9afdf5021dbf1dc
head_commit: 41b35dd13e7bfdba49be3ef7975c1104c7e188c6
supersedes: none
---

# Phase 1 Task 7 Accepted

## Scope

接受 Phase 1 Task 7 的 PostgreSQL cursor-backed SSE、生产 API 入口、登录完成页、全局壳、任务中心、任务详情与最小成员管理

不包含书库、L1、L2、连续提问页面、持久化 CSRF、Dify 配置、样例业务数据、正式数据、部署切换或 Phase Gate 变更

## Evidence

- `GET /api/job-events` 从 PostgreSQL `job_events` 按 cursor replay，API 进程不保存 replay buffer 或任务进度信源
- SSE 在连接时和轮询期间持续验证 active session 与 active user，处理 backpressure、断连清理和 API shutdown
- Web 使用相对 `/api` 与 same-origin credentials，CSRF 仅保存在模块内存
- 并发与错峰 `CSRF_STALE` 共享必要的 `/me` refresh，重放保持原 Idempotency-Key、body 和 headers，第二次 stale 不继续重放
- session 过期、撤销或用户停用后，API 与 SSE 均使 Web 返回登录页
- 任务中心、任务详情和最小成员管理均以 API 数据为准；member 不显示 admin 导航，当前管理员不能自降级或自停用
- 未知路由使用中文页面；没有新增 Phase 2 页面
- 390x844 真实浏览器验证任务中心根宽度 `390/390`、页面横向滚动为 0，宽表仍在 `360/940` 的容器内独立横向滚动
- 移动端任务详情与成员管理根宽度均为 `390/390`，任务控制、失败摘要和当前管理员保护可见
- 移动端溢出根因为表格内 `.sr-only` 保留末列静态位置；通过显式原点定位关闭根溢出，未从可访问树隐藏内容
- 最终规格审查与质量审查均 APPROVED，无 Critical、Important、Minor 或阻塞性 finding
- 总控合并最新治理 `main` 后验证 API/Auth/Jobs/Admin/SSE integration 69/69、Web 14/14、API/Web typecheck、Web production build、完整 ESLint 与 `git diff --check` 通过
- 合并后首次四文件 API 组合曾出现一次认证故障注入测试 Location 缺失，结果为 68/69；该单测隔离复跑 1/1、相同组合复跑 69/69，未形成可复现回归
- immutable base 到实现 head `9e32c3e8162c70050703ab93ba33c8cb4e32500a` 只有一个 `feat: add persisted task center projection` 提交；合并最新治理 main 后 head 为 `f1c75a123a7f0f9b7fa5e8331aba82a3150ee4df`
- PR #21 首次 CI 因 CSS 回归测试使用 cwd-relative fixture 路径而失败；用户授权后改为基于 `import.meta.url` 定位，根目录与 Web workspace 均通过 14/14
- CI 修复的独立规格审查与质量审查均 APPROVED，无 finding；修复后完整 `npm run verify` 通过 legacy 112、contracts 5、new 94、manifest 1、project source 40 及构建、lint、项目信源检查
- 工作树干净，未修改或提交主工作区 `.DS_Store`

## Accepted Result

`PHASE1-TASK7` 满足批准后的 Task 7 验收标准，branch head `41b35dd13e7bfdba49be3ef7975c1104c7e188c6` 被接受，可更新实现 PR

`PHASE1-TASK8` 在 Task 7 合并到 `main` 并创建 merged Checkpoint 前保持 blocked

阶段实现基线 `baseline_commit` 保持 `be49f4ccd312a269ee4c7419c6d9d08407df2c21`，仅在 Phase 1 全部实现通过 `GATE-PHASE1-IMPLEMENTATION-ACCEPTED` 后更新

## Deferred Items

- PostgreSQL BIGINT event ID 当前映射为 JavaScript `number`，需要后续 contract 演进授权，不在 Task 7 内扩张
- 项目既有 npm audit 风险与 GitHub Actions 完整 SHA 固定未在本任务处理
