---
checkpoint_id: CP-20260721-PHASE3-TASK6-STARTED
task_id: PHASE3-TASK6
status: accepted
recorded_at: 2026-07-21T14:37:09+08:00
branch: codex/phase3-task6-started
base_commit: e7063b9320e741b1cec3ff0143618e776ee5a16a
head_commit: e7063b9320e741b1cec3ff0143618e776ee5a16a
supersedes: none
---

# Phase 3 Task 6 Started

## Scope

### Core Allowed Modules

- create `apps/web/src/features/query/QueryWorkspacePage.tsx`
- create `apps/web/src/features/query/QuerySessionList.tsx`
- create `apps/web/src/features/query/QueryConversation.tsx`
- create `apps/web/src/features/query/QueryEvidencePanel.tsx`
- create `apps/web/src/features/query/query-api.ts`
- create `apps/web/src/features/query/query.test.tsx`
- modify `apps/web/src/app/router.tsx`
- modify `apps/web/src/features/library/BookWorkspacePage.tsx`
- modify `apps/web/src/features/task-center/useJobEvents.ts`
- modify `apps/web/src/app/styles.css`

### Mechanical Adjacent Scope

- directly corresponding Web tests、types、test fixtures and existing route or query-cache wiring
- existing shared Web API helpers only when directly required to represent an already accepted Query HTTP behavior
- test-only browser fixtures or temporary QA scripts must remain outside committed source
- no API、contract、database、Worker、package manifest、lockfile or dependency changes

### Required Behavior

- add one book-workspace navigation entry and route for continuous Query without changing existing overview、import、L1 or L2 behavior
- create、list、select and restore authorized Query sessions with title、index group、default chapter range and existing visibility controls
- render conversation turns and the selected turn's adopted evidence、candidate recall and execution trace in place
- preview the exact question and optional narrowed range before submit; only a fresh preview exposes the submit action
- reuse one idempotency key for an uncertain submit retry and rotate it only after a fresh preview or successful terminal submit
- `scope_changed` invalidates the preview and requires explicit re-preview; it must not silently resubmit
- server-owned queued、running、awaiting_fallback、completed、degraded、failed and cancelled states remain recoverable after navigation or reload
- `awaiting_fallback` exposes the two existing actions: retry Dify summary and generate local fact summary
- SSE invalidates Query session、turn and evidence query keys without placing long-running task truth in component-local state
- desktop keeps a stable session rail, conversation workspace and adjacent evidence area; evidence defaults to adopted facts and can collapse or resize within bounded dimensions
- mobile uses one session drawer and a bottom evidence panel; the composer remains reachable and no nested page navigation is required
- accessibility includes named controls、semantic tabs、visible focus、dialog/drawer dismissal and keyboard-reachable primary actions
- user-visible copy remains Chinese and the UI follows the existing restrained workbench design system

### Prohibited Changes

- Query API paths、request/response semantics、RBAC、CSRF、HMAC or sharing policy
- database schema、migration、repository、evidence immutability、lease、attempt、outbox or Worker behavior
- new local persistence for question、answer、session or job truth
- new dependency、package manifest、lockfile、icon system or design framework
- Dify YAML、manifest、credentials or real provider calls
- unrelated AppShell、library、task center or admin redesign
- Task 7 behavior、Phase 4、Gate、formal data、deployment or cutover

### Required Verification

- observable RED for missing Query route/workspace and each critical interaction before production code
- `npm test -w apps/web -- query.test.tsx`
- `npm test -w apps/web`
- `npm run typecheck -w apps/web`
- `npm run build -w apps/web`
- `npm run lint`
- `git diff --check`
- route、query-key、idempotency、scope-changed、fallback and navigation recovery scope audit
- browser QA through the available Browser skill at 1440x900、1280x800、768x1024 and 390x844
- each viewport must have no root horizontal overflow、overlap、clipped primary action or framework overlay
- browser console must have no relevant error or warning
- exercise create/select session、preview/submit、SSE refresh、fallback action、evidence tabs、mobile drawer and bottom evidence panel with observable state assertions
- independent specification review followed by independent code-quality review
- controller `npm run verify:controller`、Phase 1/2 E2E and post-merge Web smoke before merge

### Escalation Conditions

- an approved interaction requires changing Query API、public contract、sharing、security、data or Worker semantics
- existing Query responses cannot represent conversation、evidence、candidate、trace or fallback state required by the accepted design
- responsive behavior requires a new dependency or redesign outside the Query surface
- server-owned task recovery cannot work through existing query cache and SSE invalidation
- question、answer、fact body、credential or raw provider error would enter browser persistence、URL、logs or unrelated cache keys
- Task 7、Gate、formal data、deployment、cutover or another irreversible action becomes necessary
- baseline becomes stale、conflicted or blocked

## Evidence

- PHASE3-TASK5 merged through PR #92 and is accepted by `CP-20260721-PHASE3-TASK5-MERGED`
- main and origin/main align at `e7063b9320e741b1cec3ff0143618e776ee5a16a` with a clean primary workspace
- the approved Phase 3 design defines the desktop、tablet and mobile continuous-query workbench behavior
- the approved Phase 3 plan defines the ten core Web files and TDD/browser verification for Task 6
- current `baseline_status` is `current` with no evidence conflict or blocker

## Accepted Result

PHASE3-TASK6 may proceed from the final merge SHA of this Started Contract using TDD, one implementation worktree and independent specification and code-quality review

This checkpoint does not accept Task 6、change Query API/data/security semantics、unlock Task 7、change the Phase Gate、operate on formal data or authorize deployment
