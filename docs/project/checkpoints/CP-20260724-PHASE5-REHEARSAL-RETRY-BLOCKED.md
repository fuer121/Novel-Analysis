---
checkpoint_id: CP-20260724-PHASE5-REHEARSAL-RETRY-BLOCKED
task_id: PHASE5-TARGET-SERVER-ISOLATED-REHEARSAL
status: accepted
recorded_at: 2026-07-24T10:24:00+08:00
branch: codex/phase5-rehearsal-retry-blocked
base_commit: 899ef2848724619a25b0da0057057623440d9c71
head_commit: 899ef2848724619a25b0da0057057623440d9c71
supersedes: none
---

# Phase 5 Rehearsal Retry Blocked

## Scope

记录v2协议授权的一次fresh rehearsal retry在隔离数据库初始化阶段失败并按Gate停止

## Evidence

- [V2 protocol correction accepted](CP-20260724-PHASE5-REHEARSAL-PROTOCOL-CORRECTION-ACCEPTED.md)
- Target idle preflight通过，且无并发Phase 5 benchmark
- Accepted launcher与protocol wrapper identity在执行前逐byte验证通过
- Parent-owned wrapper stdout与stderr均为0 bytes
- Controller只读取脱敏错误分类，没有转发private path、credential、key、snapshot fingerprint或target identity

## Result

- Outcome: `BLOCKED`
- Failure stage: isolated migration database initialization helper load
- Failure class: private TypeScript helper在repository外缺少ESM package context，被`tsx`按CJS转换并拒绝top-level await
- Migration CLI: `NOT RUN`
- Migration manifest: `NOT PUBLISHED`
- Eight hard validations: `NOT RUN`
- Capacity suite: `NOT RUN`
- Real Dify、Feishu、UAT、deployment、traffic与cutover: `NOT TOUCHED`

该失败属于private execution helper packaging defect，不是snapshot integrity、key validation、migration semantics、production data或capacity threshold failure

## Retention Protocol Finding

V2 synthetic evidence的accepted retention文字将protocol acceptance定义为最早deadline，但actual retry又要求在execution前使用该private manifest逐byte匹配launcher与wrapper

Controller为完成pre-run identity match将v2 private evidence保留至retry结束，超过了protocol在10:04接受时已经触发的最早retention deadline

这是独立的retention-protocol failure，最终销毁与absence verification不能抵消该时间边界违规

下一版修正必须把synthetic raw evidence与最小identity artifact分离，只允许不含敏感内容的最小identity artifact在明确custody window内保留至authorized pre-run match完成，随后立即销毁

## Cleanup Evidence

- Old production key working file已销毁
- Ephemeral target encryption与HMAC key files已销毁
- Production snapshot working copy已销毁
- Isolated PostgreSQL container与database已销毁
- Actual retry private directory、logs、scripts、results与全部copies已销毁
- V2 synthetic evidence在retry结束后已销毁，但该销毁晚于protocol acceptance触发的accepted deadline
- Controller于2026-07-24T10:23:25+08:00完成fresh absence verification
- Canonical retained snapshot未修改，仍由原custodian按既有retention管理
- Old application保持运行，repository保持clean

## Gate Impact

- 本次唯一retry已消耗，不得修正helper后自动重跑
- 本次记录同时接受v2 identity evidence retention超过accepted deadline的protocol failure
- `GATE-PHASE5-FEISHU-UAT`保持locked
- 所有real Dify、Feishu、UAT、deployment、traffic与cutover操作保持locked
- 任何新retry必须先提交新的最小协议修正与synthetic evidence，并获得明确授权

## Accepted Result

总控接受本次retry outcome为`BLOCKED`，确认没有可用于later Gate的migration或capacity evidence；working artifacts最终cleanup已完成，但v2 identity evidence retention曾超过accepted deadline，且禁止自动重跑
