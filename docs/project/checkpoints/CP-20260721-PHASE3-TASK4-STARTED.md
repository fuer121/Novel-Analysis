---
checkpoint_id: CP-20260721-PHASE3-TASK4-STARTED
task_id: PHASE3-TASK4
status: accepted
recorded_at: 2026-07-21T11:38:32+08:00
branch: codex/phase3-task4-started
base_commit: 2195e09389bc9b17fa9f108c1ba0515caf7817c9
head_commit: 2195e09389bc9b17fa9f108c1ba0515caf7817c9
supersedes: none
---

# Phase 3 Task 4 Started

## Scope

### Core Allowed Modules

- `packages/jobs/src/query/query-job.ts`
- `packages/jobs/src/query/query-job.integration.test.ts`
- `packages/jobs/src/index.ts`
- `apps/api/src/routes/query-sessions.ts`
- `apps/api/src/routes/query-sessions.integration.test.ts`
- `apps/api/src/app.ts`

### Mechanical Adjacent Scope

- directly corresponding tests, types and package exports
- existing API or jobs test helpers and runtime wiring only when directly required by the approved routes and service
- no database repository, migration, public contract, package manifest, lockfile or dependency changes

### Success Criteria

- private session owner and admin can read, while another member receives 404
- shared team members can read and create their own turn but cannot manage the session or another member's turn
- turn range may equal or narrow the session default range but cannot expand it
- preview returns the approved book, group, effective range, queryable chapter count, coverage gaps, execution versions and estimated queue position without plaintext persistence
- scope hash includes session, group, range, question HMAC, L2 coverage signatures, summary workflow version, recall policy version and latest three question HMAC values
- range, question context or index/workflow version drift invalidates an old scope hash with stable 409 behavior
- create turn requires explicit preview confirmation and atomically inserts one encrypted turn, one `l2-query` job, one `l2-query` step and one `jobs.query.wake` outbox row
- same idempotency key and same payload returns the same result, while changed payload returns a stable conflict without duplicate rows
- retry-summary and local-summary reference the original immutable evidence snapshot and create only their approved step type
- all write routes use existing Feishu session, server-side RBAC, CSRF and `Idempotency-Key`
- HTTP errors expose stable codes only and do not leak question, title, answer, fact body, credential or raw provider errors
- existing books, indexes and jobs routes remain unchanged

### Prohibited Changes

- database schema, migration or Query repository changes
- authentication, CSRF, RBAC, visibility or sharing policy changes
- Worker, Query executor, queue consumer, lease or outbox protocol changes
- Web UI, Dify YAML, manifest, credentials or real keys
- new external dependencies, package manifest or lockfile changes
- embeddings, vector database, multi-index-group query or member-level ACL
- Phase 3 Tasks 5-7 behavior, Phase 4 behavior, Gate, formal data, deployment or cutover changes

### Required Verification

- observable authorization, preview, transaction and idempotency RED before production code
- `npm run test:integration -- packages/jobs/src/query apps/api/src/routes/query-sessions.integration.test.ts`
- `npm run typecheck:phase1`
- `npm run lint`
- `git diff --check`
- transaction rollback, duplicate request, scope drift, plaintext sentinel and route regression checks
- independent specification review followed by independent code-quality review
- controller `npm run verify:controller`, Phase 1 and Phase 2 E2E, Phase 2 typecheck and Web build before merge
- post-merge focused integration smoke and `npm run verify:post-merge`

### Escalation Conditions

- the existing Query repository or Job transaction boundary cannot support atomic turn/job/step/outbox creation without modification
- scope hash needs plaintext question, answer, fact body or credential persistence
- a new database object, migration, public contract, dependency, authentication or permission semantic becomes necessary
- retry or local summary requires changing evidence immutability, Job state machine, lease or outbox protocol
- API cannot preserve private 404, team-member ownership and stable error behavior within the approved routes
- Worker, Web, Dify, Task 5+, Gate, formal data, deployment, cutover or another irreversible action becomes necessary
- baseline becomes stale, conflicted or blocked

## Evidence

- PHASE3-TASK3 was merged by PR #86 and accepted by `CP-20260721-PHASE3-TASK3-MERGED`
- main and origin/main align at `2195e09389bc9b17fa9f108c1ba0515caf7817c9` with a clean primary workspace
- the approved Phase 3 design and plan define Query sessions API, preview and transactional Query job as Task 4
- the user explicitly requested continued progression of Task 4 on 2026-07-21
- current `baseline_status` is `current` with no evidence conflict or blocker

## Accepted Result

PHASE3-TASK4 may proceed from the final merge SHA of this Started Contract using TDD, one implementation worktree and independent specification and code-quality review

This checkpoint does not accept Task 4, unlock Task 5, change data or permission policy, change the Phase Gate, operate on formal data or authorize deployment
