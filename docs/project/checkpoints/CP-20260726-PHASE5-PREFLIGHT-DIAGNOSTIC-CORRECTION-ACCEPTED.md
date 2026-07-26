---
checkpoint_id: CP-20260726-PHASE5-PREFLIGHT-DIAGNOSTIC-CORRECTION-ACCEPTED
task_id: PHASE5-PREFLIGHT-DIAGNOSTIC-CORRECTION
status: accepted
recorded_at: 2026-07-26T10:11:18+08:00
branch: codex/phase5-preflight-diagnostic-correction
base_commit: 641d2b5bb055a4e7f3682aebd062369e022a9336
head_commit: 641d2b5bb055a4e7f3682aebd062369e022a9336
supersedes: CP-20260725-PHASE5-PREFLIGHT-DIAGNOSTIC-CORRECTION-STARTED
---

# Phase 5 Preflight Diagnostic Correction Accepted

## Scope

接受repository-external synthetic candidate中的固定脱敏preflight诊断、完整失败矩阵、重新冻结与独立双审结果

本checkpoint不提交或授权任何真实retry Gate，不解锁真实config、snapshot、keys、Docker、PostgreSQL、飞书UAT、部署或切换

## Actual Changes

- `bootstrap.pl`通过调用方私有fd 3发布`P5D1`诊断，普通stdout与stderr保持为零，最终失败保持exit `70`
- `wrapper.sh`只转发固定entry reason allowlist，拒绝未知reason、非法链形与动态错误文本
- `bootstrap.pl`只接受固定wrapper单行或`ENTRY + WRAPPER|ENTRY_EXIT`两行链，拒绝截断诊断与success status携带failure diagnostic
- `entry.mjs`只将固定内部错误映射为allowlisted reason，其他错误统一映射为`UNKNOWN`
- Synthetic review suite统一使用单一suite root并在process exit清理，旧版测试产生的本轮synthetic临时目录已清理
- 原accepted snapshot-preflight candidate保持逐字节不变

## Frozen Candidate Identity

| Member | SHA-256 |
| --- | --- |
| `bootstrap.pl` | `9feb447c776512620401805f14496cbb453cb860c8ff246d86c6d878ed02a470` |
| `catalog.json` | `dfa0249b388696d025610e7df9240d65242588ad2b6f99fc41966bcbd087a844` |
| `catalog.sha256` | `ad1ada779de079df66ead1eb743425261ab8f4baa8dc3ec2f0471d711ca4fea3` |
| `entry.mjs` | `466de20fec41ea9bbdf8199f41ffe5e3af009a8e5bd92d48d1394c09ce7b1227` |
| `execution.json` | `b5ecdfe748ffd4580a9dec0a34aeecd90b872036c182ac1710dd51c27ba7262b` |
| `identity-lib.mjs` | `b3576e208d3e0ad8a01d5b83fb446bddaf8aec9eaa4c12f97618392d6c5b648f` |
| `resource-lifecycle.mjs` | `abde0e72dba5f45ebb9e2e6e18c2068f5adda6919e28de9d8d3d2024ad0afa80` |
| `wrapper.sh` | `a8485464848710a39a36ca93ace065e067ef5380c8a08f285b2761e16fb11854` |

Review evidence manifest SHA-256为`0e04e2f63d4b1d092d77e14b6c3656748e045ad45e83169eac436868b20b4706`

## Verification By Role

| 角色 | 检查项 | 结果 |
| --- | --- | --- |
| 实现 | RED/GREEN、identity/tool/wrapper/entry/repository/stage、allowlist、截断、status一致性、完整E2E | `57/57 PASS` |
| 规格审查 | Task Contract、冻结identity、evidence、原candidate不变性 | `SPEC_APPROVED`，无finding |
| 质量审查 | fd3/fd2、注入与截断、load/spawn、unknown脱敏、cleanup与泄漏 | `QUALITY_APPROVED`，无finding |
| 总控 | catalog、detached digest、权限、inventory、syntax、重复性、suite root absence | PASS |

## Evidence

- Candidate exact inventory为8 files，root `0700`且members `0600`
- Review evidence exact inventory为6 files，root `0700`且members `0600`
- Catalog、detached digest、review manifest与全部members独立复算通过
- 普通stdout与stderr为零，成功路径private diagnostic为空
- 未知reason、非法链、截断单行、截断双行与failure diagnostic配合exit `0`全部fail closed
- Final log的private path、credential、key、URL与snapshot fingerprint扫描为零
- Suite root运行前后均为零，旧式synthetic fixture remaining为零
- 未访问真实config、production snapshot、old key、Keychain、target keys、Docker daemon、PostgreSQL、Dify或飞书

## Residual Risk

- 本轮未进行syscall级访问追踪
- `SIGKILL`或native crash无法触发Node exit handler，但固定suite root允许独立absence审计
- Synthetic结果不构成真实容量、迁移成功或环境可执行性证据

## Accepted Result

`PHASE5-PREFLIGHT-DIAGNOSTIC-CORRECTION`通过synthetic实现、冻结与独立双审

建议下一步只提交一个新的named real retry Gate供用户决策，未获明确接受前所有真实资源与后续环境Gate继续locked
