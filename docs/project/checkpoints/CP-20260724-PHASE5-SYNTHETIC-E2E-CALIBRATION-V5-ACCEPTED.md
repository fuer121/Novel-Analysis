---
checkpoint_id: CP-20260724-PHASE5-SYNTHETIC-E2E-CALIBRATION-V5-ACCEPTED
task_id: PHASE5-SYNTHETIC-E2E-CALIBRATION
status: accepted
recorded_at: 2026-07-24T17:58:20+08:00
branch: codex/phase5-synthetic-v5-calibration-accepted
base_commit: 845d73e029f6e47b06e39495972f6c08c4315e51
head_commit: 845d73e029f6e47b06e39495972f6c08c4315e51
supersedes: none
---

# Phase 5 Synthetic E2E Calibration V5 Accepted

## Scope

使用accepted V5 exact bytes执行用户授权的唯一一次full synthetic E2E，核验完整preflight、数据库初始化、migration、capacity、证据发布、失败清理、retention与敏感信息边界

本checkpoint不执行或授权真实retry，不访问production snapshot、old production key或Keychain，不创建真实演练数据库，不访问Dify或飞书，不推进UAT、deployment、traffic switch或cutover

## Evidence

- Launcher SHA-256：`b80f2a89162f6fced7f4d845ea569bc6f8234d022a32e4a21fcbf0b882ee5977`
- Wrapper SHA-256：`e2fea92e45be4a8960e389daf7a6c2ec36c5dd8164e4bada3a60f6e1da3af948`
- Helper SHA-256：`7bd32a088f33181d818ab73c0f5f361f67402842aec468d2b019b20ceb531b33`
- Execution base为clean detached commit `609688e7ad3ad8b7786b9cf0a554628a666fb7f7`
- Launcher只执行一次并exit `0`，outer stdout/stderr为`0/0`字节
- Audit verdict为PASS，12/12场景通过
- Catalog detached SHA-256为`2a0842bfc6d57f3cd0e104fd5d5313332c00b1e7b8aa52fc6c2955f8094ea48a`
- Exact evidence bundle为8个`0600`普通文件，目录为`0700`，无symlink与run子目录

## Scenario And Migration Result

- Containment、helper load、fixture generation、network、volume、container、readiness retry、database initialization、migration、capacity与publication failure均达到expected exit、status attribution与cleanup断言
- Readiness retry执行3次后进入预期hard stop
- Success migration CLI与capacity runner均invoked并passed
- Migration validations为8/8通过，包含book count、chapter count、metadata、source integrity、content digest、target decrypt、target HMAC与scope exclusion
- Success atomic publication为true，原始manifest digest verification为true
- Synthetic evidence SHA-256为`8d2409eebbfa26e56779a49c138c54b67e80afb2a334f646f8fded902a66516d`，与audit provenance一致

## Capacity Result

- Dataset为3 books、3000 chapters、70000 facts
- Browse p95为`395.546ms`，满足严格`<500ms`
- Submit p95为`267.061ms`，满足`<1000ms`
- Status propagation p95为`268.235ms`，满足`<2000ms`
- Interactive priority ahead与running step uninterrupted均为true

## Leakage And Cleanup

- 每场景stdout/stderr均为`0/0`字节，outer launcher sinks为`0/0`
- Per-scenario value-aware scan全部PASS
- Retained sentinel matches、repository secret matches与base-relative path delta matches均为`0`
- Container、volume、network与run artifacts残留均为`0`
- Detached execution worktree与两个空private sinks已清理并fresh absence verified
- 未声称CI执行repository-external calibration

## Independent Review

- Specification review：`SPEC_APPROVED`
- Quality review：`QUALITY_APPROVED`
- 两轮审查均未发现Critical、Important或阻塞性finding

## Residual Risks And Boundaries

- 本结果只接受synthetic calibration，不证明真实production snapshot、old key、target environment或真实数据容量状态
- Evidence bundle中的exact bytes是本次synthetic execution identity，不自动成为real retry execution identity
- Production snapshot、old production key、Keychain、真实演练数据库、Feishu UAT、deployment与cutover继续locked
- 任何真实retry必须建立新的明确Gate，重新确认输入有效期、执行identity、cleanup与失败停止条件

## Recommendation

接受V5 full synthetic calibration

建议下一步只提交真实retry Gate供用户明确确认，不直接读取真实快照或密钥，不执行真实rehearsal

## Accepted Result

接受本次唯一full synthetic E2E、exact evidence bundle与独立审查结果

真实retry与所有后续正式环境Gate保持locked
