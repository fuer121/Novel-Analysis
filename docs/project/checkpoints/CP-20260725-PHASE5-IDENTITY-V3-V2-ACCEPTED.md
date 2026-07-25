---
checkpoint_id: CP-20260725-PHASE5-IDENTITY-V3-V2-ACCEPTED
task_id: PHASE5-REAL-RETRY-IDENTITY
status: accepted
recorded_at: 2026-07-25T15:45:00+08:00
branch: unassigned
base_commit: 26951ddfc5d8b048ebe421298168043fdf5b6925
head_commit: 26951ddfc5d8b048ebe421298168043fdf5b6925
supersedes: none
---

# Phase 5 Identity V3 V2 Accepted

## Scope

接受DEC-0026定义的container-owned anonymous storage、immutable container ID cleanup，以及V1质量审查四个finding与后续JSON sentinel、durable rollback finding的synthetic correction

本checkpoint只接受frozen execution identity，不授权真实retry或任何真实资源访问

## Actual Changes

- PostgreSQL storage不再创建named volume，migration与capacity container分别使用独立anonymous volume
- Container identity绑定immutable ID、expected name、role、fixed image、network、loopback port、ownership labels与anonymous mount
- Cleanup只按captured immutable container ID执行`docker rm --force --volumes`，禁止按container name或volume name删除
- Cleanup blocked时原子保留sanitized private BLOCKED claim与status
- Manifest、sidecar、provenance、report与final readback覆盖raw及有界JSON string escaping sentinel
- PASS与BLOCKED publication包含文件和目录fsync
- Failure rollback按status、final、run、staging顺序执行，每个remove后fsync parent，并以`rollback_incomplete`聚合错误报告未完成清理

## Prohibited Changes Audit

- 未访问Docker daemon、database、network、snapshot、key、Dify或飞书
- 未修改repository product code、migration、Schema、capacity、Gate或验收标准
- Config未新增resource name、credential、URL、port、command或cleanup target
- 未覆盖历史rejected candidate或接受其SHA

## Frozen Identity

| Member | SHA-256 |
| --- | --- |
| `bootstrap.pl` | `d83d2d905c84f039e435f736cbbbfd0f2481e2c273f08aecf48176641d798e6b` |
| `catalog.json` | `06eeae2b6a6f08217a4b9c678aa0d8d65cc2acd19775cb545ac1e156a9767f9f` |
| `catalog.sha256` | `279f3dff7efabefe9b68cb625470bbe8803391f8303abb98b9f8fa26c460fe4d` |
| `entry.mjs` | `e7e1779266a26a963a36ff0173c9f7a2cf4740d68f4b81d38f365337b8ee42e9` |
| `execution.json` | `5c7be5a0c71dd3b9f3f685b920f33f9628c29adba38d2df11979cb8246143a69` |
| `identity-lib.mjs` | `b3576e208d3e0ad8a01d5b83fb446bddaf8aec9eaa4c12f97618392d6c5b648f` |
| `resource-lifecycle.mjs` | `abde0e72dba5f45ebb9e2e6e18c2068f5adda6919e28de9d8d3d2024ad0afa80` |
| `wrapper.sh` | `37be3589b784902d9430faf8a8ea05a632e5a5db5efcb38a7f4f95e946fe758f` |

Candidate root为`0700`、8个成员均为`0600`、无symlink，catalog与review evidence detached digest已独立复算

## Verification By Role

| 角色 | 检查项 | 证据 | 结果 |
| --- | --- | --- | --- |
| 实现 Agent | RED/GREEN、focused tests、scope audit | V1四finding `5/5 RED`、V2 quality finding `2/2 RED`、rollback order `3/3 RED`、最终runner | `23/23 PASS` |
| 规格审查 | DEC-0026、sentinel、durability、rollback order、遗漏行为 | fresh runner、静态contract audit、SHA与scope复算 | `SPEC_APPROVED`，无Critical或Important finding |
| 质量审查 | ID replacement、mount、sentinel、fsync、multi-fault rollback、BLOCKED evidence | targeted reproduction、23项runner、canonical before/after SHA | `QUALITY_APPROVED`，无Critical或Important finding |
| 总控 | frozen bytes、权限、catalog与runner | 8文件SHA、`0700`/`0600`、parameterized runner | SHA匹配，`23/23 PASS` |

## Evidence

- Implementation scope相对V1只涉及`entry.mjs`、`identity-lib.mjs`、`resource-lifecycle.mjs`与catalog/digest
- Final rollback correction相对上一candidate只改变`entry.mjs`
- 11个rollback相关failure points覆盖publication与4个cleanup target的remove/fsync
- Full synthetic success、failure、manifest sentinel与lifecycle blocked retention均通过
- Repository clean且`HEAD == origin/main == 26951ddfc5d8b048ebe421298168043fdf5b6925`

## Residual Risks

- 真实Docker CLI schema、daemon行为、PostgreSQL readiness与真实filesystem掉电语义未验证，因为本任务明确禁止真实资源访问
- 这些残余风险只能在新的明确real retry Gate授权后使用已接受的exact bytes验证

## Accepted Result

接受Phase 5 identity v3 V2 frozen synthetic execution identity

真实Docker、database、snapshot、old key、Keychain、Dify、飞书、rehearsal、部署与切换继续locked
