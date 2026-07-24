---
checkpoint_id: CP-20260724-PHASE5-SYNTHETIC-E2E-CALIBRATION-BLOCKED
task_id: PHASE5-SYNTHETIC-E2E-CALIBRATION
status: accepted
recorded_at: 2026-07-24T15:03:36+08:00
branch: codex/phase5-preflight-correction-accepted
base_commit: 1bfc74c45a4cf194b2dd611af84356197b3be5db
head_commit: 1bfc74c45a4cf194b2dd611af84356197b3be5db
supersedes: none
---

# Phase 5 Synthetic E2E Calibration Blocked

## Scope

将preflight、synthetic fixture、一次性PostgreSQL初始化、真实migration CLI调用、现有capacity command调用、evidence原子发布与失败清理作为单一执行单元完成repository-external synthetic校准

本checkpoint不授权或执行真实retry，不访问production snapshot、old production key或Keychain，不推进Dify、Feishu UAT、deployment、traffic switch或cutover

## Evidence

- `main`与`origin/main`同步且clean，SHA为`1bfc74c45a4cf194b2dd611af84356197b3be5db`
- Active Work在校准前为`PHASE5-TARGET-SERVER-ISOLATED-REHEARSAL` blocked，依据为[retry containment blocker](CP-20260724-PHASE5-RETRY-CONTAINMENT-BLOCKED.md)
- 没有Phase 5 rehearsal、migration、capacity或PostgreSQL运行进程，也没有本轮container、volume或network残留
- Canonical production snapshot与v3 identity保持原custody，本轮未打开、hash、复制或修改
- Production snapshot最长保留至`2026-07-30T21:37:42+08:00`，或rehearsal完成、Gate拒绝、任务取消中的最早时间
- 中止的单点preflight correction临时candidate已清理并fresh absence verified

## Root Cause

此前执行链路把preflight、helper加载、数据库初始化、迁移、容量与证据发布分段验证，单点修正通过后即消耗真实retry，无法证明最终exact bytes可以完整执行同一运行单元

本轮将链路合并后验证出两个新的整体性缺口

- Exact launcher在10个场景完成后将`import.meta.url`字符串直接作为filesystem path读取，在post-run packaging阶段exit `1`
- Failure matrix未覆盖fixture generation failure与database initialization failure，不能证明任意阶段失败均被完整清理

## Synthetic Result

- 只使用synthetic snapshot、synthetic keys和一次性PostgreSQL
- 10个已定义场景全部达到预期exit与断言，包括containment、helper load、network/volume/container中间失败、readiness retry、migration failure、capacity failure、publication failure与success
- Success场景真实调用migration CLI与现有capacity command，browse/submit/status p95分别为`312.576ms`、`282.774ms`、`284.469ms`，priority检查通过
- Publication-failure场景前置capacity的browse/submit/status p95分别为`369.227ms`、`281.826ms`、`284.031ms`，priority检查通过
- 所有已执行场景ordinary stdout/stderr均为`0`字节，runtime value-aware sentinel scan通过
- 所有已执行场景cleanup与sanitized-only retention断言通过

## Fixed Byte Anchors

- Launcher SHA-256：`e6ab8bb2d5f2e511693178a42e84e30d7c27bb52d3d2160bf801427786290ddd`
- Wrapper SHA-256：`7135aa57bd2c215a850e156b4d8e73556e84b399815a88af63c24d407313cfc3`
- Helper SHA-256：`49fa0316e547866aba1c66a2f7e8d1161a85bd268053df24ab75c0780fc7502a`
- Matrix SHA-256：`215b232978776416ef223df6d9f129723cb704ab4af226c4028407f3813b2fa8`
- Sanitized evidence SHA-256：`6a002f57bd0524e53fdd24d83e33b766388e6c79e6c8d90c4fc0cd1aed22e521`
- Audit SHA-256：`62dda65547051a0aec3e25c8115920f5bcb39160030b54b5996be5da6526ea40`
- Catalog detached SHA-256：`9ffffc4fc0f1245451d93ecaadbce0218cd73ca6cd30abeb7e6f5ec2fa9c943e`

这些anchors只记录本次blocked evidence，不能作为真实retry的accepted execution identity

## Cleanup And Disclosure Evidence

- Synthetic snapshot、三份synthetic key与raw run artifacts已销毁
- 本轮container、volume、network与process fresh absence均为`0`
- Retained blocked review bundle为exact 8-file allowlist，目录`0700`、文件`0600`、均为non-symlink
- Bundle hash catalog与detached digest一致
- Retained content未命中private path literal、credential pattern或known key value
- Repository保持clean，Git未包含private path、key、credential、snapshot fingerprint或synthetic plaintext
- 未声称CI执行本repository-external calibration，真实CI与完整ordinary-log coverage仍未成立

## Independent Review

- Specification review：`SPEC_REVIEW_BLOCKED — EXACT LAUNCHER DID NOT COMPLETE AND REQUIRED FAILURE/LEAKAGE COVERAGE REMAINS INCOMPLETE — DO NOT AUTHORIZE REAL RETRY`
- Quality acceptance review：`NOT RUN`，规格审查存在未关闭Important findings，按审查顺序禁止启动

## Residual Risks And Blockers

- Exact launcher在post-run packaging阶段exit `1`，没有由自身完成audit、catalog、inventory与final verdict发布
- Fixture generation failure与database initialization failure未进入synthetic matrix
- Retained/repository scan由blocked run后的受控恢复审计完成，不是exact launcher成功输出
- CI只确认仓库未污染，不能替代repository-external执行单元的完整ordinary-log泄漏验证
- Production snapshot retention仍在计时，但本checkpoint不授权因临近deadline而放宽任何Gate

## Recommendation

`DO NOT AUTHORIZE REAL RETRY`

真实retry、production snapshot、old production key、Keychain、Feishu UAT、deployment与cutover继续locked

如后续恢复，必须先修复launcher URL-to-path处理，补齐fixture generation与database initialization failure场景，并以修复后的exact bytes重新完成一次完整synthetic E2E及独立spec、quality review

## Accepted Result

接受本次synthetic E2E calibration的blocked结果与`DO NOT AUTHORIZE REAL RETRY`建议，不接受当前launcher、wrapper或helper作为真实retry execution identity
