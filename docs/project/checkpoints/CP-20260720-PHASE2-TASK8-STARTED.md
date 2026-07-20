---
checkpoint_id: CP-20260720-PHASE2-TASK8-STARTED
task_id: PHASE2-TASK8
status: accepted
recorded_at: 2026-07-20T21:50:38+08:00
branch: codex/phase2-task8-acceptance
base_commit: 3f9cd304018497b835b743440c38ea459846b6a8
head_commit: 3f9cd304018497b835b743440c38ea459846b6a8
supersedes: none
---

# Phase 2 Task 8 Started

## Scope

### Core Allowed Modules

- `test/phase2/**`
- `vitest.phase2.config.ts`
- root `package.json` test and typecheck scripts required by Phase 2 verification

### Mechanical Adjacent Scope

- direct test fixtures, types and exports
- reuse or narrow extension of existing `test/phase1/helpers/**` patterns inside `test/phase2/helpers/**`
- existing Vitest configuration and TypeScript test-file lists when directly required to execute Task 8 tests
- test-only API and Worker compositions built from accepted public module boundaries

### Success Criteria

- independent RED proves the Phase 2 end-to-end composition is initially absent for a behavioral reason, not because PostgreSQL is unavailable
- one three-chapter book completes creation, import preview/import, automatic L1, L2 group creation, missing preview and L2 execution
- preview counts equal actual effects and API restart preserves book, job and coverage projections
- Worker lease expiry, restart, outbox replay and pg-boss wake converge to one committed chapter/L1/L2 effect
- synthetic metadata for 3000 chapters and 70000 encrypted facts meets the accepted Task 0 local thresholds
- tests prove no plaintext content, fact body or credential enters scope, events, outbox, logs or errors
- Phase 3 routes, formal migration, deployment and cutover remain absent

### Prohibited Changes

- production API, Worker, domain, database, jobs or Dify implementation behavior
- database schema, migrations, indexes, encryption strategy or destructive data operation
- authentication, authorization, session, CSRF, credential or permission behavior
- new external dependencies or production test hooks
- Phase 3 continuous-question capability, legacy migration, deployment or cutover
- Phase 2 Gate, acceptance criteria or task order

### Required Verification

- observed RED followed by GREEN for vertical workflow, recovery/idempotency and scale behavior
- `npm run verify:legacy`
- `npm run verify:new`
- `npm run dify:manifest:check`
- `npm run test:project-source`
- `npm run project:check`
- `npm run test:integration`
- `npm run test:phase1:e2e`
- `npm run test:phase2:e2e`
- `npm run lint`
- `npm run typecheck:phase2`
- `npm run build -w apps/web`
- `git diff --check`
- Phase 2 scope audit against the controller-provided base

### Escalation Conditions

- RED requires production behavior changes rather than test-only composition
- scale thresholds require schema/index/migration changes or weakening accepted limits
- recovery evidence conflicts with transaction, lease, outbox or idempotency contracts
- any plaintext or credential leakage is observed
- verification requires a new dependency, production test hook, Gate change or Phase 3 capability
- baseline becomes stale, conflicted or blocked

## Evidence

- Task 7 merged checkpoint is accepted and implementation commit is in main
- baseline worktree is clean and `npm test` passes legacy 112/112, contracts 7/7 and new 249 passed with 1 skipped
- PostgreSQL integration environment passed the final Task 7 controller verification with 208/208 tests
- accepted Task 8 plan defines the vertical, recovery, scale and scope-audit behaviors

## Accepted Result

Task 8 may proceed from `3f9cd304018497b835b743440c38ea459846b6a8` using TDD and independent review

This checkpoint does not accept Task 8, pass the Phase 2 Gate, start Phase 3, migrate formal data or authorize deployment
