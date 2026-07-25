---
checkpoint_id: CP-20260725-PHASE5-SNAPSHOT-PREFLIGHT-CORRECTION-ACCEPTED
task_id: PHASE5-SNAPSHOT-PREFLIGHT-CORRECTION
status: accepted
recorded_at: 2026-07-25T21:37:25+08:00
branch: codex/phase5-snapshot-preflight-correction
base_commit: 8396047884bcdf4c3cb383d43363ce65651a07e2
head_commit: 8396047884bcdf4c3cb383d43363ce65651a07e2
supersedes: CP-20260725-PHASE5-REAL-RETRY-EXECUTION-V3-PREPARATION-BLOCKED
---

# Phase 5 Snapshot Preflight Correction Accepted

## Scope

接受DEC-0028定义的candidate-owned snapshot preflight、full execute二次复验与synthetic refreeze

本checkpoint只接受repository-external synthetic candidate，不提交或接受Execution V3 Gate，不授权production snapshot bytes、old key、Keychain、target key generation、Docker、PostgreSQL或任何真实retry

## Actual Changes

- Bootstrap、wrapper与entry新增显式`snapshot-preflight`模式，config与expected SHA由同一candidate验证
- Snapshot preflight复用exact identity、tools、repository anchor、large stage、config、snapshot deadline、fingerprint、sidecar absence、SQLite integrity与custody验证
- Snapshot preflight不要求或访问old key、target encryption key、target HMAC key或plaintext sentinel
- Snapshot preflight不创建runtime、evidence、database、container、volume或network
- Full execute仍从identity开始重新验证repository、stage与snapshot，通过后才读取keys
- Snapshot sidecar恢复既有standalone contract，任何WAL、SHM或其他basename sidecar均fail closed
- SQLite integrity恢复既有exact `PRAGMA integrity_check`并严格要求单行`ok`

## Frozen Identity

| Member | SHA-256 |
| --- | --- |
| `bootstrap.pl` | `fd36177a43ad759f58e61ed57a2f6fd68dda63055a7e1066b1139b640217637e` |
| `catalog.json` | `aec5af215d1353a24c4192de6d16cf03dd4141df8296b338f7cd8769c887d30c` |
| `catalog.sha256` | `5a065f626c63fed6253715433a100dd57a6cb91b364f7aead55451ef45cf242e` |
| `entry.mjs` | `47deabf3adc8efc02d0d3382c1a7fea46b45f9e7185dec58f2ee706627c6ff4d` |
| `execution.json` | `b5ecdfe748ffd4580a9dec0a34aeecd90b872036c182ac1710dd51c27ba7262b` |
| `identity-lib.mjs` | `b3576e208d3e0ad8a01d5b83fb446bddaf8aec9eaa4c12f97618392d6c5b648f` |
| `resource-lifecycle.mjs` | `abde0e72dba5f45ebb9e2e6e18c2068f5adda6919e28de9d8d3d2024ad0afa80` |
| `wrapper.sh` | `0e98156e6ab4c1f5c0c312a457644b17c9e598c60bd8f5bba4136054dbd95537` |

Candidate exact inventory为8个owner-owned `0600`文件，bundle root为`0700`，catalog member digest与detached digest均fresh匹配

既有accepted candidate的8个SHA逐项保持不变，未原地修改

## Verification By Role

| 角色 | 验证 | 结果 |
| --- | --- | --- |
| 实现与总控 | missing-key success、mode wiring、config/repository/stage/snapshot failure、zero runtime、full execute revalidation、WAL/SHM absence、integrity primitive、full synthetic、leakage与identity | `46/46 PASS` |
| 规格审查 | DEC-0028契约矩阵、standalone snapshot contract、exact integrity primitive、catalog与scope | `SPEC_APPROVED`，两个Important finding已关闭 |
| 质量审查 | mode分派、descriptor lifecycle、错误路径、zero resource、zero output、二次复验、测试有效性与旧candidate不变性 | `QUALITY_APPROVED`，无Critical、Important或阻塞finding |
| 总控终验 | fresh synthetic、8-member identity、permissions、catalog、detached digest、旧candidate SHA与Git leakage | 全部通过，repository private reference hits `0` |

## Prohibited Changes Audit

- 未修改repository product code、migration语义、database schema、capacity threshold、Gate顺序或验收标准
- 未修改既有accepted candidate目录
- 未读取V3 config、production snapshot bytes、old key、Keychain或chapter plaintext，未生成target keys
- 未访问Docker daemon、PostgreSQL、Dify、飞书或任何真实环境
- 未创建真实database、container、volume、network、execution root或retry attempt
- Candidate与synthetic evidence继续位于repository外，Git与CI不包含private path、credential、key、snapshot fingerprint或sensitive data

## Evidence

- Controller fresh synthetic result：`46/46 PASS`
- Independent specification verdict：`SPEC_APPROVED`
- Independent quality verdict：`QUALITY_APPROVED`
- Candidate exact inventory：8 files，root `0700`，members `0600`
- Catalog member digests、detached digest与本checkpoint冻结SHA全部fresh匹配
- Accepted旧candidate 8个SHA逐项fresh匹配既有accepted checkpoint
- Repository private reference scan：`0` hits
- Implementation worktree在治理记录前保持clean，HEAD为`8396047884bcdf4c3cb383d43363ce65651a07e2`

## Residual Risks

- 本轮没有执行syscall级key-access或file descriptor计数审计，实现中snapshot preflight没有引用key path字段，missing-key与静态调用链证据已覆盖契约
- 本轮没有对每个bootstrap失败类型逐项重复zero-output测试，wrapper固定丢弃child stdio且bootstrap拒绝自身任何ordinary output
- 本轮没有访问真实snapshot或真实执行环境，必须留待后续named Gate单独授权

## Recommended Next Action

建议总控基于本checkpoint的8个SHA与既有frozen config SHA另行准备`GATE-PHASE5-REAL-RETRY-EXECUTION-V3`

Gate提交、用户明确接受与唯一真实attempt必须继续分离，本checkpoint不授权任何真实输入访问或执行

## Accepted Result

接受`PHASE5-SNAPSHOT-PREFLIGHT-CORRECTION`与上述最终frozen identity

Execution V3 Gate尚未提交，全部真实资源、真实retry与Feishu UAT继续locked
