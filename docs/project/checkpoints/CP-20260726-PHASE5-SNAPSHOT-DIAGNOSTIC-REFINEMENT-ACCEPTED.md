---
checkpoint_id: CP-20260726-PHASE5-SNAPSHOT-DIAGNOSTIC-REFINEMENT-ACCEPTED
task_id: PHASE5-SNAPSHOT-DIAGNOSTIC-REFINEMENT
status: accepted
recorded_at: 2026-07-26T14:30:00+08:00
branch: codex/phase5-snapshot-diagnostic-refinement-accepted
base_commit: 5c449a30dcec4137edbbe9b5404f1cebfa6dc9ba
head_commit: 5c449a30dcec4137edbbe9b5404f1cebfa6dc9ba
supersedes: CP-20260726-PHASE5-REAL-RETRY-V4-BLOCKED-DISPOSITION-ACCEPTED
---

# Phase 5 Snapshot Diagnostic Refinement Accepted

## Scope

接受repository-external synthetic candidate中的snapshot-preflight固定原因码细化、重新冻结与独立双审结果

本checkpoint不授权读取真实config、snapshot、old key或Keychain，不生成target keys，不连接Docker或database，也不授权真实诊断或retry

## Actual Changes

- Snapshot-preflight既有固定失败分支加入entry、wrapper与bootstrap三层allowlist
- Malformed config、catalog与execution JSON按调用上下文分别映射为`INVALID_CONFIG`、`CATALOG_INVALID`与`EXECUTION_IDENTITY_MISMATCH`
- SQLite open、prepare与integrity异常统一映射为`SNAPSHOT_INTEGRITY_FAILED`，不暴露动态异常文本
- Runtime pre-absence使用既有`RUNTIME_RETAINED`固定原因
- Execute-only `RESOURCE_NOT_ABSENT`保持`UNKNOWN`，没有扩大full execute诊断语义
- Unknown动态错误继续统一映射为`UNKNOWN`
- Execution、identity、resource lifecycle、migration、capacity、publication与cleanup语义未修改

## Frozen Candidate Identity

| Member | SHA-256 |
| --- | --- |
| `bootstrap.pl` | `dc42aa0760fa5ebe762514ce59ab7b36c5c173ae14500f187380d6e2124fe963` |
| `catalog.json` | `4963b9d6f7094cf952b8f86a7ccd84ca5c9f31c75a9a2b23fa544ee722bfe678` |
| `catalog.sha256` | `d564282b45db67c06343aa001df6028fa8cc652b725364c3fcd09d2adcfcdb82` |
| `entry.mjs` | `85c706328df054bf735a5c2df078d75716716bc44f4c618ca23fea35dc48d1de` |
| `execution.json` | `b5ecdfe748ffd4580a9dec0a34aeecd90b872036c182ac1710dd51c27ba7262b` |
| `identity-lib.mjs` | `b3576e208d3e0ad8a01d5b83fb446bddaf8aec9eaa4c12f97618392d6c5b648f` |
| `resource-lifecycle.mjs` | `abde0e72dba5f45ebb9e2e6e18c2068f5adda6919e28de9d8d3d2024ad0afa80` |
| `wrapper.sh` | `c119823a5f30dc7df93b6d2c02eaf7e9402b0b35153e81ff6d60759d42e7d96a` |

Review evidence manifest SHA-256为`f1fce155dca17de3397feac24a1262350240896179890d8207f77fabe9dab625`

## Verification By Role

| 角色 | 检查项 | 结果 |
| --- | --- | --- |
| 实现 | TDD RED/GREEN、19 reason注入、malformed JSON、八类失败矩阵、完整E2E | `63/63 PASS` |
| 规格审查 | 分支映射、scope、冻结identity与finding closure | `SPEC_APPROVED`，3个Important finding closed，无新finding |
| 质量审查 | 动态异常脱敏、伪造、截断、status、普通输出、cleanup与泄漏 | `QUALITY_APPROVED`，Important finding closed，无新finding |
| 总控 | Inventory、permissions、catalog、detached digest、manifest、base不变性与suite root | PASS |

## Evidence

- Candidate exact inventory为8 files，review evidence exact inventory为6 files
- Candidate与evidence roots为`0700`，所有members为`0600`
- Catalog、detached digest、review manifest与全部members独立复算通过
- `execution.json`、`identity-lib.mjs`与`resource-lifecycle.mjs`和V4 accepted base逐字节相同
- 19个refined reasons逐项通过entry、wrapper、bootstrap链，exit `70`且ordinary stdout/stderr为零
- Malformed config、catalog与execution通过真实synthetic bootstrap链验证
- Dynamic SQLite异常不再退化为`UNKNOWN`
- Forged reason、非法链、截断与failure diagnostic配success status继续fail closed
- Final evidence敏感路径、credential、private key与database URL扫描为零
- Suite root运行后为零
- 未访问真实config、snapshot、keys、Keychain、Docker、PostgreSQL、Dify或飞书

## Residual Risk

- Synthetic-only审查未使用syscall级访问追踪
- 本结果不证明当前真实snapshot将产生哪一个固定reason
- 任何只读真实诊断仍需新的named Gate，且不得继承V4已消耗attempt

## Accepted Result

`PHASE5-SNAPSHOT-DIAGNOSTIC-REFINEMENT`通过synthetic实现、冻结与独立双审

下一步只允许提交一个新的只读真实snapshot诊断Gate供用户决策；真实诊断、retry、飞书UAT、部署与切换继续locked
