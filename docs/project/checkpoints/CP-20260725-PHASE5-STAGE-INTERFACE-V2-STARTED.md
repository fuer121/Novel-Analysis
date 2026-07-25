---
checkpoint_id: CP-20260725-PHASE5-STAGE-INTERFACE-V2-STARTED
task_id: PHASE5-STAGE-INTERFACE-V2
status: accepted
recorded_at: 2026-07-25T08:40:56+08:00
branch: codex/phase5-stage-interface-v2
base_commit: 1a46d275285d24d4aa76ec25b1290b0a59c20e80
head_commit: 1a46d275285d24d4aa76ec25b1290b0a59c20e80
supersedes: none
---

# Phase 5 Stage Interface V2 Started

## Scope

实施[DEC-0023 Phase 5 Stage Verified Input And Resource Binding](../decisions/DEC-0023-phase5-stage-verified-input-resource-binding.md)，关闭identity v2发现的path reopen与resource binding根因

## Task Contract

- Task ID：`PHASE5-STAGE-INTERFACE-V2`
- Core allowed modules：`scripts/phase5-rehearsal-stage/**`
- Mechanical adjacent scope：`packages/migration/src/**`内直接需要的verified-input入口、对应直接测试、root package scripts、类型与既有export、artifact build与SHA checker
- Base commit：`1a46d275285d24d4aa76ec25b1290b0a59c20e80`
- Required input custody：request、database URL、migration source与keys通过inherited descriptor或verified bytes消费，不允许path check后重新open
- Required SQLite bridge：若SQLite必须使用path，只允许从verified bytes创建stage-owned private write-once working copy，使用后清理，不接受`/dev/fd/N`绕过检查
- Required resource binding：migration与capacity request携带非secret opaque resource ID，result原样绑定expected ID，mismatch fail closed
- Required preservation：migration、Schema、8项validation、capacity dataset、browse `<500ms`、submit `<1000ms`、status `<2000ms`与两项priority语义不变
- Required artifact：仍为一个可复现Node ESM artifact，生成新的SHA-256并重新完成closure检查
- Required verification：RED/GREEN focused tests、descriptor custody与path swap negative tests、resource match/mismatch、working copy cleanup、source/artifact对齐、fresh build byte equality、closure scan、lint、typecheck、scope audit、独立spec与quality review、controller full verify与CI
- Escalation：需要新dependency、新数据对象或Schema；需要改变migration、capacity或Gate语义；无法在stage-owned custody内支持SQLite；需要真实snapshot、key、database、Docker、network、Dify、飞书、deployment或cutover

## Prohibited Changes

- 放宽same-descriptor verified-use、resource-match、Gate顺序或验收标准
- 新dependency、table、migration、Schema、产品API、认证或权限能力
- 修改migration选择、事务语义、8项validation、capacity threshold或priority contract
- 通过禁用symlink检查、信任parent path或传递`/dev/fd/N`替代verified bytes custody
- Production snapshot、old key、Keychain、真实database、Docker、Dify、飞书、UAT、deployment、traffic switch或cutover
- 修改或删除既有accepted checkpoint与decision

## Evidence

- 用户明确选择Option `A1`
- [DEC-0023](../decisions/DEC-0023-phase5-stage-verified-input-resource-binding.md)固定verified input与resource binding安全边界
- 当前main与origin/main同步且clean，SHA为`1a46d275285d24d4aa76ec25b1290b0a59c20e80`
- 旧identity candidate未freeze且继续invalid
- 本checkpoint未读取真实输入或创建真实资源

## Accepted Result

解锁`PHASE5-STAGE-INTERFACE-V2`的synthetic implementation、artifact重建与双审

Real retry identity重建、Execution confirmation与真实执行继续locked
