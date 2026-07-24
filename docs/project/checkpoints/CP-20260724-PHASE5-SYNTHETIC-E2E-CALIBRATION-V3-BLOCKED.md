---
checkpoint_id: CP-20260724-PHASE5-SYNTHETIC-E2E-CALIBRATION-V3-BLOCKED
task_id: PHASE5-SYNTHETIC-E2E-CALIBRATION
status: accepted
recorded_at: 2026-07-24T15:29:49+08:00
branch: codex/phase5-synthetic-calibration-v3-blocked
base_commit: 0d998e3be341376ea86d665fd15e2ceadbc9526b
head_commit: 0d998e3be341376ea86d665fd15e2ceadbc9526b
supersedes: none
---

# Phase 5 Synthetic E2E Calibration V3 Blocked

## Scope

修复repository-external exact launcher的URL-to-path错误，补齐fixture generation与database initialization两个失败场景，并以修复后的exact bytes执行唯一一次fresh synthetic E2E

本checkpoint不授权或执行真实retry，不访问production snapshot、old production key或Keychain，不推进Dify、Feishu UAT、deployment、traffic switch或cutover

## Evidence

- Base `main`与`origin/main`同步且clean，SHA为`0d998e3be341376ea86d665fd15e2ceadbc9526b`
- 前序blocked基线为[Phase 5 synthetic E2E calibration blocked](CP-20260724-PHASE5-SYNTHETIC-E2E-CALIBRATION-BLOCKED.md)
- Contract RED tests先证明launcher未使用`fileURLToPath`且两个失败场景缺失，修复后2/2 GREEN
- Node与POSIX shell语法检查通过
- 唯一fresh run的launcher总exit为`1`，外层ordinary stdout/stderr均为`0`字节，未自动重跑
- Exact 8-file bundle为`0700`目录、`0600`文件、全部non-symlink
- Catalog与detached digest一致，detached SHA-256为`d8bde2f88ea3d508d62b2489455923f9e57b06c805d890abe73a87f63c75aa3a`

## Fix Result

- Launcher使用`fileURLToPath(import.meta.url)`解析自身路径，post-run packaging URL错误已关闭
- Fixture generation failure真实调用helper的无效mode，映射为exit `71`
- Database initialization failure真实调用不可达PostgreSQL URL上的`db:migrate`，映射为exit `77`
- 两个新增场景均通过expected exit、status attribution、zero ordinary output、value-aware scan与cleanup断言
- 12个场景全部执行，11个达到预期

## Synthetic E2E Result

- Containment、helper load、fixture generation、network/volume/container中间失败、readiness retry、database initialization、migration、capacity注入失败与publication冲突场景均通过
- Readiness retry执行3次后进入预期hard stop
- 真实repository migration CLI已调用并通过
- 真实现有capacity command已调用
- Publication-failure场景前置browse p95为`358.516ms`且capacity通过
- Success场景browse p95为`566.322ms`，违反accepted严格`<500ms`阈值，因而在capacity阶段exit `80`
- Success场景未进入atomic publication，`synthetic-evidence.json`为`null`
- 所有场景ordinary stdout/stderr均为`0`字节，runtime value-aware scans通过

## Fixed Byte Anchors

- Launcher SHA-256：`8a930032f067d09a071ddd0843681c5408a170dfff242bb684f10390b1937bf2`
- Wrapper SHA-256：`2d198506121f0625e2a35a662302257e152c0dd550e43cc9fd57125ca57dc7bd`
- Helper SHA-256：`49fa0316e547866aba1c66a2f7e8d1161a85bd268053df24ab75c0780fc7502a`
- Matrix SHA-256：`2d756ad7cb9944d50b154382e63ff79aeb4b1efceae127f2504beddc1830d4d6`
- Synthetic evidence SHA-256：`38e0b9de817f645c4bec37c0d4a3e58baecccb040f5718dc069a72c7385a0bed`
- Audit SHA-256：`d403e8aa1dc4939419e8a5b5e0da185939cd7cf92fb96c7fcc24cd690362be57`
- Catalog detached SHA-256：`d8bde2f88ea3d508d62b2489455923f9e57b06c805d890abe73a87f63c75aa3a`

这些anchors只记录本次blocked evidence，不能作为真实retry的accepted execution identity

## Cleanup And Disclosure Evidence

- Synthetic snapshot、synthetic keys、raw run artifacts与外层process sinks均已销毁
- 本轮container、volume、network、process与run artifacts fresh absence均为`0`
- Bundle retained sentinel matches为`0`，known key matches为`0`
- Repository保持clean，本轮没有写入private path、key、credential、snapshot fingerprint或synthetic plaintext
- Repository sentinel count为`1`，独立归因到base commit已存在的`README.md`绝对仓库路径，不是本轮新增泄漏
- 当前launcher未区分既有非密钥路径基线，因此即使容量通过仍会因该match fail-closed
- 未声称CI执行repository-external calibration

## Independent Review

- Specification review：`SPEC_REVIEW_BLOCKED — CAPACITY THRESHOLD FAILED, SUCCESS EVIDENCE WAS NOT PUBLISHED, AND BASELINE SENTINEL POLICY CANNOT PASS — DO NOT AUTHORIZE REAL RETRY`
- Quality acceptance review：`NOT RUN`，规格审查存在未关闭Important findings，按审查顺序禁止启动

## Residual Risks And Blockers

- Success browse p95超过accepted硬阈值，不能用publication-failure场景的较低结果替代
- V3 exact bytes没有完成成功atomic publication与evidence retention
- Repository path sentinel策略把base commit中既有README路径计为污染，无法在当前基线上产生成功verdict
- Production snapshot最长保留至`2026-07-30T21:37:42+08:00`，但不得因临近deadline放宽任何Gate

## Recommendation

`DO NOT AUTHORIZE REAL RETRY`

真实retry、production snapshot、old production key、Keychain、Feishu UAT、deployment与cutover继续locked

后续恢复必须先把repository leakage scan改为相对base commit检测新增泄漏，同时保持key、credential、snapshot fingerprint为绝对零容忍，再在稳定idle环境用新的exact bytes完成一次全量synthetic E2E、成功原子发布及独立spec与quality review

## Accepted Result

接受本次V3 synthetic E2E的blocked结果与`DO NOT AUTHORIZE REAL RETRY`建议，不接受当前launcher、wrapper或helper作为真实retry execution identity
