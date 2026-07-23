---
checkpoint_id: CP-20260723-PHASE5-TASK3-MERGED-TASK4-STARTED
task_id: PHASE5-TASK4
status: accepted
recorded_at: 2026-07-23T12:32:53+08:00
branch: codex/phase5-task3-merged-task4-started
base_commit: 78421b32d812f281480bca0e2af403484f6a1062
head_commit: 78421b32d812f281480bca0e2af403484f6a1062
supersedes: none
---

# Phase 5 Task 3 Merged And Task 4 Started

## Scope

记录 PHASE5-TASK3 合并，并接受 PHASE5-TASK4 的 existing-table derived analysis readiness、server-side analysis lock 与 book workspace disabled-state Task Contract

### Core Allowed Modules

- library contracts and exports
- database library derived readiness query over existing tables
- existing books、query sessions and advanced analysis routes
- existing book workspace page and library types

### Mechanical Adjacent Scope

- directly corresponding contracts/database/API/Web tests
- existing exports、types、styles and runtime wiring
- test fixture setup required to represent existing chapter/index/job states

### Success Criteria

- strict readiness contract exposes waiting/building_l1/building_l2/available/failed、chapter/L1/L2 counts、stable progress、analysisAvailable and nullable blocking code
- readiness derives only from existing chapters、fresh L1、base-group fresh L2 and current library Job states in one repository boundary
- `available` requires positive chapter total and complete fresh L1 plus complete base-group L2 coverage
- zero index、active L1、complete L1 with active L2、failed job、complete coverage and missing base group are independently tested
- `GET /books/:id/analysis-readiness` returns strict parsed readiness under existing book access rules
- Query turn create and Advanced Analysis preview/create re-read readiness server-side and return HTTP 409 `{ error: analysis_rebuild_incomplete }` when unavailable
- Query session/history and Advanced Analysis read/history surfaces remain available
- book workspace keeps Query/Advanced Analysis entry points visible with `aria-disabled` and `索引重建中` progress, blocks navigation without layout shift and unlocks after refetch

### Prohibited Changes

- new table、migration、persistent readiness state or rebuild scheduler
- Prompt、Dify workflow/provider、L1/L2 Job/lease/outbox semantics or index freshness rules
- bypass of existing L1/L2 job semantics
- new auth/permission/sharing semantics or unrelated API product capability
- formal migration execution、real snapshot/key、Feishu、UAT、deployment or cutover

### Required Verification

- observed RED across contracts、database derivation and Web lock behavior
- focused contract tests
- real synthetic PostgreSQL readiness integration tests and existing migration schema roundtrip tests
- focused books、query-sessions and advanced-analysis API integration tests
- focused Web library tests including disabled navigation、progress geometry and refetch unlock
- explicit no-migration scope audit
- focused lint、typecheck、`git diff --check` and complete scope audit
- independent specification review followed by independent quality review
- controller `npm run verify:controller`、CI and post-merge smoke

### Escalation Conditions

- readiness cannot be derived exactly from existing tables or requires new persistent state
- correct fail-closed behavior requires changing Job、index freshness、Prompt/Dify、auth or permission semantics
- server-side analysis lock would block approved read/history behavior
- implementation requires new dependency、migration、scheduler、architecture/data/security policy、Gate or acceptance change
- any real data、credential、external system、deployment or cutover access is needed
- baseline becomes stale、conflicted or blocked

## Evidence

- PR #139 merged as `78421b32d812f281480bca0e2af403484f6a1062` after CI passed
- Task 3 final specification was `SPEC_COMPLIANT` and final quality was `QUALITY_APPROVED`
- post-merge Phase 5 migration E2E passed 2/2 and project source check passed
- local main and origin/main align at `78421b32d812f281480bca0e2af403484f6a1062` with clean main worktree
- approved Phase 5 plan defines Task 4 as read-model and fail-closed access only, with no new persistent object

## Accepted Result

PHASE5-TASK3 is merged and PHASE5-TASK4 may proceed from this checkpoint's final governance merge SHA using TDD, one implementation worktree and fresh implementer、specification reviewer、quality reviewer agents

This checkpoint does not accept Task 4, unlock Task 5, authorize a rebuild scheduler, or permit formal data、Dify、Feishu、UAT、deployment or cutover operations
