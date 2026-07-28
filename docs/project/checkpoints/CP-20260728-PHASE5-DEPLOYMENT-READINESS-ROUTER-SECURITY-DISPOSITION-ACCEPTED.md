---
checkpoint_id: CP-20260728-PHASE5-DEPLOYMENT-READINESS-ROUTER-SECURITY-DISPOSITION-ACCEPTED
task_id: PHASE5-DEPLOYMENT-READINESS-ROUTER-SECURITY-CORRECTION
status: accepted
recorded_at: 2026-07-28T08:24:22+08:00
branch: codex/phase5-router-security-gate-accepted
base_commit: 1bca248f3767acb0dc9868d93ce9059f51f41a10
head_commit: 1bca248f3767acb0dc9868d93ce9059f51f41a10
supersedes: CP-20260728-PHASE5-DEPLOYMENT-READINESS-CORRECTION-BLOCKED
---

# Phase 5 Deployment Readiness Router Security Disposition Accepted

## Scope

接受`GATE-PHASE5-DEPLOYMENT-READINESS-ROUTER-SECURITY-DISPOSITION`并选择有界Router replacement，解锁一个repository-only内部Web routing correction

本checkpoint不接受当前deployment-readiness correction为通过，不授权synthetic deployment smoke、Docker daemon、目标服务器演练、UAT、Deployment Gate、正式部署、切换或cutover

## User Confirmation

用户于`2026-07-28`明确回复

`接受 GATE-PHASE5-DEPLOYMENT-READINESS-ROUTER-SECURITY-DISPOSITION，选择有界 Router replacement`

该确认只授权下述内部Router replacement、strict TDD、依赖安全验证、独立审查与result checkpoint

## Task Contract

- Task ID：`PHASE5-DEPLOYMENT-READINESS-ROUTER-SECURITY-CORRECTION`
- Core allowed modules：`apps/web/src/app`内部routing module、当前直接导入`react-router-dom`的Web组件与路由测试、`apps/web/package.json`、root lockfile
- Mechanical adjacent scope：当前路由focused tests、Web workspace test script、TypeScript类型与既有`AppRouter` runtime wiring
- Base commit：`1bca248f3767acb0dc9868d93ce9059f51f41a10`
- Success criteria：移除`react-router`与`react-router-dom`生产依赖且不新增替代runtime dependency；保持现有公开path、未知路由safe return、鉴权return-to、absolute与relative navigation、replace、params、search params、nested outlet/context、active link与test-only memory history语义；production critical/high依赖审计为零；focused Web tests、Web build、Web typecheck、repository verify与scope audit通过
- Prohibited changes：新增外部Router dependency、改变公开path或用户可见导航语义、API或database contract修改、V4至V8 evidence读取或mutation、V9、真实config、snapshot、keys、Docker daemon、database、Dify、飞书、目标服务器、UAT、部署、切换、retry、synthetic deployment smoke、自动Deployment Gate或cutover
- Required verification：每个新增routing行为先运行RED再实施GREEN；现有route matrix、navigation、auth redirect、relative tab、params、search params、outlet context、unknown route、browser history与memory history focused tests；Web full tests、build、typecheck、production audit、repository verify、lint、scope audit与post-merge verification
- Escalation conditions：任一公开路由或navigation语义无法在有界内部module中保持、需要新runtime dependency、Critical、Important、生产critical/high finding、V4至V8 custody冲突、真实输入或外部runtime需求、证据冲突或验证维度缺失必须停止并保持BLOCKED

## Accepted Protocol Boundary

1. Replacement必须位于Web内部，不得引入新的production routing package或借由devDependency隐藏runtime dependency
2. `AppRouter`继续是唯一顶层routing入口，并同时支持真实browser history与测试`initialEntries`
3. 现有`/login`、`/auth/complete`、`/books`、`/books/:bookId/*`、`/tasks`、`/tasks/:id`与`/admin/members`路径必须保持
4. 未知路径继续显示中文safe return，不得重定向或暴露内部错误
5. 鉴权过期replace、safe return-to、书籍relative tab、query与analysis search params、nested outlet context及active link行为必须保持
6. 内部routing API只实现当前调用面，不建立通用Router框架或新增未使用能力
7. 移除依赖后必须fresh证明production critical/high audit为零，不能使用audit ignore、override或隐藏dependency
8. Router correction通过后只能提交独立result checkpoint；synthetic deployment smoke与后续deployment readiness工作仍按原Gate顺序推进

## Evidence

- `PROJECT.md` source version为`70`
- `main`与`origin/main`在Gate创建前fresh同步于`1bca248f3767acb0dc9868d93ce9059f51f41a10`
- `npm run test:project-source`为`42/42 PASS`且`npm run project:check`通过
- Controller health fresh可运行，main只包含用户自有未跟踪目录
- Fresh production audit仍为`0 critical / 2 high`，两项high只来自`react-router`与`react-router-dom`
- 当前Web调用面只需要既有path matching、navigation、params、search params、nested outlet/context、active link与browser/memory history
- 本Gate未修改application code、dependency manifest或lockfile
- 本Gate未读取或修改V4至V8 retained evidence，未访问真实输入、Docker、database、Dify、飞书、目标服务器或部署环境

## Accepted Result

解锁repository-only `PHASE5-DEPLOYMENT-READINESS-ROUTER-SECURITY-CORRECTION`与strict TDD验证

V9、synthetic deployment smoke、真实config、snapshot、keys、Docker daemon、database、真实diagnostic或retry、Dify、飞书UAT、目标服务器演练、部署与切换继续locked
