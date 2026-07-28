---
checkpoint_id: CP-20260728-PHASE5-DEPLOYMENT-READINESS-TARGET-SERVER-REHEARSAL-DISPOSITION-ACCEPTED
task_id: PHASE5-DEPLOYMENT-READINESS-TARGET-SERVER-REHEARSAL-CONTRACT
status: accepted
recorded_at: 2026-07-28T10:56:11+08:00
branch: codex/phase5-target-server-rehearsal-disposition-accepted
base_commit: 9a39849cf91e7b0ad76e3dd9474b02fcef69dccb
head_commit: 9a39849cf91e7b0ad76e3dd9474b02fcef69dccb
supersedes: CP-20260728-PHASE5-DEPLOYMENT-READINESS-SYNTHETIC-SMOKE-ACCEPTED
---

# Phase 5 Deployment Readiness Target-Server Rehearsal Disposition Accepted

## Scope

接受`GATE-PHASE5-DEPLOYMENT-READINESS-TARGET-SERVER-REHEARSAL-DISPOSITION`，只解锁一个repository-only的target-server rehearsal contract准备任务

本checkpoint不接受或复用2026-07-24的blocked rehearsal execution授权，不批准当前controller Mac或任何未明确识别的设备作为target，不授权读取真实输入、连接目标服务器或执行演练

## User Confirmation

用户于`2026-07-28`明确回复

`接受 GATE-PHASE5-DEPLOYMENT-READINESS-TARGET-SERVER-REHEARSAL-DISPOSITION`

该确认只授权审查既有blocked历史、定义新的有界contract并提交新的named execution Gate供后续决策

## Historical Disposition

- 既有target-server rehearsal在migration CLI与capacity suite执行前因private path进入ordinary controller output而hard-stop
- 旧run的keys、snapshot working copy、isolated runtime与private working evidence已按其accepted blocked checkpoint完成cleanup
- 旧Gate曾批准current controller Mac为target，该target decision不得被本任务继承
- 旧Gate、旧target identity、旧window、旧snapshot custody、旧key delivery、旧private paths与旧execution evidence均不构成新演练授权或输入
- 新contract必须以当前repository baseline与fresh target identity为起点，不能把旧review启动状态、cleanup结果或blocked execution推断为新execution verdict

## Task Contract

- Task ID：`PHASE5-DEPLOYMENT-READINESS-TARGET-SERVER-REHEARSAL-CONTRACT`
- Core allowed modules：`docs/project/checkpoints`内既有deployment readiness、rehearsal、migration、capacity与custody记录的只读审查，以及一个新的rehearsal execution Gate contract checkpoint
- Mechanical adjacent scope：`docs/project/PROJECT.md`的current state、active work、pending feedback、next Gate与evidence index更新
- Base commit：`9a39849cf91e7b0ad76e3dd9474b02fcef69dccb`
- Success criteria：新contract必须绑定fresh target identity reference、Owner、Approver、window、network isolation、server profile、snapshot/key/artifact custody、exact execution boundary、private output protocol、hard stops、cleanup、五维fresh absence、review roles与result Gate；不得包含private values或把contract准备表述为execution approval
- Prohibited changes：application code、deployment artifacts、dependencies、thresholds、migration semantics、database schema、auth或permission语义、真实config、snapshot、keys、credentials、private pointer、Docker daemon、database、目标服务器、Dify、飞书、UAT、Deployment Gate、正式部署、切换、cutover、V9、V5至V8 retained evidence或synthetic attempt
- Required verification：fresh project source与main/origin状态、controller health、旧blocked contract边界矩阵、new contract完整性与非授权性审查、`npm run test:project-source`、`npm run project:check`、scope audit及post-merge verification
- Escalation conditions：target identity、Owner、Approver、window、isolation、custody、cleanup或review任一无法精确定义；需要读取真实输入或连接外部runtime；snapshot retention冲突；Critical、Important、阻塞finding；V5至V8 custody冲突；证据冲突或验证维度缺失时立即保持locked并停止提交execution Gate

## Required New Contract Boundary

1. Target必须以非敏感asset reference明确识别，真实hostname、address、credential与private paths只允许进入独立private evidence
2. Contract必须明确target不是因本checkpoint而获批，target identity与execution授权必须由新的named Gate单独接受
3. Contract必须在任何真实输入读取、credential请求、network connection、Docker或database access之前定义完整preflight与hard-stop顺序
4. 所有stdout、stderr、diagnostic、manifest、report、audit与cleanup evidence必须使用no-disclosure、no-clobber、owner-bound private protocol
5. Contract必须分别定义process、file、key、local TCP与task-owned runtime五维cleanup及fresh absence证据
6. Migration rehearsal与synthetic capacity rehearsal必须保持隔离，不能将旧run artifact、旧database、旧keys或旧samples作为新证据
7. 任一preflight失败、private output泄露、identity mismatch、custody conflict或cleanup维度缺失必须fail closed，不能自动修复、补跑或降低阈值
8. 新contract完成后只能提交`GATE-PHASE5-DEPLOYMENT-READINESS-TARGET-SERVER-REHEARSAL-EXECUTION`供用户决策，不能自动执行

## Evidence

- `PROJECT.md` source version在本checkpoint创建前为`75`
- `main`与`origin/main`在本checkpoint创建前fresh同步于`9a39849cf91e7b0ad76e3dd9474b02fcef69dccb`
- Latest accepted checkpoint为`CP-20260728-PHASE5-DEPLOYMENT-READINESS-SYNTHETIC-SMOKE-ACCEPTED`
- Synthetic deployment smoke为`9/9 PASS`，但未验证真实target、Docker daemon、database、credentials、Dify或飞书
- Controller health fresh可运行，main只包含用户自有未跟踪目录
- 当前时间早于V5 hard custody deadline，V5至V8 retained evidence与顺序cleanup保持不变
- 本Gate未读取或修改真实config、snapshot、keys、credentials、private pointer、V5至V8 retained evidence或外部环境

## Still Locked

- 真实target identity、hostname、address、credentials与private paths的读取或记录
- 真实config、snapshot、keys、Keychain、plaintext或production data访问
- 目标服务器连接、Docker daemon、Compose、PostgreSQL、migration、capacity execution或任何真实rehearsal
- Dify、飞书UAT、Deployment Gate、正式部署、traffic switch与cutover
- V9与V5至V8 retained evidence mutation、提前cleanup或synthetic attempt补跑

## Accepted Result

解锁repository-only `PHASE5-DEPLOYMENT-READINESS-TARGET-SERVER-REHEARSAL-CONTRACT`准备任务

下一步只能形成并审查新的有界contract，再提交`GATE-PHASE5-DEPLOYMENT-READINESS-TARGET-SERVER-REHEARSAL-EXECUTION`供用户单独确认
