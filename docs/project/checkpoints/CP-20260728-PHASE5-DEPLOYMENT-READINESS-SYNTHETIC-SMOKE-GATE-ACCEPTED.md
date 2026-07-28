---
checkpoint_id: CP-20260728-PHASE5-DEPLOYMENT-READINESS-SYNTHETIC-SMOKE-GATE-ACCEPTED
task_id: PHASE5-DEPLOYMENT-READINESS-SYNTHETIC-SMOKE
status: accepted
recorded_at: 2026-07-28T10:22:00+08:00
branch: codex/phase5-deployment-readiness-synthetic-smoke-gate-accepted
base_commit: 3524da696eaa9e599529d8353a1b9fd5be199bfa
head_commit: 3524da696eaa9e599529d8353a1b9fd5be199bfa
supersedes: CP-20260728-PHASE5-DEPLOYMENT-READINESS-ROUTER-SECURITY-CORRECTION-ACCEPTED
---

# Phase 5 Deployment Readiness Synthetic Smoke Gate Accepted

## Scope

接受原deployment-readiness correction contract中的repository-only synthetic deployment smoke恢复Gate

本checkpoint只解锁committed deployment artifacts、无env-file Web build与本地in-process synthetic runtime验证，不授权Docker daemon、真实config、credentials、database、外部或独立网络服务、目标服务器、UAT、Deployment Gate、正式部署、切换或cutover

## User Confirmation

用户明确回复`接受 GATE-PHASE5-DEPLOYMENT-READINESS-SYNTHETIC-SMOKE-RESUME`

该确认只授权`PHASE5-DEPLOYMENT-READINESS-SYNTHETIC-SMOKE`的strict TDD、repository-only实现、验证、审查与result checkpoint

## Task Contract

- Task ID：`PHASE5-DEPLOYMENT-READINESS-SYNTHETIC-SMOKE`
- Core allowed modules：synthetic smoke runner、`test/deployment/**`、`vitest.deployment.config.ts`与root package scripts
- Mechanical adjacent scope：Web synthetic build配置、临时目录cleanup、API in-process request harness、Worker readiness fixture与直接类型检查入口
- Base commit：`3524da696eaa9e599529d8353a1b9fd5be199bfa`
- Success criteria：fresh Web build禁用env-file读取并只写临时目录；committed image、Compose与edge artifacts匹配accepted contract；built SPA root、deep route、asset与API-only miss通过in-process smoke；API liveness/readiness成功及fail-closed通过；Worker readiness publish、probe与cleanup通过；临时文件无残留；生产依赖audit保持critical/high为零；仓库标准完整验证通过
- Prohibited changes：产品业务语义、API或database contract、认证或权限语义、Router行为、V5至V8 retained evidence、V9、真实config、snapshot、keys、credentials、Docker daemon、database、Dify、飞书、外部或独立网络服务、目标服务器、UAT、deployment、switch、retry或cutover
- Required verification：strict TDD RED/GREEN、focused deployment tests、fresh synthetic smoke、Web build、API/Worker focused tests、production dependency audit、lint、typecheck、repository verify、project source、scope audit与post-merge verification
- Escalation conditions：任一Critical、Important、阻塞finding、production critical/high、真实输入或外部runtime需求、custody conflict、Gate语义扩张、证据冲突、临时资源残留或验证维度缺失必须停止并保持`BLOCKED`

## Accepted Protocol Boundary

1. Smoke只能读取Git跟踪的deployment与source artifacts，不读取`.env`、`.env.local`或其他真实配置文件
2. Web build必须显式设置`envDir: false`并输出到task-owned临时目录
3. API验证只能使用in-process synthetic request harness、synthetic config、fake OAuth与显式readiness probe，不创建真实database connection
4. Worker验证只能使用task-owned临时readiness marker与当前synthetic process identity
5. Smoke不得调用Docker、Compose、PostgreSQL、Dify、飞书、目标服务器或任何外部服务，不得启动独立监听服务
6. Smoke结束时必须销毁task-owned临时build与readiness artifacts
7. 任一smoke或审查finding均只形成accepted或blocked result checkpoint，不自动进入目标服务器演练

## Evidence

- `main`与`origin/main`fresh同步于`3524da696eaa9e599529d8353a1b9fd5be199bfa`
- `PROJECT.md` source version为`73`
- Baseline repository `verify`通过，deployment contract为`5/5 PASS`
- Fresh production audit为`0 critical / 0 high / 1 moderate / 1 low`
- Controller health fresh可运行，main仅有用户自有未跟踪目录
- Router production dependency与source import均为零
- Synthetic deployment smoke尚未创建或执行
- V9、V5至V8 custody与所有真实操作保持locked

## Accepted Result

解锁repository-only `PHASE5-DEPLOYMENT-READINESS-SYNTHETIC-SMOKE`与strict TDD验证

目标服务器演练、UAT、Deployment Gate、正式部署、切换与cutover继续locked
