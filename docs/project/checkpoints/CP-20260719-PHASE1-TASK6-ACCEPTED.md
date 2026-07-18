---
checkpoint_id: CP-20260719-PHASE1-TASK6-ACCEPTED
task_id: PHASE1-TASK6
status: accepted
recorded_at: 2026-07-19T04:59:35+08:00
branch: refactor/phase1-task6-worker
base_commit: fd51657889a7748bc90a4641f3fa51f6dcb1526a
head_commit: 3daab74b8c9c50378a8e5a40074e33b13757dde8
supersedes: none
---

# Phase 1 Task 6 Accepted

## Scope

接受 Phase 1 Task 6 的 PostgreSQL step lease、attempt recovery、幂等完成、control/completion race、示例 executor、独立 Worker runtime、pg-boss singleton queue policy 与确定性中断验证

用户明确授权将既有 `failed -> queued` 状态迁移移除，使 `completed`、`failed`、`cancelled` 与已批准计划一致成为不可覆盖终态，并授权更新对应 domain 与控制竞态测试

不包含 schema/migration、Dify executor、旧 server、crypto、SQLite、书库/L1/L2 页面、正式数据、部署切换或 Phase Gate 变更

## Evidence

- claim 与 completion 事务保持 job → step → attempt 锁序，使用锁后 PostgreSQL `clock_timestamp()` 作为 lease 唯一权威时间，不依赖 Worker 主机时钟
- caller clock 快慢各一小时均不能提前抢占或阻塞已过期恢复；事务在 job lock 上等待跨过 lease expiry 后，claim 可恢复且 completion 在任何副作用前拒绝
- live lease 不可领取；expired lease 将旧 running attempt 标记 abandoned，新 attempt number 递增且新 owner 获得 lease
- owner、attempt ID、attempt number、lease snapshot 与 lease expiry 共同防止 forged、stale 或迟到 attempt 覆盖新结果
- step completion、attempt completion、progress、event、terminal status 与 next outbox 在同一事务内提交；重复完成不重复 output、progress、event 或 outbox
- pause、cancel、completion-first 与 completed/failed/cancelled 终态竞态由 PostgreSQL advisory lock 确定性验证，不依赖随机 sleep 决定 ordering
- paused completion 只提交当前 boundary 且不创建 next outbox；cancelled 丢弃迟到输出；终态控制和迟到完成均不改变终态
- ExecutionBarrier 只在 attempt 与 lease 事务提交后运行；attempt 1 阻塞期间 attempt 2 过期恢复并完成，释放 attempt 1 后其迟到输出零副作用
- Worker 启动 pg-boss consumer、transactional outbox dispatcher 与 expired lease recovery，生产入口只注入 no-op barrier且无测试开关或 HTTP 控制路径
- `jobs.wake` 显式使用 pg-boss `exclusive` policy，真实 PostgreSQL 验证相同 stable singleton key 只产生一个物理 job
- Worker background rejection 被观察和报告且后续 polling 继续；boss consumer 的 awaited rejection 保持向 pg-boss 传播
- Worker start/stop 串行化，重复 start 不重复注册 consumer/timer，stop 等待 in-flight startup 与 active step boundary 后清理
- `boss.start`、queue/work registration、offWork、active work、boss stop 与 database destroy 的部分失败均执行剩余清理并保留单一或聚合错误
- pg-boss `error` listener 在 start 前注册，重复 error 与 SIGTERM 共享同一幂等 coordinated shutdown 并设置非零退出结果
- 生产 `npm start -w apps/worker` smoke 真实观察 `exclusive` queue，向实际 Worker PID 发送 SIGTERM 并验证退出码 0，失败清理不会遗留子进程
- 规格审查最终 APPROVED，代码质量审查最终 APPROVED，无未解决 Critical、Important、Minor 或阻塞性 finding
- 总控独立验证通过 Task 6 focused integration 38/38、全部 jobs integration 48/48、Worker/Jobs/Domain typecheck、完整 ESLint 与 `git diff --check`
- 完整 `npm run verify` 通过：legacy 112、contracts 5、new unit 80、manifest 1、project-source 40，legacy build 与 project source check 有效
- base-to-implementation head 只有一个 `feat: recover jobs from expired worker leases` 提交；合并最新治理 main 后 head 为 `3daab74b8c9c50378a8e5a40074e33b13757dde8`
- 测试后 `novel_test_%` 数据库与 Task 6 Worker 进程均为 0；主工作区 `.DS_Store` 哈希保持 `217e9f0a83b73518ad0a15a09faee9ab28c262f9`

## Accepted Result

`PHASE1-TASK6` 满足批准后的 Task 6 验收标准，branch head `3daab74b8c9c50378a8e5a40074e33b13757dde8` 被接受，可发布实现 PR

`PHASE1-TASK7` 在 Task 6 合并到 `main` 并创建 merged Checkpoint 前保持 blocked

阶段实现基线 `baseline_commit` 保持 `be49f4ccd312a269ee4c7419c6d9d08407df2c21`，仅在 Phase 1 全部实现通过 `GATE-PHASE1-IMPLEMENTATION-ACCEPTED` 后更新

## Deferred Items

- pg-boss 与 PostgreSQL 真实故障注入目前主要由 fake boss lifecycle test 覆盖，生产 smoke 覆盖正常启动与 SIGTERM 路径
- 长步骤当前不实现 lease heartbeat；执行超过 lease 时旧 owner completion 被 fence，后续由 expired recovery 重试
- 项目既有 npm audit 风险与 GitHub Actions 完整 SHA 固定未在本任务处理
