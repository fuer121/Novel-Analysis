---
checkpoint_id: CP-20260722-PHASE4-TASK4-MERGED-TASK5-STARTED
task_id: PHASE4-TASK5
status: accepted
recorded_at: 2026-07-22T12:54:08+08:00
branch: codex/phase4-task5-legacy-history-api
base_commit: 5a398472682d8a2cf06f48614f5fe4764601751e
head_commit: 5a398472682d8a2cf06f48614f5fe4764601751e
supersedes: none
---

# Phase 4 Task 4 Merged And Task 5 Started

## Scope

记录 PHASE4-TASK4 实现合并，并接受 PHASE4-TASK5 的 Legacy History Read-Only Port And Fixture API Task Contract

### Core Allowed Modules

- `apps/api/src/legacy-analysis.ts`
- `apps/api/src/routes/legacy-analysis.ts`
- `apps/api/src/routes/legacy-analysis.integration.test.ts`
- `apps/api/src/app.ts`
- `test/phase4/fixtures/legacy-analysis-golden.ts`

### Mechanical Adjacent Scope

- directly corresponding tests、types and existing API export or runtime wiring
- existing authentication、book ownership and resource-not-found helpers may be reused without semantic changes
- production may inject an empty read-only reader until Phase 5，tests may inject the accepted fixture reader
- no migration、SQLite adapter、legacy runtime bridge or mutation route

### Success Criteria

- define a replaceable `LegacyAnalysisReader` with only list and detail read methods scoped by book、analysis and actor
- authenticated book owner can list and read fixture-backed legacy analysis through GET-only routes
- non-owner、administrator or otherwise unauthorized access returns resource-not-found without revealing existence
- every legacy summary and detail returns fixed `readOnly: true` and `canResume: false`
- POST、PATCH、DELETE、pause、resume and cancel paths expose no legacy mutation capability and return the existing router's 404 or 405 behavior
- production startup does not expose fixture records by default and may use an explicit empty reader until Phase 5
- the port and routes contain no SQLite handle、`better-sqlite`、old `server/workflows` dependency or legacy runtime import

### Prohibited Changes

- create、update、delete、pause、resume、cancel or any other legacy mutation API
- SQLite、legacy server runtime、filesystem history reader or production fixture data
- new table、migration、formal data import、data conversion or Phase 5 adapter
- advanced analysis、Job、Worker、lease、outbox、Dify、authentication or authorization semantic change
- new external dependency、lockfile、Web behavior or new API product capability beyond the approved GET-only list/detail
- deployment、UAT、cutover、Phase 4 Gate、acceptance criteria or task order change

### Required Verification

- RED integration tests prove the port and GET routes do not yet exist
- authorized owner list/detail、empty list、missing detail and unauthorized resource-not-found matrix
- fixed `readOnly: true` and `canResume: false` response contract
- explicit 404 or 405 evidence for POST、PATCH、DELETE、pause、resume and cancel paths
- production empty-reader and fixture-injection separation test
- `npm run test:integration -- legacy-analysis.integration.test.ts`
- `rg -n "sqlite|better-sqlite|server/workflows" apps/api/src/legacy-analysis.ts apps/api/src/routes/legacy-analysis.ts` returns no dependency match
- API-focused typecheck、`npm run lint`、`git diff --check` and scope audit
- independent specification review followed by code-quality review
- controller verification and CI before merge
- post-merge focused API smoke and `npm run verify:post-merge`

### Escalation Conditions

- accepted fixture shape cannot support list/detail without a contract、data model or production migration change
- existing ownership helpers cannot provide resource-not-found isolation without new authentication or authorization semantics
- route registration requires changing existing advanced-analysis or shared API product behavior
- SQLite、legacy runtime、new dependency、formal data、deployment、Gate or acceptance change is required
- baseline becomes stale、conflicted or blocked

## Evidence

- PHASE4-TASK4 accepted checkpoint merged after independent specification and quality reviews、controller verification and PR #117 CI passed
- PR #117 merged at `5a398472682d8a2cf06f48614f5fe4764601751e`
- post-merge Worker focused tests passed 21，database integration tests passed 36，project source passed 42
- post-merge project check、workspace audit and controller health passed，main and origin/main align and the main worktree is clean
- accepted Phase 4 plan fixes Task 5 as a replaceable GET-only legacy history port with fixture injection and no SQLite dependency

## Accepted Result

PHASE4-TASK4 is merged and PHASE4-TASK5 may proceed from the final governance merge SHA using TDD、one external implementation worktree and independent reviews

This checkpoint does not accept Task 5、unlock Task 6、authorize formal data operations、deployment or cutover
