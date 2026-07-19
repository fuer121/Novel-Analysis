---
checkpoint_id: CP-20260719-PHASE2-L2-REAL-SMOKE-ACCEPTED
task_id: PHASE2-L2-DSL-ALIGNMENT
status: accepted
recorded_at: 2026-07-19T22:30:16+08:00
branch: main
base_commit: 5d218eca83d388d1b36c26acf8a72289ff7e41ad
head_commit: 5d218eca83d388d1b36c26acf8a72289ff7e41ad
supersedes: none
---

# Phase 2 L2 Real Smoke Accepted

## Scope

记录用户手动导入仓库 L2 DSL 后，按 DEC-0004 执行的显式、脱敏、非正式数据真实 Dify smoke 结果

本 checkpoint 只接受环境连通性与三类 Workflow contract 证据，不改变 Phase 2 Gate、实现基线、正式数据策略、部署或切换状态

## Evidence

- 用户于 2026-07-19 明确确认已重新导入仓库 L2 DSL
- smoke 使用本地已映射且未跟踪的凭证，由一次性父进程注入子进程环境，未写入 `.env`、日志、Git、项目源或其他持久文件
- 输入为现有 smoke fixture 的合成、非敏感、最小数据，未连接 PostgreSQL，未使用正式小说正文、事实或用户数据
- `npm run test:smoke -w packages/dify` exit 0，1 个显式 smoke passed，24 个非目标测试 skipped
- 三个顺序 target 在 7.32 秒内完成，测试总耗时 7.47 秒，未触发 60 秒单请求 timeout 或 200 秒测试 timeout
- chapter-import、l1-index 与 l2-index 均通过 HTTP、Dify envelope 和本地 accepted contract 校验
- l2-index 不再出现缺少 `chapter_index`、`chapter_title` 的 `provider_invalid_response`
- 未记录 URL、Key、Authorization header、请求正文、provider 原始响应或任何凭证派生信息

## Accepted Result

用户手动导入后的线上 L2 Workflow 已通过当前 Phase 2 adapter contract smoke，原线上 L2 输出 blocker 已解除

Task 2 仍按已批准 Phase 2 计划保持解锁，可基于当前 `main` 推进；本 smoke 不替代 Task 2 的数据库、事务、freshness 或持久化验收

实现基线 `baseline_commit` 保持 `820b30a1cfae0b0a19be9fa763f44801742d38e9`，只有 Phase 2 最终实现验收并合并后才能更新
