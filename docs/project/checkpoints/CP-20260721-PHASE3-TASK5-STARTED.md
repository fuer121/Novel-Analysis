---
checkpoint_id: CP-20260721-PHASE3-TASK5-STARTED
task_id: PHASE3-TASK5
status: accepted
recorded_at: 2026-07-21T13:16:15+08:00
branch: codex/phase3-task5-started
base_commit: b187d0e7b9b2f6cbc576531fdfc0ba2ad3afa1bb
head_commit: b187d0e7b9b2f6cbc576531fdfc0ba2ad3afa1bb
supersedes: none
---

# Phase 3 Task 5 Started

## Scope

### Core Allowed Modules

- `apps/worker/src/query-executor.ts`
- `apps/worker/src/query-executor.integration.test.ts`
- `apps/worker/src/worker.ts`
- `apps/worker/src/worker.test.ts`
- `apps/worker/src/main.ts`
- `packages/jobs/src/boss.ts`
- `packages/jobs/src/outbox-dispatcher.ts`

### Mechanical Adjacent Scope

- directly corresponding Worker、jobs、integration tests、types、exports and existing runtime wiring
- existing Worker fakes and Phase 1/2 harness wiring only when directly required by the approved `WorkerBoss.work` signature or Query executor composition
- no database schema、migration、Query API、public contract、package manifest、lockfile 或 dependency changes

### Success Criteria

- Query executor recalls and commits one immutable evidence snapshot, then saves one encrypted answer exactly once
- no-evidence turns produce an explicit no-evidence result without calling Dify
- provider retry exhaustion keeps evidence and moves the turn to `awaiting_fallback`
- retry-summary reuses the original evidence snapshot version and local-summary produces a `degraded` Markdown result only from adopted evidence
- previous model answers never enter intent、recall、Dify payload、evidence、events、outbox、attempt errors 或 logs
- Dify boundary lease expiry can be recovered by Worker B while Worker A's late result becomes `already-completed` or `terminal-noop`
- recovery yields one authoritative answer、one immutable evidence snapshot and attempts `abandoned, completed`
- `jobs.wake` and `jobs.query.wake` use separate pg-boss consumer registrations while sharing the existing JobWorker、lease service、dispatcher and shutdown lifecycle
- a blocked background consumer cannot prevent an interactive Query wake from reaching its terminal or awaiting state
- exact outbox replay and duplicate wake do not create duplicate evidence、answer、attempt or terminal events
- `stop()` waits for both consumers and their active promises
- `QUERY_CONCURRENCY` defaults to 10 and accepts only safe integers from 1 through 20
- missing `DIFY_ANALYSIS_SUMMARY_KEY` returns Query `configuration_error` without preventing chapter、L1 或 L2 Worker startup
- existing background jobs、lease、outbox、shutdown and Phase 1/2 recovery behavior remain unchanged

### Prohibited Changes

- database schema、migration、Query repository 或 evidence immutability semantics
- Query HTTP API、session sharing、RBAC、CSRF 或 HMAC key policy
- public Job、turn status、lease、attempt 或 outbox protocol changes
- Web UI、Dify YAML、manifest、credentials 或 real keys
- new queue system、external dependency、package manifest 或 lockfile
- embeddings、vector database、multi-index-group query 或 member-level ACL
- Phase 3 Tasks 6-7 behavior、Phase 4、Gate、formal data、deployment 或 cutover changes

### Required Verification

- observable executor、interactive queue、lease expiry、late result and outbox replay RED before production code
- `npm run test:integration -- apps/worker/src/query-executor.integration.test.ts apps/worker/src/worker.test.ts`
- `npm run test:integration`
- `npm run test:phase1:e2e`
- `npm run test:phase2:e2e`
- `npm run typecheck:phase2`
- `npm run lint`
- `git diff --check`
- plaintext/credential sentinel scan、attempt/evidence/answer count audit and scope audit
- independent specification review followed by independent code-quality review
- controller `npm run verify:controller` and Web build before merge
- post-merge focused recovery smoke and `npm run verify:post-merge`

### Escalation Conditions

- recovery or late-result safety requires changing the accepted lease、attempt、Job state machine、outbox protocol or database schema
- Query executor cannot freeze and revalidate evidence version through existing repository and claim boundaries
- dual queue isolation requires a new message system or independent JobWorker implementation
- Query runtime configuration requires changing existing chapter、L1 或 L2 startup semantics
- question、answer、fact body、credential or raw provider error enters ordinary columns、events、outbox、attempts or logs
- Query API、Web、Dify DSL、dependency、public contract、Task 6+、Gate、formal data、deployment、cutover or another irreversible action becomes necessary
- baseline becomes stale、conflicted 或 blocked

## Evidence

- PHASE3-TASK4 was merged by PR #89 and accepted by `CP-20260721-PHASE3-TASK4-MERGED`
- main and origin/main align at `b187d0e7b9b2f6cbc576531fdfc0ba2ad3afa1bb` with a clean primary workspace
- the approved Phase 3 design and plan define Query executor、fallback、interactive queue and recovery as Task 5
- the user explicitly requested continued progression on 2026-07-21
- current `baseline_status` is `current` with no evidence conflict or blocker

## Accepted Result

PHASE3-TASK5 may proceed from the final merge SHA of this Started Contract using TDD, one implementation worktree and independent specification and code-quality review

This checkpoint does not accept Task 5、unlock Task 6、change lease/outbox/data/security policy、change the Phase Gate、operate on formal data or authorize deployment
