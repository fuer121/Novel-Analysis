---
project_id: novel-analysis-refactor
source_version: 28
baseline_commit: d7c4697c3053311e0b1d4680ecfda2a2a7f1e267
baseline_status: current
updated_at: 2026-07-26T11:30:00+08:00
updated_by: controller-agent
current_phase: phase-5-real-retry-execution-v4-gate-submitted
last_checkpoint: CP-20260726-PHASE5-PREFLIGHT-DIAGNOSTIC-CORRECTION-ACCEPTED
next_gate: GATE-PHASE5-REAL-RETRY-EXECUTION-V4-ACCEPTANCE
---

# Novel Analysis Refactor Project Source

本文档是项目当前状态、基线、决策、风险和推进条件的唯一入口，线程上下文不能替代本文档，历史任务与证据由阶段 ledger 承载

## Current Baseline

| 字段 | 当前值 |
| --- | --- |
| Repository | fuer121/Novel-Analysis |
| Branch | main |
| Accepted implementation baseline | `d7c4697c3053311e0b1d4680ecfda2a2a7f1e267` |
| Latest merged implementation | PR #150 `https://github.com/fuer121/Novel-Analysis/pull/150` |
| CI | passed |
| Legacy application | 旧应用只是兼容基线，不是重构前端 |
| Dify workflow | [Workflow](../../dify-workflows/manifest.json) |
| Controller health | `npm run controller:health`，只读并已纳入 post-merge verification |

## Phase Status

| 阶段 | 状态 | 证据或依赖 |
| --- | --- | --- |
| Phase 0 | merged | [Phase 0 merged](checkpoints/CP-20260717-PHASE0-MERGED.md) |
| Phase 1 | merged | [Phase 1 merged](checkpoints/CP-20260719-PHASE1-MERGED.md) |
| Phase 2 | accepted | `GATE-PHASE2-IMPLEMENTATION-ACCEPTED` 已通过 |
| Phase 3 | accepted | `GATE-PHASE3-IMPLEMENTATION-ACCEPTED` 已通过 |
| Phase 4 | accepted | `GATE-PHASE4-IMPLEMENTATION-ACCEPTED` 已通过 |
| Phase 5 | Real retry Execution V4 Gate submitted | Gate contract已提交；真实retry仍需用户在contract合并后明确接受named Gate |

## Active Work

| Task | Phase | Scope | Owner | Branch | Base | Head | Status | Depends On | Checkpoint | Next Action |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| PHASE5-REAL-RETRY-STAGE-ENTRY | phase-5 | Build a committed single-file Node ESM rehearsal stage artifact | controller-agent | codex/phase5-real-retry-stage-entry-impl | f82fcf9cb4be73fed356299565b2a22b2ed71d10 | 72e0d29bb5fade441530e79736deb53c735d794a | merged | DEC-0022 | CP-20260725-PHASE5-STAGE-MERGED-IDENTITY-RESTARTED | none |
| PHASE5-REAL-RETRY-IDENTITY | phase-5 | Prepare, test, freeze and review exact real retry execution identity without real inputs | controller-agent | unassigned | 26951ddfc5d8b048ebe421298168043fdf5b6925 | 26951ddfc5d8b048ebe421298168043fdf5b6925 | superseded | DEC-0026 | CP-20260725-PHASE5-IDENTITY-V3-V2-ACCEPTED | replaced by PHASE5-REAL-RETRY-CORRECTION |
| PHASE5-REAL-RETRY-EXECUTION-V2 | phase-5 | Execute one real isolated rehearsal using only accepted V2 bytes after explicit confirmation | controller-agent | codex/phase5-real-retry-execution-v2-blocked | de143a8e2fd6aa7159e5a5c31d02bc20b9eb2afb | de143a8e2fd6aa7159e5a5c31d02bc20b9eb2afb | blocked | CP-20260725-PHASE5-REAL-RETRY-EXECUTION-V2-GATE-ACCEPTED | CP-20260725-PHASE5-REAL-RETRY-EXECUTION-V2-BLOCKED | correct controller preflight implementation and identity-before-snapshot ordering before any retry |
| PHASE5-REAL-RETRY-CORRECTION | phase-5 | Candidate-owned preflight、snapshot validation ordering、synthetic refreeze与双审 | controller-agent | codex/phase5-real-retry-correction-accepted | 68bcfb4b1d437ccb750b6326d81c37d3b21db962 | 68bcfb4b1d437ccb750b6326d81c37d3b21db962 | superseded | DEC-0027 | CP-20260725-PHASE5-REAL-RETRY-CORRECTION-ACCEPTED | full-unit ordering gap recorded by V3 preparation blocked checkpoint |
| PHASE5-REAL-RETRY-EXECUTION-V3-PREPARATION | phase-5 | Freeze V3 config and audit complete preflight-to-sensitive-input ordering before Gate submission | controller-agent | codex/phase5-v3-gate-preparation-blocked | d7c4697c3053311e0b1d4680ecfda2a2a7f1e267 | d7c4697c3053311e0b1d4680ecfda2a2a7f1e267 | superseded | CP-20260725-PHASE5-REAL-RETRY-CORRECTION-ACCEPTED | CP-20260725-PHASE5-REAL-RETRY-EXECUTION-V3-PREPARATION-BLOCKED | replaced by accepted snapshot-preflight correction |
| PHASE5-SNAPSHOT-PREFLIGHT-CORRECTION | phase-5 | Add candidate-owned snapshot preflight without key or runtime resource access, then refreeze and review | controller-agent | codex/phase5-snapshot-preflight-correction | 8396047884bcdf4c3cb383d43363ce65651a07e2 | 8396047884bcdf4c3cb383d43363ce65651a07e2 | accepted | DEC-0028 | CP-20260725-PHASE5-SNAPSHOT-PREFLIGHT-CORRECTION-ACCEPTED | prepare a separate named Execution V3 Gate without accessing real resources |
| PHASE5-REAL-RETRY-EXECUTION-V3 | phase-5 | Execute one real isolated rehearsal using accepted snapshot-preflight identity after exact named confirmation | controller-agent | codex/phase5-real-retry-v3-preflight-blocked | cc874db3dc4b8be5cb7a59ff20f0351023d5d372 | cc874db3dc4b8be5cb7a59ff20f0351023d5d372 | blocked | DEC-0029 | CP-20260725-PHASE5-REAL-RETRY-EXECUTION-V3-PREFLIGHT-BLOCKED | design synthetic sanitized preflight diagnostics before any new Gate |
| PHASE5-PREFLIGHT-DIAGNOSTIC-CORRECTION | phase-5 | Add deterministic sanitized preflight stage and reason codes in a new synthetic-only candidate | controller-agent | codex/phase5-preflight-diagnostic-correction | 776267c1d5c56a35c61753df7d7d1b43405e2f40 | 641d2b5bb055a4e7f3682aebd062369e022a9336 | accepted | CP-20260725-PHASE5-REAL-RETRY-EXECUTION-V3-PREFLIGHT-BLOCKED | CP-20260726-PHASE5-PREFLIGHT-DIAGNOSTIC-CORRECTION-ACCEPTED | request user decision before submitting any new named real retry Gate |
| PHASE5-REAL-RETRY-EXECUTION-V4 | phase-5 | Submit exact contract for one real isolated rehearsal using accepted diagnostic candidate | controller-agent | codex/phase5-real-retry-execution-v4-gate | e43aa7669196b19d3609f5c068efcc21570e3b30 | e43aa7669196b19d3609f5c068efcc21570e3b30 | blocked | CP-20260726-PHASE5-PREFLIGHT-DIAGNOSTIC-CORRECTION-ACCEPTED | CP-20260726-PHASE5-REAL-RETRY-EXECUTION-V4-GATE-SUBMITTED | merge Gate submission, then request exact named acceptance |
| PHASE5-STAGE-INTERFACE-V2 | phase-5 | Consume verified sensitive inputs and bind migration/capacity resource IDs without relaxing Gate | controller-agent | codex/phase5-stage-interface-v2 | 4fc2472d0e7e89d733a5d7b16f9e41da4b69c2fb | 7fc0d0d6d0c8d872237dbd3710b2c61247ffd31f | merged | DEC-0023 | CP-20260725-PHASE5-STAGE-INTERFACE-V2-MERGED | none |

## Phase Ledgers

- [Phase 1 ledger](ledgers/phase-1-ledger.md)
- [Phase 2 ledger](ledgers/phase-2-ledger.md)
- [Phase 3 ledger](ledgers/phase-3-ledger.md)
- [Phase 4 ledger](ledgers/phase-4-ledger.md)

## Effective Decisions

- [DEC-0001 Controller-Owned Project Source](decisions/DEC-0001-project-governance.md)
- [DEC-0002 Automated Pull Request Authority](decisions/DEC-0002-automated-pull-request-authority.md)
- [DEC-0003 One Chapter Per JobStep](decisions/DEC-0003-phase2-step-granularity.md)
- [DEC-0004 Dify Smoke Credential Policy](decisions/DEC-0004-dify-smoke-credential-policy.md)
- [DEC-0005 Repository L2 Workflow Output Alignment](decisions/DEC-0005-repository-l2-workflow-output-alignment.md)
- [DEC-0006 Phase 2 Task 4 Contract Correction](decisions/DEC-0006-phase2-task4-contract-correction.md)
- [DEC-0007 Controller Workspace And Governance Lifecycle](decisions/DEC-0007-controller-workspace-and-governance-lifecycle.md)
- [DEC-0008 Phase 2 Task 5 Index Group Create Only](decisions/DEC-0008-phase2-task5-index-group-create-only.md)
- [DEC-0009 Phase 2 Task 5 Workflow Snapshot Boundary](decisions/DEC-0009-phase2-task5-workflow-snapshot-boundary.md)
- [DEC-0010 Index Group Category Scope](decisions/DEC-0010-index-group-category-scope.md)
- [DEC-0011 Task 7 Fact Review API](decisions/DEC-0011-task7-fact-review-api.md)
- [DEC-0012 Task 7 Session Cache Boundary](decisions/DEC-0012-task7-session-cache-boundary.md)
- [DEC-0013 Phase 3 Query Session Sharing](decisions/DEC-0013-phase3-query-session-sharing.md)
- [DEC-0014 Query HMAC Key Policy](decisions/DEC-0014-query-hmac-key-policy.md)
- [DEC-0015 Query Turn History And Trace Projection](decisions/DEC-0015-query-turn-history-and-trace-projection.md)
- [DEC-0016 Encrypted Advanced Analysis Execution Snapshot](decisions/DEC-0016-phase4-encrypted-execution-snapshot.md)
- [DEC-0017 Phase 5 Selective Migration And No Entry Rollback](decisions/DEC-0017-phase5-selective-migration-and-no-entry-rollback.md)
- [DEC-0018 Phase 5 Shared Freshness Selector Ownership](decisions/DEC-0018-phase5-shared-freshness-selector.md)
- [DEC-0019 Phase 5 Rebuild Reorder Temporary Positions](decisions/DEC-0019-phase5-rebuild-reorder-positive-temporary-positions.md)
- [DEC-0020 Phase 5 Local Isolated Capacity Benchmark](decisions/DEC-0020-phase5-local-isolated-capacity-benchmark.md)
- [DEC-0021 Phase 5 Lean Completion Boundary](decisions/DEC-0021-phase5-lean-completion-boundary.md)
- [DEC-0022 Phase 5 Single Artifact Rehearsal Stage](decisions/DEC-0022-phase5-single-artifact-rehearsal-stage.md)
- [DEC-0023 Phase 5 Stage Verified Input And Resource Binding](decisions/DEC-0023-phase5-stage-verified-input-resource-binding.md)
- [DEC-0024 Phase 5 Launcher Owned PostgreSQL Lifecycle](decisions/DEC-0024-phase5-launcher-owned-postgres-lifecycle.md)
- [DEC-0025 Phase 5 Docker Resource Kind Identities](decisions/DEC-0025-phase5-docker-resource-kind-identities.md)
- [DEC-0026 Phase 5 Container Owned Ephemeral Storage](decisions/DEC-0026-phase5-container-owned-ephemeral-storage.md)
- [DEC-0027 Phase 5 Candidate Owned Preflight](decisions/DEC-0027-phase5-candidate-owned-preflight.md)
- [DEC-0028 Phase 5 Snapshot Preflight Mode](decisions/DEC-0028-phase5-snapshot-preflight-mode.md)
- [DEC-0029 Phase 5 Real Retry V3 Resource Ordering](decisions/DEC-0029-phase5-real-retry-v3-resource-ordering.md)
- [已批准重构设计](../superpowers/specs/2026-07-16-novel-analysis-refactor-design.md)
- 完整重构完成后再切换，不长期双维护旧应用与重构应用
- 目标场景为 5-20 人 LAN 使用，采用飞书登录、共享书库以及管理员和成员角色
- 技术路线为 React、TypeScript、模块化单体、PostgreSQL、pg-boss 和 Dify executor
- 核心分析路径为核心书库 → L1 → L2 → L2 连续提问

## Risks And Blockers

- `npm audit` 当前有 1 low、1 moderate、1 high、2 critical，修复需要单独授权
- GitHub Actions 依赖尚未固定到完整 SHA
- PostgreSQL BIGINT event ID 当前映射为 JavaScript `number`，后续 contract 演进需要单独授权
- Task 2 UUID cursor 在 cursor row 被删除时会提前结束分页，当前阶段没有 fact 删除路径
- Fact category allowlist 在 contracts 与 database 分别维护，后续 category contract 演进必须同步验证
- Query API 运行环境必须提供独立的 canonical-base64 32-byte `CONTENT_HMAC_KEY`，且不得与内容加密 key 相同
- Task 7 的 10 用户 p95 阈值是本地 fake-provider 验收证据，不代表生产容量承诺
- Task 7 plaintext 与 credential sentinel 扫描必须覆盖持久化、普通 Query JSON、captured API/Worker logs 与受控 provider error
- Task 6开发机browse p95存在329.648ms至705.975ms波动，保留为indicative evidence；硬threshold由target-server isolated rehearsal Gate验证
- Target-server rehearsal的noclobber readiness wrapper曾将private run path写入ordinary terminal；本次run已作废并完成敏感working artifacts与隔离数据库清理，修正协议重新确认前禁止retry
- Corrected launcher与wrapper已通过process-level private stdio、deterministic wrapper failure、repeated-readiness、identity binding、atomic manifest与cleanup验证；actual retry必须逐byte匹配accepted private identity
- Fresh retry因repository-external TypeScript helper被按CJS转换而在database initialization阶段blocked；helper修正与新retry必须重新提交确认
- V2 private identity evidence为pre-run匹配被保留超过protocol acceptance触发的retention deadline；下一修正必须分离raw evidence与具有明确execution custody window的最小identity artifact
- V3 protocol、Git trust anchor与verified-byte handoff已接受；唯一fresh retry必须先完成anchored pre-run验证与identity cleanup，任一mismatch在snapshot/key access前exit `70`
- Prior Task 6 stale PostgreSQL container、专属volume与空network已在授权后删除并fresh absence verified；新授权的唯一retry仍须遵守v3 anchor、pre-run hard stops与identity-before-snapshot/key cleanup顺序
- Cleanup后唯一retry在identity open/hash前因expected-path parent层级比较错误于首项containment exit `70`并已消耗；empty run/sink/pointer已清理，任何新retry前必须完整修正并独立审查preflight wrapper
- Full synthetic execution unit的10个已定义场景完成，但exact launcher在post-run packaging exit `1`，fixture generation与database initialization failure未覆盖，spec review blocked且quality review未启动
- V3已关闭launcher URL-to-path与两个缺失失败场景，但success browse p95为`566.322ms`、成功evidence未发布，且README既有绝对路径触发repository sentinel基线误报
- V4已完成12/12场景、严格容量阈值、零ordinary output及spec approval，但quality review因retained runtime sentinel未完整覆盖、原始manifest digest未独立核验及launcher编排层异常清理缺口而blocked
- V5已关闭V4三个quality findings与incomplete-status截断盲区，focused evidence与独立审查通过，但尚未执行新的full synthetic E2E
- V5唯一full synthetic已12/12通过，success browse p95为`395.546ms`，原始evidence digest、absolute-zero scans与资源清理通过，真实retry仍需独立Gate
- Real retry Gate采用两次明确确认，首次只授权无真实输入的execution identity准备，第二次才可授权唯一真实执行
- Gate contract第一次确认已通过，identity准备不得读取snapshot、old key、Keychain或创建真实数据库
- Real retry identity的focused suites与最终规格审查通过，但独立质量审查因实际执行闭包未冻结及5类关联安全问题blocked；当前069e baseline没有tracked且可直接执行的统一JavaScript stage，需要用户选择执行闭包Option A、B或C
- 用户已选择Option A，单一committed Node ESM rehearsal stage进入实现；stage通过双审前，blocked candidate SHA继续无效
- Single-artifact stage已通过规格、质量与总控验证，accepted artifact SHA为`6ea6bebe5cdfee41f9060a270e1a3af8773fc51a8692d097af0900a31d4666f0`；real retry identity仍需围绕该artifact重新生成和双审
- Single-artifact stage已在PR #177合并并通过post-merge verification；旧candidate继续invalid，新candidate必须关闭accepted task contract中的全部quality findings
- Identity v2在freeze前确认accepted stage仍以path check后重新open方式消费input且不回传resource IDs，无法满足same-descriptor与resource-match要求；candidate未freeze，等待A1或A2决策
- 用户已选择A1，stage interface v2进入synthetic implementation；保持same-descriptor verified-use与resource-match要求，不放宽Gate
- Stage interface v2已通过独立规格与质量审查，新artifact SHA为`acedef876bc35821ac0e708660d3ddc1d373d30eb97dc15fdc9846f863cc71d5`；等待implementation PR CI与合并
- Stage interface v2已在PR #181合并并通过post-merge verification；identity stage interface blocker已关闭
- Identity v3已关闭wrapper stdin、非循环bootstrap、parent containment与manifest provenance primitive，但无法证明既有database URL对应资源归本次launcher所有；等待R1或R2决策
- 用户已选择R1，launcher-owned PostgreSQL lifecycle进入synthetic stub implementation；真实Docker与database继续locked
- R1 candidate已关闭原规格findings，但synthetic fixture错误假设Docker volume具有`Id`；等待V1或V2 volume identity决策
- 用户已选择V1，named volume改用Docker真实字段的composite attestation，kind-specific fixture correction进入implementation
- V1 candidate的kind-specific correction已通过规格审查，但独立质量审查发现volume deletion TOCTOU、manifest sentinel、durable atomic publication与cleanup blocked evidence四个Important finding，candidate继续blocked
- 用户确认放弃V1并切换到V2，container-owned anonymous storage与immutable container ID cleanup进入单一synthetic correction
- V2 frozen identity已关闭container storage、sentinel、durability与rollback findings，通过独立规格和质量双审；真实retry仍需新的明确Gate授权
- Real retry Execution V2 Gate已submitted；只有用户明确接受Gate名称才授权唯一一次真实attempt
- 用户已明确接受`GATE-PHASE5-REAL-RETRY-EXECUTION-V2`，唯一一次attempt已授权；任一hard stop消耗授权且禁止自动retry
- Execution V2 attempt因controller临时stage checker的默认buffer误判及identity-before-snapshot顺序违规而BLOCKED；anchor与stage实际匹配，授权已消耗且cleanup完成
- Candidate-owned correction已通过36/36与独立双审；恶意同UID ABA不在既有owner-only信任模型，普通tool update由每次调用前后guard转为BLOCKED并cleanup
- Execution V3 config已冻结，但candidate启动前必须准备key files，导致完整执行单元仍无法证明snapshot validation先于old-key access与target-key generation；Gate未提交
- Snapshot preflight correction已通过`46/46`、规格与质量双审，恢复standalone sidecar absence与exact `PRAGMA integrity_check`；Execution V3 Gate仍未提交
- Execution V3 accepted Gate要求snapshot前验证六个resource name absence，但candidate只在snapshot与key后生成runId且anonymous storage name仅在create后存在；attempt未开始且未消耗
- Preflight diagnostic correction已通过`57/57`与独立双审，固定allowlist、合法链形、截断拒绝、status一致性与synthetic cleanup均已验证；真实retry继续locked

## Pending Feedback

等待Gate submission合并后由用户明确接受或拒绝`GATE-PHASE5-REAL-RETRY-EXECUTION-V4`

## Next Gate

下一步仅为合并V4 Gate submission并请求`GATE-PHASE5-REAL-RETRY-EXECUTION-V4`明确接受；Gate未接受前，真实retry与`GATE-PHASE5-FEISHU-UAT`继续locked

## Evidence Index

- [Phase 5 real retry Execution V4 Gate submitted](checkpoints/CP-20260726-PHASE5-REAL-RETRY-EXECUTION-V4-GATE-SUBMITTED.md)
- [Phase 5 preflight diagnostic correction accepted](checkpoints/CP-20260726-PHASE5-PREFLIGHT-DIAGNOSTIC-CORRECTION-ACCEPTED.md)
- [Phase 5 preflight diagnostic correction started](checkpoints/CP-20260725-PHASE5-PREFLIGHT-DIAGNOSTIC-CORRECTION-STARTED.md)
- [Phase 5 real retry Execution V3 preflight blocked](checkpoints/CP-20260725-PHASE5-REAL-RETRY-EXECUTION-V3-PREFLIGHT-BLOCKED.md)
- [Phase 5 real retry Execution V3 ordering correction accepted](checkpoints/CP-20260725-PHASE5-REAL-RETRY-EXECUTION-V3-ORDERING-CORRECTION-ACCEPTED.md)
- [Phase 5 real retry Execution V3 ordering correction submitted](checkpoints/CP-20260725-PHASE5-REAL-RETRY-EXECUTION-V3-ORDERING-CORRECTION-SUBMITTED.md)
- [Phase 5 real retry V3 resource ordering decision](decisions/DEC-0029-phase5-real-retry-v3-resource-ordering.md)
- [Phase 5 real retry Execution V3 pre-execution blocked](checkpoints/CP-20260725-PHASE5-REAL-RETRY-EXECUTION-V3-PRE-EXECUTION-BLOCKED.md)
- [Phase 5 real retry Execution V3 Gate accepted](checkpoints/CP-20260725-PHASE5-REAL-RETRY-EXECUTION-V3-GATE-ACCEPTED.md)
- [Phase 5 real retry Execution V3 Gate submitted](checkpoints/CP-20260725-PHASE5-REAL-RETRY-EXECUTION-V3-GATE-SUBMITTED.md)
- [Phase 5 snapshot preflight correction accepted](checkpoints/CP-20260725-PHASE5-SNAPSHOT-PREFLIGHT-CORRECTION-ACCEPTED.md)
- [Phase 5 snapshot preflight correction started](checkpoints/CP-20260725-PHASE5-SNAPSHOT-PREFLIGHT-CORRECTION-STARTED.md)
- [Phase 5 snapshot preflight mode decision](decisions/DEC-0028-phase5-snapshot-preflight-mode.md)
- [Phase 5 real retry Execution V3 preparation blocked](checkpoints/CP-20260725-PHASE5-REAL-RETRY-EXECUTION-V3-PREPARATION-BLOCKED.md)
- [Phase 5 real retry correction accepted](checkpoints/CP-20260725-PHASE5-REAL-RETRY-CORRECTION-ACCEPTED.md)
- [Phase 5 real retry correction started](checkpoints/CP-20260725-PHASE5-REAL-RETRY-CORRECTION-STARTED.md)
- [Phase 5 candidate owned preflight decision](decisions/DEC-0027-phase5-candidate-owned-preflight.md)
- [Phase 5 real retry Execution V2 blocked](checkpoints/CP-20260725-PHASE5-REAL-RETRY-EXECUTION-V2-BLOCKED.md)
- [Phase 5 real retry Execution V2 Gate accepted](checkpoints/CP-20260725-PHASE5-REAL-RETRY-EXECUTION-V2-GATE-ACCEPTED.md)
- [Phase 5 real retry Execution V2 Gate submitted](checkpoints/CP-20260725-PHASE5-REAL-RETRY-EXECUTION-V2-GATE-SUBMITTED.md)
- [Phase 5 identity v3 V2 accepted](checkpoints/CP-20260725-PHASE5-IDENTITY-V3-V2-ACCEPTED.md)
- [Phase 5 identity v3 V2 restarted](checkpoints/CP-20260725-PHASE5-IDENTITY-V3-V2-RESTARTED.md)
- [Phase 5 container owned ephemeral storage decision](decisions/DEC-0026-phase5-container-owned-ephemeral-storage.md)
- [Phase 5 identity v3 V1 quality blocked](checkpoints/CP-20260725-PHASE5-IDENTITY-V3-V1-QUALITY-BLOCKED.md)
- [Phase 5 identity v3 V1 restarted](checkpoints/CP-20260725-PHASE5-IDENTITY-V3-V1-RESTARTED.md)
- [Phase 5 Docker resource kind identities decision](decisions/DEC-0025-phase5-docker-resource-kind-identities.md)
- [Phase 5 identity v3 R1 volume identity blocked](checkpoints/CP-20260725-PHASE5-IDENTITY-V3-R1-VOLUME-IDENTITY-BLOCKED.md)
- [Phase 5 identity v3 R1 restarted](checkpoints/CP-20260725-PHASE5-IDENTITY-V3-R1-RESTARTED.md)
- [Phase 5 launcher owned PostgreSQL lifecycle decision](decisions/DEC-0024-phase5-launcher-owned-postgres-lifecycle.md)
- [Phase 5 real retry identity v3 resource ownership blocked](checkpoints/CP-20260725-PHASE5-REAL-RETRY-IDENTITY-V3-RESOURCE-OWNERSHIP-BLOCKED.md)
- [Phase 5 stage interface v2 merged](checkpoints/CP-20260725-PHASE5-STAGE-INTERFACE-V2-MERGED.md)
- [Phase 5 stage interface v2 accepted](checkpoints/CP-20260725-PHASE5-STAGE-INTERFACE-V2-ACCEPTED.md)
- [Phase 5 stage interface v2 started](checkpoints/CP-20260725-PHASE5-STAGE-INTERFACE-V2-STARTED.md)
- [Phase 5 stage verified input and resource binding decision](decisions/DEC-0023-phase5-stage-verified-input-resource-binding.md)
- [Phase 5 real retry identity v2 interface blocked](checkpoints/CP-20260725-PHASE5-REAL-RETRY-IDENTITY-V2-INTERFACE-BLOCKED.md)
- [Phase 5 stage merged and identity restarted](checkpoints/CP-20260725-PHASE5-STAGE-MERGED-IDENTITY-RESTARTED.md)
- [Phase 5 real retry stage entry accepted](checkpoints/CP-20260725-PHASE5-REAL-RETRY-STAGE-ENTRY-ACCEPTED.md)
- [Phase 5 real retry stage entry started](checkpoints/CP-20260724-PHASE5-REAL-RETRY-STAGE-ENTRY-STARTED.md)
- [Phase 5 single artifact rehearsal stage decision](decisions/DEC-0022-phase5-single-artifact-rehearsal-stage.md)
- [Phase 5 real retry identity quality blocked](checkpoints/CP-20260724-PHASE5-REAL-RETRY-IDENTITY-QUALITY-BLOCKED.md)
- [Phase 5 real retry Gate contract accepted](checkpoints/CP-20260724-PHASE5-REAL-RETRY-GATE-CONTRACT-ACCEPTED.md)
- [Phase 5 real retry Gate submitted](checkpoints/CP-20260724-PHASE5-REAL-RETRY-GATE-SUBMITTED.md)
- [Phase 5 synthetic E2E calibration v5 accepted](checkpoints/CP-20260724-PHASE5-SYNTHETIC-E2E-CALIBRATION-V5-ACCEPTED.md)
- [Phase 5 synthetic E2E calibration v5 correction accepted](checkpoints/CP-20260724-PHASE5-SYNTHETIC-E2E-CALIBRATION-V5-CORRECTION-ACCEPTED.md)
- [Phase 5 synthetic E2E calibration v4 quality blocked](checkpoints/CP-20260724-PHASE5-SYNTHETIC-E2E-CALIBRATION-V4-QUALITY-BLOCKED.md)
- [Phase 5 synthetic E2E calibration v3 blocked](checkpoints/CP-20260724-PHASE5-SYNTHETIC-E2E-CALIBRATION-V3-BLOCKED.md)
- [Phase 5 synthetic E2E calibration blocked](checkpoints/CP-20260724-PHASE5-SYNTHETIC-E2E-CALIBRATION-BLOCKED.md)
- [Phase 5 retry containment blocked](checkpoints/CP-20260724-PHASE5-RETRY-CONTAINMENT-BLOCKED.md)
- [Phase 5 retry after cleanup accepted](checkpoints/CP-20260724-PHASE5-RETRY-AFTER-CLEANUP-ACCEPTED.md)
- [Phase 5 v3 retry preflight blocked](checkpoints/CP-20260724-PHASE5-V3-RETRY-PREFLIGHT-BLOCKED.md)
- [Phase 5 v3 retry correction accepted](checkpoints/CP-20260724-PHASE5-V3-RETRY-CORRECTION-ACCEPTED.md)
- [Phase 5 v3 retry correction submitted](checkpoints/CP-20260724-PHASE5-V3-RETRY-CORRECTION-SUBMITTED.md)
- [Phase 5 rehearsal retry blocked](checkpoints/CP-20260724-PHASE5-REHEARSAL-RETRY-BLOCKED.md)
- [Phase 5 rehearsal protocol correction accepted](checkpoints/CP-20260724-PHASE5-REHEARSAL-PROTOCOL-CORRECTION-ACCEPTED.md)
- [Phase 5 rehearsal protocol correction submitted](checkpoints/CP-20260724-PHASE5-REHEARSAL-PROTOCOL-CORRECTION-SUBMITTED.md)
- [Phase 5 target-server isolated rehearsal blocked](checkpoints/CP-20260724-PHASE5-TARGET-SERVER-ISOLATED-REHEARSAL-BLOCKED.md)
- [Phase 5 target-server isolated rehearsal Gate accepted](checkpoints/CP-20260724-PHASE5-TARGET-SERVER-ISOLATED-REHEARSAL-GATE-ACCEPTED.md)
- [Phase 5 target-server isolated rehearsal Gate submitted](checkpoints/CP-20260724-PHASE5-TARGET-SERVER-ISOLATED-REHEARSAL-GATE-SUBMITTED.md)
- [Phase 5 production snapshot acquisition accepted](checkpoints/CP-20260723-PHASE5-PRODUCTION-SNAPSHOT-ACQUISITION-ACCEPTED.md)
- [Phase 5 production snapshot access Gate accepted](checkpoints/CP-20260723-PHASE5-PRODUCTION-SNAPSHOT-ACCESS-GATE-ACCEPTED.md)
- [Phase 5 production snapshot access Gate submitted](checkpoints/CP-20260723-PHASE5-PRODUCTION-SNAPSHOT-ACCESS-GATE-SUBMITTED.md)
- [Phase 5 tools Gate accepted](checkpoints/CP-20260723-PHASE5-TOOLS-GATE-ACCEPTED.md)
- [Phase 5 Task 8 merged and tools Gate submitted](checkpoints/CP-20260723-PHASE5-TASK8-MERGED-TOOLS-GATE-SUBMITTED.md)
- [Phase 5 tools Gate submitted](checkpoints/CP-20260723-PHASE5-TOOLS-GATE-SUBMITTED.md)
- [Phase 5 Task 8 accepted](checkpoints/CP-20260723-PHASE5-TASK8-ACCEPTED.md)
- [Phase 5 Task 7 merged and Task 8 started](checkpoints/CP-20260723-PHASE5-TASK7-MERGED-TASK8-STARTED.md)
- [Phase 5 Task 7 accepted](checkpoints/CP-20260723-PHASE5-TASK7-ACCEPTED.md)
- [Phase 5 Task 6 merged and Task 7 started](checkpoints/CP-20260723-PHASE5-TASK6-MERGED-TASK7-STARTED.md)
- [Phase 5 Task 6 accepted](checkpoints/CP-20260723-PHASE5-TASK6-ACCEPTED.md)
- [Phase 5 lean completion approved](checkpoints/CP-20260723-PHASE5-LEAN-COMPLETION-APPROVED.md)
- [Phase 5 lean completion plan](../superpowers/plans/2026-07-23-phase-5-lean-completion-plan.md)
- [Phase 5 Task 6 capacity revalidation blocked](checkpoints/CP-20260723-PHASE5-TASK6-CAPACITY-REVALIDATION-BLOCKED.md)
- [Phase 5 Task 6 isolation correction](checkpoints/CP-20260723-PHASE5-TASK6-ISOLATION-CORRECTION.md)
- [Phase 5 Task 6 quality blocked](checkpoints/CP-20260723-PHASE5-TASK6-QUALITY-BLOCKED.md)
- [Phase 5 Task 6 repeatability audit accepted](checkpoints/CP-20260723-PHASE5-TASK6-REPEATABILITY-AUDIT-ACCEPTED.md)
- [Phase 5 Task 6 repeatability audit authorized](checkpoints/CP-20260723-PHASE5-TASK6-REPEATABILITY-AUDIT-AUTHORIZED.md)
- [Phase 5 Task 6 blocked](checkpoints/CP-20260723-PHASE5-TASK6-BLOCKED.md)
- [Phase 5 Task 5 merged and Task 6 started](checkpoints/CP-20260723-PHASE5-TASK5-MERGED-TASK6-STARTED.md)
- [Phase 5 Task 5 accepted](checkpoints/CP-20260723-PHASE5-TASK5-ACCEPTED.md)
- [Phase 5 Task 5 reorder correction](checkpoints/CP-20260723-PHASE5-TASK5-REORDER-CORRECTION.md)
- [Phase 5 Task 5 started](checkpoints/CP-20260723-PHASE5-TASK5-STARTED.md)
- [Phase 5 Task 4 merged](checkpoints/CP-20260723-PHASE5-TASK4-MERGED.md)
- [Phase 5 Task 4 accepted](checkpoints/CP-20260723-PHASE5-TASK4-ACCEPTED.md)
- [Phase 5 Task 4 unblocked](checkpoints/CP-20260723-PHASE5-TASK4-UNBLOCKED.md)
- [Phase 5 shared freshness selector decision](decisions/DEC-0018-phase5-shared-freshness-selector.md)
- [Phase 5 Task 4 blocked](checkpoints/CP-20260723-PHASE5-TASK4-BLOCKED.md)
- [Phase 5 Task 3 merged and Task 4 started](checkpoints/CP-20260723-PHASE5-TASK3-MERGED-TASK4-STARTED.md)
- [Phase 5 Task 3 accepted](checkpoints/CP-20260723-PHASE5-TASK3-ACCEPTED.md)
- [Phase 5 Task 2 merged and Task 3 started](checkpoints/CP-20260723-PHASE5-TASK2-MERGED-TASK3-STARTED.md)
- [Phase 5 Task 2 accepted](checkpoints/CP-20260723-PHASE5-TASK2-ACCEPTED.md)
- [Phase 5 Task 1 merged and Task 2 started](checkpoints/CP-20260723-PHASE5-TASK1-MERGED-TASK2-STARTED.md)
- [Phase 5 Task 1 accepted](checkpoints/CP-20260723-PHASE5-TASK1-ACCEPTED.md)
- [Phase 5 Task 1 started](checkpoints/CP-20260723-PHASE5-TASK1-STARTED.md)
- [Phase 5 plan approved](checkpoints/CP-20260723-PHASE5-PLAN-APPROVED.md)
- [Phase 5 plan submitted](checkpoints/CP-20260723-PHASE5-PLAN-SUBMITTED.md)
- [Phase 5 implementation plan](../superpowers/plans/2026-07-23-phase-5-migration-cutover-implementation-plan.md)
- [Phase 5 design accepted](checkpoints/CP-20260723-PHASE5-DESIGN-ACCEPTED.md)
- [Phase 5 selective migration decision](decisions/DEC-0017-phase5-selective-migration-and-no-entry-rollback.md)
- [Phase 5 design submitted](checkpoints/CP-20260723-PHASE5-DESIGN-SUBMITTED.md)
- [Phase 5 migration and cutover design](../superpowers/specs/2026-07-23-phase-5-migration-cutover-design.md)
- [Phase 4 implementation accepted](checkpoints/CP-20260722-PHASE4-IMPLEMENTATION-ACCEPTED.md)
- [Phase 4 Task 7 merged](checkpoints/CP-20260722-PHASE4-TASK7-MERGED.md)
- [Phase 4 Task 7 accepted](checkpoints/CP-20260722-PHASE4-TASK7-ACCEPTED.md)
- [Phase 4 Task 6 merged and Task 7 started](checkpoints/CP-20260722-PHASE4-TASK6-MERGED-TASK7-STARTED.md)
- [Phase 4 Task 6 accepted](checkpoints/CP-20260722-PHASE4-TASK6-ACCEPTED.md)
- [Phase 4 Task 6 Worker correction](checkpoints/CP-20260722-PHASE4-TASK6-WORKER-CORRECTION.md)
- [Phase 4 Task 6 contract correction](checkpoints/CP-20260722-PHASE4-TASK6-CONTRACT-CORRECTION.md)
- [Phase 4 Task 5 merged and Task 6 started](checkpoints/CP-20260722-PHASE4-TASK5-MERGED-TASK6-STARTED.md)
- [Phase 4 Task 5 accepted](checkpoints/CP-20260722-PHASE4-TASK5-ACCEPTED.md)
- [Phase 4 Task 4 merged and Task 5 started](checkpoints/CP-20260722-PHASE4-TASK4-MERGED-TASK5-STARTED.md)
- [Phase 4 Task 4 accepted](checkpoints/CP-20260722-PHASE4-TASK4-ACCEPTED.md)
- [Phase 4 Task 3 merged and Task 4 started](checkpoints/CP-20260722-PHASE4-TASK3-MERGED-TASK4-STARTED.md)
- [Phase 4 Task 3 accepted](checkpoints/CP-20260722-PHASE4-TASK3-ACCEPTED.md)
- [Phase 4 Task 3 contract correction](checkpoints/CP-20260722-PHASE4-TASK3-CONTRACT-CORRECTION.md)
- [Encrypted advanced analysis execution snapshot decision](decisions/DEC-0016-phase4-encrypted-execution-snapshot.md)
- [Phase 4 Task 2 merged and Task 3 started](checkpoints/CP-20260722-PHASE4-TASK2-MERGED-TASK3-STARTED.md)
- [Phase 4 Task 2 accepted](checkpoints/CP-20260722-PHASE4-TASK2-ACCEPTED.md)
- [Phase 4 Task 1 merged and Task 2 started](checkpoints/CP-20260721-PHASE4-TASK1-MERGED-TASK2-STARTED.md)
- [Phase 4 Task 1 accepted](checkpoints/CP-20260721-PHASE4-TASK1-ACCEPTED.md)
- [Phase 4 Task 1 started](checkpoints/CP-20260721-PHASE4-TASK1-STARTED.md)
- [Phase 4 plan approved](checkpoints/CP-20260721-PHASE4-PLAN-APPROVED.md)
- [Phase 4 ledger](ledgers/phase-4-ledger.md)
- [Phase 4 plan submitted](checkpoints/CP-20260721-PHASE4-PLAN-SUBMITTED.md)
- [Phase 4 implementation plan](../superpowers/plans/2026-07-21-phase-4-advanced-analysis-implementation-plan.md)
- [Phase 4 design accepted](checkpoints/CP-20260721-PHASE4-DESIGN-ACCEPTED.md)
- [Phase 4 design submitted](checkpoints/CP-20260721-PHASE4-DESIGN-SUBMITTED.md)
- [Phase 4 design](../superpowers/specs/2026-07-21-phase-4-advanced-analysis-design.md)
- [Phase 3 implementation accepted](checkpoints/CP-20260721-PHASE3-IMPLEMENTATION-ACCEPTED.md)
- [Phase 3 Task 7 merged](checkpoints/CP-20260721-PHASE3-TASK7-MERGED.md)
- [Phase 3 Task 7 accepted](checkpoints/CP-20260721-PHASE3-TASK7-ACCEPTED.md)
- [Phase 3 Task 7 started](checkpoints/CP-20260721-PHASE3-TASK7-STARTED.md)
- [Phase 3 Task 6 merged](checkpoints/CP-20260721-PHASE3-TASK6-MERGED.md)
- [Phase 3 Task 6 accepted](checkpoints/CP-20260721-PHASE3-TASK6-ACCEPTED.md)
- [Phase 3 Task 6 API correction merged](checkpoints/CP-20260721-PHASE3-TASK6-API-CORRECTION-MERGED.md)
- [Phase 3 Task 6 API correction accepted](checkpoints/CP-20260721-PHASE3-TASK6-API-CORRECTION-ACCEPTED.md)
- [Phase 3 Task 6 API correction started](checkpoints/CP-20260721-PHASE3-TASK6-API-CORRECTION-STARTED.md)
- [Phase 3 Task 6 started](checkpoints/CP-20260721-PHASE3-TASK6-STARTED.md)
- [Phase 3 Task 5 merged](checkpoints/CP-20260721-PHASE3-TASK5-MERGED.md)
- [Phase 3 Task 5 accepted](checkpoints/CP-20260721-PHASE3-TASK5-ACCEPTED.md)
- [Phase 3 Task 5 started](checkpoints/CP-20260721-PHASE3-TASK5-STARTED.md)
- [Phase 3 Task 4 merged](checkpoints/CP-20260721-PHASE3-TASK4-MERGED.md)
- [Phase 3 Task 4 accepted](checkpoints/CP-20260721-PHASE3-TASK4-ACCEPTED.md)
- [Phase 3 Task 4 started](checkpoints/CP-20260721-PHASE3-TASK4-STARTED.md)
- [Phase 3 Task 3 merged](checkpoints/CP-20260721-PHASE3-TASK3-MERGED.md)
- [Phase 3 Task 3 accepted](checkpoints/CP-20260721-PHASE3-TASK3-ACCEPTED.md)
- [Phase 3 Task 3 started](checkpoints/CP-20260721-PHASE3-TASK3-STARTED.md)
- [Phase 3 Task 2 merged](checkpoints/CP-20260721-PHASE3-TASK2-MERGED.md)
- [Phase 3 Task 2 accepted](checkpoints/CP-20260721-PHASE3-TASK2-ACCEPTED.md)
- [Phase 3 Task 2 started](checkpoints/CP-20260721-PHASE3-TASK2-STARTED.md)
- [Phase 3 Task 1 merged](checkpoints/CP-20260721-PHASE3-TASK1-MERGED.md)
- [Phase 3 Task 1 accepted](checkpoints/CP-20260721-PHASE3-TASK1-ACCEPTED.md)
- [Phase 3 Task 1 started](checkpoints/CP-20260721-PHASE3-TASK1-STARTED.md)
- [Phase 3 plan approved](checkpoints/CP-20260721-PHASE3-PLAN-APPROVED.md)
- [Phase 3 plan submitted](checkpoints/CP-20260721-PHASE3-PLAN-SUBMITTED.md)
- [Phase 3 design accepted](checkpoints/CP-20260721-PHASE3-DESIGN-ACCEPTED.md)
- [Phase 3 design submitted](checkpoints/CP-20260721-PHASE3-DESIGN-SUBMITTED.md)
- [Phase 2 implementation accepted](checkpoints/CP-20260720-PHASE2-IMPLEMENTATION-ACCEPTED.md)
- [Phase 2 Task 8 merged](checkpoints/CP-20260720-PHASE2-TASK8-MERGED.md)
- [Phase 2 Task 8 accepted](checkpoints/CP-20260720-PHASE2-TASK8-ACCEPTED.md)
- [Phase 2 Task 8 started](checkpoints/CP-20260720-PHASE2-TASK8-STARTED.md)
- [Phase 2 Task 7 merged](checkpoints/CP-20260720-PHASE2-TASK7-MERGED.md)
- [Phase 2 Task 7 accepted](checkpoints/CP-20260720-PHASE2-TASK7-ACCEPTED.md)
- [Phase 2 Task 7 session cache correction](checkpoints/CP-20260720-PHASE2-TASK7-SESSION-CACHE-CORRECTION.md)
- [Phase 2 Task 7 contract correction](checkpoints/CP-20260720-PHASE2-TASK7-CONTRACT-CORRECTION.md)
- [Phase 2 Task 7 started](checkpoints/CP-20260720-PHASE2-TASK7-STARTED.md)
- [Phase 2 Task 6 merged](checkpoints/CP-20260720-PHASE2-TASK6-MERGED.md)
- [Phase 2 Task 6 accepted](checkpoints/CP-20260720-PHASE2-TASK6-ACCEPTED.md)
- [Phase 2 Task 6 contract correction](checkpoints/CP-20260720-PHASE2-TASK6-CONTRACT-CORRECTION.md)
- [Phase 2 Task 6 started](checkpoints/CP-20260720-PHASE2-TASK6-STARTED.md)
- [Controller health metrics accepted](checkpoints/CP-20260720-CONTROLLER-HEALTH-METRICS-ACCEPTED.md)
- [Task 5 merged and project ledgers accepted](checkpoints/CP-20260720-PHASE2-TASK5-MERGED-PROJECT-LEDGERS.md)
- [Phase 1 ledger](ledgers/phase-1-ledger.md)
- [Phase 2 ledger](ledgers/phase-2-ledger.md)
- [项目唯一信源治理设计](../superpowers/specs/2026-07-17-project-source-of-truth-design.md)
- [重构路线图](../superpowers/plans/2026-07-16-novel-analysis-refactor-roadmap.md)
- [Legacy project control baseline](../PROJECT_CONTROL_BASELINE.md)

## Update Protocol

1. 执行 Agent 只提交反馈和证据，不直接更新本信源
2. 总控 Agent 核验提交内容并记录状态
3. 只有状态为 `accepted` 的结果可以推进项目基线和阶段
4. 证据冲突时将状态设为 `conflicted` 或 `blocked` 并暂停推进
5. 治理提交不更新 `baseline_commit`，只有实现基线变化时才更新
6. 已完成任务写入对应阶段 ledger，`PROJECT.md` 只保留当前任务和下一动作
7. PR 自动化权限、前置条件和强制暂停边界以 `DEC-0002` 为唯一依据，不得从线程上下文扩张权限
