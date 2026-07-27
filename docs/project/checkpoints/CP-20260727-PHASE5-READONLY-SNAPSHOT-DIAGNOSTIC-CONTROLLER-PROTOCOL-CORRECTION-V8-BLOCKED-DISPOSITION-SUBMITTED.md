---
checkpoint_id: CP-20260727-PHASE5-READONLY-SNAPSHOT-DIAGNOSTIC-CONTROLLER-PROTOCOL-CORRECTION-V8-BLOCKED-DISPOSITION-SUBMITTED
task_id: PHASE5-READONLY-SNAPSHOT-DIAGNOSTIC-CONTROLLER-PROTOCOL-CORRECTION-V8-BLOCKED-DISPOSITION
status: submitted
recorded_at: 2026-07-27T19:11:18+08:00
branch: codex/phase5-readonly-snapshot-diagnostic-protocol-v9-gate-submitted
base_commit: b6109b743878eab6b0a217c3ba55aa1212ae5b41
head_commit: b6109b743878eab6b0a217c3ba55aa1212ae5b41
supersedes: none
---

# Phase 5 Read-Only Snapshot Diagnostic Controller Protocol Correction V8 Blocked Disposition Submitted

## Scope

提交controller protocol correction V8的blocked disposition，并请求用户决定是否解锁一个新的repository-external synthetic-only controller protocol correction V9

V9只允许关闭reviewer evidence-access eligibility、task-owned hermetic scratch与exact sealed bundle reproduction三个consolidated blocking finding

本checkpoint不接受V8 protocol，不授权提前清理V2至V8 retained evidence，不授权执行V9，不授权读取真实config、snapshot、old key或Keychain，不生成target keys，不连接Docker或database，不修改accepted candidate，也不授权真实diagnostic、UAT、部署、切换或retry

## Blocking Basis

- V8 factual blocked result已通过PR #245的`CI/verify`并合并
- PR #245 merge commit为`b6109b743878eab6b0a217c3ba55aa1212ae5b41`
- V8唯一synthetic attempt为exit `0`且三项raw exact-zero，但specification与quality pre-cleanup verdict均为failed
- Specification finding为1个Critical：独立review process无法读取required governance与V8 evidence，全部contract dimension未核验
- Quality findings为2个Important：frozen tests写correction root导致read-only reproduction以`EPERM`失败；V8 dependency test只复制4个成员而未复现exact sealed bundle
- V8 raw custody保持完整，cleanup四项pending，deadline为`2026-07-28T18:50:17.350+08:00`
- V2至V8 cleanup continuity heartbeat保持原始V2 schedule并已追加V8 deadline handoff

## Proposed V9 Task Contract

- Task ID：`PHASE5-READONLY-SNAPSHOT-DIAGNOSTIC-CONTROLLER-PROTOCOL-CORRECTION-V9`
- Core allowed modules：new repository-external synthetic controller protocol V9、reviewer evidence-access preflight、task-owned hermetic scratch policy、exact sealed bundle reproduction与focused tests
- Mechanical adjacent scope：explicit correction-root/frozen-root/scratch-root separation、reviewer identity validation、read-only evidence probe、nested test-runner environment isolation、scratch cleanup proof、full frozen manifest enumeration、prepare/cleanup/register wrapper wiring与sanitized evidence schema
- Base commit：`b6109b743878eab6b0a217c3ba55aa1212ae5b41`
- Base identity：V8 blocked checkpoint、V8 frozen identity与attempt只读custody evidence；不得修改或补跑V2至V8 identity或attempt
- Success criteria：关闭1个Critical与2个Important finding，strict TDD与全部inherited regression通过，new V9 frozen identity能从exact sealed bundle使用独立task-owned scratch完成全部focused tests，独立reviewer在attempt前通过governance/evidence readability与64-hex identity eligibility，唯一synthetic attempt完成pre-cleanup双审、受控cleanup、五维post-cleanup双审且无Critical、Important或阻塞finding
- Prohibited changes：V2至V8 retained evidence提前cleanup或补跑、真实输入或runtime访问、accepted candidate或其permissions修改、diagnostic allowlist修改、snapshot写入或修复、key访问、Docker、database、migration、capacity、Dify、飞书、UAT、部署、切换、cutover或retry
- Required verification：fresh clone exact commit与clean state、current owner、root `0700`、member mode policy、symlink absence、remote absence、reviewer evidence readability、valid reviewer identity、correction/frozen/scratch root separation、scratch exact cleanup、pre-mutation rollback clock rejection、all initialization crash points、exact frozen manifest member execution、frozen wrapper execution、deadline cleanup availability、existing V8 regression、sensitive-data scan、独立规格与质量双审
- Escalation conditions：任一V2至V8 custody冲突、reviewer eligibility缺失、scratch污染、subset-only reproduction、真实输入需求、candidate或Gate语义变化、raw custody超期、Critical、Important、阻塞finding或证据冲突必须停止

## Proposed Protocol Boundary

1. V9必须使用新的repository-external root与new frozen identity，不得原地修改V2至V8文件、attempt state或retained evidence
2. V2至V8 retained evidence继续由既有deadline continuity独立cleanup，V9不得消费、重跑或提前销毁旧evidence
3. Reviewer eligibility必须在attempt创建前验证PROJECT与accepted checkpoint可读、V9 evidence root可读、reviewer identity为distinct 64-hex且review process可返回结构化findings；任一失败不得消费唯一attempt
4. Reviewer preflight不得读取private pointer value、candidate bytes或raw bytes，只允许验证required evidence availability与metadata边界
5. Frozen tests只能把mutable fixture写入explicit task-owned scratch root；correction root只提供只读private dependencies，frozen root保持sealed且不可写
6. Scratch root必须current-owner `0700`、无symlink、与correction/frozen root distinct，并在每次focused run后证明exact absence
7. Frozen focused harness必须从exact sealed identity直接执行并fresh验证完整manifest inventory、member digest与wrapper/test绑定，不得复制subset形成替代identity
8. Nested test runner必须清除父runner context泄漏，同时保留accepted Node、frozen controller/wrapper与correction-root dependency binding
9. 任一missing dependency、reviewer ineligibility、scratch residue、manifest subset、path confusion、rollback clock或mutation sentinel触发必须在attempt-zero阶段拒绝
10. Pre-cleanup review继续要求execution status为`0`且stdout、stderr与diagnostic均exact-zero，两位eligible independent reviewer必须绑定同一V9 frozen manifest、sealed custody identities与相同raw digests
11. Deadline前只有两项review都passed才能cleanup；deadline到达时必须通过frozen cleanup wrapper销毁exact targets并保持`BLOCKED`
12. Cleanup后必须完成process、file、key、local TCP与task-owned runtime五维fresh observation及独立双审

V9 correction通过完整双审后只能创建correction result checkpoint，不得自动提交或执行新的read-only snapshot diagnostic Gate、UAT、Deployment Gate或Cutover Gate

## Gate Declaration

请求用户明确接受或拒绝

`GATE-PHASE5-READONLY-SNAPSHOT-DIAGNOSTIC-CONTROLLER-PROTOCOL-CORRECTION-V8-BLOCKED-DISPOSITION`

只有用户在本submission合并后提供exact named confirmation，才能创建accepted checkpoint并解锁repository-external synthetic-only V9 correction

## Evidence

- `main`与`origin/main`在本submission创建前同步于PR #245 merge commit
- `PROJECT.md` source version为`65`
- Post-merge `npm run test:project-source`为`42/42 PASS`且`npm run project:check`通过
- V8 retained evidence保持双failed verdict、三项raw exact-zero custody intact、deadline future且cleanup pending
- V8 synthetic attempt未补跑，frozen identity未修改
- 本submission未读取raw bytes、private pointer value、candidate bytes或真实路径
- 本submission未访问任何真实输入、Docker、database、Dify、飞书或部署环境

## Submitted Result

提交repository-external synthetic-only controller protocol correction V9、strict TDD focused tests、new frozen identity、reviewer eligibility、task-owned scratch、exact sealed bundle reproduction、受控cleanup与独立双审的决策请求

本checkpoint状态仅为`submitted`，不代表Gate accepted，不解锁V9或任何真实操作
