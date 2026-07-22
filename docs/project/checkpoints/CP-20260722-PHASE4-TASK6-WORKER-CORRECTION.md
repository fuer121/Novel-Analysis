---
checkpoint_id: CP-20260722-PHASE4-TASK6-WORKER-CORRECTION
task_id: PHASE4-TASK6
status: accepted
recorded_at: 2026-07-22T16:44:23+08:00
branch: codex/phase4-task6-analysis-workspace
base_commit: c8238e6145ddcdbb55790859bc6ab7f8d8e161ec
head_commit: ca0b17bb0eda140b5a26de0402074b2f3c613fc5
supersedes: none
---

# Phase 4 Task 6 Worker Correction

## Scope

Task 6 specification re-review proved that a Worker holding an old claim can acquire the Job lock after pause，because advanced-analysis claim validation does not reject `paused`，then commit a part and write the linked run back to `running`

The user explicitly approved the minimum Worker correction and durable four-viewport verification evidence on 2026-07-22

### Additional Core Allowed Modules

- `apps/worker/src/analysis-executor.ts`
- `apps/worker/src/analysis-executor.integration.test.ts`
- direct existing linked analysis control/Worker race integration tests
- direct Task 6 browser verification test or script under existing test scope when no new dependency is required

### Required Behavior

- advanced-analysis claim validation treats a locked `paused` Job as a safe paused boundary and rejects part、checkpoint、failure and final commits from the old claim
- pause winning the Job lock leaves both Job and linked analysis run `paused` after the late Worker path returns
- Worker winning the Job lock may finish only the already-authorized commit before pause then pause must coordinate the resulting run state；no committed Job/run divergence may be observable after either transaction completes
- cancel、terminal、expired lease、superseded attempt and completed checkpoint reuse retain existing semantics
- resume continues through the existing queued Job、outbox and lease recovery path without a new retry or state semantic
- four accepted viewports have reproducible assertions for root/body horizontal scroll、unintended overflow、component overlap and drawer focus restoration，with screenshots retained as review evidence outside committed product assets

### Additional Required Verification

- RED linked analysis Worker race reproduces `Job=paused` and `run=running`
- GREEN deterministic pause-first and Worker-first race cases under real PostgreSQL row locks
- focused checkpoint、part、failure and final late-claim rejection matrix
- existing Worker recovery、cancel、lease、outbox and control-completion suites remain green
- repeat browser verification at 1440x900、1280x800、768x800 and 390x760 with reproducible command or script evidence
- repeat specification review before code-quality and visual-quality review

## Prohibited Changes

- new state、API、table、migration、dependency、queue、retry loop or outbox semantic
- lease duration、attempt numbering、claim acquisition or completed checkpoint reuse change
- broad Worker、Job or analysis executor refactor
- committed screenshot assets or test-only product behavior
- formal data、deployment、UAT、cutover、Gate or task order change

## Evidence

- `validateClaim` currently rejects cancelled、completed and failed Jobs but not paused Jobs
- `commitPart` sets `analysis_runs.status` to running after claim validation，so pause-first can persist a Job/run split
- existing control-completion race tests use example Jobs and do not create linked analysis runs or execute the advanced-analysis commit path
- Task 6 correction screenshots exist for all four viewports，but the accepted contract also requires reproducible no-scroll and no-overlap assertions
- the user confirmed the narrow Worker and verification scope after the concurrency risk and prohibited expansion were stated

## Accepted Result

PHASE4-TASK6 may reject paused advanced-analysis late commits and add durable four-viewport verification within the exact scopes above

This correction does not accept Task 6、unlock Task 7 or authorize any other Worker、data、security、deployment or Gate change
