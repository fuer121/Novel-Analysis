# L1 / L2 Index Storage

Last updated: 2026-06-02, Asia/Shanghai

This document describes the current L1/L2 index storage used by the service. It replaces the earlier marker/object proposal. The implementation source of truth is `server/db.js` and the runtime orchestration is in `server/workflows.js`.

## Goal

The index layer lets analysis tasks avoid reading every chapter body whenever possible.

- `L1` is a chapter-level route and signal index.
- `L2` is a chapter-level typed fact index, scoped by one or more index groups.
- Analysis tasks consume L1/L2 as recall material, then produce final encrypted analysis results.

L1 and L2 are not the final analysis result. They are reusable navigation and evidence layers.

## Current Data Flow

1. Chapters are imported from Dify and encrypted in `chapters`.
2. L1 is built per chapter into `l1_chapter_indexes`.
3. L2 is built per chapter and per index group into `l2_chapter_statuses` and `l2_facts`.
4. Analysis templates bind one or more L2 index groups through `prompt_groups.index_group_keys`.
5. Index-based analysis scans L1, recalls L2 facts, optionally reviews a small number of original chapters, then saves final results.

## L1 Boundary

L1 answers: "Which chapters are worth looking at for this kind of analysis?"

It stores compact route material:

- route schema version
- route entities and aliases
- route keywords
- category signals
- category scores
- compatibility fields for older L1 data

L1 should not become:

- a deep chapter summary
- a fact card store
- a relationship encyclopedia
- a replacement for L2

## L2 Boundary

L2 answers: "What reusable facts from this chapter can later be recalled?"

It stores typed facts:

- category
- entity
- aliases
- tags
- related entities
- fact type
- encrypted fact/evidence payload
- importance and confidence
- source metadata

L2 facts are grouped by `index_group_key`. A book can have multiple specialized fact indexes, such as character appearance, items, cultivation, or faction relationships.

## SQLite Tables

### `book_index_prompts`

Book-level default index prompts.

Columns:

- `book_id TEXT PRIMARY KEY`
- `l1_index_prompt TEXT NOT NULL DEFAULT ''`
- `l2_index_prompt TEXT NOT NULL DEFAULT ''`
- `created_at TEXT NOT NULL`
- `updated_at TEXT NOT NULL`

Purpose:

- stores the current L1 prompt for the book
- stores the legacy/default L2 prompt used by the base group
- drives freshness hashes for L1 and base L2 data

### `book_index_groups`

Book-level L2 fact index groups.

Columns:

- `book_id TEXT NOT NULL`
- `group_key TEXT NOT NULL`
- `name TEXT NOT NULL DEFAULT ''`
- `description TEXT NOT NULL DEFAULT ''`
- `category_scope TEXT NOT NULL DEFAULT '[]'`
- `trigger_keywords TEXT NOT NULL DEFAULT '[]'`
- `l2_index_prompt TEXT NOT NULL DEFAULT ''`
- `enabled INTEGER NOT NULL DEFAULT 1`
- `created_at TEXT NOT NULL`
- `updated_at TEXT NOT NULL`

Primary key:

- `(book_id, group_key)`

Purpose:

- isolates different L2 prompts and facts for the same book
- lets analysis templates bind specific fact indexes
- keeps coverage and rebuild behavior separate per index group

Special key:

- `base` is the compatibility group.
- User-created analysis templates normally bind non-base specialized groups.

### `l1_chapter_indexes`

Chapter-level route and signal index.

Key columns:

- `book_id TEXT NOT NULL`
- `chapter_index INTEGER NOT NULL`
- `status TEXT NOT NULL`
- `source_hmac TEXT NOT NULL DEFAULT ''`
- `model TEXT NOT NULL DEFAULT ''`
- `prompt_hash TEXT NOT NULL DEFAULT ''`
- `route_schema_version TEXT NOT NULL DEFAULT ''`
- `route_entities TEXT NOT NULL DEFAULT '[]'`
- `route_keywords TEXT NOT NULL DEFAULT '[]'`
- `signals TEXT NOT NULL DEFAULT '[]'`
- `category_scores TEXT NOT NULL DEFAULT '{}'`
- `has_major_signal INTEGER NOT NULL DEFAULT 0`
- `confidence REAL NOT NULL DEFAULT 0`
- `error_summary TEXT NOT NULL DEFAULT ''`

Primary key:

- `(book_id, chapter_index)`

Freshness is determined by:

- chapter `content_hmac`
- L1 execution signature
- book L1 prompt hash

### `l1_window_indexes`

Historical 10-chapter window index data.

Current status:

- retained for compatibility and diagnostics
- not the current build path
- not used by new index-based analysis as the main route layer

### `l2_chapter_statuses`

Chapter-level L2 build status for each index group.

Columns:

- `book_id TEXT NOT NULL`
- `index_group_key TEXT NOT NULL DEFAULT 'base'`
- `chapter_index INTEGER NOT NULL`
- `status TEXT NOT NULL`
- `source_hmac TEXT NOT NULL DEFAULT ''`
- `model TEXT NOT NULL DEFAULT ''`
- `prompt_hash TEXT NOT NULL DEFAULT ''`
- `schema_version TEXT NOT NULL DEFAULT ''`
- `facts_count INTEGER NOT NULL DEFAULT 0`
- `error_summary TEXT NOT NULL DEFAULT ''`
- `created_at TEXT NOT NULL`
- `updated_at TEXT NOT NULL`

Primary key:

- `(book_id, index_group_key, chapter_index)`

Freshness is determined by:

- chapter `content_hmac`
- L2 execution signature
- index group prompt hash
- L2 schema version

### `l2_facts`

Encrypted L2 fact records.

Plain metadata columns:

- `id TEXT PRIMARY KEY`
- `book_id TEXT NOT NULL`
- `index_group_key TEXT NOT NULL DEFAULT 'base'`
- `chapter_index INTEGER NOT NULL`
- `status TEXT NOT NULL`
- `source_hmac TEXT NOT NULL DEFAULT ''`
- `model TEXT NOT NULL DEFAULT ''`
- `prompt_hash TEXT NOT NULL DEFAULT ''`
- `schema_version TEXT NOT NULL DEFAULT ''`
- `category TEXT NOT NULL DEFAULT 'other'`
- `entity TEXT NOT NULL DEFAULT ''`
- `aliases TEXT NOT NULL DEFAULT '[]'`
- `tags TEXT NOT NULL DEFAULT '[]'`
- `related_entities TEXT NOT NULL DEFAULT '[]'`
- `fact_type TEXT NOT NULL DEFAULT ''`
- `importance REAL NOT NULL DEFAULT 0`
- `confidence REAL NOT NULL DEFAULT 0`
- `review_source TEXT NOT NULL DEFAULT 'index'`

Encrypted payload columns:

- `ciphertext`
- `iv`
- `tag`
- `algorithm`

Encrypted payload contains:

- `fact`
- `evidence`
- `review_note`

Indexes:

- `idx_l2_facts_lookup` on `(book_id, index_group_key, category, entity, chapter_index)`
- `idx_l2_facts_chapter` on `(book_id, index_group_key, chapter_index)`

## Write Strategy

### L1 Build

For each selected chapter:

1. Check existing L1 freshness.
2. Skip fresh completed rows unless force rebuild is requested.
3. Decrypt chapter body.
4. Run Dify or OpenAI according to `L1_INDEX_PROVIDER`.
5. Save a completed or failed row in `l1_chapter_indexes`.

Execution signature:

- Dify: `dify:l1:${DIFY_L1_WORKFLOW_VERSION}`
- OpenAI: configured model name

### L2 Build

For each selected chapter and index group:

1. Check existing L2 status freshness.
2. Apply build mode: `all`, `missing`, or `retry_failed`.
3. Decrypt chapter body.
4. Attach compact L1 route JSON when available.
5. Run Dify or OpenAI according to `L2_INDEX_PROVIDER`.
6. Replace that chapter's facts for the target group.
7. Save status in `l2_chapter_statuses`.

Execution signature:

- Dify: `dify:l2:${DIFY_L2_WORKFLOW_VERSION}`
- OpenAI: configured model name

## Analysis Recall Strategy

`full_text` mode:

- decrypts selected chapters
- runs chapter analysis
- summarizes encrypted chapter results

`fast_index`, `balanced`, and `precision` modes:

- scan fresh L1 route rows
- infer categories and entity queries from the analysis prompt
- recall facts from bound L2 index groups
- optionally review a small number of high-risk original chapters
- summarize evidence packets into the final result

Source review budget:

- `fast_index`: 0 chapters
- `balanced`: about 1 percent, capped at 10
- `precision`: about 3 percent, capped at 30

## Security Notes

- Chapter bodies remain encrypted in `chapters`.
- L2 fact text and evidence are encrypted in `l2_facts`.
- L1 route fields are stored in plain SQLite because they are used for routing, but they remain sensitive derived novel content.
- L2 metadata fields are stored in plain SQLite for lookup, but fact and evidence content stay encrypted.
- Diagnostics must expose counts, statuses, and coverage only, not raw chapter text or encrypted fact payloads.

## Known Follow-Ups

- The analysis page currently displays coverage for the first bound index group only, while backend recall can use multiple groups.
- Analysis chapter-result reuse should include the analysis execution signature to avoid accidental reuse after switching analysis provider or workflow version.
- Dify analysis workflows should be validated end to end with a small real task after API keys are configured.
