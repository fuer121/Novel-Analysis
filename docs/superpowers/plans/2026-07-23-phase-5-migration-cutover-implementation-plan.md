# Phase 5 Migration And Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and verify the selective SQLite-to-PostgreSQL migration tool, per-book analysis readiness, production-scale test harness, and gated single-server UAT/cutover runbooks without operating production data or infrastructure

**Architecture:** A new `@novel-analysis/migration` package owns the read-only legacy snapshot boundary, in-process re-encryption, per-book PostgreSQL transactions, immutable manifest, and hard validation. Existing L1/L2 jobs remain authoritative; API and Web derive per-book readiness from current chapters, index coverage, and job state rather than adding a migration status table. Performance, deployment, UAT, and cutover artifacts are executable local harnesses and runbooks whose production inputs remain blocked by independent Gates

**Tech Stack:** TypeScript, Node.js `node:sqlite`, AES-256-GCM, HMAC-SHA256, Kysely, PostgreSQL, Vitest, React, Express, Playwright, Docker Compose-compatible deployment templates, GitHub Actions

---

## Approved Boundary

- Migrate only books, source metadata, and chapters
- Do not import legacy L1, L2, Prompt, Analysis, Job, session, or runtime state
- Rebuild L1/L2 from the repository-approved Prompt, Schema, and Dify DSL
- Keep the two-hour limit on maintenance, migration, hard validation, base smoke, and entry switch; exclude full L1/L2 rebuild duration
- Keep analysis unavailable per book until its L1, base L2, coverage, and smoke checks pass
- Do not access a production snapshot, use an old production key, modify Feishu callbacks, deploy, run UAT, or switch traffic under the implementation-plan Gate

## File Map

| Area | Files | Responsibility |
| --- | --- | --- |
| Migration package | `packages/migration/src/contracts.ts`, `legacy-reader.ts`, `target-writer.ts`, `manifest.ts`, `validate.ts`, `run.ts`, `cli.ts`, `index.ts` | Read-only source boundary, stable mapping, re-encryption, transaction, manifest, hard validation, CLI |
| Migration tests | `packages/migration/src/*.test.ts`, `test/phase5/fixtures/create-legacy-snapshot.ts`, `test/phase5/migration.integration.test.ts` | Synthetic encrypted SQLite, source immutability, target roundtrip, failure rollback, secret sentinel checks |
| Readiness contract | `packages/contracts/src/library-contract.ts`, `library-contract.test.ts`, `index.ts` | Strict per-book rebuild readiness DTO |
| Readiness query/API | `packages/database/src/library/rebuild-readiness.ts`, books/query/analysis routes, focused tests | Derive readiness from existing data and reject analysis while incomplete |
| Readiness UI | `apps/web/src/features/library/BookWorkspacePage.tsx`, `types.ts`, `library.test.tsx`, `app/styles.css` | Visible rebuild state, progress, and disabled analysis navigation |
| Rebuild batch | `config/indexing-baseline.json`, `packages/jobs/src/library/rebuild-job.ts`, `apps/worker/src/rebuild-executor.ts`, admin API/Web | Seed approved index configuration, persist one Step per book, defer through outbox, reorder untouched Steps |
| Scale harness | `test/phase5/scale.integration.test.ts`, `test/phase5/helpers/phase5-harness.ts`, `vitest.phase5.config.ts`, `package.json` | 20-user browse, 10-user submit, status latency, queue isolation evidence |
| Operations artifacts | `deploy/phase5/compose.yml`, `deploy/phase5/Caddyfile`, `deploy/phase5/env.example`, `scripts/phase5-preflight.mjs`, `docs/operations/phase5-*.md` | Single-server topology, fail-closed preflight, UAT and cutover procedures |
| Acceptance | `test/phase5/phase5-acceptance.e2e.test.ts`, `scripts/phase5-acceptance.mjs`, `docs/operations/phase5-gate-dossier.md` | Tool acceptance evidence and explicit boundary before formal operations |

## Task 1: Migration Contracts And Read-Only Legacy Snapshot Boundary

**Core allowed modules:** `packages/migration`, synthetic Phase 5 fixture, workspace package metadata

**Mechanical adjacent scope:** root lockfile, root scripts, package exports, focused tests and TypeScript configuration

**Prohibited changes:** legacy `server/db.js`, PostgreSQL schema, production SQLite, Keychain, Dify workflows, API/Web behavior

**Files:**
- Create: `packages/migration/package.json`
- Create: `packages/migration/tsconfig.json`
- Create: `packages/migration/src/contracts.ts`
- Create: `packages/migration/src/legacy-reader.ts`
- Create: `packages/migration/src/legacy-reader.test.ts`
- Create: `packages/migration/src/index.ts`
- Create: `test/phase5/fixtures/create-legacy-snapshot.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Define strict source records and a source-reader port**

```ts
export type LegacyBook = Readonly<{
  sourceId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}>;

export type LegacyChapter = Readonly<{
  bookSourceId: string;
  chapterIndex: number;
  title: string;
  contentHmac: string;
  ciphertext: string;
  iv: string;
  tag: string;
  algorithm: "aes-256-gcm";
  updatedAt: string;
}>;

export interface LegacySnapshotReader {
  fingerprint(): string;
  books(): readonly LegacyBook[];
  chapters(bookSourceId: string): readonly LegacyChapter[];
  close(): void;
}
```

- [ ] **Step 2: Write failing tests for immutable, query-only access**

Create a synthetic SQLite fixture with one book and two encrypted chapters, record its SHA-256 before and after reading, assert ordered records, and assert these failures: missing required table, duplicate chapter position, unsupported algorithm, incomplete cipher tuple, and attempted URI without `mode=ro`

```ts
expect(afterFingerprint).toBe(beforeFingerprint);
expect(reader.chapters("legacy-book").map(c => c.chapterIndex)).toEqual([1, 2]);
expect(() => openLegacySnapshot(writablePath)).toThrow("legacy snapshot must be opened read-only");
```

- [ ] **Step 3: Run the focused test and verify RED**

Run: `npm test -w @novel-analysis/migration -- legacy-reader.test.ts`

Expected: FAIL because `openLegacySnapshot` is not implemented

- [ ] **Step 4: Implement the minimal reader with `DatabaseSync` read-only mode**

```ts
const database = new DatabaseSync(new URL(`file:${encodeURIComponent(path)}?mode=ro`), {
  open: true,
  readOnly: true,
});
database.exec("PRAGMA query_only = ON");
```

Validate schema with `PRAGMA table_info`, select only `books` and `chapters`, sort books by `book_id` and chapters by `chapter_index`, reject non-AES-GCM rows, and never import `server/db.js`

- [ ] **Step 5: Verify GREEN and source immutability**

Run: `npm test -w @novel-analysis/migration -- legacy-reader.test.ts && npm run typecheck -w @novel-analysis/migration && git diff --check`

Expected: reader tests PASS, TypeScript PASS, no source-file hash change

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json packages/migration test/phase5/fixtures/create-legacy-snapshot.ts
git commit -m "feat: add read-only legacy snapshot reader"
```

**Escalate when:** real snapshot access is needed, legacy schema differs from the audited schema, or the reader would need a write/repair path

## Task 2: In-Process Re-Encryption, Per-Book Transaction, And Manifest

**Core allowed modules:** `packages/migration`, existing database cipher and library tables

**Mechanical adjacent scope:** database exports, integration fixture, focused package tests

**Prohibited changes:** new PostgreSQL tables, plaintext persistence, legacy index/history import, migration continuation on a non-empty target

**Files:**
- Create: `packages/migration/src/legacy-crypto.ts`
- Create: `packages/migration/src/stable-id.ts`
- Create: `packages/migration/src/target-writer.ts`
- Create: `packages/migration/src/manifest.ts`
- Create: `packages/migration/src/target-writer.integration.test.ts`
- Modify: `packages/migration/src/contracts.ts`
- Modify: `packages/migration/src/index.ts`
- Modify: `packages/migration/package.json`

- [ ] **Step 1: Define manifest and key interfaces without secret fields**

```ts
export type MigrationManifest = Readonly<{
  manifestVersion: "phase5-v1";
  sourceFingerprint: string;
  targetSchemaVersion: string;
  startedAt: string;
  completedAt: string;
  books: readonly {
    sourceIdHash: string;
    targetId: string;
    chapterCount: number;
    contentDigest: string;
    durationMs: number;
    status: "completed";
  }[];
}>;
```

Accept `oldMasterKey`, `targetCipher`, and independent `targetHmacKey` as injected buffers; never load Keychain or environment variables inside domain functions

- [ ] **Step 2: Write failing transaction and sentinel tests**

Test one successful book, a second book with a corrupt tag, deterministic source-to-target mapping, all-or-none rollback, empty-target enforcement, target decrypt roundtrip, target HMAC verification, and serialized manifest/log absence of plaintext and key sentinels

```ts
await expect(writer.writeBook(corruptBook)).rejects.toThrow("source_decrypt_failed");
expect(await countTargetChapters(corruptBookId)).toBe(0);
expect(JSON.stringify(manifest)).not.toContain("SENTINEL_CHAPTER_TEXT");
expect(JSON.stringify(manifest)).not.toContain("SENTINEL_OLD_KEY");
```

- [ ] **Step 3: Run the focused integration test and verify RED**

Run: `TEST_DATABASE_URL=postgres://novel:novel_dev_only@127.0.0.1:55432/postgres npm test -w @novel-analysis/migration -- target-writer.integration.test.ts`

Expected: FAIL because writer, stable mapping, and manifest builder do not exist

- [ ] **Step 4: Implement source validation and target protection**

Use AES-256-GCM with legacy AAD `chapter:${bookSourceId}:${chapterIndex}`, verify the legacy HMAC with timing-safe comparison, compute normalized plaintext SHA-256, encrypt with `ContentCipher`, and compute target HMAC with the independent key

Create target `book_sources` with `provider: "legacy-sqlite"`, the old book ID as `source_id`, and the migrated minimum/maximum chapter positions. Derive the stable target UUID from source fingerprint plus old object identity using SHA-256 with UUID version/variant bits, without a new dependency

```ts
const targetHmac = createHmac("sha256", targetHmacKey).update(plaintext, "utf8").digest("hex");
await database.transaction().execute(async transaction => {
  await assertTargetBookAbsent(transaction, targetBookId);
  await insertBookSourceAndChapters(transaction, preparedBook);
});
```

- [ ] **Step 5: Verify GREEN, transaction rollback, and secret scanning**

Run: `TEST_DATABASE_URL=postgres://novel:novel_dev_only@127.0.0.1:55432/postgres npm test -w @novel-analysis/migration -- target-writer.integration.test.ts && npm run typecheck -w @novel-analysis/migration`

Expected: all cases PASS and no sentinel appears in manifest, captured logs, ordinary errors, or target plaintext columns

- [ ] **Step 6: Commit**

```bash
git add packages/migration
git commit -m "feat: migrate books in isolated transactions"
```

**Escalate when:** old HMAC semantics cannot be proven, a source row cannot decrypt, target is not empty, or any plaintext/credential sentinel escapes

## Task 3: Migration CLI And Hard Validation

**Core allowed modules:** migration orchestration, validator, synthetic PostgreSQL integration test

**Mechanical adjacent scope:** root commands, package build output rules, Phase 5 Vitest config

**Prohibited changes:** automatic target deletion, production defaults, implicit key fallback, partial-success exit code zero

**Files:**
- Create: `packages/migration/src/validate.ts`
- Create: `packages/migration/src/run.ts`
- Create: `packages/migration/src/cli.ts`
- Create: `packages/migration/src/run.integration.test.ts`
- Create: `test/phase5/migration.integration.test.ts`
- Create: `vitest.phase5.config.ts`
- Modify: `packages/migration/package.json`
- Modify: `package.json`

- [ ] **Step 1: Define a fail-closed run result**

```ts
export type MigrationRunResult = Readonly<{
  status: "passed";
  elapsedMs: number;
  manifestPath: string;
  books: number;
  chapters: number;
  validations: readonly { name: string; passed: true; checked: number }[];
}>;
```

The CLI requires explicit `--source`, `--database-url`, `--old-key-file`, `--target-key-file`, `--target-hmac-key-file`, and `--manifest`; reject inline key values and existing manifest paths

- [ ] **Step 2: Write failing end-to-end cases**

Cover successful two-book migration, source count drift, title drift, normalized-content digest drift, target decrypt failure, HMAC failure, duplicate chapter, non-empty target, manifest collision, and a forced mid-book exception

```ts
expect(result.validations.map(item => item.name)).toEqual([
  "book-count", "chapter-count", "metadata", "source-integrity",
  "content-digest", "target-decrypt", "target-hmac", "scope-exclusion",
]);
```

- [ ] **Step 3: Run Phase 5 migration tests and verify RED**

Run: `npm run test:phase5 -- migration.integration.test.ts`

Expected: FAIL because orchestration and validator are absent

- [ ] **Step 4: Implement orchestration and atomic manifest publication**

Write the manifest to a same-directory temporary file with mode `0600`, `fsync` it, rename only after every hard validation passes, and delete only the temporary manifest on failure

```ts
if (failures.length > 0) throw new MigrationHardFailure(failures.map(f => f.code));
await writeManifestAtomically(options.manifestPath, manifest, { mode: 0o600 });
```

- [ ] **Step 5: Verify GREEN and CLI exit semantics**

Run: `npm run test:phase5 -- migration.integration.test.ts && npm run typecheck -w @novel-analysis/migration && npm run project:check`

Expected: successful run exits 0 with a passed manifest; every hard failure exits non-zero and publishes no final manifest

- [ ] **Step 6: Commit**

```bash
git add package.json packages/migration test/phase5/migration.integration.test.ts vitest.phase5.config.ts
git commit -m "feat: add fail-closed migration command"
```

**Escalate when:** validation requires relaxing 100% equality, migration needs more than books/source/chapters, or execution needs a production path or key

## Task 4: Derived Rebuild Readiness And Analysis Lock

**Core allowed modules:** library contracts, derived readiness query, existing books route, book workspace UI

**Mechanical adjacent scope:** focused API/Web tests, types, styles and exports

**Prohibited changes:** new table or migration, new rebuild scheduler, Prompt/Dify changes, bypass of existing L1/L2 job semantics

**Files:**
- Create: `packages/database/src/library/rebuild-readiness.ts`
- Create: `packages/database/src/library/rebuild-readiness.integration.test.ts`
- Modify: `packages/database/src/index.ts`
- Modify: `packages/contracts/src/library-contract.ts`
- Modify: `packages/contracts/src/library-contract.test.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `apps/api/src/routes/books.ts`
- Modify: `apps/api/src/routes/books.integration.test.ts`
- Modify: `apps/api/src/routes/query-sessions.ts`
- Modify: `apps/api/src/routes/query-sessions.integration.test.ts`
- Modify: `apps/api/src/routes/advanced-analysis.ts`
- Modify: `apps/api/src/routes/advanced-analysis.integration.test.ts`
- Modify: `apps/web/src/features/library/BookWorkspacePage.tsx`
- Modify: `apps/web/src/features/library/types.ts`
- Modify: `apps/web/src/features/library/library.test.tsx`
- Modify: `apps/web/src/app/styles.css`

- [ ] **Step 1: Add the strict readiness contract**

```ts
export const BookAnalysisReadinessSchema = z.strictObject({
  state: z.enum(["waiting", "building_l1", "building_l2", "available", "failed"]),
  chapterTotal: z.number().int().nonnegative(),
  l1Fresh: z.number().int().nonnegative(),
  l2Fresh: z.number().int().nonnegative(),
  progressPercent: z.number().int().min(0).max(100),
  analysisAvailable: z.boolean(),
  blockingCode: z.enum(["l1_incomplete", "l2_incomplete", "rebuild_failed"]).nullable(),
});
```

- [ ] **Step 2: Write failing derivation, API, and UI tests**

Assert zero-index waiting, active L1 job, complete L1/active L2, failed job, complete base-group coverage, no base group, and strict rule that only complete L1 plus complete base L2 returns `analysisAvailable: true`

Assert query and advanced-analysis navigation use `aria-disabled`, cannot navigate when locked, show progress without layout shift, and unlock after refetch

- [ ] **Step 3: Run focused tests and verify RED**

Run: `npm test -w @novel-analysis/contracts -- library-contract.test.ts && TEST_DATABASE_URL=postgres://novel:novel_dev_only@127.0.0.1:55432/postgres npm test -w @novel-analysis/database -- rebuild-readiness.integration.test.ts && npm test -w @novel-analysis/web -- library.test.tsx`

Expected: FAIL because the readiness contract and query do not exist

- [ ] **Step 4: Implement readiness as a read model over existing tables**

Count chapters, current fresh L1 rows, base-group fresh L2 statuses, and current library job states in one repository function. Return `available` only when chapter total is positive and both fresh counts equal the chapter total

Expose `GET /books/:id/analysis-readiness`, parse the response with the strict contract, and keep disabled tabs visible with status text `索引重建中`

Before creating a Query turn or previewing/creating Advanced Analysis, re-read readiness inside the request path and return HTTP 409 `{ error: "analysis_rebuild_incomplete" }` unless `analysisAvailable` is true. Session/history reads remain available and the server check cannot rely on the Web disabled state

- [ ] **Step 5: Verify GREEN and no schema change**

Run: `npm run test:contracts && TEST_DATABASE_URL=postgres://novel:novel_dev_only@127.0.0.1:55432/postgres npm test -w @novel-analysis/database -- rebuild-readiness.integration.test.ts && npm test -w @novel-analysis/api -- books.integration.test.ts query-sessions.integration.test.ts advanced-analysis.integration.test.ts && npm test -w @novel-analysis/web -- library.test.tsx && if git diff --name-only main...HEAD | rg 'migrations/'; then exit 1; fi`

Expected: all focused tests PASS and no migration file changed

- [ ] **Step 6: Commit**

```bash
git add packages/contracts packages/database/src/library packages/database/src/index.ts apps/api/src/routes/books.ts apps/api/src/routes/books.integration.test.ts apps/api/src/routes/query-sessions.ts apps/api/src/routes/query-sessions.integration.test.ts apps/api/src/routes/advanced-analysis.ts apps/api/src/routes/advanced-analysis.integration.test.ts apps/web/src/features/library apps/web/src/app/styles.css
git commit -m "feat: expose per-book analysis readiness"
```

**Escalate when:** readiness cannot be derived from existing tables, a new persistent state is required, or product behavior beyond fail-closed analysis access is requested

## Task 5: Approved Index Baseline And Persistent Rebuild Batch

**Core allowed modules:** repository indexing baseline, existing Job/Step/lease/outbox kernel, rebuild API/Worker/UI, Phase 5 recovery harness

**Mechanical adjacent scope:** Job contract type, package exports, controlled fake Dify, focused tests, root commands

**Prohibited changes:** new database table, legacy Prompt import, L1/L2 algorithm or DSL change, provider quota policy change, reorder of started Steps

**Files:**
- Create: `config/indexing-baseline.json`
- Create: `scripts/check-indexing-baseline.mjs`
- Create: `packages/jobs/src/library/rebuild-job.ts`
- Create: `packages/jobs/src/library/rebuild-job.integration.test.ts`
- Create: `apps/worker/src/rebuild-executor.ts`
- Create: `apps/worker/src/rebuild-executor.integration.test.ts`
- Create: `apps/api/src/routes/admin-rebuild.ts`
- Create: `apps/api/src/routes/admin-rebuild.integration.test.ts`
- Create: `apps/web/src/features/library/RebuildQueuePanel.tsx`
- Create: `test/phase5/helpers/phase5-harness.ts`
- Create: `test/phase5/rebuild-recovery.e2e.test.ts`
- Create: `test/phase5/fixtures/golden-query.ts`
- Modify: `packages/contracts/src/job-contract.ts`
- Modify: `packages/contracts/src/job-contract.test.ts`
- Modify: `packages/jobs/src/index.ts`
- Modify: `packages/jobs/src/step-leases.ts`
- Create: `packages/jobs/src/step-leases.integration.test.ts`
- Modify: `apps/worker/src/worker.ts`
- Modify: `apps/worker/src/worker.test.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/web/src/features/library/LibraryPage.tsx`
- Modify: `apps/web/src/features/library/library.test.tsx`
- Modify: `vitest.phase5.config.ts`
- Modify: `package.json`

- [ ] **Step 1: Add one repository-owned indexing baseline**

The checked-in JSON contains exact L1/L2 Prompt text, strict hashes, base group key/name/category scope, adapter contract versions, and the current L1/L2 DSL hashes copied from `dify-workflows/manifest.json`

```json
{
  "version": "phase5-indexing-v1",
  "l1": {
    "promptVersion": "phase5-l1-v1",
    "prompt": "请为当前小说章节建立轻量 L1 章节路由/信号索引。\n定位：L1 只判断本章有哪些可召回信号，服务后续按章节命中后读取 L2 专项事实；不要写长摘要，不要沉淀事实卡，不要替代 L2。\n要求：只依据本章原文；不要输出 Markdown；不要引用长段原文；主体、别名、关键词和分类信号要稳定、短句化、便于检索。",
    "adapterContractVersion": "l1-route-v1",
    "dslSha256": "ebd3d3b403e9dd10bc6f5f0a2a16e94c7cfe94dc5c83ed766b34ba9f00190bf9"
  },
  "l2": {
    "promptVersion": "phase5-l2-v1",
    "prompt": "请为当前小说章节建立 L2 类型化事实索引。\n目标：提取可复用、可检索、可追溯的事实单元，不要写长摘要，不要输出 Markdown。\n分类只能使用：character、relationship、cultivation、force、event、item、magical_creature、location、foreshadowing、other、organization、power、mystery。\n每条事实必须短而明确，保留主体、相关主体、事实类型、重要度、置信度和少量证据摘记。\n不要补充本章原文之外的信息；如果本章没有可复用事实，facts 输出空数组。",
    "adapterContractVersion": "l2-fact-v1",
    "dslSha256": "b8003c60302c80d017eb00eac16ed18b0d4dba6df6073c6eb1735a2139ae4894",
    "baseGroup": { "key": "base", "name": "基础事实", "categoryScope": "general" }
  }
}
```

`categoryScope: "general"` retains the existing admission meaning of all contract-approved categories. The checker recomputes Prompt hashes, compares DSL hashes to the manifest, and rejects unknown fields or a changed category meaning

- [ ] **Step 2: Define the parent Job contract and untouched-step reorder rule**

Add `library-rebuild` to `JOB_TYPES`. The parent Job has one `library-rebuild-book` Step per book, ordered by `books.updated_at DESC, books.id`, and one active concurrency key `library-rebuild:all`

```ts
export type RebuildStepRef = Readonly<{
  bookId: string;
  stage: "waiting" | "l1" | "l2" | "verify";
  l1JobId?: string;
  l2JobId?: string;
  baseGroupId?: string;
}>;
```

Reorder accepts the complete ordered set of only `queued` Steps with `attempt_count = 0`, locks the parent and Steps, uses temporary negative positions to avoid the unique constraint, then assigns positive positions and writes one audit event in the same transaction

- [ ] **Step 3: Write failing baseline, batch, defer, recovery, and authorization tests**

Assert idempotent baseline seeding, manifest/hash mismatch rejection, one Step per book, recently updated default order, admin-only creation/reorder, member denial, reorder rejection after first attempt, and no duplicate active batch

Terminate Worker while a child L1 and L2 Job is running, expire leases, replay parent and child outbox wakes, reject late attempts, and assert the parent Step resumes from its stored child ID instead of creating a duplicate

```ts
expect(await activeChildren(parentStep.id, "l1-index")).toHaveLength(1);
expect(await activeChildren(parentStep.id, "l2-index")).toHaveLength(1);
expect(reorderStartedStep.status).toBe(409);
```

- [ ] **Step 4: Run focused tests and verify RED**

Run: `node scripts/check-indexing-baseline.mjs && npm run test:contracts && TEST_DATABASE_URL=postgres://novel:novel_dev_only@127.0.0.1:55432/postgres npm test -w @novel-analysis/jobs -- rebuild-job.integration.test.ts step-leases.integration.test.ts && TEST_DATABASE_URL=postgres://novel:novel_dev_only@127.0.0.1:55432/postgres npm test -w @novel-analysis/worker -- rebuild-executor.integration.test.ts`

Expected: FAIL because baseline seed, batch service, deferred Step transition, and executor do not exist

- [ ] **Step 5: Implement the parent-step state machine through existing transactions and outbox**

The executor behavior is

```ts
switch (ref.stage) {
  case "waiting": return deferAfterCreatingL1(claim, ref);
  case "l1": return childCompleted(ref.l1JobId) ? deferAfterCreatingL2(claim, ref) : defer(claim, ref);
  case "l2": return childCompleted(ref.l2JobId) ? defer(claim, { ...ref, stage: "verify" }) : defer(claim, ref);
  case "verify": return readinessAvailable(ref.bookId) ? complete(claim) : fail(claim, "rebuild_verification_failed");
}
```

`deferStep` locks the parent Job, Step, and running attempt; verifies lease owner/attempt authority; marks the attempt completed; returns the Step to queued with cleared lease; updates encrypted-free `output_ref`; and inserts a deduplicated delayed outbox wake in the same transaction. A stale attempt changes nothing

Child L1/L2 creation uses existing services and the seeded baseline. It creates the base group idempotently and never imports legacy Prompt or index configuration

- [ ] **Step 6: Add admin API and queue UI**

Expose admin-only create, get, and reorder routes. `RebuildQueuePanel` shows each book's stage/progress/failure, allows moving only untouched waiting books, and has no control that bypasses per-book readiness

- [ ] **Step 7: Verify recovery, idempotency, ordering, and golden recall**

Run: `npm run test:phase5 -- rebuild-recovery.e2e.test.ts && npm run test:phase2:e2e && npm run test:phase3:e2e && npm run test:phase4:e2e`

Expected: parent and child recovery PASS, duplicate counts remain zero, golden fact/chapter recall PASS, untouched reorder PASS, and prior phase behavior remains unchanged

- [ ] **Step 8: Commit**

```bash
git add config/indexing-baseline.json scripts/check-indexing-baseline.mjs packages/contracts packages/jobs apps/worker/src/rebuild-executor.ts apps/worker/src/rebuild-executor.integration.test.ts apps/worker/src/worker.ts apps/worker/src/worker.test.ts apps/api/src/app.ts apps/api/src/routes/admin-rebuild.ts apps/api/src/routes/admin-rebuild.integration.test.ts apps/web/src/features/library test/phase5 vitest.phase5.config.ts package.json
git commit -m "feat: orchestrate recoverable library rebuilds"
```

**Escalate when:** a new table is needed, baseline Prompt/Schema/DSL semantics differ from this approved file, transaction/lease/outbox evidence fails, started Steps must be reordered, or provider quota policy must change

## Task 6: Production-Scale Capacity Harness

**Core allowed modules:** Phase 5 load harness and test-only controlled provider

**Mechanical adjacent scope:** Vitest configuration, root scripts, documented report schema

**Prohibited changes:** claims based on development-machine timing, bulk real-Dify load, threshold reduction, production traffic

**Files:**
- Create: `test/phase5/scale.integration.test.ts`
- Create: `test/phase5/helpers/load-runner.ts`
- Create: `test/phase5/fixtures/scale-profile.ts`
- Create: `docs/operations/phase5-performance-report-schema.md`
- Modify: `test/phase5/helpers/phase5-harness.ts`
- Modify: `vitest.phase5.config.ts`
- Modify: `package.json`

- [ ] **Step 1: Define reproducible percentile and report contracts**

```ts
export type Phase5LoadReport = Readonly<{
  server: { cpu: string; memoryBytes: number; node: string; postgres: string };
  dataset: { books: number; chapters: number; facts: number };
  warmupSeconds: number;
  durationSeconds: number;
  browse: { users: 20; p95Ms: number };
  submit: { users: 10; p95Ms: number };
  statusPropagationP95Ms: number;
}>;
```

- [ ] **Step 2: Write failing capacity assertions**

Run 20 authenticated browse loops and 10 concurrent query submissions against real API/PostgreSQL with a controlled Dify adapter, calculate nearest-rank p95, and assert `browse < 500ms`, `submit < 1000ms`, and status propagation `< 2000ms`

Run rebuild work concurrently and assert interactive submission remains ahead of queued background work without interrupting an already-running step

- [ ] **Step 3: Run the scale suite and verify RED or measurable baseline**

Run: `npm run test:phase5:scale`

Expected: machine-readable report plus explicit PASS/FAIL for all three accepted thresholds

- [ ] **Step 4: Fix only measured repository-level bottlenecks**

Allowed changes are missing existing-table indexes proven by `EXPLAIN ANALYZE`, bounded query projection, and test harness isolation. Any new migration, queue quota semantics, caching layer, or infrastructure change requires user confirmation before implementation

- [ ] **Step 5: Re-run and preserve raw evidence**

Run: `npm run test:phase5:scale -- --reporter=json --outputFile=.artifacts/phase5-scale.json && npm run test:integration`

Expected: all thresholds PASS on the recorded server profile and PostgreSQL integration remains green

- [ ] **Step 6: Commit**

```bash
git add test/phase5 docs/operations/phase5-performance-report-schema.md vitest.phase5.config.ts package.json packages/database
git commit -m "test: add Phase 5 capacity evidence"
```

**Escalate when:** any threshold fails, a new database migration is needed, queue policy must change, or local and CI evidence conflict

## Task 7: Single-Server Preflight, UAT, And Cutover Runbooks

**Core allowed modules:** deployment templates, read-only preflight, operational documentation

**Mechanical adjacent scope:** script tests, environment example, package commands

**Prohibited changes:** real domain/certificate, real credentials, Feishu callback mutation, deployment, production snapshot/key access, service stop/start, database deletion, traffic switch

**Files:**
- Create: `deploy/phase5/compose.yml`
- Create: `deploy/phase5/Caddyfile`
- Create: `deploy/phase5/env.example`
- Create: `scripts/phase5-preflight.mjs`
- Create: `test/phase5/preflight.test.ts`
- Create: `docs/operations/phase5-snapshot-access.md`
- Create: `docs/operations/phase5-uat.md`
- Create: `docs/operations/phase5-cutover.md`
- Create: `docs/operations/phase5-repair.md`
- Modify: `package.json`

- [ ] **Step 1: Write failing preflight tests**

Assert fail-closed behavior for non-HTTPS origin, callback outside the exact origin/path, PostgreSQL published externally, missing health check, insufficient disk/backup space, invalid key length, equal encryption/HMAC keys, certificate expiry, clock skew, and unapproved operation mode

```ts
expect(runPreflight({ operationGate: "" })).toEqual({ ok: false, code: "gate_not_approved" });
expect(runPreflight({ databasePublished: true })).toEqual({ ok: false, code: "database_exposed" });
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npm run test:phase5 -- preflight.test.ts`

Expected: FAIL because the preflight script and deployment templates do not exist

- [ ] **Step 3: Implement local-only topology and a read-only preflight**

Compose exposes only Caddy HTTPS, keeps API/Worker/PostgreSQL on an internal network, uses named volumes, health checks, restart policy, log limits, and secret file mounts. The preflight reads configuration and health endpoints but performs no mutation

- [ ] **Step 4: Write exact gated procedures**

The snapshot runbook names owner, approver, source fingerprint, access start/end, isolated storage, `0600` permissions, old-key custodian, and destruction evidence

The UAT runbook lists 3-5 representative users and exact login, authorization, library, chapter, readiness, L2 query, evidence, recovery, and denial cases

The cutover runbook encodes the 12 accepted steps, a two-hour stopwatch for maintenance through entry switch, zero live legacy jobs, hard-stop commands, two-hour observation, no old-entry rollback, new-system maintenance repair, and 90-day backup expiry approval

- [ ] **Step 5: Verify templates contain no credentials and no external action runs**

Run: `npm run test:phase5 -- preflight.test.ts && npm run phase5:preflight -- --config deploy/phase5/env.example --dry-run && rg -n '(DIFY-[A-Za-z0-9]|BEGIN PRIVATE KEY|postgres://[^:]+:[^@]+@)' deploy/phase5 docs/operations scripts/phase5-preflight.mjs && exit 1 || true`

Expected: preflight fixture PASS, dry-run performs no mutation, credential scan returns no match

- [ ] **Step 6: Commit**

```bash
git add deploy/phase5 scripts/phase5-preflight.mjs test/phase5/preflight.test.ts docs/operations package.json
git commit -m "docs: add gated Phase 5 operations runbooks"
```

**Escalate when:** any external system must be changed, a real secret/data path is requested, deployment topology changes, or the no-entry-rollback policy is questioned

## Task 8: Engineering Acceptance Harness And Gate Dossier

**Core allowed modules:** Phase 5 acceptance tests, local verification command, gate dossier, project checkpoint evidence

**Mechanical adjacent scope:** package scripts, CI verification wiring, project source update by controller

**Prohibited changes:** formal snapshot migration, real Dify load, UAT execution, deployment, callback change, cutover, automatic Gate acceptance

**Files:**
- Create: `test/phase5/phase5-acceptance.e2e.test.ts`
- Create: `scripts/phase5-acceptance.mjs`
- Create: `docs/operations/phase5-gate-dossier.md`
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`
- Modify by controller only: `docs/project/PROJECT.md`
- Create by controller only: `docs/project/checkpoints/CP-20260723-PHASE5-TOOLS-ACCEPTED.md`

- [ ] **Step 1: Encode the engineering acceptance matrix**

```ts
const requiredEvidence = [
  "source-read-only",
  "book-transaction-rollback",
  "source-target-content-equality",
  "target-decrypt-and-hmac",
  "manifest-secret-scan",
  "scope-exclusion",
  "rebuild-recovery",
  "analysis-lock",
  "capacity-thresholds",
  "operations-preflight",
] as const;
```

- [ ] **Step 2: Write failing acceptance tests for missing or contradictory evidence**

Reject missing evidence, stale manifest fingerprint, non-empty target, sentinel leakage, incomplete readiness lock, failed capacity threshold, missing Gate authorization, and any dossier statement that claims production execution

- [ ] **Step 3: Run acceptance and verify RED**

Run: `npm run test:phase5:acceptance`

Expected: FAIL until every engineering artifact from Tasks 1-7 is present and fresh

- [ ] **Step 4: Implement the local acceptance command and CI wiring**

`phase5-acceptance.mjs` orchestrates only synthetic/integration fixtures, writes evidence under ignored `.artifacts/phase5/`, prints stable PASS/FAIL codes, and never accepts production paths or keys

CI runs the Phase 5 contract/unit/integration acceptance that fits the repository service environment; production-scale timing remains controller evidence on the recorded target server and cannot be replaced by CI timing

- [ ] **Step 5: Run controller verification and scope audit**

Run: `npm run verify:legacy && npm run verify:new && npm run test:integration && npm run test:phase2:e2e && npm run test:phase3:e2e && npm run test:phase4:e2e && npm run test:phase5:acceptance && npm run project:check && git diff --check main...HEAD`

Expected: every command PASS, no production data/key/domain appears in Git, and changed files match Tasks 1-8

- [ ] **Step 6: Produce the gate dossier without accepting the operational Gates**

The dossier links fresh commands, CI, migration manifests from synthetic fixtures, scale report, recovery evidence, secret scan, known risks, and four explicit pending decisions: production snapshot access, Feishu/UAT, deployment, and cutover

- [ ] **Step 7: Commit**

```bash
git add test/phase5 scripts/phase5-acceptance.mjs docs/operations/phase5-gate-dossier.md package.json .github/workflows/ci.yml
git commit -m "test: add Phase 5 engineering acceptance gate"
```

**Escalate when:** any required verification fails, evidence conflicts, CI differs from local evidence, production material appears, or a formal-operation Gate is requested

## Task Contracts And Ordering

Tasks must execute in order `1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7 -> 8`

Each Task Contract uses the merged SHA immediately preceding that task as `base commit`, copies the task's core modules, mechanical adjacent scope, prohibited changes, required verification, and escalation conditions, and sets success criteria to the task's final GREEN evidence

Task 6 may begin only after Task 5 proves recovery and analysis locking. Task 7 is documentation and local preflight only. Task 8 may submit tool acceptance but cannot accept or execute any formal-operation Gate

## Verification By Role

| Role | Default verification |
| --- | --- |
| Implementer | RED/GREEN focused tests, package typecheck, lint, `git diff --check`, scope audit |
| Specification review | Task contract matrix, focused tests, migration scope exclusion, missing behavior |
| Quality review | corruption, rollback, secret leakage, lease/outbox recovery, readiness fail-closed, threshold reproduction |
| Controller before merge | `verify:legacy`, `verify:new`, integration, affected phase E2E, project source, full committed whitespace diff |
| CI | repository standard verification plus bounded Phase 5 synthetic acceptance |
| Post-merge | focused smoke, project source, main SHA, clean status and worktree cleanup |

Expand verification for Tasks 2, 3, 5, and 8 because they touch encryption, database transactions, lease recovery, outbox, or cross-phase acceptance

## Phase 5 Implementation Gate

Approval of this plan unlocks only Tasks 1-8 within their contracts

After Task 8, the controller must stop and request separate authorization in this order

1. Production snapshot access Gate
2. Production-scale isolated rehearsal result Gate
3. Feishu callback and representative-user UAT Gate
4. Single-server deployment Gate
5. Formal cutover Gate

No earlier Gate implies approval of a later Gate
