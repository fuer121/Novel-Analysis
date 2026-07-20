---
checkpoint_id: CP-20260720-PHASE2-TASK7-STARTED
task_id: PHASE2-TASK7
status: accepted
recorded_at: 2026-07-20T20:24:26+08:00
branch: codex/phase2-task7-book-workspace
base_commit: 0ccf23b5aeeeded8d15dffdd3225feed8f665ea8
head_commit: 0ccf23b5aeeeded8d15dffdd3225feed8f665ea8
supersedes: none
---

# Phase 2 Task 7 Started

## Scope

### Core Allowed Modules

- `apps/web/src/features/library/**`
- `apps/web/src/app/router.tsx`
- `apps/web/src/app/AppShell.tsx`
- `apps/web/src/app/styles.css`
- `apps/web/src/shared/api.ts`
- `apps/web/src/features/task-center/useJobEvents.ts`

### Mechanical Adjacent Scope

- direct Web tests and test setup
- existing Web package scripts or dependencies only when already present and required by the approved UI behavior
- existing shared UI primitives and route exports when directly required by the book workspace

### Success Criteria

- `/books` supports library listing, book creation and entry into one persistent book context
- `/books/:bookId/overview`, `/import`, `/l1` and `/l2` preserve the selected book without repeated selection
- import, L1 and L2 write flows require a successful preview and explicit confirmation before job creation
- scope views display requested, execute, skip, fresh, missing, failed and stale counts available from the accepted API contracts
- `scope_changed` invalidates the preview and requires reconfirmation
- job and coverage state refresh through the existing API and SSE invalidation path without binding long tasks to page-local state
- fact review is paginated, readable on desktop and mobile, and fact bodies remain in query cache only
- desktop and mobile layouts have no incoherent overlap or root overflow

### Prohibited Changes

- API routes, database schema, migrations, job semantics, Dify contracts or workflows
- authentication, authorization, session, CSRF or credential behavior
- new external dependencies unless a concrete blocker requires user confirmation
- Phase 3 continuous-question routes or capabilities
- Phase 2 Gate, acceptance criteria, formal data, deployment or cutover

### Required Verification

- Web RED/GREEN interaction tests for library, preserved context, previews, confirmation, scope conflict, SSE invalidation and fact pagination
- `npm run test -w apps/web`
- `npm run typecheck -w apps/web`
- `npm run build -w apps/web`
- `npm run lint`
- browser verification at 1440x900, 1280x800, 768x1024 and 390x844
- page identity, nonblank render, no framework overlay, console health and target-flow interaction proof
- concept-to-render screenshot comparison with `view_image`
- `npm run test:project-source`, `npm run project:check` and `git diff --check`
- controller verification before merge

### Escalation Conditions

- required UI behavior is absent from accepted API contracts
- a new dependency, API capability, data object, permission rule or security behavior is required
- task continuity cannot be achieved through existing task-center/SSE architecture
- browser evidence conflicts with tests or reveals a material information-architecture change
- baseline becomes stale, conflicted or blocked

## Evidence

- Task 6 merged checkpoint is accepted and implementation dependencies are satisfied
- existing API routes expose books, import preview/jobs, L1 preview/jobs/coverage, L2 groups/preview/jobs/coverage and paginated facts
- existing Web app already provides authenticated shell, task center and SSE invalidation utilities
- one clean external implementation worktree exists for Task 7

## Accepted Result

Task 7 may proceed from `0ccf23b5aeeeded8d15dffdd3225feed8f665ea8` using concept-first TDD and two-stage review

This checkpoint does not accept implementation, unlock Task 8 or change the Phase 2 Gate
