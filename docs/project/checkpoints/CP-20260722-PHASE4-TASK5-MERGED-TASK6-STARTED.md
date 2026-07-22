---
checkpoint_id: CP-20260722-PHASE4-TASK5-MERGED-TASK6-STARTED
task_id: PHASE4-TASK6
status: accepted
recorded_at: 2026-07-22T14:06:17+08:00
branch: codex/phase4-task6-analysis-workspace
base_commit: 439599b8078cf6aeb895b02669269880e886982b
head_commit: 439599b8078cf6aeb895b02669269880e886982b
supersedes: none
---

# Phase 4 Task 5 Merged And Task 6 Started

## Scope

记录 PHASE4-TASK5 实现合并，并接受 PHASE4-TASK6 的 Book-Scoped Advanced Analysis Workspace Task Contract

### Core Allowed Modules

- `apps/web/src/features/analysis/**`
- `apps/web/src/app/router.tsx`
- `apps/web/src/features/library/BookWorkspacePage.tsx`
- `apps/web/src/app/styles.css`

### Mechanical Adjacent Scope

- directly corresponding Web tests、existing shared API types、test setup and exports
- reuse existing TanStack Query、routing、icons、drawers、dialogs、tables and export helpers without dependency or semantic changes
- existing API paths from Tasks 3 and 5 may be called but not redefined
- no API、database、Worker、Job、Dify or authentication change

### Success Criteria

- Advanced Analysis is a secondary route inside the selected book workspace and never duplicates book selection or enters global primary navigation
- server state survives page navigation through TanStack Query and restores templates、runs、progress、results and errors from APIs rather than component-local task state
- new-task and legacy-history segmented views share one page，desktop uses a side list and 768/390 widths use an accessible drawer
- owners can list、create and update private templates，preview scope，choose all four compatible modes and create idempotent runs
- pre-submit preview shows book、template version、mode、chapter scope、index groups、source boundary、expected review range and immutable snapshot notice
- run detail shows real progress、current step、part counts、pause/resume/cancel controls and terminal-only irreversible delete confirmation
- active runs never expose delete，terminal delete is explicitly unrecoverable and no optimistic UI invents a terminal state
- result view renders table-compatible JSON first、Markdown second and formatted JSON fallback，with `.md`、existing Excel-compatible and `.json` exports
- legacy history is visibly read-only，uses list/detail GET APIs and never renders control、resume、delete or mutation actions
- loading、empty、resource-not-found、validation、provider and retryable states are coherent and do not erase the selected book context
- 1440、1280、768 and 390 pixel views have no component overlap or root horizontal scrolling，text and controls remain within stable containers

### Prohibited Changes

- global navigation entry、duplicate book selector、marketing/landing page or unrelated library redesign
- API、database、migration、Worker、Job、lease、outbox、Dify、auth or authorization semantic change
- legacy mutation UI/API、shared template/team result behavior or new product capability
- new dependency、lockfile、custom backend export、XLSX/CSV/batch export or file storage
- hidden current-state fallback、client-only long-task authority or fabricated progress/status
- formal data、deployment、UAT、cutover、Phase 4 Gate、acceptance criteria or task order change

### Required Verification

- RED workflow tests before implementation for route stability、template/run workflow、four modes、scope preview、controls、terminal delete、legacy read-only and error states
- interaction tests prove navigation away/back restores server state without duplicate create or lost selected book
- API request assertions prove book-scoped paths、idempotency and no legacy mutation requests
- export unit evidence for Markdown、table-compatible Excel format and JSON fallback
- browser screenshots and interaction checks at 1440、1280、768 and 390，including drawer、segmented control、result and task controls
- automated no-overlap and root horizontal-scroll assertions for all accepted viewports
- `npm run test -w apps/web -- advanced-analysis.test.tsx`
- `npm run typecheck:phase3`
- `npm run lint`
- `npm run build -w apps/web`
- `git diff --check` and cumulative scope audit
- independent specification review followed by code-quality and visual quality review
- controller verification and CI before merge
- post-merge focused Web smoke and `npm run verify:post-merge`

### Escalation Conditions

- accepted APIs lack fields required for the approved workflow or require backend、contract、data or security changes
- routing cannot remain book-scoped without global navigation or duplicate selection
- server-state recovery requires new task authority or API capability
- responsive interaction requires a new dependency or design-system architecture change
- legacy history requires mutation、formal data or production adapter work
- deployment、Gate、acceptance or task order change is required
- baseline becomes stale、conflicted or blocked

## Evidence

- PHASE4-TASK5 accepted checkpoint merged after independent specification and quality reviews、controller verification and PR #120 CI passed
- PR #120 merged at `439599b8078cf6aeb895b02669269880e886982b`
- post-merge Legacy API smoke passed 7，project source passed 42，project check、workspace audit and controller health passed
- main and origin/main align at the implementation merge SHA and the main worktree is clean
- accepted Phase 4 design and plan fix the book-scoped route、same-page segmented views、desktop list、mobile drawer、result ordering、exports and legacy read-only boundary

## Accepted Result

PHASE4-TASK5 is merged and PHASE4-TASK6 may proceed from the final governance merge SHA using TDD、one external implementation worktree and independent reviews

This checkpoint does not accept Task 6、unlock Task 7、authorize formal data operations、deployment or cutover
