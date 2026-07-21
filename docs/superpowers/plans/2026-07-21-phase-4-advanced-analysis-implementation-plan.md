# Phase 4 Advanced Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking

**Goal:** Build private, recoverable advanced analysis on the new PostgreSQL job platform while exposing legacy Analysis history through a fixture-backed read-only boundary

**Architecture:** Add an Advanced Analysis vertical module across contracts, database, jobs, worker, API and Web while reusing accepted encryption, L1/L2 repositories, Dify `analysis-summary`, JobSteps, lease recovery, outbox and SSE. The legacy SQLite runtime remains a golden reference only and is never imported by the new application

**Tech Stack:** TypeScript, Zod, PostgreSQL, Kysely, Express, pg-boss, React, TanStack Query, Vitest, Playwright-compatible browser tests

---

## 1. Approved Scope And Task Contract Rules

All tasks use implementation base `5a853744dfdef06d08bab6514eb0f022d50937c3` unless a merged checkpoint advances the baseline

Mechanical adjacent scope includes directly corresponding tests, type exports, migration registry, existing runtime wiring, package exports and schema roundtrip tests required by the approved behavior

Every task prohibits formal SQLite migration, production data operations, new Dify DSL, new external dependencies, deployment, UAT, cutover, team-shared templates or results, mode algorithm changes and Phase 5 behavior

Escalate before implementation when a task requires a new table not listed in the accepted design, a new authentication or authorization meaning, a different deletion policy, a Gate or acceptance change, or any plaintext content outside the approved encrypted columns

## 2. File Map

| Area | Responsibility |
| --- | --- |
| `packages/contracts/src/advanced-analysis-contract.ts` | Public template, run, part, preview and legacy read-only schemas |
| `packages/domain/src/analysis/mode-policy.ts` | Four compatible mode boundaries and review budgets |
| `packages/database/src/analysis/content.ts` | Typed encryption codecs for template, part and result payloads |
| `packages/database/src/analysis/analysis-repository.ts` | Private templates, versions, runs, parts and owner-filtered content reads |
| `packages/database/src/migrations/007_advanced_analysis.ts` | Approved Phase 4 schema and constraints |
| `packages/jobs/src/analysis/analysis-job.ts` | Preview, transactional creation, idempotency and terminal hard delete |
| `apps/api/src/routes/advanced-analysis.ts` | Private content API and owner-only mutations |
| `apps/api/src/routes/admin-analysis-jobs.ts` | Metadata-only administrator projection and controls |
| `apps/worker/src/analysis-source-selector.ts` | Mode-specific L1/L2/chapter input selection |
| `apps/worker/src/analysis-executor.ts` | Recoverable parts, summary and final result commit |
| `apps/api/src/legacy-analysis.ts` | Read-only port and fixture implementation |
| `apps/api/src/routes/legacy-analysis.ts` | GET-only legacy routes |
| `apps/web/src/features/analysis/` | Book-scoped template, run, result, legacy and export experience |
| `test/phase4/` | Golden behavior, recovery, privacy, deletion and E2E acceptance |

## Task 1: Public Contracts And Compatible Mode Policy

**Core allowed modules:** `packages/contracts`, `packages/domain`, `test/phase4/fixtures`

**Success criteria:** Public schemas reject write semantics for legacy records, four modes preserve old source boundaries and budgets, and no runtime or database changes occur

**Files:**
- Create: `packages/contracts/src/advanced-analysis-contract.ts`
- Modify: `packages/contracts/src/index.ts`
- Create: `packages/contracts/src/advanced-analysis-contract.test.ts`
- Create: `packages/domain/src/analysis/mode-policy.ts`
- Create: `packages/domain/src/analysis/mode-policy.test.ts`
- Modify: `packages/domain/src/index.ts`
- Create: `test/phase4/fixtures/legacy-analysis-golden.ts`

- [ ] **Step 1: Write failing contract tests**

Cover strict template create/update, mode enum, chapter range, preview hash, private run summaries, part progress, encrypted-content-free administrator metadata and legacy `readOnly: true` plus `canResume: false`

```ts
expect(LegacyAnalysisDetailSchema.safeParse({
  id: "legacy-1", bookId, name: "人物分析", readOnly: true,
  canResume: true, status: "completed", result: {}, diagnostics: [],
  startChapter: 1, endChapter: 10, createdAt: now, updatedAt: now,
}).success).toBe(false)
```

- [ ] **Step 2: Run RED verification**

Run: `npm run test -w packages/contracts -- advanced-analysis-contract.test.ts`

Expected: FAIL because the advanced-analysis schemas do not exist

- [ ] **Step 3: Implement the minimal public schemas**

Define `AnalysisModeSchema`, template summaries/details, preview/create input, run summary/detail, part summary, administrator metadata and legacy list/detail schemas. Do not place Prompt, Schema or result content in administrator schemas

```ts
export const AnalysisModeSchema = z.enum([
  "fast_index", "balanced", "precision", "full_text",
])

export const LegacyAnalysisDetailSchema = z.strictObject({
  id: z.string().min(1), bookId: z.uuid(), name: z.string(),
  startChapter: z.number().int().positive(),
  endChapter: z.number().int().positive(),
  status: z.string(), result: z.unknown(), diagnostics: z.array(z.string()),
  readOnly: z.literal(true), canResume: z.literal(false),
  createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
})
```

- [ ] **Step 4: Write and run compatible mode-policy tests**

Use old defaults as immutable golden values: `fast_index` reads indexes and reviews 0 chapters, `balanced` reviews `min(10,max(3,ceil(chapterCount*0.01)))`, `precision` reviews `min(30,max(5,ceil(chapterCount*0.03)))`, and `full_text` reads every selected chapter

Run: `npm run test -w packages/domain -- mode-policy.test.ts`

Expected: PASS with all four mode cases and boundary chapter counts

- [ ] **Step 5: Verify Task 1**

Run: `npm run test -w packages/contracts && npm run test -w packages/domain && npm run typecheck:new && npm run lint`

Expected: all commands pass

## Task 2: Encrypted Analysis Schema And Private Repository

**Core allowed modules:** `packages/database/src/migrations`, `packages/database/src/analysis`, `packages/database/src/db.ts`

**Success criteria:** Approved tables and constraints exist, content is encrypted, owner-filtered reads do not expose content to members or administrators, and completed parts are reusable only by matching signatures

**Files:**
- Create: `packages/database/src/migrations/007_advanced_analysis.ts`
- Modify: `packages/database/src/migrations/index.ts`
- Modify: `packages/database/src/db.ts`
- Create: `packages/database/src/analysis/content.ts`
- Create: `packages/database/src/analysis/analysis-repository.ts`
- Create: `packages/database/src/analysis/analysis-repository.integration.test.ts`
- Modify: `packages/database/src/index.ts`
- Modify: `packages/database/src/schema.integration.test.ts`

- [ ] **Step 1: Write failing migration and repository tests**

Assert tables `analysis_templates`, `analysis_template_versions`, `analysis_runs` and `analysis_parts`; private owner listing; administrator content denial; immutable versions; run/Job identity; valid ranges; allowed statuses; all-or-none encrypted columns; part uniqueness; and no Prompt, Schema or result sentinel in ordinary JSON columns

```ts
expect(await repository.listTemplates({ bookId, actor: otherMember })).toEqual([])
await expect(repository.getRun({ runId, actor: admin }))
  .rejects.toThrow("Analysis not found")
expect(JSON.stringify(await database.selectFrom("jobs").selectAll().execute()))
  .not.toContain("PRIVATE_PROMPT_SENTINEL")
```

- [ ] **Step 2: Run RED verification against PostgreSQL**

Run: `TEST_DATABASE_URL=postgres://novel:novel_dev_only@127.0.0.1:55432/postgres npm run test:integration -- analysis-repository.integration.test.ts`

Expected: FAIL because migration 007 and the repository are absent

- [ ] **Step 3: Add the approved schema**

Create private template/version tables, run and part tables with explicit foreign keys, status checks and encryption tuple checks. Do not create `legacy_analysis_runs` in Phase 4

The run owns the Job relationship and cascades its parts. Job deletion ordering remains controlled by Task 3 rather than a circular cascading foreign key

- [ ] **Step 4: Implement encrypted repository codecs and private reads**

Reuse `ContentCipher` with typed JSON serialization and reject malformed decrypted payloads

```ts
export function encryptAnalysisJson(cipher: ContentCipher, value: unknown) {
  return cipher.encrypt(JSON.stringify(value))
}

export function decryptAnalysisJson<T>(
  cipher: ContentCipher,
  encrypted: EncryptedContent,
  schema: z.ZodType<T>,
): T {
  return schema.parse(JSON.parse(cipher.decrypt(encrypted)))
}
```

- [ ] **Step 5: Implement part commit and reuse rules**

Commit ciphertext and `completed` status in one transaction. `findReusablePart` must match run, kind, position and full input signature; failed, running or signature-mismatched parts are never reusable

- [ ] **Step 6: Verify Task 2**

Run: `npm run test:integration -- analysis-repository.integration.test.ts schema.integration.test.ts && npm run typecheck:phase3 && npm run lint`

Expected: schema roundtrip and repository integration tests pass with plaintext sentinel scans clean

## Task 3: Template API, Transactional Run Creation And Terminal Hard Delete

**Core allowed modules:** `packages/jobs/src/analysis`, `apps/api/src/routes`, existing app wiring

**Success criteria:** Owners manage private templates and runs, create is transactional and idempotent with outbox, administrators see metadata only, and owner-only terminal hard delete is atomic with retained audit

**Files:**
- Create: `packages/jobs/src/analysis/analysis-job.ts`
- Create: `packages/jobs/src/analysis/analysis-job.integration.test.ts`
- Modify: `packages/jobs/src/index.ts`
- Create: `apps/api/src/routes/advanced-analysis.ts`
- Create: `apps/api/src/routes/admin-analysis-jobs.ts`
- Create: `apps/api/src/routes/advanced-analysis.integration.test.ts`
- Modify: `apps/api/src/app.ts`

- [ ] **Step 1: Write failing preview and create tests**

Cover book/template/index ownership, chapter range, mode source summary, execution versions, scope hash invalidation, owner/request idempotency, conflicting replay, transaction rollback, one run/Job/Step/event/outbox/audit and absence of sensitive content from ordinary persistence

```ts
const replay = await service.createRun(input)
expect(replay.run.id).toBe(first.run.id)
expect(await count("job_outbox", first.job.id)).toBe(1)
```

- [ ] **Step 2: Run RED verification**

Run: `npm run test:integration -- analysis-job.integration.test.ts advanced-analysis.integration.test.ts`

Expected: FAIL because the service and routes do not exist

- [ ] **Step 3: Implement preview and transactional creation**

Use a transaction advisory lock keyed by owner and idempotency key. Recompute selection under the lock, compare scope hash, create run and `advanced-analysis` Job, create initial steps, event, outbox and audit, then return public owner projections

```ts
await sql`select pg_advisory_xact_lock(
  hashtext(${`${actor.id}:advanced-analysis:${requestId}`})
)`.execute(transaction)
```

- [ ] **Step 4: Implement private template and run routes**

Add strict Zod parsing, session and CSRF middleware, resource-not-found behavior for unauthorized content access, and no administrator bypass on content routes

- [ ] **Step 5: Implement metadata-only administrator route**

Return only ID, creator ID, book ID, state, counts, stable error code and timing. Reuse existing Job control operations without resolving template or result ciphertext

- [ ] **Step 6: Write hard-delete race and rollback tests**

Assert active states return conflict, other members and administrators cannot delete, owner terminal delete removes run/parts/Job graph, audit survives, a forced audit failure rolls back, and a row locked as active cannot be deleted by a stale request

- [ ] **Step 7: Implement atomic terminal hard delete**

Lock run and Job, recheck owner and terminal status, insert `advanced_analysis.deleted` audit, delete run/parts and the Job graph in dependency order, and commit once

- [ ] **Step 8: Verify Task 3**

Run: `npm run test:integration -- analysis-job.integration.test.ts advanced-analysis.integration.test.ts && npm run typecheck:phase3 && npm run lint`

Expected: privacy, transaction, idempotency, outbox and hard-delete cases pass

## Task 4: Recoverable Four-Mode Worker Executor

**Core allowed modules:** `apps/worker`, `packages/jobs` execution wiring, accepted Dify and database exports

**Success criteria:** All modes preserve compatible source boundaries, parts recover after lease loss, summaries validate before completion, and provider failures remain sanitized

**Files:**
- Create: `apps/worker/src/analysis-source-selector.ts`
- Create: `apps/worker/src/analysis-source-selector.test.ts`
- Create: `apps/worker/src/analysis-executor.ts`
- Create: `apps/worker/src/analysis-executor.integration.test.ts`
- Modify: `apps/worker/src/worker.ts`
- Modify: `apps/worker/src/main.ts`
- Modify: `apps/worker/src/worker.integration.test.ts`
- Create: `test/phase4/fixtures/analysis-mode-golden.ts`

- [ ] **Step 1: Write failing source-boundary golden tests**

Record calls to L1, L2 and chapter readers for all modes and chapter counts. Assert `fast_index` never calls chapter decryption, balanced and precision call only their deterministic review sets, and full text calls every selected chapter

- [ ] **Step 2: Run RED verification**

Run: `npm run test -w apps/worker -- analysis-source-selector.test.ts`

Expected: FAIL because the selector is absent

- [ ] **Step 3: Implement the source selector**

Use `modeSourcePolicy` from Task 1 and accepted repository inputs. Preserve old default budgets exactly and keep algorithm improvement out of the selector

- [ ] **Step 4: Write failing executor integration tests**

Cover encrypted part commits, Schema validation, partial failure, pause at step boundary, cancel, repeated wake, lease expiry, completed part reuse, signature mismatch, outbox replay and late attempt rejection

```ts
expect(provider.callsFor("chapter", completedPart.position)).toBe(1)
expect(await repository.getRunAsOwner(run.id, owner)).toMatchObject({
  status: "completed",
})
```

- [ ] **Step 5: Implement the four execution units**

Keep source selection, part execution, hierarchical summary and final validation in separate functions. Persist only stable error codes outside encrypted diagnostics. Use existing Dify adapter retry behavior without adding a second retry loop

- [ ] **Step 6: Wire the worker safely**

Add advanced-analysis step kinds to `createWorkerStepExecutor`, require existing analysis-summary runtime configuration, and keep queue and state-machine infrastructure shared

- [ ] **Step 7: Verify Task 4**

Run: `npm run test -w apps/worker && npm run test:integration -- analysis-executor.integration.test.ts worker.integration.test.ts && npm run typecheck:phase3 && npm run lint`

Expected: golden, recovery, race and sanitization tests pass

## Task 5: Legacy History Read-Only Port And Fixture API

**Core allowed modules:** `apps/api/src/legacy-analysis.ts`, legacy route, contracts and tests

**Success criteria:** Fixture-backed legacy list/detail works through a replaceable read-only port and no mutation route or SQLite dependency exists

**Files:**
- Create: `apps/api/src/legacy-analysis.ts`
- Create: `apps/api/src/routes/legacy-analysis.ts`
- Create: `apps/api/src/routes/legacy-analysis.integration.test.ts`
- Modify: `apps/api/src/app.ts`
- Reuse: `test/phase4/fixtures/legacy-analysis-golden.ts`

- [ ] **Step 1: Write failing read-only route tests**

Assert authorized owner list/detail, unauthorized resource-not-found, fixed `readOnly: true`, fixed `canResume: false`, and 404/405 for POST, PATCH, DELETE, pause, resume and cancel paths

- [ ] **Step 2: Run RED verification**

Run: `npm run test:integration -- legacy-analysis.integration.test.ts`

Expected: FAIL because the port and routes do not exist

- [ ] **Step 3: Define the port and fixture adapter**

```ts
export interface LegacyAnalysisReader {
  list(input: { bookId: string; actorId: string }): Promise<LegacyAnalysisSummary[]>
  get(input: { bookId: string; analysisId: string; actorId: string }): Promise<LegacyAnalysisDetail | null>
}
```

The fixture adapter stores no SQLite handle and has no create, update, resume or delete method

- [ ] **Step 4: Add GET-only routes and explicit runtime injection**

Production may use an empty reader until Phase 5. Tests inject fixtures. Do not make fixture records appear as production data by default

- [ ] **Step 5: Verify Task 5**

Run: `npm run test:integration -- legacy-analysis.integration.test.ts && rg -n "sqlite|better-sqlite|server/workflows" apps/api/src/legacy-analysis.ts apps/api/src/routes/legacy-analysis.ts && npm run lint`

Expected: tests pass and the search returns no legacy runtime dependency

## Task 6: Book-Scoped Advanced Analysis Workspace

**Core allowed modules:** `apps/web/src/features/analysis`, book workspace route/navigation, shared API types and styles

**Success criteria:** Owners manage private templates and runs, tasks survive navigation, results and exports work, legacy history is visibly read-only, and responsive layouts do not overlap

**Files:**
- Create: `apps/web/src/features/analysis/analysis-api.ts`
- Create: `apps/web/src/features/analysis/AdvancedAnalysisPage.tsx`
- Create: `apps/web/src/features/analysis/AnalysisTemplatePanel.tsx`
- Create: `apps/web/src/features/analysis/AnalysisRunPanel.tsx`
- Create: `apps/web/src/features/analysis/AnalysisResultView.tsx`
- Create: `apps/web/src/features/analysis/LegacyAnalysisPanel.tsx`
- Create: `apps/web/src/features/analysis/analysis-export.ts`
- Create: `apps/web/src/features/analysis/advanced-analysis.test.tsx`
- Modify: `apps/web/src/app/router.tsx`
- Modify: `apps/web/src/features/library/BookWorkspacePage.tsx`
- Modify: `apps/web/src/app/styles.css`

- [ ] **Step 1: Write failing workflow tests**

Cover book-stable navigation, private template create/update, scope preview, all four mode descriptions, submit and server-state recovery, pause/resume/cancel, terminal-only delete, same-page new/legacy segmented views, absent legacy mutations and error states

- [ ] **Step 2: Run RED verification**

Run: `npm run test -w apps/web -- advanced-analysis.test.tsx`

Expected: FAIL because the analysis workspace does not exist

- [ ] **Step 3: Implement API hooks and stable page structure**

Use TanStack Query for server state. Keep selected book in the route and do not duplicate book selection. Use a segmented control for new tasks and legacy history, a desktop side list and a narrow-screen drawer

- [ ] **Step 4: Implement preview, task controls and irreversible delete confirmation**

Show book, template version, mode, chapter scope, index groups, source boundary, expected review range and snapshot notice before submit. Hide delete for active runs and label terminal delete as unrecoverable

- [ ] **Step 5: Implement result presentation and existing export rules**

Render table-compatible JSON first, Markdown text second and formatted JSON as fallback. Export text as `.md`, tabular JSON with the existing Excel-compatible client format, and other values as `.json`

- [ ] **Step 6: Implement read-only legacy view**

Show an explicit fixture/read-only label and never render control or delete components for legacy results

- [ ] **Step 7: Verify Task 6**

Run: `npm run test -w apps/web -- advanced-analysis.test.tsx && npm run typecheck:phase3 && npm run lint && npm run build -w apps/web`

Expected: interaction tests, typecheck, lint and build pass

## Task 7: Independent Phase 4 Acceptance And Security Evidence

**Core allowed modules:** `test/phase4`, Phase 4 Vitest config, package scripts and direct acceptance fixtures

**Success criteria:** Independent E2E evidence proves compatible modes, privacy, administrator projection, recovery, deletion, read-only legacy behavior, exports and responsive usability without changing product behavior

**Files:**
- Create: `test/phase4/advanced-analysis.e2e.test.ts`
- Create: `test/phase4/analysis-recovery.e2e.test.ts`
- Create: `test/phase4/analysis-security.integration.test.ts`
- Create: `test/phase4/helpers/phase4-harness.ts`
- Create: `vitest.phase4.config.ts`
- Modify: `package.json`

- [ ] **Step 1: Build the independent harness**

Start real API and Worker processes against disposable PostgreSQL, use the deterministic Dify fake, create owner/member/admin identities, and capture API/Worker logs for sentinel scanning

- [ ] **Step 2: Add the four-mode golden E2E matrix**

For one indexed book, run all modes and assert source counts, chapter reader calls, default review budget, complete snapshot, encrypted result and export projection

- [ ] **Step 3: Add recovery and idempotency cases**

Terminate a Worker after one committed part, expire the lease, restart, replay the outbox and repeat the create request. Assert completed parts run once and only one terminal result exists

- [ ] **Step 4: Add privacy and administrator cases**

Assert another member and an administrator cannot enumerate or read owner templates/runs/results, while the administrator metadata endpoint can control the Job without content fields

- [ ] **Step 5: Add deletion and legacy read-only cases**

Assert active delete rejection, cancellation then terminal owner delete, retained audit with removed business graph, other-actor denial, fixture legacy list/detail and absence of every legacy mutation route

- [ ] **Step 6: Add plaintext and credential sentinel scans**

Scan persisted rows, ordinary analysis and Job JSON, captured API/Worker logs, events, outbox, attempts and controlled provider errors. Decrypted authorized response content is the only allowed sentinel location

- [ ] **Step 7: Add viewport acceptance**

Use browser tests at 1440, 1280, 768 and 390 pixels to assert no overlap or root horizontal scrolling, accessible segmented controls/drawer, visible result and available task controls

- [ ] **Step 8: Run Phase 4 and full controller verification**

Run: `npm run test:phase4:e2e && npm run test:legacy && npm run test:contracts && npm run test:new && npm run test:integration && npm run test:project-source && npm run project:check && npm run lint && npm run typecheck:phase3`

Expected: every command passes with no plaintext sentinel or unresolved Critical/Important finding

## 3. Gate And Execution Order

Tasks execute strictly in order 1 through 7. A merged checkpoint unlocks only the next listed task

Task 2 schema, Task 3 privacy and hard delete, and Task 4 recovery cannot be implemented until their started contracts restate the accepted data and security boundaries

Task 7 supplies implementation acceptance evidence but cannot pass `GATE-PHASE4-IMPLEMENTATION-ACCEPTED`; that Gate requires an explicit user decision after all implementation and merged checkpoints

`GATE-PHASE4-PLAN-APPROVED` must be explicitly accepted before Task 1 implementation begins
