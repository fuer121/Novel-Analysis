---
checkpoint_id: CP-20260728-PHASE5-DEPLOYMENT-READINESS-ROUTER-SECURITY-CORRECTION-ACCEPTED
task_id: PHASE5-DEPLOYMENT-READINESS-ROUTER-SECURITY-CORRECTION
status: accepted
recorded_at: 2026-07-28T09:37:35+08:00
branch: codex/phase5-router-security-correction
base_commit: 8acdfdd4696e50a9d62e40a65e1ccfd3bf644e72
head_commit: 0cbbd4cc324ea930ec00ff61bf9885750a5f3bf0
supersedes: CP-20260728-PHASE5-DEPLOYMENT-READINESS-ROUTER-SECURITY-DISPOSITION-ACCEPTED
---

# Phase 5 Deployment Readiness Router Security Correction Accepted

## Scope

接受repository-only有界内部Web Router replacement、严格TDD、production dependency security closure与独立双审结果

本checkpoint不授权synthetic deployment smoke、Docker daemon、目标服务器演练、UAT、Deployment Gate、正式部署、切换或cutover

## Actual Changes

- 移除`react-router`与`react-router-dom`生产依赖及孤立传递依赖，未新增替代runtime dependency
- 新增单一Web内部`routing.tsx`，只实现当前调用面所需的browser/test memory history、absolute与relative navigation、replace、params、search params、nested outlet/context、active link与safe internal links
- `AppRouter`保持唯一顶层入口，并显式保持既有公开path与未知路由中文safe return
- 导航拒绝active scheme、authority target与外部origin，避免跨origin `pushState`及修饰键逃逸
- 路由与active link逐段安全解码并保持既有大小写不敏感语义，malformed encoding fail closed
- Book tab lookup只接受own properties，`__proto__`与`constructor`等未声明段返回safe unknown route

## Verification By Role

| 角色 | 检查项 | 结果 |
| --- | --- | --- |
| 实现 | Router dependency RED、完整route regression RED、malformed/popstate/unsafe target与review finding RED/GREEN | 最终Web `7 files / 73 tests PASS` |
| 规格审查 | 公开path、导航、鉴权return-to、params、search、outlet、active link、history、依赖与scope矩阵 | Critical、Important、Minor均为零，`reviewVerdict: passed` |
| 质量审查 | active scheme、encoded/case path、prototype tab、active link与异常路径复现 | 两轮finding全部关闭，最终无可执行regression |
| 总控 | Web build/typecheck、repository verify、implementation verify、production audit、project source与scope | PASS |

## Evidence

- Web focused与full tests为`73/73 PASS`
- Web production build与Web typecheck exit `0`
- Repository verify exit `0`，legacy `112/112`、contracts `41/41`、new `443 passed / 1 skipped`、Dify manifest `1/1`、project-source `42/42`
- `npm run verify:implementation`的repository lint与完整Phase 1 typecheck exit `0`
- Production audit为`0 critical / 0 high / 1 moderate / 1 low`
- `npm ls react-router react-router-dom --omit=dev --all`为空，production Router source import为零
- Final diff为22 files，全部属于Web routing、直接consumer/tests、Web manifest与root lockfile的accepted scope
- `git diff --check`通过，implementation HEAD工作树clean

## Review Finding Closure

- `blob:`同origin表象与synthetic internal origin/authority target已在解析前拒绝
- 合法百分号编码与大小写不敏感static path matching已恢复
- `bookTabs` inherited property lookup已改为own-property检查
- decoded与大小写不敏感active-link matching已恢复
- 每项finding均先由targeted RED复现，再完成GREEN与Web full regression

## Prohibited Changes Audit

- 未新增外部Router dependency、audit ignore、override或隐藏runtime dependency
- 未改变公开path、API contract、database contract、权限语义、Gate顺序或验收标准
- 未读取或修改V4至V8 retained evidence、真实config、snapshot、keys、Keychain或credential
- 未连接Docker daemon、PostgreSQL、Dify、飞书、目标服务器或部署环境
- 未执行synthetic deployment smoke、真实diagnostic、retry、UAT、deployment、traffic switch或cutover

## Residual Risk

- Production audit仍有一个moderate与一个low transitive finding，不违反本Gate的critical/high归零标准
- Router replacement只覆盖当前调用面，不是通用Router框架
- Synthetic deployment smoke及后续deployment readiness仍需按原Gate顺序单独恢复

## Accepted Result

`PHASE5-DEPLOYMENT-READINESS-ROUTER-SECURITY-CORRECTION`通过strict TDD、production security closure、独立双审与总控完整验证

下一步只允许提交named synthetic deployment smoke resume Gate供用户决策，不得自动执行synthetic smoke、目标服务器演练、UAT、Deployment Gate、真实部署或切换
