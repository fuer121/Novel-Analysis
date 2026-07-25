---
checkpoint_id: CP-20260725-PHASE5-REAL-RETRY-CORRECTION-ACCEPTED
task_id: PHASE5-REAL-RETRY-CORRECTION
status: accepted
recorded_at: 2026-07-25T18:45:00+08:00
branch: codex/phase5-real-retry-correction-accepted
base_commit: 68bcfb4b1d437ccb750b6326d81c37d3b21db962
head_commit: 68bcfb4b1d437ccb750b6326d81c37d3b21db962
supersedes: CP-20260725-PHASE5-IDENTITY-V3-V2-ACCEPTED
---

# Phase 5 Real Retry Correction Accepted

## Scope

接受DEC-0027定义的candidate-owned preflight、snapshot-before-key ordering、config SHA binding、tool update guard与atomic BLOCKED publication correction

本checkpoint替代旧V2 identity acceptance，不授权production snapshot、old key、Keychain、Docker、PostgreSQL、Dify、飞书、UAT、deployment、cutover或任何真实retry

## Actual Changes

- Bootstrap增加正式`preflight`与`execute`模式，preflight不接收config或sensitive input
- Entry在任何snapshot访问前重新验证bundle、Node、Perl、shell、Git、Docker、repository anchor与large stage bytes
- Execute config由expected SHA绑定，snapshot deadline、metadata、fingerprint、sidecar、SQLite integrity与custody全部先于key access
- Git、Node与Docker每次实际调用前后复核initial descriptor identity、current path dev/ino与frozen SHA，persistent update在调用前停止，in-call update在调用后BLOCKED并进入cleanup
- BLOCKED evidence与status任一durability failure均回滚status、final claim与staging并fsync parent，rollback不完整返回aggregate failure
- Controller不得在candidate外增加stage checker、snapshot checker或repository-external helper

## Frozen Identity

| Member | SHA-256 |
| --- | --- |
| `bootstrap.pl` | `95d3e01eb03f259ca650c5d35168d477750ce3e740793b593a031e7704930297` |
| `catalog.json` | `116b498e0957c7e1510c0ff6921a22908598bd1477a75551b339fda72b63cdc6` |
| `catalog.sha256` | `5c3b30b3363b3219a917f3b0bdf0ccda304a8f7db94894d5bddaca875ee97e52` |
| `entry.mjs` | `12c97fd44d33e88cb0f9c2991ffc25a9529c74a91b3bb64988cd836e15ad4736` |
| `execution.json` | `b5ecdfe748ffd4580a9dec0a34aeecd90b872036c182ac1710dd51c27ba7262b` |
| `identity-lib.mjs` | `b3576e208d3e0ad8a01d5b83fb446bddaf8aec9eaa4c12f97618392d6c5b648f` |
| `resource-lifecycle.mjs` | `abde0e72dba5f45ebb9e2e6e18c2068f5adda6919e28de9d8d3d2024ad0afa80` |
| `wrapper.sh` | `3051b7e852d2285400fb399c2cd4113f013caa9490260e129e225b67c7f698e5` |

Candidate exact inventory为8个owner-owned `0600`文件，bundle root为`0700`，catalog member digest与detached digest均fresh匹配

## Verification By Role

| 角色 | 验证 | 结果 |
| --- | --- | --- |
| 实现 Agent | exact identity、process wiring、ordering、large stage、config binding、snapshot integrity、tool update、publication、cleanup、leakage | `36/36 PASS` |
| 规格审查 | fresh SHA、catalog、tool identity、anchor/stage、ordering、failure behavior与scope | `SPEC_APPROVED`，无finding |
| 质量审查 | persistent/in-call tool replacement、BLOCKED durability faults、full cleanup、zero output与temp absence | `QUALITY_APPROVED`，无Critical、Important或阻塞finding |
| 总控 | final runner、ordinary output sentinel、repository diff sentinel、project source | `36/36 PASS`、ordinary output sensitive hits `0`、project source valid |

## Prohibited Changes Audit

- 未修改repository product code、migration语义、database schema、capacity threshold、Gate顺序或验收标准
- 未访问production snapshot、old key、Keychain、Docker daemon、PostgreSQL、Dify、飞书或任何真实环境
- 未创建真实database、container、volume、network或retry execution root
- Candidate与synthetic evidence继续位于repository外，Git与CI不包含private path、credential、key、snapshot fingerprint或sensitive data

## Evidence

- Final synthetic runner：`36/36 PASS`
- Independent specification verdict：`SPEC_APPROVED`
- Independent quality verdict：`QUALITY_APPROVED`
- Final ordinary output sensitive scan：`0` hits
- Candidate exact inventory、permissions、catalog member digest与detached digest均由总控和两个reviewer fresh复算
- Started Contract已通过PR #193 CI并合并，main为`68bcfb4b1d437ccb750b6326d81c37d3b21db962`

## Residual Risks

- 恶意同UID ABA replacement不在既有owner-only `0700`/`0600`信任模型内
- `precheck → exec → postcheck`窗口内的普通tool update可能先执行后被post guard发现，结果必须BLOCKED、cleanup且禁止PASS
- 进程崩溃或断电发生在publication rollback本身时，下一次执行必须依赖absence hard stop与manual disposition
- Bootstrap对Node、Perl与shell采用执行前后fresh path/byte验证，不是descriptor-bound execution，在既有root-owned tool与同UID信任模型内接受

## Recommended Next Action

建议允许总控另行提交新的named real retry Execution Gate，Gate必须冻结本checkpoint的8个SHA与单独冻结的config SHA

Gate提交、Gate确认与唯一真实attempt仍须分离；本checkpoint不授权创建Gate确认记录或执行retry

## Accepted Result

接受`PHASE5-REAL-RETRY-CORRECTION`与上述最终frozen identity

原Execution V2授权保持consumed，旧V2 candidate继续invalid，全部真实资源保持locked
