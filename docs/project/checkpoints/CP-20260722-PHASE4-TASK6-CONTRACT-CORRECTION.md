---
checkpoint_id: CP-20260722-PHASE4-TASK6-CONTRACT-CORRECTION
task_id: PHASE4-TASK6
status: accepted
recorded_at: 2026-07-22T15:45:10+08:00
branch: codex/phase4-task6-analysis-workspace
base_commit: 0f2d2e0e9bf2d57bc2005a3999939123554dfcf4
head_commit: e488f913b35c3e22717b122c44c2eebdf2b4d6ca
supersedes: none
---

# Phase 4 Task 6 Contract Correction

## Scope

Task 6 specification review proved the accepted pause/resume UI cannot be correct with the current backend behavior：`JobControls` changes the Job state for pause and resume but synchronizes `analysis_runs.status` only for cancel，while the owner run API projects `analysis_runs.status`

The user explicitly approved the minimum correction on 2026-07-22：synchronize Job and analysis run status for pause/resume without adding a state、table、migration or API

## Corrected Core Allowed Modules

The original Task 6 Web scope remains accepted，with this narrow addition

- `packages/jobs/src/job-controls.ts`
- `packages/jobs/src/job-controls.integration.test.ts`
- direct existing analysis control integration tests only when required to prove owner API projection

## Required Behavior

- pause updates a linked active `analysis_runs.status` to `paused` in the same transaction and under the same locked Job authority as the Job transition
- resume updates a linked paused `analysis_runs.status` to `queued` in the same transaction and under the same locked Job authority as the Job transition
- cancel retains its existing linked analysis run synchronization
- non-analysis Jobs remain unchanged when no linked analysis run exists
- idempotent control replay returns the original result without applying a second run transition、event、audit or outbox effect
- audit failure、event failure、outbox failure or transaction rollback leaves Job and linked analysis run in their original coordinated state
- invalid、late and concurrent control transitions preserve existing Job state-machine authority and cannot create Job/run divergence
- Task 6 Web shows controls only from authoritative returned run state and does not fabricate the pause/resume transition locally

## Additional Required Verification

- RED PostgreSQL integration proves pause and resume previously left a linked run stale
- GREEN integration proves queued/running/retrying → paused and paused → queued coordination
- replay、rollback、non-analysis Job、invalid terminal transition and concurrent completion/control coverage
- owner analysis API integration proves pause response is subsequently observable as paused and resume as queued
- all five specification findings receive focused regressions：mixed result fidelity、sheet-name uniqueness、drawer/modal focus、navigation/idempotency recovery and four-mode/error/viewport assertions
- repeat specification review before quality and visual quality reviews

## Prohibited Changes

- new Job or analysis run state、new API、new table、migration or dependency
- change to lease、attempt、outbox delivery、retry、cancel、completion or hard-delete semantics
- broad Job architecture refactor、new control service or duplicated state machine
- optimistic client-only status authority
- formal data、deployment、UAT、cutover、Gate or task order change

## Evidence

- specification review reproduced a queued analysis run that remained `queued` after its Job changed to `paused`，making Resume unreachable in the owner Web flow
- `packages/jobs/src/job-controls.ts` currently updates linked `analysis_runs` only inside the cancel branch
- existing database status values already include `queued`、`running`、`retrying`、`paused`、`completed`、`failed` and `cancelled`，so no schema change is required
- the user confirmed the recommended minimum correction after the scope、tradeoff and prohibited expansion were stated

## Accepted Result

PHASE4-TASK6 may correct linked analysis run pause/resume coordination and the five reported Web specification findings within the scopes above

This correction does not accept Task 6、unlock Task 7 or authorize any other backend、data、security、deployment or Gate change
