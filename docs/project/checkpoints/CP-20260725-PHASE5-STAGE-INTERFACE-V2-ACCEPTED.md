---
checkpoint_id: CP-20260725-PHASE5-STAGE-INTERFACE-V2-ACCEPTED
task_id: PHASE5-STAGE-INTERFACE-V2
status: accepted
recorded_at: 2026-07-25T09:19:47+08:00
branch: codex/phase5-stage-interface-v2
base_commit: 4fc2472d0e7e89d733a5d7b16f9e41da4b69c2fb
head_commit: ae43a56416058b4e4109fdaf0bef66215694ce9a
supersedes: none
---

# Phase 5 Stage Interface V2 Accepted

## Scope

- Core modules：`scripts/phase5-rehearsal-stage/**`
- Mechanical adjacent scope：`packages/migration/src/**`最小verified-input入口与直接测试
- Required behavior：通过inherited descriptor或verified bytes消费敏感input，在stage custody内建立SQLite working copy，并绑定migration/capacity opaque resource ID

## Prohibited Changes Audit

- 未新增dependency、table、migration、Schema、产品API、认证或权限语义
- 未放宽same-descriptor verified-use、resource-match、Gate顺序或验收标准
- 未改变migration选择、事务、8项validation、capacity dataset、threshold或priority contract
- 未使用`/dev/fd/N`、parent path trust或禁用symlink检查替代verified bytes custody
- 未访问production snapshot、old key、Keychain、真实database、Docker、network、Dify、飞书、UAT、deployment或cutover
- 未修改任何既有accepted checkpoint或decision

## Actual Changes

- Stage v2只接受`--request-fd`，request、database URL、migration source与三个key均从inherited descriptor读取bytes
- SQLite source bytes写入stage-owned `0700` temporary directory中的exclusive `0600` working copy，write后fsync，成功与失败均在`finally`清理
- Migration package新增最小`runMigrationFromVerifiedInput`入口，既有CLI继续读取原file inputs后委托该入口
- Migration与capacity request要求`rid_`格式opaque resource ID，成功和失败result都绑定request expected ID，mismatch fail closed且不采用operation返回的错误ID
- Result schema升级为`phase5-rehearsal-stage-result-v2`
- 单一Node ESM artifact重新构建，新SHA-256为`acedef876bc35821ac0e708660d3ddc1d373d30eb97dc15fdc9846f863cc71d5`

## Verification By Role

| 角色 | 检查项 | 命令或证据 | 结果 |
| --- | --- | --- | --- |
| 实现 Agent | RED/GREEN、descriptor custody、resource binding、cleanup、artifact、lint、scope | Stage focused、migration focused、`npm run test:contracts`、`npm run phase5:stage:check`、`npm run lint`、`git diff --check` | GREEN；stage 9/9、migration 11/11、contracts 41/41 |
| 规格审查 | 契约矩阵、focused tests、失败result resource ID correction | 独立base-to-head review与focused reproduction | `SPEC_APPROVED`，原1个Important已修复并复审关闭 |
| 质量审查 | descriptor/path swap、cleanup、error path、atomic publish、artifact closure | 独立targeted reproduction、stage 9/9、artifact 7/7、migration 11/11、lint与source check | `QUALITY_APPROVED`，无Critical、Important或阻塞finding |
| 总控 | 完整new、legacy、contracts、Workflow、project source及A1 focused | `npm run verify`、stage focused、migration focused、artifact/closure checks | PASS；legacy 112/112，new 416 passed/1 skipped，contracts 41/41，project source 42/42 |

## Evidence

- Implementation commits：`8517d9a5eb7ac4f91b7aae26a17933a8dc07722b`、`ae43a56416058b4e4109fdaf0bef66215694ce9a`
- Artifact SHA-256：`acedef876bc35821ac0e708660d3ddc1d373d30eb97dc15fdc9846f863cc71d5`
- 独立规格审查：`SPEC_APPROVED`
- 独立质量审查：`QUALITY_APPROVED`
- 总控完整`npm run verify`与A1 focused verification均exit `0`

## Scope Deviations

无

## Escalations

规格初审发现失败result缺失expected resource ID，已由implementer补齐operation failure与resource mismatch测试并修复，规格复审批准

## Risks And Blockers

- Resource ID是否由secret派生只能由后续launcher生成规则保证，stage只校验opaque shape并原样绑定
- SQLite working copy需要把完整snapshot读入memory，真实资源占用仍需后续受控rehearsal验证
- Migration package的database-backed integration tests需要`TEST_DATABASE_URL`，本任务禁止创建或访问真实database，因此未运行
- Migration workspace全量typecheck仍受既有`phase5-preflight.mjs` declaration缺失影响；stage strict typecheck与仓库标准typecheck均通过

## User Feedback

用户明确选择A1，要求保持Gate安全强度并修正stage interface

## Decisions Required

无

## Recommended Next Action

创建实现PR并核验CI，合并后执行post-merge verification与merged checkpoint，再决定是否重新启动无真实输入的identity candidate

## Acceptance Request

总控已核验并接受`PHASE5-STAGE-INTERFACE-V2`实现与artifact SHA `acedef876bc35821ac0e708660d3ddc1d373d30eb97dc15fdc9846f863cc71d5`

本接受不构成Real retry Execution confirmation，不解锁真实input或真实rehearsal

## Accepted Result

接受A1 stage interface v2实现、独立双审与新artifact SHA

只解锁implementation PR合并与post-merge verification，真实input和real retry继续locked
