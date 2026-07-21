---
checkpoint_id: CP-20260721-PHASE3-TASK6-API-CORRECTION-STARTED
task_id: PHASE3-TASK6-API-CORRECTION
status: accepted
recorded_at: 2026-07-21T16:58:24+08:00
branch: codex/phase3-task6-api-correction-started
base_commit: bc965c3fff67ed64a44386b97a0c1095d36f1e0b
head_commit: bc965c3fff67ed64a44386b97a0c1095d36f1e0b
supersedes: none
---

# Phase 3 Task 6 API Correction Started

## Scope

### Core Allowed Modules

- `packages/contracts/src/query-contract.ts`
- `packages/contracts/src/query-contract.test.ts`
- `packages/database/src/query/query-repository.ts`
- `packages/database/src/query/query-repository.integration.test.ts`
- `apps/api/src/routes/query-sessions.ts`
- `apps/api/src/routes/query-sessions.integration.test.ts`

### Mechanical Adjacent Scope

- direct contract/database/API types、exports and existing test fixtures
- no schema、migration、Worker、Web、package manifest、lockfile or dependency changes

### Required Behavior

- add an authorized session-turn history endpoint with a bounded default/max page size and opaque cursor
- use deterministic newest-first ordering with a stable tie-breaker and no duplicate or skipped row while the cursor row exists
- history returns the accepted conversation fields and safe Trace projection but omits evidence bodies and internal hashes/IDs
- selected-turn detail retains evidence and adds the same safe Trace projection
- private/team/admin visibility and cross-book/session non-enumeration remain identical to existing Query authorization
- archived sessions remain readable under existing visibility semantics and cannot gain new write behavior
- Trace is a strict allowlist derived from persisted intent、source、gap and config snapshots and handles queued empty snapshots without fabrication
- response and errors must not expose question HMAC、execution signature、evidence hash、raw snapshots、job/attempt internals、provider errors or credentials
- no database shape、write path、lease、outbox、fallback or evidence immutability behavior changes

### Prohibited Changes

- table、column、index、migration or stored snapshot semantics
- session sharing、RBAC、CSRF、HMAC、content encryption or decryption authorization policy
- create/update/archive/fallback API behavior
- Worker、lease、attempt、outbox、Dify or queue behavior
- Web implementation、dependency、package、lockfile、Task 7、Gate、formal data、deployment or cutover

### Required Verification

- observable RED for missing history endpoint、pagination、authorization and Trace allowlist
- focused contracts、Query repository and Query routes tests
- full contracts and integration suites
- Phase 1/2 E2E、typecheck、lint and `git diff --check`
- direct sentinel audit proving internal hashes、raw errors and credentials cannot enter the public projection
- independent specification review followed by independent code-quality and security review
- controller `npm run verify:controller` before merge

### Escalation Conditions

- stable pagination requires schema or index changes
- Trace requires exposing fields outside DEC-0015 or changing stored snapshot semantics
- session/turn authorization cannot be reused without new permission policy
- API compatibility requires changing existing write、fallback or evidence responses
- Web、Task 7、Gate、formal data、deployment or irreversible action becomes necessary
- baseline becomes stale、conflicted or blocked for another reason

## Evidence

- PHASE3-TASK6 preflight stopped cleanly before edits at `bc965c3fff67ed64a44386b97a0c1095d36f1e0b`
- existing session detail returns only `{ session }` and existing turn detail requires a known `turnId`
- existing `publicTurn` omits intent、gap and configuration projections required for execution Trace
- the database already stores encrypted turn content and allowlisted structured snapshots, so no migration is required
- user approved Option A on 2026-07-21

## Accepted Result

PHASE3-TASK6-API-CORRECTION may proceed from the merge SHA of this contract using TDD and independent reviews

PHASE3-TASK6 remains paused until the correction implementation is merged and accepted; Task 7 and the Phase Gate remain locked
