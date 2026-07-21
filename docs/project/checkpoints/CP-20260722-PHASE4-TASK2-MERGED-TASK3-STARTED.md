---
checkpoint_id: CP-20260722-PHASE4-TASK2-MERGED-TASK3-STARTED
task_id: PHASE4-TASK3
status: accepted
recorded_at: 2026-07-22T01:00:27+08:00
branch: codex/phase4-task3-analysis-api
base_commit: 93f1e635be9f122e589f894c5eda2db984c66d88
head_commit: 93f1e635be9f122e589f894c5eda2db984c66d88
supersedes: none
---

# Phase 4 Task 2 Merged And Task 3 Started

## Scope

记录 PHASE4-TASK2 实现合并并接受 PHASE4-TASK3 的私有模板 API、事务化 run 创建与 terminal hard delete Task Contract

### Core Allowed Modules

- `packages/jobs/src/analysis/analysis-job.ts`
- `packages/jobs/src/analysis/analysis-job.integration.test.ts`
- `packages/jobs/src/index.ts`
- `apps/api/src/routes/advanced-analysis.ts`
- `apps/api/src/routes/admin-analysis-jobs.ts`
- `apps/api/src/routes/advanced-analysis.integration.test.ts`
- `apps/api/src/app.ts`

### Mechanical Adjacent Scope

- directly corresponding contracts, tests, types, exports and existing app runtime wiring
- accepted Task 2 analysis repository may receive only directly required transaction-aware methods or owner projections within its existing module
- existing Job, outbox, audit, session, CSRF and authorization primitives may be reused but not behaviorally redefined
- no Worker, Web, Dify or legacy runtime wiring

### Success Criteria

- authenticated owners can create, list, read and version private templates for books they can access，其他成员与管理员不能读取 Prompt、Schema、part 或 result content
- preview validates book、template、index ownership、chapter range and mode，返回执行版本、scope hash、source summary 与 accepted public projection，且不创建持久化对象
- create recomputes the authoritative selection under one database transaction and owner/request idempotency lock，stale scope hash is rejected
- one successful create atomically commits exactly one analysis run、one `advanced-analysis` Job、approved initial JobStep graph、initial event、one outbox wake-up、audit record and encrypted snapshots
- same owner and request ID with identical canonical input replays the original run，conflicting canonical input is rejected，concurrent duplicates cannot create extra run、Job、step、event、outbox or audit rows
- transaction failure at any persistence stage rolls back the complete run/Job graph and leaves no orphan or plaintext sensitive content
- owner routes use strict Zod input/output contracts、session and CSRF middleware，unauthorized private resources return resource-not-found without content enumeration
- administrator route returns metadata only and reuses existing Job control operations without resolving template、part、result or encrypted diagnostics
- hard delete is owner-only and terminal-only，locks run and Job，rechecks authority and terminal state after lock acquisition，then atomically records retained `advanced_analysis.deleted` audit and deletes run、parts and the Job graph in dependency order
- active、paused or stale pre-lock delete attempts fail without partial deletion，administrator and other member delete attempts remain resource-not-found，audit failure rolls back every deletion
- ordinary Job、event、outbox、audit、error and log JSON contain no Prompt、Schema、part、result or decrypted content

### Prohibited Changes

- Worker execution、lease recovery、part execution、Dify invocation or Web UI
- new table or migration、new external dependency、new authentication、sharing or role semantics
- existing Job state machine、outbox delivery、audit retention、CSRF or authorization semantic changes
- administrator content bypass、administrator hard delete or any non-terminal owner hard delete
- legacy analysis mutation、SQLite data path、formal data migration、deployment、UAT、cutover or Phase 5 behavior
- Dify YAML、manifest、credential files、package dependencies or lockfile
- Phase 4 Gate、acceptance criteria、task order or product scope changes

### Required Verification

- observed PostgreSQL RED for preview/create/idempotency/rollback/privacy/hard-delete behavior before implementation
- focused service and API integration tests against real PostgreSQL
- concurrent identical create、conflicting replay、forced transaction rollback、active delete race、stale delete and audit rollback reproductions
- transaction graph counts prove exactly one run、Job、initial step set、event、outbox and audit for an idempotent request
- owner/member/administrator matrix and plaintext sentinel scan cover database rows、ordinary JSON、events、outbox、audit and controlled errors
- `npm run test:integration -- analysis-job.integration.test.ts advanced-analysis.integration.test.ts`
- `npm run typecheck:phase3`
- `npm run lint`
- `git diff --check`
- scope audit against the final governance merge SHA
- independent specification and code-quality reviews
- controller `npm run verify:controller` before merge
- post-merge focused integration smoke and `npm run verify:post-merge`

### Escalation Conditions

- atomic create or hard delete cannot use the existing Job、outbox、audit and four-table model without architecture or migration changes
- idempotency requires a new table、new externally visible API semantic or change to existing outbox behavior
- private content would enter ordinary JSON、Job、event、outbox、audit、log or error fields
- administrator control requires content decryption or a new permission bypass
- hard delete requires destructive migration、formal data operation or audit retention change
- Worker、lease、Dify、Web、new dependency、deployment、Gate or acceptance change is required
- baseline becomes stale、conflicted or blocked

## Evidence

- PHASE4-TASK2 accepted checkpoint merged after independent specification and quality reviews、controller verification and PR #110 CI passed
- PR #110 merged at `93f1e635be9f122e589f894c5eda2db984c66d88`
- post-merge focused PostgreSQL integration 23、project source 42、project check、workspace audit and controller health passed
- main and origin/main align at `93f1e635be9f122e589f894c5eda2db984c66d88` and the main worktree is clean
- accepted design and implementation plan explicitly approve private owner APIs、transactional idempotent creation、metadata-only administrator control and terminal owner hard delete

## Accepted Result

PHASE4-TASK2 is merged and PHASE4-TASK3 may proceed from the final governance merge SHA using TDD、one implementation worktree and independent reviews

This checkpoint does not accept Task 3、unlock Task 4、authorize Worker execution or permit formal data operations
