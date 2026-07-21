---
checkpoint_id: CP-20260721-PHASE3-TASK7-STARTED
task_id: PHASE3-TASK7
status: accepted
recorded_at: 2026-07-21T19:03:43+08:00
branch: codex/phase3-task7-started
base_commit: f701e648d19cd8e1c22ac98d385acdbba81cfd35
head_commit: f701e648d19cd8e1c22ac98d385acdbba81cfd35
supersedes: none
---

# Phase 3 Task 7 Started

## Scope

### Core Allowed Modules

- create `test/phase3/continuous-query.e2e.test.ts`
- create `test/phase3/query-recovery.e2e.test.ts`
- create `test/phase3/query-scale.integration.test.ts`
- create `test/phase3/helpers/phase3-harness.ts`
- create `vitest.phase3.config.ts`
- modify `package.json`

### Mechanical Adjacent Scope

- direct type imports and existing Phase 1/2 test helper reuse required by the six core files
- existing test-only process、database cleanup、fake provider and timing wiring when directly required by Phase 3 verification
- no production runtime wiring、new test hook、dependency or lockfile change

### Required Behavior

- independently compose disposable PostgreSQL、real Express API、real pg-boss Worker and controlled fake summary provider
- prove two turns in one session resolve the same target while each turn performs fresh recall and stores an independent evidence version
- prove the second turn does not feed the first answer into Dify input and every returned evidence item belongs to the selected turn
- prove adopted、candidate、excluded、gap and safe Trace projections remain separately observable through authorized HTTP reads
- drive provider retry exhaustion to `awaiting_fallback`, restart API and Worker, then prove retry-summary and local-summary both reuse the immutable evidence version
- prove replay、duplicate wake、late result and restart converge without duplicate answer、attempt or evidence snapshot
- submit 10 users concurrently while one background index step is blocked and prove interactive Query jobs reach terminal or awaiting state without duplicate authoritative results
- measure local fake-provider Query completion p95 below 2 seconds and authorized session、turn and evidence HTTP read p95 below 500ms; these are local acceptance thresholds, not production capacity commitments
- scan chapter、fact、question、answer、session-title and credential sentinels across job fields、step output、events、outbox、attempts、audit metadata、ordinary Query JSON columns and captured API/Worker logs
- controlled raw provider errors may contain sentinels only inside the fake boundary; persisted state、public response and captured application logs expose stable error codes only

### Prohibited Changes

- any production code under `apps/` or `packages/`
- database schema、migration、repository semantics、transaction、lease、attempt、outbox or evidence immutability behavior
- Query API、public contracts、RBAC、sharing、CSRF、HMAC、authentication or credential policy
- production-only test hook、SQLite、embedding、new external dependency or lockfile change
- legacy `server/`、`src/`、`test/service.test.js` or the five Dify YAML exports
- Phase 4 route or capability、new DSL、cross-index-group behavior、formal data、deployment or cutover
- Phase 3 Gate、acceptance criteria or task order change

### Required Verification

- observable RED because the independent Phase 3 harness、config and test command do not yet exist; RED must not be caused by PostgreSQL、fixture or credential unavailability
- focused RED/GREEN for continuous-query、recovery and scale/security suites
- `npm run verify:legacy`
- `npm run verify:new`
- `npm run dify:manifest:check`
- `npm run test:project-source`
- `npm run project:check`
- `npm run test:integration`
- `npm run test:phase1:e2e`
- `npm run test:phase2:e2e`
- `npm run test:phase3:e2e`
- `npm run lint`
- `npm run typecheck:phase3`
- `npm run build -w apps/web`
- `git diff --check`
- plaintext、credential、production-hook、dependency and exact six-file scope audit
- independent specification review followed by independent code-quality review
- controller full verification、CI and post-merge Phase 3 smoke

### Escalation Conditions

- any required evidence cannot be produced through existing public composition without production code change
- current API、Worker、repository or contract behavior contradicts an accepted Task 1-6 invariant
- performance threshold requires production tuning rather than test harness correction
- plaintext or credential sentinel reaches persisted metadata、public response or captured application logs
- new schema、dependency、test hook、security policy or formal-data operation becomes necessary
- Phase 3 Gate、acceptance criteria、task order、deployment or cutover would change
- baseline becomes stale、conflicted or blocked

## Evidence

- PHASE3-TASK6 merged through PR #98 and is accepted by `CP-20260721-PHASE3-TASK6-MERGED`
- main and origin/main align at `f701e648d19cd8e1c22ac98d385acdbba81cfd35` with a clean primary workspace
- the approved Phase 3 plan defines exactly six Task 7 core files and the independent behavior、recovery、concurrency、performance and plaintext evidence
- Query contracts、database、API、Worker and responsive Web workspace are already merged; Task 7 adds independent evidence only
- the original plan's pre-implementation RED wording is no longer reproducible after Tasks 1-6, so RED is correctly anchored to the missing independent Phase 3 harness and command without changing acceptance behavior
- current `baseline_status` is `current` with no evidence conflict or blocker

## Accepted Result

PHASE3-TASK7 may proceed from the final merge SHA of this Started Contract using TDD, one implementation worktree and independent specification and code-quality review

This checkpoint does not accept Task 7、change production behavior、pass the Phase 3 Gate、operate on formal data or authorize deployment
