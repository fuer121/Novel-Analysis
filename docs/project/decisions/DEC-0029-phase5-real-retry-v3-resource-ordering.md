---
decision_id: DEC-0029
status: accepted
recorded_at: 2026-07-25T22:28:23+08:00
confidence: high
scope: phase5-real-retry-v3-resource-ordering
supersedes: none
---

# Phase 5 Real Retry V3 Resource Ordering

## Context

Execution V3 accepted Gate要求在snapshot与key access前验证六个预期resource name absence

Frozen candidate只在full execute完成snapshot validation并读取private keys后生成fresh random runId，container与network名称依赖该runId，anonymous storage名称只在container创建后由Docker返回

因此原Gate ordering不可由accepted candidate执行，attempt已在真实资源访问前停止且未消耗

## Decision

采用Gate-only ordering correction，不修改candidate、config或执行语义

Candidate preflight与snapshot-preflight仍必须先于old key access、target key generation与plaintext sentinel delivery

Full execute重新验证snapshot并读取private inputs后生成fresh random runId

Lifecycle必须在创建任何Docker resource前，分别验证该runId对应的两个container名称与两个network名称fresh absence

Container-owned anonymous storage没有可在create前验证的稳定名称，不得猜测或预声明名称

Anonymous storage必须在container创建后由immutable container ID、single anonymous mount identity、destination与read-write contract验证，并随verified container cleanup；fresh container与network absence及local TCP absence仍是cleanup完成条件

## Security Boundary

- Snapshot-preflight先于任何key access的安全顺序不变
- Full execute的identity、repository、stage、config与snapshot二次复验不变
- Resource absence仍先于对应container或network create
- Random runId、两套database隔离、loopback-only binding、immutable cleanup与BLOCKED evidence不变
- Key在resource absence前已private delivery，但任一absence failure必须进入统一key与runtime cleanup并消耗attempt
- 不新增external checker、临时helper、resource API或持久状态

## Locked Scope

本decision不授权读取真实input或启动attempt

本decision不修改migration、database Schema、capacity dataset、threshold、priority、candidate bytes、config bytes、repository anchor、stage artifact、PostgreSQL image、Dify、飞书、部署或切换

## Evidence

- `entry.mjs`在snapshot与private inputs后生成runId并调用lifecycle
- `resource-lifecycle.mjs`在每个container与network create前执行exact fresh-name absence
- Anonymous mount name只存在于container inspect返回值，candidate按immutable container ID与mount contract绑定
- Synthetic lifecycle、ownership、TOCTOU与cleanup evidence已包含在accepted `46/46 PASS` suite
- 用户于`2026-07-25`选择pre-execution blocked checkpoint的Option A

## Source

- [Execution V3 pre-execution blocked](../checkpoints/CP-20260725-PHASE5-REAL-RETRY-EXECUTION-V3-PRE-EXECUTION-BLOCKED.md)
- 用户于`2026-07-25`回复`AA`，总控按其对应的Option A记录

## Accepted Result

允许提交`GATE-PHASE5-REAL-RETRY-EXECUTION-V3-ORDERING-CORRECTION`

Correction Gate明确接受前，唯一attempt保持未开始且未消耗，全部真实资源继续locked
