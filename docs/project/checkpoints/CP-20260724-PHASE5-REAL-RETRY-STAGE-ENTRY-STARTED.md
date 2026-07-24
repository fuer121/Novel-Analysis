---
checkpoint_id: CP-20260724-PHASE5-REAL-RETRY-STAGE-ENTRY-STARTED
task_id: PHASE5-REAL-RETRY-STAGE-ENTRY
status: accepted
recorded_at: 2026-07-24T23:55:34+08:00
branch: codex/phase5-real-retry-stage-entry
base_commit: d6d9d9d6bebe63e0aac361ab0a75b4e048949de6
head_commit: d6d9d9d6bebe63e0aac361ab0a75b4e048949de6
supersedes: none
---

# Phase 5 Real Retry Stage Entry Started

## Scope

实施[DEC-0022 Phase 5 Single Artifact Rehearsal Stage](../decisions/DEC-0022-phase5-single-artifact-rehearsal-stage.md)，为real retry建立可直接执行、可冻结bytes且不依赖runtime compiler与node_modules的单一Node ESM artifact

## Task Contract

- Task ID：`PHASE5-REAL-RETRY-STAGE-ENTRY`
- Core allowed modules：`scripts/phase5-rehearsal-stage/**`的source entry、build config与committed artifact
- Mechanical adjacent scope：root package scripts、直接contract tests、artifact reproducibility与SHA checker、必要类型与既有module export
- Base commit：`d6d9d9d6bebe63e0aac361ab0a75b4e048949de6`
- Required execution：artifact提供固定database initialization、migration、8项hard validation与capacity stage mode，拒绝unknown mode与unknown argument
- Required closure：runtime只使用system Node、artifact与显式private input/output，不调用npm、tsc、Vite、Vitest或repository node_modules，不按repository path动态import
- Required behavior：复用现有migration、validation与capacity contract，保持browse `<500ms`、submit `<1000ms`、status `<2000ms`及两项priority为true
- Required build：使用现有toolchain生成单一Node ESM artifact，committed artifact与fresh build逐byte一致
- Required security：不接受inline key，错误输出使用sanitized code，不在ordinary output保留key、credential、snapshot fingerprint、database URL、private path或plaintext
- Required verification：先RED后GREEN，source/artifact contract、fresh build byte equality、runtime dependency scan、synthetic stub modes、unknown input fail-closed、lint、typecheck、scope audit、独立spec与quality review、controller full verify与CI
- Escalation：需要新依赖、新table或migration；需要改变migration、Schema、capacity dataset/threshold/priority；artifact无法成为单文件runtime closure；需要真实snapshot、key、database、Docker、Dify、飞书、deployment或Gate变化

## Prohibited Changes

- 新外部依赖、新table、migration或Schema变化
- Migration选择、8项validation、capacity threshold与priority contract变化
- 通用deployment framework、新产品API、认证或权限能力
- Production snapshot、old key、Keychain、真实database、Docker、Dify、飞书、UAT、deployment、traffic switch或cutover
- 修改或删除既有accepted checkpoint

## Evidence

- 用户明确选择质量blocked checkpoint中的Option A
- [DEC-0022](../decisions/DEC-0022-phase5-single-artifact-rehearsal-stage.md)固定单一artifact执行闭包
- 当前main与origin/main同步且clean，SHA为`d6d9d9d6bebe63e0aac361ab0a75b4e048949de6`
- 本checkpoint未读取真实输入或创建真实资源

## Accepted Result

解锁`PHASE5-REAL-RETRY-STAGE-ENTRY`的无真实输入实现与双审

Real retry identity correction、Execution confirmation与真实执行继续locked
