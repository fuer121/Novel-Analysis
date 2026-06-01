import path from "node:path";
import crypto from "node:crypto";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { config } from "./config.js";
import { decryptText, encryptText, hmacText, sha256 } from "./crypto.js";
import {
  defaultSchemaFields,
  normalizeSchemaFields,
  normalizeSchemaMode,
  parseSchemaOrThrow,
  schemaFromFields
} from "./schema.js";

export const DEFAULT_L1_INDEX_PROMPT = [
  "请为当前小说章节建立轻量 L1 章节路由/信号索引。",
  "定位：L1 只判断本章有哪些可召回信号，服务后续按章节命中后读取 L2 专项事实；不要写长摘要，不要沉淀事实卡，不要替代 L2。",
  "要求：只依据本章原文；不要输出 Markdown；不要引用长段原文；主体、别名、关键词和分类信号要稳定、短句化、便于检索。"
].join("\n");

export const DEFAULT_L2_INDEX_PROMPT = [
  "请为当前小说章节建立 L2 类型化事实索引。",
  "目标：提取可复用、可检索、可追溯的事实单元，不要写长摘要，不要输出 Markdown。",
  "分类只能使用：character、relationship、cultivation、force、item、location、event、foreshadowing、other。",
  "每条事实必须短而明确，保留主体、相关主体、事实类型、重要度、置信度和少量证据摘记。",
  "不要补充本章原文之外的信息；如果本章没有可复用事实，facts 输出空数组。"
].join("\n");

const DEFAULT_L1_INDEX_PROMPT_HASH = "l1-route-v1";
const DEFAULT_L2_INDEX_PROMPT_HASH = "l2-v1-typed-facts";
export const BASE_INDEX_GROUP_KEY = "base";

const dbPath = path.join(config.dataDir, "novel-chapters.sqlite");
const db = new DatabaseSync(dbPath);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS books (
    book_id TEXT PRIMARY KEY,
    book_name TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_import_status TEXT NOT NULL DEFAULT 'idle'
  );

  CREATE TABLE IF NOT EXISTS chapters (
    book_id TEXT NOT NULL,
    chapter_index INTEGER NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    content_length INTEGER NOT NULL DEFAULT 0,
    content_hmac TEXT NOT NULL,
    ciphertext TEXT NOT NULL,
    iv TEXT NOT NULL,
    tag TEXT NOT NULL,
    algorithm TEXT NOT NULL DEFAULT 'aes-256-gcm',
    fetch_status TEXT NOT NULL DEFAULT 'ok',
    fetched_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (book_id, chapter_index),
    FOREIGN KEY (book_id) REFERENCES books(book_id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS prompt_settings (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    model TEXT NOT NULL,
    reasoning_effort TEXT NOT NULL,
    chapter_prompt TEXT NOT NULL,
    summary_prompt TEXT NOT NULL,
    output_schema TEXT NOT NULL,
    schema_mode TEXT NOT NULL DEFAULT 'fields',
    schema_fields TEXT NOT NULL DEFAULT '[]',
    l1_index_prompt TEXT NOT NULL DEFAULT '',
    l2_index_prompt TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS prompt_groups (
    id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT '未分类',
    chapter_prompt TEXT NOT NULL,
    summary_prompt TEXT NOT NULL,
    index_group_keys TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS book_index_prompts (
    book_id TEXT PRIMARY KEY,
    l1_index_prompt TEXT NOT NULL DEFAULT '',
    l2_index_prompt TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (book_id) REFERENCES books(book_id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS book_index_groups (
    book_id TEXT NOT NULL,
    group_key TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    category_scope TEXT NOT NULL DEFAULT '[]',
    trigger_keywords TEXT NOT NULL DEFAULT '[]',
    l2_index_prompt TEXT NOT NULL DEFAULT '',
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (book_id, group_key),
    FOREIGN KEY (book_id) REFERENCES books(book_id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS analysis_runs (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL DEFAULT '',
    book_id TEXT NOT NULL,
    start_chapter INTEGER NOT NULL,
    end_chapter INTEGER NOT NULL,
    chapter_selection TEXT NOT NULL DEFAULT '',
    model TEXT NOT NULL,
    reasoning_effort TEXT NOT NULL,
    prompt_hash TEXT NOT NULL,
    schema_hash TEXT NOT NULL,
    status TEXT NOT NULL,
    chapter_count INTEGER NOT NULL DEFAULT 0,
    error_summary TEXT NOT NULL DEFAULT '',
    source_stats TEXT NOT NULL DEFAULT '',
    prompt_ciphertext TEXT,
    prompt_iv TEXT,
    prompt_tag TEXT,
    prompt_algorithm TEXT NOT NULL DEFAULT 'aes-256-gcm',
    ciphertext TEXT,
    iv TEXT,
    tag TEXT,
    algorithm TEXT NOT NULL DEFAULT 'aes-256-gcm',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (book_id) REFERENCES books(book_id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS analysis_chapters (
    analysis_id TEXT NOT NULL,
    chapter_index INTEGER NOT NULL,
    status TEXT NOT NULL,
    content_hmac TEXT,
    prompt_hash TEXT NOT NULL,
    ciphertext TEXT,
    iv TEXT,
    tag TEXT,
    algorithm TEXT NOT NULL DEFAULT 'aes-256-gcm',
    error_summary TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL,
    PRIMARY KEY (analysis_id, chapter_index),
    FOREIGN KEY (analysis_id) REFERENCES analysis_runs(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS analysis_summary_parts (
    analysis_id TEXT NOT NULL,
    part_key TEXT NOT NULL,
    parent_key TEXT NOT NULL DEFAULT '',
    stage TEXT NOT NULL,
    status TEXT NOT NULL,
    content_hash TEXT NOT NULL DEFAULT '',
    prompt_hash TEXT NOT NULL DEFAULT '',
    schema_hash TEXT NOT NULL DEFAULT '',
    model TEXT NOT NULL DEFAULT '',
    reasoning_effort TEXT NOT NULL DEFAULT '',
    input_summary TEXT NOT NULL DEFAULT '',
    trace_summary TEXT NOT NULL DEFAULT '',
    error_summary TEXT NOT NULL DEFAULT '',
    ciphertext TEXT,
    iv TEXT,
    tag TEXT,
    algorithm TEXT NOT NULL DEFAULT 'aes-256-gcm',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (analysis_id, part_key),
    FOREIGN KEY (analysis_id) REFERENCES analysis_runs(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS l1_chapter_indexes (
    book_id TEXT NOT NULL,
    chapter_index INTEGER NOT NULL,
    status TEXT NOT NULL,
    source_hmac TEXT NOT NULL DEFAULT '',
    model TEXT NOT NULL DEFAULT '',
    prompt_hash TEXT NOT NULL DEFAULT '',
    summary TEXT NOT NULL DEFAULT '',
    keywords TEXT NOT NULL DEFAULT '[]',
    entities TEXT NOT NULL DEFAULT '[]',
    key_events TEXT NOT NULL DEFAULT '[]',
    items_places_orgs TEXT NOT NULL DEFAULT '[]',
    open_questions TEXT NOT NULL DEFAULT '[]',
    route_schema_version TEXT NOT NULL DEFAULT '',
    route_summary TEXT NOT NULL DEFAULT '',
    route_entities TEXT NOT NULL DEFAULT '[]',
    route_keywords TEXT NOT NULL DEFAULT '[]',
    signals TEXT NOT NULL DEFAULT '[]',
    category_scores TEXT NOT NULL DEFAULT '{}',
    has_major_signal INTEGER NOT NULL DEFAULT 0,
    confidence REAL NOT NULL DEFAULT 0,
    error_summary TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (book_id, chapter_index),
    FOREIGN KEY (book_id) REFERENCES books(book_id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS l1_window_indexes (
    book_id TEXT NOT NULL,
    window_start INTEGER NOT NULL,
    window_end INTEGER NOT NULL,
    status TEXT NOT NULL,
    source_hmac TEXT NOT NULL DEFAULT '',
    model TEXT NOT NULL DEFAULT '',
    prompt_hash TEXT NOT NULL DEFAULT '',
    summary TEXT NOT NULL DEFAULT '',
    timeline TEXT NOT NULL DEFAULT '[]',
    entity_changes TEXT NOT NULL DEFAULT '[]',
    relationship_changes TEXT NOT NULL DEFAULT '[]',
    foreshadowing TEXT NOT NULL DEFAULT '[]',
    covered_chapters TEXT NOT NULL DEFAULT '[]',
    missing_chapters TEXT NOT NULL DEFAULT '[]',
    confidence REAL NOT NULL DEFAULT 0,
    error_summary TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (book_id, window_start, window_end),
    FOREIGN KEY (book_id) REFERENCES books(book_id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS l2_chapter_statuses (
    book_id TEXT NOT NULL,
    index_group_key TEXT NOT NULL DEFAULT 'base',
    chapter_index INTEGER NOT NULL,
    status TEXT NOT NULL,
    source_hmac TEXT NOT NULL DEFAULT '',
    model TEXT NOT NULL DEFAULT '',
    prompt_hash TEXT NOT NULL DEFAULT '',
    schema_version TEXT NOT NULL DEFAULT '',
    facts_count INTEGER NOT NULL DEFAULT 0,
    error_summary TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (book_id, index_group_key, chapter_index),
    FOREIGN KEY (book_id) REFERENCES books(book_id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS l2_facts (
    id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL,
    index_group_key TEXT NOT NULL DEFAULT 'base',
    chapter_index INTEGER NOT NULL,
    status TEXT NOT NULL,
    source_hmac TEXT NOT NULL DEFAULT '',
    model TEXT NOT NULL DEFAULT '',
    prompt_hash TEXT NOT NULL DEFAULT '',
    schema_version TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT 'other',
    entity TEXT NOT NULL DEFAULT '',
    aliases TEXT NOT NULL DEFAULT '[]',
    tags TEXT NOT NULL DEFAULT '[]',
    related_entities TEXT NOT NULL DEFAULT '[]',
    fact_type TEXT NOT NULL DEFAULT '',
    importance REAL NOT NULL DEFAULT 0,
    confidence REAL NOT NULL DEFAULT 0,
    review_source TEXT NOT NULL DEFAULT 'index',
    ciphertext TEXT,
    iv TEXT,
    tag TEXT,
    algorithm TEXT NOT NULL DEFAULT 'aes-256-gcm',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (book_id) REFERENCES books(book_id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_l2_facts_lookup
    ON l2_facts(book_id, index_group_key, category, entity, chapter_index);
  CREATE INDEX IF NOT EXISTS idx_l2_facts_chapter
    ON l2_facts(book_id, index_group_key, chapter_index);
`);

migrateSchema();
seedDefaultPrompts();
seedDefaultPromptGroups();

export function getDbPath() {
  return dbPath;
}

export function nowIso() {
  return new Date().toISOString();
}

export function ensureBook(bookId, bookName = "") {
  const id = normalizeBookId(bookId);
  const name = normalizeBookName(bookName);
  const now = nowIso();
  const existing = getBook(id);

  if (existing) {
    if (name && existing.book_name && existing.book_name !== name) {
      const error = new Error(`小说 ID ${id} 已绑定书名《${existing.book_name}》，不能再绑定为《${name}》。`);
      error.status = 409;
      throw error;
    }
    db.prepare("UPDATE books SET book_name = ?, updated_at = ? WHERE book_id = ?")
      .run(existing.book_name || name, now, id);
    ensureBookIndexPrompts(id);
    ensureBaseIndexGroup(id);
    return getBook(id);
  }

  db.prepare(`
    INSERT INTO books (book_id, book_name, created_at, updated_at)
    VALUES (?, ?, ?, ?)
  `).run(id, name, now, now);
  ensureBookIndexPrompts(id);
  ensureBaseIndexGroup(id);
  return getBook(id);
}

export function getBook(bookId) {
  return db.prepare("SELECT * FROM books WHERE book_id = ?").get(normalizeBookId(bookId));
}

export function listBooks() {
  return db.prepare(`
    SELECT
      b.book_id,
      b.book_name,
      b.created_at,
      b.updated_at,
      b.last_import_status,
      COUNT(c.chapter_index) AS chapter_count,
      MIN(c.chapter_index) AS first_chapter,
      MAX(c.chapter_index) AS last_chapter
    FROM books b
    LEFT JOIN chapters c ON c.book_id = b.book_id
    GROUP BY b.book_id
    ORDER BY b.updated_at DESC
  `).all();
}

export function getDatabaseDiagnostics() {
  const stats = safeStat(dbPath);
  const books = listBooks().map((book) => ({
    book_id: book.book_id,
    book_name: book.book_name,
    chapter_count: Number(book.chapter_count || 0),
    first_chapter: book.first_chapter,
    last_chapter: book.last_chapter,
    last_import_status: book.last_import_status,
    updated_at: book.updated_at,
    l1: countStatusesForBook("l1_chapter_indexes", book.book_id),
    l2: countStatusesForBook("l2_chapter_statuses", book.book_id),
    index_groups: countRows("book_index_groups", "book_id = ?", [book.book_id]),
    l2_facts: countRows("l2_facts", "book_id = ?", [book.book_id]),
    analyses: countStatusesForBook("analysis_runs", book.book_id),
    prompt_groups: countRows("prompt_groups", "book_id = ?", [book.book_id])
  }));
  return {
    generated_at: nowIso(),
    storage: {
      db_file_bytes: stats.size || 0,
      db_updated_at: stats.mtime ? stats.mtime.toISOString() : ""
    },
    totals: {
      books: countRows("books"),
      chapters: countRows("chapters"),
      l1_indexes: countRows("l1_chapter_indexes"),
      l1_windows: countRows("l1_window_indexes"),
      l2_chapter_statuses: countRows("l2_chapter_statuses"),
      index_groups: countRows("book_index_groups"),
      l2_facts: countRows("l2_facts"),
      analyses: countRows("analysis_runs"),
      prompt_groups: countRows("prompt_groups"),
      summary_parts: countRows("analysis_summary_parts")
    },
    statuses: {
      l1: countStatuses("l1_chapter_indexes"),
      l2: countStatuses("l2_chapter_statuses"),
      analyses: countStatuses("analysis_runs"),
      summary_parts: countStatuses("analysis_summary_parts")
    },
    books
  };
}

export function updateBookImportStatus(bookId, status) {
  db.prepare("UPDATE books SET last_import_status = ?, updated_at = ? WHERE book_id = ?")
    .run(String(status || "idle"), nowIso(), normalizeBookId(bookId));
}

export function listChapterMetadata(bookId) {
  return db.prepare(`
    SELECT book_id, chapter_index, title, content_length, content_hmac, fetch_status, fetched_at, updated_at
    FROM chapters
    WHERE book_id = ?
    ORDER BY chapter_index ASC
  `).all(normalizeBookId(bookId));
}

export function getChapterMetadata(bookId, chapterIndex) {
  return db.prepare(`
    SELECT book_id, chapter_index, title, content_length, content_hmac, fetch_status, fetched_at, updated_at
    FROM chapters
    WHERE book_id = ? AND chapter_index = ?
  `).get(normalizeBookId(bookId), normalizeChapterIndex(chapterIndex));
}

export function getExistingChapterIndexes(bookId, startChapter, endChapter) {
  const rows = db.prepare(`
    SELECT chapter_index
    FROM chapters
    WHERE book_id = ? AND chapter_index BETWEEN ? AND ?
  `).all(normalizeBookId(bookId), normalizeChapterIndex(startChapter), normalizeChapterIndex(endChapter));
  return new Set(rows.map((row) => row.chapter_index));
}

export async function saveEncryptedChapter({ bookId, chapterIndex, title = "", content, fetchStatus = "ok" }) {
  const normalizedBookId = normalizeBookId(bookId);
  const normalizedIndex = normalizeChapterIndex(chapterIndex);
  const text = String(content || "");
  const aad = chapterAad(normalizedBookId, normalizedIndex);
  const encrypted = await encryptText(text, aad);
  const contentHmac = await hmacText(text);
  const now = nowIso();

  ensureBook(normalizedBookId);
  db.prepare(`
    INSERT INTO chapters (
      book_id, chapter_index, title, content_length, content_hmac,
      ciphertext, iv, tag, algorithm, fetch_status, fetched_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(book_id, chapter_index) DO UPDATE SET
      title = excluded.title,
      content_length = excluded.content_length,
      content_hmac = excluded.content_hmac,
      ciphertext = excluded.ciphertext,
      iv = excluded.iv,
      tag = excluded.tag,
      algorithm = excluded.algorithm,
      fetch_status = excluded.fetch_status,
      fetched_at = excluded.fetched_at,
      updated_at = excluded.updated_at
  `).run(
    normalizedBookId,
    normalizedIndex,
    String(title || ""),
    text.length,
    contentHmac,
    encrypted.ciphertext,
    encrypted.iv,
    encrypted.tag,
    encrypted.algorithm,
    String(fetchStatus || "ok"),
    now,
    now
  );

  return getChapterMetadata(normalizedBookId, normalizedIndex);
}

export async function decryptChapterContent(bookId, chapterIndex) {
  const normalizedBookId = normalizeBookId(bookId);
  const normalizedIndex = normalizeChapterIndex(chapterIndex);
  const row = db.prepare(`
    SELECT ciphertext, iv, tag, algorithm
    FROM chapters
    WHERE book_id = ? AND chapter_index = ?
  `).get(normalizedBookId, normalizedIndex);

  if (!row) {
    const error = new Error(`章节不存在：${normalizedBookId} #${normalizedIndex}`);
    error.status = 404;
    throw error;
  }

  return decryptText(row, chapterAad(normalizedBookId, normalizedIndex));
}

export function deleteBook(bookId) {
  const id = normalizeBookId(bookId);
  const result = db.prepare("DELETE FROM books WHERE book_id = ?").run(id);
  return { deleted: result.changes > 0, bookId: id };
}

export function getPromptSettings() {
  return publicPromptSettings(db.prepare("SELECT * FROM prompt_settings WHERE id = 'default'").get());
}

export function savePromptSettings(settings) {
  const current = getPromptSettings();
  const next = normalizePromptSettings(settings);
  if (!Object.hasOwn(settings, "l1_index_prompt")) {
    next.l1_index_prompt = current.l1_index_prompt;
  }
  if (!Object.hasOwn(settings, "l2_index_prompt")) {
    next.l2_index_prompt = current.l2_index_prompt;
  }
  db.prepare(`
    INSERT INTO prompt_settings (
      id, name, model, reasoning_effort, chapter_prompt, summary_prompt,
      output_schema, schema_mode, schema_fields, l1_index_prompt, l2_index_prompt, updated_at
    )
    VALUES ('default', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      model = excluded.model,
      reasoning_effort = excluded.reasoning_effort,
      chapter_prompt = excluded.chapter_prompt,
      summary_prompt = excluded.summary_prompt,
      output_schema = excluded.output_schema,
      schema_mode = excluded.schema_mode,
      schema_fields = excluded.schema_fields,
      l1_index_prompt = excluded.l1_index_prompt,
      l2_index_prompt = excluded.l2_index_prompt,
      updated_at = excluded.updated_at
  `).run(
    next.name,
    next.model,
    next.reasoning_effort,
    next.chapter_prompt,
    next.summary_prompt,
    next.output_schema,
    next.schema_mode,
    JSON.stringify(next.schema_fields),
    next.l1_index_prompt,
    next.l2_index_prompt,
    nowIso()
  );
  return getPromptSettings();
}

export function getIndexPromptSettings() {
  const settings = getPromptSettings();
  return {
    l1_index_prompt: settings.l1_index_prompt,
    l2_index_prompt: settings.l2_index_prompt,
    l1_index_prompt_hash: l1IndexPromptHash(settings),
    l2_index_prompt_hash: l2IndexPromptHash(settings),
    updated_at: settings.updated_at
  };
}

export function saveIndexPromptSettings(settings = {}) {
  const current = getPromptSettings();
  const patch = { ...current };
  if (Object.hasOwn(settings, "l1_index_prompt")) patch.l1_index_prompt = settings.l1_index_prompt;
  if (Object.hasOwn(settings, "l2_index_prompt")) patch.l2_index_prompt = settings.l2_index_prompt;
  savePromptSettings(patch);
  return getIndexPromptSettings();
}

export function ensureBookIndexPrompts(bookId, prompts = {}) {
  const id = normalizeBookId(bookId);
  const defaults = getPromptSettings();
  const now = nowIso();
  const current = db.prepare("SELECT * FROM book_index_prompts WHERE book_id = ?").get(id);
  if (current) return publicBookIndexPrompts(current);
  db.prepare(`
    INSERT INTO book_index_prompts (book_id, l1_index_prompt, l2_index_prompt, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    id,
    normalizeIndexPrompt(prompts.l1_index_prompt, defaults.l1_index_prompt),
    normalizeIndexPrompt(prompts.l2_index_prompt, defaults.l2_index_prompt),
    now,
    now
  );
  return getBookIndexPrompts(id);
}

export function getBookIndexPrompts(bookId) {
  const id = normalizeBookId(bookId);
  const row = db.prepare("SELECT * FROM book_index_prompts WHERE book_id = ?").get(id);
  if (row) return publicBookIndexPrompts(row);
  return ensureBookIndexPrompts(id);
}

export function updateBookIndexPrompts(bookId, payload = {}) {
  const current = getBookIndexPrompts(bookId);
  const next = {
    l1_index_prompt: Object.hasOwn(payload, "l1_index_prompt")
      ? normalizeIndexPrompt(payload.l1_index_prompt, current.l1_index_prompt)
      : current.l1_index_prompt,
    l2_index_prompt: Object.hasOwn(payload, "l2_index_prompt")
      ? normalizeIndexPrompt(payload.l2_index_prompt, current.l2_index_prompt)
      : current.l2_index_prompt
  };
  db.prepare(`
    UPDATE book_index_prompts
    SET l1_index_prompt = ?, l2_index_prompt = ?, updated_at = ?
    WHERE book_id = ?
  `).run(next.l1_index_prompt, next.l2_index_prompt, nowIso(), normalizeBookId(bookId));
  ensureBaseIndexGroup(bookId);
  return getBookIndexPrompts(bookId);
}

export function ensureBaseIndexGroup(bookId) {
  const id = normalizeBookId(bookId);
  const prompts = getBookIndexPrompts(id);
  const now = nowIso();
  const current = db.prepare("SELECT * FROM book_index_groups WHERE book_id = ? AND group_key = ?").get(id, BASE_INDEX_GROUP_KEY);
  if (!current) {
    db.prepare(`
      INSERT INTO book_index_groups (
        book_id, group_key, name, description, category_scope, trigger_keywords,
        l2_index_prompt, enabled, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `).run(
      id,
      BASE_INDEX_GROUP_KEY,
      "专项事实索引",
      "书籍级专项事实索引，兼容历史迁移数据。",
      JSON.stringify([]),
      JSON.stringify([]),
      prompts.l2_index_prompt,
      now,
      now
    );
  } else if (current.l2_index_prompt !== prompts.l2_index_prompt || current.name !== "专项事实索引" || current.description !== "书籍级专项事实索引，兼容历史迁移数据。") {
    db.prepare(`
      UPDATE book_index_groups
      SET name = ?, description = ?, l2_index_prompt = ?, enabled = 1, updated_at = ?
      WHERE book_id = ? AND group_key = ?
    `).run("专项事实索引", "书籍级专项事实索引，兼容历史迁移数据。", prompts.l2_index_prompt, now, id, BASE_INDEX_GROUP_KEY);
  }
  return getBookIndexGroup(id, BASE_INDEX_GROUP_KEY);
}

export function listBookIndexGroups(bookId, { includeDisabled = false } = {}) {
  const id = normalizeBookId(bookId);
  ensureBaseIndexGroup(id);
  const rows = db.prepare(`
    SELECT *
    FROM book_index_groups
    WHERE book_id = ? ${includeDisabled ? "" : "AND enabled = 1"}
    ORDER BY CASE WHEN group_key = ? THEN 0 ELSE 1 END, updated_at DESC
  `).all(id, BASE_INDEX_GROUP_KEY);
  return rows.map(publicBookIndexGroup);
}

export function getBookIndexGroup(bookId, groupKey = BASE_INDEX_GROUP_KEY) {
  const id = normalizeBookId(bookId);
  const key = normalizeIndexGroupKey(groupKey);
  if (key === BASE_INDEX_GROUP_KEY) {
    const row = db.prepare("SELECT * FROM book_index_groups WHERE book_id = ? AND group_key = ?").get(id, BASE_INDEX_GROUP_KEY);
    if (row) return publicBookIndexGroup(row);
  }
  const row = db.prepare("SELECT * FROM book_index_groups WHERE book_id = ? AND group_key = ?").get(id, key);
  return publicBookIndexGroup(row);
}

export function createBookIndexGroup(bookId, payload = {}) {
  const id = normalizeBookId(bookId);
  ensureBook(id);
  const group = normalizeBookIndexGroupPayload(payload);
  if (group.group_key === BASE_INDEX_GROUP_KEY) {
    const error = new Error("专项事实索引不能手动创建。");
    error.status = 409;
    throw error;
  }
  let nextGroupKey = group.group_key;
  if (getBookIndexGroup(id, nextGroupKey)) {
    nextGroupKey = resolveAvailableBookIndexGroupKey(id, nextGroupKey);
  }
  const now = nowIso();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      db.prepare(`
        INSERT INTO book_index_groups (
          book_id, group_key, name, description, category_scope, trigger_keywords,
          l2_index_prompt, enabled, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        nextGroupKey,
        group.name,
        group.description,
        JSON.stringify(group.category_scope),
        JSON.stringify(group.trigger_keywords),
        group.l2_index_prompt,
        group.enabled ? 1 : 0,
        now,
        now
      );
      return getBookIndexGroup(id, nextGroupKey);
    } catch (error) {
      if (!isBookIndexGroupUniqueError(error) || attempt >= 1) throw error;
      nextGroupKey = resolveAvailableBookIndexGroupKey(id, nextGroupKey);
    }
  }
  const finalError = new Error("创建事实索引失败，请稍后重试。");
  finalError.status = 500;
  throw finalError;
}

export function updateBookIndexGroup(bookId, groupKey, payload = {}) {
  const id = normalizeBookId(bookId);
  const key = normalizeIndexGroupKey(groupKey);
  if (key === BASE_INDEX_GROUP_KEY) {
    const error = new Error("专项事实索引请通过书籍 L2 Prompt 更新。");
    error.status = 409;
    throw error;
  }
  const current = getBookIndexGroup(id, key);
  if (!current) {
    const error = new Error("索引组不存在。");
    error.status = 404;
    throw error;
  }
  const group = normalizeBookIndexGroupPayload({ ...current, ...payload, group_key: key });
  db.prepare(`
    UPDATE book_index_groups
    SET name = ?, description = ?, category_scope = ?, trigger_keywords = ?,
      l2_index_prompt = ?, enabled = ?, updated_at = ?
    WHERE book_id = ? AND group_key = ?
  `).run(
    group.name,
    group.description,
    JSON.stringify(group.category_scope),
    JSON.stringify(group.trigger_keywords),
    group.l2_index_prompt,
    group.enabled ? 1 : 0,
    nowIso(),
    id,
    key
  );
  return getBookIndexGroup(id, key);
}

export function deleteBookIndexGroup(bookId, groupKey) {
  const id = normalizeBookId(bookId);
  const key = normalizeIndexGroupKey(groupKey);
  if (key === BASE_INDEX_GROUP_KEY) {
    const error = new Error("专项事实索引不可删除。");
    error.status = 409;
    throw error;
  }
  const result = db.transaction(() => {
    const deleted = db.prepare("DELETE FROM book_index_groups WHERE book_id = ? AND group_key = ?").run(id, key);
    db.prepare("DELETE FROM l2_chapter_statuses WHERE book_id = ? AND index_group_key = ?").run(id, key);
    db.prepare("DELETE FROM l2_facts WHERE book_id = ? AND index_group_key = ?").run(id, key);
    return deleted;
  })();
  return { deleted: result.changes > 0, bookId: id, groupKey: key };
}

export function disableBookIndexGroup(bookId, groupKey) {
  const id = normalizeBookId(bookId);
  const key = normalizeIndexGroupKey(groupKey);
  if (key === BASE_INDEX_GROUP_KEY) {
    const error = new Error("专项事实索引不可删除。");
    error.status = 409;
    throw error;
  }
  const result = db.prepare(`
    UPDATE book_index_groups
    SET enabled = 0, updated_at = ?
    WHERE book_id = ? AND group_key = ?
  `).run(nowIso(), id, key);
  return { disabled: result.changes > 0, bookId: id, groupKey: key };
}

export function listPromptGroups(filters = {}) {
  const category = typeof filters === "string" ? filters : filters.category;
  const hasBookFilter = typeof filters === "object" && Object.hasOwn(filters, "bookId");
  const bookId = hasBookFilter ? String(filters.bookId ?? filters.book_id ?? "") : undefined;

  if (hasBookFilter && category) {
    return db.prepare(`
      SELECT id, book_id, name, category, chapter_prompt, summary_prompt, index_group_keys, created_at, updated_at
      FROM prompt_groups
      WHERE book_id = ? AND category = ?
      ORDER BY updated_at DESC
    `).all(bookId ? normalizeBookId(bookId) : "", normalizePromptCategory(category)).map(publicPromptGroup);
  }

  if (hasBookFilter) {
    return db.prepare(`
      SELECT id, book_id, name, category, chapter_prompt, summary_prompt, index_group_keys, created_at, updated_at
      FROM prompt_groups
      WHERE book_id = ?
      ORDER BY updated_at DESC
    `).all(bookId ? normalizeBookId(bookId) : "").map(publicPromptGroup);
  }

  if (category) {
    return db.prepare(`
      SELECT id, book_id, name, category, chapter_prompt, summary_prompt, index_group_keys, created_at, updated_at
      FROM prompt_groups
      WHERE category = ?
      ORDER BY category ASC, updated_at DESC
    `).all(normalizePromptCategory(category)).map(publicPromptGroup);
  }

  return db.prepare(`
    SELECT id, book_id, name, category, chapter_prompt, summary_prompt, index_group_keys, created_at, updated_at
    FROM prompt_groups
    ORDER BY category ASC, updated_at DESC
  `).all().map(publicPromptGroup);
}

export function getPromptGroup(id) {
  const row = db.prepare(`
    SELECT id, book_id, name, category, chapter_prompt, summary_prompt, index_group_keys, created_at, updated_at
    FROM prompt_groups
    WHERE id = ?
  `).get(String(id || ""));
  return publicPromptGroup(row);
}

export function createPromptGroup(payload = {}) {
  const group = normalizePromptGroup(payload);
  const id = crypto.randomUUID();
  const now = nowIso();
  db.prepare(`
    INSERT INTO prompt_groups (id, book_id, name, category, chapter_prompt, summary_prompt, index_group_keys, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, group.book_id, group.name, group.category, group.chapter_prompt, group.summary_prompt, JSON.stringify(group.index_group_keys), now, now);
  return getPromptGroup(id);
}

export function updatePromptGroup(id, payload = {}) {
  const current = getPromptGroup(id);
  if (!current) {
    const error = new Error("Prompt 组不存在。");
    error.status = 404;
    throw error;
  }
  const next = normalizePromptGroup({ ...current, ...payload });
  db.prepare(`
    UPDATE prompt_groups
    SET book_id = ?, name = ?, category = ?, chapter_prompt = ?, summary_prompt = ?, index_group_keys = ?, updated_at = ?
    WHERE id = ?
  `).run(next.book_id, next.name, next.category, next.chapter_prompt, next.summary_prompt, JSON.stringify(next.index_group_keys), nowIso(), current.id);
  return getPromptGroup(current.id);
}

export function deletePromptGroup(id) {
  const result = db.prepare("DELETE FROM prompt_groups WHERE id = ?").run(String(id || ""));
  return { deleted: result.changes > 0, id: String(id || "") };
}

export async function createAnalysisRun({
  id,
  name,
  bookId,
  startChapter,
  endChapter,
  chapterSelection,
  model,
  reasoningEffort,
  promptHash,
  schemaHash,
  chapterCount,
  promptSnapshot
}) {
  const now = nowIso();
  const promptEncrypted = promptSnapshot
    ? await encryptText(JSON.stringify(promptSnapshot), analysisPromptAad(id))
    : null;
  db.prepare(`
    INSERT INTO analysis_runs (
      id, name, book_id, start_chapter, end_chapter, chapter_selection,
      model, reasoning_effort, prompt_hash, schema_hash, status, chapter_count,
      prompt_ciphertext, prompt_iv, prompt_tag, prompt_algorithm, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    normalizeAnalysisName(name, bookId, startChapter, endChapter),
    normalizeBookId(bookId),
    normalizeChapterIndex(startChapter),
    normalizeChapterIndex(endChapter),
    JSON.stringify(chapterSelection || {}),
    model,
    reasoningEffort,
    promptHash,
    schemaHash,
    chapterCount,
    promptEncrypted?.ciphertext || null,
    promptEncrypted?.iv || null,
    promptEncrypted?.tag || null,
    promptEncrypted?.algorithm || "aes-256-gcm",
    now,
    now
  );
  return getAnalysisRun(id);
}

export function updateAnalysisRun(id, patch = {}) {
  const current = getAnalysisRun(id);
  if (!current) return null;
  const next = { ...current, ...patch, updated_at: nowIso() };
  db.prepare(`
    UPDATE analysis_runs
    SET status = ?, error_summary = ?, source_stats = ?, ciphertext = ?, iv = ?, tag = ?, algorithm = ?, updated_at = ?
    WHERE id = ?
  `).run(
    next.status,
    next.error_summary || "",
    next.source_stats || "",
    next.ciphertext || null,
    next.iv || null,
    next.tag || null,
    next.algorithm || "aes-256-gcm",
    next.updated_at,
    id
  );
  return getAnalysisRun(id);
}

export function getAnalysisRun(id) {
  return db.prepare("SELECT * FROM analysis_runs WHERE id = ?").get(String(id || ""));
}

export function listAnalysisRuns(bookId) {
  if (bookId) {
    return db.prepare(`
      SELECT id, name, book_id, start_chapter, end_chapter, chapter_selection,
        model, reasoning_effort, prompt_hash, schema_hash, status, chapter_count,
        error_summary, source_stats, created_at, updated_at
      FROM analysis_runs
      WHERE book_id = ?
      ORDER BY created_at DESC
    `).all(normalizeBookId(bookId));
  }

  return db.prepare(`
    SELECT id, name, book_id, start_chapter, end_chapter, chapter_selection,
      model, reasoning_effort, prompt_hash, schema_hash, status, chapter_count,
      error_summary, source_stats, created_at, updated_at
    FROM analysis_runs
    ORDER BY created_at DESC
    LIMIT 100
  `).all();
}

export function deleteAnalysisRun(id) {
  const result = db.prepare("DELETE FROM analysis_runs WHERE id = ?").run(String(id || ""));
  return { deleted: result.changes > 0, id: String(id || "") };
}

export function saveL1ChapterIndex({ bookId, chapterIndex, status, sourceHmac, model, promptHash, value = {}, errorSummary = "" }) {
  const id = normalizeBookId(bookId);
  const index = normalizeChapterIndex(chapterIndex);
  const now = nowIso();
  const routeValue = normalizeL1RouteValue(value);
  db.prepare(`
    INSERT INTO l1_chapter_indexes (
      book_id, chapter_index, status, source_hmac, model, prompt_hash,
      summary, keywords, entities, key_events, items_places_orgs, open_questions,
      route_schema_version, route_summary, route_entities, route_keywords, signals,
      category_scores, has_major_signal, confidence, error_summary, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(book_id, chapter_index) DO UPDATE SET
      status = excluded.status,
      source_hmac = excluded.source_hmac,
      model = excluded.model,
      prompt_hash = excluded.prompt_hash,
      summary = excluded.summary,
      keywords = excluded.keywords,
      entities = excluded.entities,
      key_events = excluded.key_events,
      items_places_orgs = excluded.items_places_orgs,
      open_questions = excluded.open_questions,
      route_schema_version = excluded.route_schema_version,
      route_summary = excluded.route_summary,
      route_entities = excluded.route_entities,
      route_keywords = excluded.route_keywords,
      signals = excluded.signals,
      category_scores = excluded.category_scores,
      has_major_signal = excluded.has_major_signal,
      confidence = excluded.confidence,
      error_summary = excluded.error_summary,
      updated_at = excluded.updated_at
  `).run(
    id,
    index,
    String(status || "pending"),
    String(sourceHmac || ""),
    String(model || ""),
    String(promptHash || ""),
    routeValue.summary,
    stringifyJsonArray(routeValue.keywords),
    stringifyJsonArray(routeValue.entities),
    stringifyJsonArray(value.key_events),
    stringifyJsonArray(value.items_places_orgs),
    stringifyJsonArray(value.open_questions),
    routeValue.route_schema_version,
    "",
    stringifyJsonArray(routeValue.route_entities),
    stringifyJsonArray(routeValue.route_keywords),
    stringifyJsonArray(routeValue.signals),
    stringifyJsonObject(routeValue.category_scores),
    deriveRouteMajorSignal(routeValue) ? 1 : 0,
    normalizeConfidence(routeValue.confidence),
    String(errorSummary || "").slice(0, 1000),
    now,
    now
  );
  return getL1ChapterIndex(id, index);
}

export function getL1ChapterIndex(bookId, chapterIndex) {
  const row = db.prepare(`
    SELECT *
    FROM l1_chapter_indexes
    WHERE book_id = ? AND chapter_index = ?
  `).get(normalizeBookId(bookId), normalizeChapterIndex(chapterIndex));
  return publicL1ChapterIndex(row);
}

export function listL1ChapterIndexes(bookId, startChapter, endChapter) {
  const range = normalizeRange(startChapter, endChapter);
  return db.prepare(`
    SELECT *
    FROM l1_chapter_indexes
    WHERE book_id = ? AND chapter_index BETWEEN ? AND ?
    ORDER BY chapter_index ASC
  `).all(normalizeBookId(bookId), range.startChapter, range.endChapter).map(publicL1ChapterIndex);
}

export function saveL1WindowIndex({ bookId, windowStart, windowEnd, status, sourceHmac, model, promptHash, value = {}, errorSummary = "" }) {
  const id = normalizeBookId(bookId);
  const start = normalizeChapterIndex(windowStart);
  const end = normalizeChapterIndex(windowEnd);
  const now = nowIso();
  db.prepare(`
    INSERT INTO l1_window_indexes (
      book_id, window_start, window_end, status, source_hmac, model, prompt_hash,
      summary, timeline, entity_changes, relationship_changes, foreshadowing,
      covered_chapters, missing_chapters, confidence, error_summary, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(book_id, window_start, window_end) DO UPDATE SET
      status = excluded.status,
      source_hmac = excluded.source_hmac,
      model = excluded.model,
      prompt_hash = excluded.prompt_hash,
      summary = excluded.summary,
      timeline = excluded.timeline,
      entity_changes = excluded.entity_changes,
      relationship_changes = excluded.relationship_changes,
      foreshadowing = excluded.foreshadowing,
      covered_chapters = excluded.covered_chapters,
      missing_chapters = excluded.missing_chapters,
      confidence = excluded.confidence,
      error_summary = excluded.error_summary,
      updated_at = excluded.updated_at
  `).run(
    id,
    start,
    end,
    String(status || "pending"),
    String(sourceHmac || ""),
    String(model || ""),
    String(promptHash || ""),
    String(value.summary || ""),
    stringifyJsonArray(value.timeline),
    stringifyJsonArray(value.entity_changes),
    stringifyJsonArray(value.relationship_changes),
    stringifyJsonArray(value.foreshadowing),
    stringifyJsonArray(value.covered_chapters),
    stringifyJsonArray(value.missing_chapters),
    normalizeConfidence(value.confidence),
    String(errorSummary || "").slice(0, 1000),
    now,
    now
  );
  return getL1WindowIndex(id, start, end);
}

export function getL1WindowIndex(bookId, windowStart, windowEnd) {
  const row = db.prepare(`
    SELECT *
    FROM l1_window_indexes
    WHERE book_id = ? AND window_start = ? AND window_end = ?
  `).get(normalizeBookId(bookId), normalizeChapterIndex(windowStart), normalizeChapterIndex(windowEnd));
  return publicL1WindowIndex(row);
}

export function listL1WindowIndexes(bookId, startChapter, endChapter) {
  const range = normalizeRange(startChapter, endChapter);
  return db.prepare(`
    SELECT *
    FROM l1_window_indexes
    WHERE book_id = ?
      AND window_end >= ?
      AND window_start <= ?
    ORDER BY window_start ASC
  `).all(normalizeBookId(bookId), range.startChapter, range.endChapter).map(publicL1WindowIndex);
}

export function getL1Coverage({ bookId, startChapter, endChapter, model = "", promptHash = "", windowSize = 10, includeWindows = true }) {
  const id = normalizeBookId(bookId);
  const range = normalizeRange(startChapter, endChapter);
  const chapters = listChapterMetadata(id)
    .filter((chapter) => chapter.chapter_index >= range.startChapter && chapter.chapter_index <= range.endChapter);
  const indexes = new Map(listL1ChapterIndexes(id, range.startChapter, range.endChapter)
    .map((entry) => [entry.chapter_index, entry]));

  const chapterStats = {
    total: chapters.length,
    completed: 0,
    failed: 0,
    missing: 0,
    outdated: 0
  };

  for (const chapter of chapters) {
    const index = indexes.get(chapter.chapter_index);
    if (!index) {
      chapterStats.missing += 1;
      continue;
    }
    const outdated = index.source_hmac !== chapter.content_hmac
      || (model && index.model !== model)
      || (promptHash && index.prompt_hash !== promptHash);
    if (outdated) {
      chapterStats.outdated += 1;
    } else if (index.status === "completed") {
      chapterStats.completed += 1;
    } else if (index.status === "failed") {
      chapterStats.failed += 1;
    } else {
      chapterStats.missing += 1;
    }
  }

  const windowStats = {
    total: 0,
    completed: 0,
    failed: 0,
    missing: 0,
    outdated: 0
  };
  if (includeWindows) {
    const windows = listL1WindowIndexes(id, range.startChapter, range.endChapter);
    const expectedWindows = buildAlignedWindowRanges(range.startChapter, range.endChapter, windowSize);
    const windowsByKey = new Map(windows.map((window) => [`${window.window_start}-${window.window_end}`, window]));
    windowStats.total = expectedWindows.length;
    for (const window of expectedWindows) {
      const index = windowsByKey.get(`${window.startChapter}-${window.endChapter}`);
      if (!index) {
        windowStats.missing += 1;
        continue;
      }
      const expectedSourceHmac = l1WindowSourceHmac(id, window.startChapter, window.endChapter, model, promptHash);
      const outdated = index.source_hmac !== expectedSourceHmac
        || (model && index.model !== model)
        || (promptHash && index.prompt_hash !== promptHash);
      if (outdated) {
        windowStats.outdated += 1;
      } else if (index.status === "completed") {
        windowStats.completed += 1;
      } else if (index.status === "failed") {
        windowStats.failed += 1;
      } else {
        windowStats.missing += 1;
      }
    }
  }

  return {
    book_id: id,
    start_chapter: range.startChapter,
    end_chapter: range.endChapter,
    chapters: chapterStats,
    windows: windowStats
  };
}

export async function saveL2ChapterFacts({ bookId, indexGroupKey = BASE_INDEX_GROUP_KEY, chapterIndex, status, sourceHmac, model, promptHash, schemaVersion, facts = [], errorSummary = "" }) {
  const id = normalizeBookId(bookId);
  const groupKey = normalizeIndexGroupKey(indexGroupKey);
  const index = normalizeChapterIndex(chapterIndex);
  const now = nowIso();
  const normalizedFacts = Array.isArray(facts) ? facts.map((fact) => normalizeL2Fact(fact)).filter(Boolean) : [];

  db.prepare("DELETE FROM l2_facts WHERE book_id = ? AND index_group_key = ? AND chapter_index = ?").run(id, groupKey, index);

  db.prepare(`
    INSERT INTO l2_chapter_statuses (
      book_id, index_group_key, chapter_index, status, source_hmac, model, prompt_hash, schema_version,
      facts_count, error_summary, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(book_id, index_group_key, chapter_index) DO UPDATE SET
      status = excluded.status,
      source_hmac = excluded.source_hmac,
      model = excluded.model,
      prompt_hash = excluded.prompt_hash,
      schema_version = excluded.schema_version,
      facts_count = excluded.facts_count,
      error_summary = excluded.error_summary,
      updated_at = excluded.updated_at
  `).run(
    id,
    groupKey,
    index,
    String(status || "pending"),
    String(sourceHmac || ""),
    String(model || ""),
    String(promptHash || ""),
    String(schemaVersion || ""),
    normalizedFacts.length,
    String(errorSummary || "").slice(0, 1000),
    now,
    now
  );

  for (const fact of normalizedFacts) {
    const factId = crypto.randomUUID();
    const encrypted = await encryptText(JSON.stringify({
      fact: fact.fact,
      evidence: fact.evidence,
      review_note: fact.review_note
    }), l2FactAad(factId));
    db.prepare(`
      INSERT INTO l2_facts (
        id, book_id, index_group_key, chapter_index, status, source_hmac, model, prompt_hash, schema_version,
        category, entity, aliases, tags, related_entities, fact_type, importance, confidence,
        review_source, ciphertext, iv, tag, algorithm, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      factId,
      id,
      groupKey,
      index,
      String(status || "completed"),
      String(sourceHmac || ""),
      String(model || ""),
      String(promptHash || ""),
      String(schemaVersion || ""),
      fact.category,
      fact.entity,
      stringifyJsonArray(fact.aliases),
      stringifyJsonArray(fact.tags),
      stringifyJsonArray(fact.related_entities),
      fact.fact_type,
      fact.importance,
      fact.confidence,
      fact.review_source,
      encrypted.ciphertext,
      encrypted.iv,
      encrypted.tag,
      encrypted.algorithm,
      now,
      now
    );
  }

  return getL2ChapterStatus(id, index, groupKey);
}

export function saveL2ChapterStatus({ bookId, indexGroupKey = BASE_INDEX_GROUP_KEY, chapterIndex, status, sourceHmac, model, promptHash, schemaVersion, errorSummary = "" }) {
  const id = normalizeBookId(bookId);
  const groupKey = normalizeIndexGroupKey(indexGroupKey);
  const index = normalizeChapterIndex(chapterIndex);
  const now = nowIso();
  db.prepare(`
    INSERT INTO l2_chapter_statuses (
      book_id, index_group_key, chapter_index, status, source_hmac, model, prompt_hash, schema_version,
      facts_count, error_summary, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
    ON CONFLICT(book_id, index_group_key, chapter_index) DO UPDATE SET
      status = excluded.status,
      source_hmac = excluded.source_hmac,
      model = excluded.model,
      prompt_hash = excluded.prompt_hash,
      schema_version = excluded.schema_version,
      facts_count = excluded.facts_count,
      error_summary = excluded.error_summary,
      updated_at = excluded.updated_at
  `).run(
    id,
    groupKey,
    index,
    String(status || "pending"),
    String(sourceHmac || ""),
    String(model || ""),
    String(promptHash || ""),
    String(schemaVersion || ""),
    String(errorSummary || "").slice(0, 1000),
    now,
    now
  );
  if (status !== "failed") db.prepare("DELETE FROM l2_facts WHERE book_id = ? AND index_group_key = ? AND chapter_index = ?").run(id, groupKey, index);
  return getL2ChapterStatus(id, index, groupKey);
}

export function getL2ChapterStatus(bookId, chapterIndex, indexGroupKey = BASE_INDEX_GROUP_KEY) {
  const row = db.prepare(`
    SELECT *
    FROM l2_chapter_statuses
    WHERE book_id = ? AND index_group_key = ? AND chapter_index = ?
  `).get(normalizeBookId(bookId), normalizeIndexGroupKey(indexGroupKey), normalizeChapterIndex(chapterIndex));
  return publicL2ChapterStatus(row);
}

export function listL2ChapterStatuses(bookId, startChapter, endChapter, indexGroupKey = BASE_INDEX_GROUP_KEY) {
  const range = normalizeRange(startChapter, endChapter);
  return db.prepare(`
    SELECT *
    FROM l2_chapter_statuses
    WHERE book_id = ? AND index_group_key = ? AND chapter_index BETWEEN ? AND ?
    ORDER BY chapter_index ASC
  `).all(normalizeBookId(bookId), normalizeIndexGroupKey(indexGroupKey), range.startChapter, range.endChapter).map(publicL2ChapterStatus);
}

export function getL2Coverage({ bookId, indexGroupKey = BASE_INDEX_GROUP_KEY, startChapter, endChapter, model = "", promptHash = "", schemaVersion = "" }) {
  const id = normalizeBookId(bookId);
  const groupKey = normalizeIndexGroupKey(indexGroupKey);
  const range = normalizeRange(startChapter, endChapter);
  const chapters = listChapterMetadata(id)
    .filter((chapter) => chapter.chapter_index >= range.startChapter && chapter.chapter_index <= range.endChapter);
  const statuses = new Map(listL2ChapterStatuses(id, range.startChapter, range.endChapter, groupKey)
    .map((entry) => [entry.chapter_index, entry]));
  const stats = {
    total: chapters.length,
    completed: 0,
    failed: 0,
    missing: 0,
    outdated: 0,
    facts: 0
  };
  const failed_chapters = [];
  for (const chapter of chapters) {
    const status = statuses.get(chapter.chapter_index);
    if (!status) {
      stats.missing += 1;
      continue;
    }
    const outdated = status.source_hmac !== chapter.content_hmac
      || (model && status.model !== model)
      || (promptHash && status.prompt_hash !== promptHash)
      || (schemaVersion && status.schema_version !== schemaVersion);
    if (outdated) {
      stats.outdated += 1;
    } else if (status.status === "completed") {
      stats.completed += 1;
      stats.facts += status.facts_count || 0;
    } else if (status.status === "failed") {
      stats.failed += 1;
      failed_chapters.push(status.chapter_index);
    } else {
      stats.missing += 1;
    }
  }
  return {
    book_id: id,
    index_group_key: groupKey,
    start_chapter: range.startChapter,
    end_chapter: range.endChapter,
    chapters: stats,
    failed_chapters
  };
}

export async function listL2Facts({ bookId, indexGroupKeys = [BASE_INDEX_GROUP_KEY], startChapter, endChapter, chapterIndexes = [], categories = [], entity = "", entities = [], limit = 500, includeContent = true }) {
  const range = normalizeRange(startChapter, endChapter);
  const indexes = normalizeChapterIndexList(chapterIndexes)
    .filter((index) => index >= range.startChapter && index <= range.endChapter);
  const groupKeys = normalizeIndexGroupKeys(indexGroupKeys);
  const categoryList = normalizeL2Categories(categories);
  const params = [normalizeBookId(bookId), range.startChapter, range.endChapter];
  const where = ["book_id = ?", "chapter_index BETWEEN ? AND ?", "status = 'completed'"];
  where.push(`index_group_key IN (${groupKeys.map(() => "?").join(", ")})`);
  params.push(...groupKeys);
  if (indexes.length) {
    where.push(`chapter_index IN (${indexes.map(() => "?").join(", ")})`);
    params.push(...indexes);
  }
  if (categoryList.length) {
    where.push(`category IN (${categoryList.map(() => "?").join(", ")})`);
    params.push(...categoryList);
  }
  const entityQueries = normalizeEntityQueries(entity, entities);
  if (entityQueries.length) {
    where.push(`(${entityQueries.map(() => "(LOWER(entity) LIKE ? OR LOWER(aliases) LIKE ? OR LOWER(related_entities) LIKE ? OR LOWER(tags) LIKE ? OR LOWER(fact_type) LIKE ?)").join(" OR ")})`);
    for (const entityQuery of entityQueries) {
      const pattern = `%${entityQuery}%`;
      params.push(pattern, pattern, pattern, pattern, pattern);
    }
  }
  params.push(Math.max(1, Math.min(2000, Number.parseInt(limit, 10) || 500)));
  const rows = db.prepare(`
    SELECT *
    FROM l2_facts
    WHERE ${where.join(" AND ")}
    ORDER BY importance DESC, confidence DESC, chapter_index ASC
    LIMIT ?
  `).all(...params);

  const facts = [];
  for (const row of rows) {
    facts.push(includeContent ? await publicL2FactWithContent(row) : publicL2Fact(row));
  }
  return facts;
}

function normalizeChapterIndexList(values) {
  const input = Array.isArray(values) ? values : [];
  const seen = new Set();
  const indexes = [];
  for (const value of input) {
    const number = Number(value);
    if (!Number.isInteger(number) || number <= 0 || seen.has(number)) continue;
    seen.add(number);
    indexes.push(number);
  }
  return indexes.sort((left, right) => left - right);
}

export function listL2FactMetadata({ bookId, indexGroupKeys = [BASE_INDEX_GROUP_KEY], startChapter, endChapter, categories = [], entity = "", limit = 500 }) {
  const range = normalizeRange(startChapter, endChapter);
  const groupKeys = normalizeIndexGroupKeys(indexGroupKeys);
  const categoryList = normalizeL2Categories(categories);
  const params = [normalizeBookId(bookId), range.startChapter, range.endChapter];
  const where = ["book_id = ?", "chapter_index BETWEEN ? AND ?", "status = 'completed'"];
  where.push(`index_group_key IN (${groupKeys.map(() => "?").join(", ")})`);
  params.push(...groupKeys);
  if (categoryList.length) {
    where.push(`category IN (${categoryList.map(() => "?").join(", ")})`);
    params.push(...categoryList);
  }
  const entityQuery = String(entity || "").trim().toLowerCase();
  if (entityQuery) {
    where.push("(LOWER(entity) LIKE ? OR LOWER(aliases) LIKE ? OR LOWER(related_entities) LIKE ? OR LOWER(tags) LIKE ?)");
    const pattern = `%${entityQuery}%`;
    params.push(pattern, pattern, pattern, pattern);
  }
  params.push(Math.max(1, Math.min(2000, Number.parseInt(limit, 10) || 500)));
  return db.prepare(`
    SELECT id, book_id, index_group_key, chapter_index, status, source_hmac, model, prompt_hash, schema_version,
      category, entity, aliases, tags, related_entities, fact_type, importance, confidence,
      review_source, created_at, updated_at
    FROM l2_facts
    WHERE ${where.join(" AND ")}
    ORDER BY importance DESC, confidence DESC, chapter_index ASC
    LIMIT ?
  `).all(...params).map(publicL2Fact);
}

export function l1WindowSourceHmac(bookId, windowStart, windowEnd, model = "", promptHash = "") {
  const id = normalizeBookId(bookId);
  const range = normalizeRange(windowStart, windowEnd);
  const metadata = new Map(
    listChapterMetadata(id)
      .filter((chapter) => chapter.chapter_index >= range.startChapter && chapter.chapter_index <= range.endChapter)
      .map((chapter) => [chapter.chapter_index, chapter])
  );
  return listL1ChapterIndexes(id, range.startChapter, range.endChapter)
    .filter((index) => {
      const chapter = metadata.get(index.chapter_index);
      if (!chapter || index.status !== "completed" || index.source_hmac !== chapter.content_hmac) return false;
      if (model && index.model !== model) return false;
      if (promptHash && index.prompt_hash !== promptHash) return false;
      return true;
    })
    .map((index) => `${index.chapter_index}:${index.source_hmac}`)
    .join("|");
}

export async function saveAnalysisChapter({ analysisId, chapterIndex, status, contentHmac, promptHash, result, errorSummary = "" }) {
  const encrypted = result === undefined ? null : await encryptText(JSON.stringify(result), analysisChapterAad(analysisId, chapterIndex));
  db.prepare(`
    INSERT INTO analysis_chapters (
      analysis_id, chapter_index, status, content_hmac, prompt_hash,
      ciphertext, iv, tag, algorithm, error_summary, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(analysis_id, chapter_index) DO UPDATE SET
      status = excluded.status,
      content_hmac = excluded.content_hmac,
      prompt_hash = excluded.prompt_hash,
      ciphertext = excluded.ciphertext,
      iv = excluded.iv,
      tag = excluded.tag,
      algorithm = excluded.algorithm,
      error_summary = excluded.error_summary,
      updated_at = excluded.updated_at
  `).run(
    analysisId,
    normalizeChapterIndex(chapterIndex),
    status,
    contentHmac || "",
    promptHash,
    encrypted?.ciphertext || null,
    encrypted?.iv || null,
    encrypted?.tag || null,
    encrypted?.algorithm || "aes-256-gcm",
    String(errorSummary || "").slice(0, 1000),
    nowIso()
  );
}

export function listAnalysisChapterMetadata(analysisId) {
  return db.prepare(`
    SELECT
      analysis_id,
      chapter_index,
      status,
      content_hmac,
      prompt_hash,
      error_summary,
      updated_at,
      CASE WHEN ciphertext IS NOT NULL AND ciphertext != '' THEN 1 ELSE 0 END AS has_result
    FROM analysis_chapters
    WHERE analysis_id = ?
    ORDER BY chapter_index ASC
  `).all(String(analysisId || ""));
}

export function getAnalysisChapterMetadata(analysisId, chapterIndex) {
  return db.prepare(`
    SELECT
      analysis_id,
      chapter_index,
      status,
      content_hmac,
      prompt_hash,
      error_summary,
      updated_at,
      CASE WHEN ciphertext IS NOT NULL AND ciphertext != '' THEN 1 ELSE 0 END AS has_result
    FROM analysis_chapters
    WHERE analysis_id = ? AND chapter_index = ?
  `).get(String(analysisId || ""), normalizeChapterIndex(chapterIndex));
}

export async function decryptAnalysisChapterResult(analysisId, chapterIndex) {
  const row = db.prepare(`
    SELECT ciphertext, iv, tag
    FROM analysis_chapters
    WHERE analysis_id = ? AND chapter_index = ?
  `).get(String(analysisId || ""), normalizeChapterIndex(chapterIndex));
  if (!row?.ciphertext) return null;
  return JSON.parse(await decryptText(row, analysisChapterAad(analysisId, chapterIndex)));
}

export async function decryptCompletedAnalysisChapterResults(analysisId) {
  const rows = db.prepare(`
    SELECT chapter_index, ciphertext, iv, tag
    FROM analysis_chapters
    WHERE analysis_id = ? AND status = 'completed' AND ciphertext IS NOT NULL AND ciphertext != ''
    ORDER BY chapter_index ASC
  `).all(String(analysisId || ""));
  const results = [];
  for (const row of rows) {
    results.push({
      chapter_index: row.chapter_index,
      result: JSON.parse(await decryptText(row, analysisChapterAad(analysisId, row.chapter_index)))
    });
  }
  return results;
}

export async function saveAnalysisSummaryPart({
  analysisId,
  partKey,
  parentKey = "",
  stage,
  status,
  contentHash = "",
  promptHash = "",
  schemaHash = "",
  model = "",
  reasoningEffort = "",
  inputSummary = "",
  traceSummary = null,
  result,
  errorSummary = ""
}) {
  const now = nowIso();
  const encrypted = result === undefined ? null : await encryptText(JSON.stringify(result), analysisSummaryPartAad(analysisId, partKey));
  const normalizedTraceSummary = traceSummary
    ? JSON.stringify(traceSummary).slice(0, 12000)
    : "";
  db.prepare(`
    INSERT INTO analysis_summary_parts (
      analysis_id, part_key, parent_key, stage, status, content_hash, prompt_hash, schema_hash,
      model, reasoning_effort, input_summary, trace_summary, error_summary,
      ciphertext, iv, tag, algorithm, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(analysis_id, part_key) DO UPDATE SET
      parent_key = excluded.parent_key,
      stage = excluded.stage,
      status = excluded.status,
      content_hash = excluded.content_hash,
      prompt_hash = excluded.prompt_hash,
      schema_hash = excluded.schema_hash,
      model = excluded.model,
      reasoning_effort = excluded.reasoning_effort,
      input_summary = excluded.input_summary,
      trace_summary = excluded.trace_summary,
      error_summary = excluded.error_summary,
      ciphertext = excluded.ciphertext,
      iv = excluded.iv,
      tag = excluded.tag,
      algorithm = excluded.algorithm,
      updated_at = excluded.updated_at
  `).run(
    String(analysisId || ""),
    normalizeSummaryPartKey(partKey),
    String(parentKey || ""),
    String(stage || ""),
    String(status || ""),
    String(contentHash || ""),
    String(promptHash || ""),
    String(schemaHash || ""),
    String(model || ""),
    String(reasoningEffort || ""),
    String(inputSummary || "").slice(0, 1000),
    normalizedTraceSummary,
    String(errorSummary || "").slice(0, 1000),
    encrypted?.ciphertext || null,
    encrypted?.iv || null,
    encrypted?.tag || null,
    encrypted?.algorithm || "aes-256-gcm",
    now,
    now
  );
  return getAnalysisSummaryPartMetadata(analysisId, partKey);
}

export function getAnalysisSummaryPartMetadata(analysisId, partKey) {
  const row = db.prepare(`
    SELECT
      analysis_id, part_key, parent_key, stage, status, content_hash, prompt_hash, schema_hash,
      model, reasoning_effort, input_summary, trace_summary, error_summary, created_at, updated_at,
      CASE WHEN ciphertext IS NOT NULL AND ciphertext != '' THEN 1 ELSE 0 END AS has_result
    FROM analysis_summary_parts
    WHERE analysis_id = ? AND part_key = ?
  `).get(String(analysisId || ""), normalizeSummaryPartKey(partKey));
  return publicAnalysisSummaryPart(row);
}

export function listAnalysisSummaryPartMetadata(analysisId) {
  return db.prepare(`
    SELECT
      analysis_id, part_key, parent_key, stage, status, content_hash, prompt_hash, schema_hash,
      model, reasoning_effort, input_summary, trace_summary, error_summary, created_at, updated_at,
      CASE WHEN ciphertext IS NOT NULL AND ciphertext != '' THEN 1 ELSE 0 END AS has_result
    FROM analysis_summary_parts
    WHERE analysis_id = ?
    ORDER BY part_key ASC
  `).all(String(analysisId || "")).map(publicAnalysisSummaryPart);
}

export async function decryptAnalysisSummaryPartResult(analysisId, partKey) {
  const row = db.prepare(`
    SELECT ciphertext, iv, tag
    FROM analysis_summary_parts
    WHERE analysis_id = ? AND part_key = ?
  `).get(String(analysisId || ""), normalizeSummaryPartKey(partKey));
  if (!row?.ciphertext) return null;
  return JSON.parse(await decryptText(row, analysisSummaryPartAad(analysisId, partKey)));
}

export async function saveFinalAnalysisResult(analysisId, result) {
  const encrypted = await encryptText(JSON.stringify(result), analysisRunAad(analysisId));
  return updateAnalysisRun(analysisId, {
    status: "completed",
    ciphertext: encrypted.ciphertext,
    iv: encrypted.iv,
    tag: encrypted.tag,
    algorithm: encrypted.algorithm
  });
}

export async function decryptFinalAnalysisResult(analysisId) {
  const row = getAnalysisRun(analysisId);
  if (!row?.ciphertext) return null;
  return JSON.parse(await decryptText(row, analysisRunAad(analysisId)));
}

export async function decryptAnalysisPromptSnapshot(analysisId) {
  const row = getAnalysisRun(analysisId);
  if (!row?.prompt_ciphertext) return null;
  return JSON.parse(await decryptText({
    ciphertext: row.prompt_ciphertext,
    iv: row.prompt_iv,
    tag: row.prompt_tag,
    algorithm: row.prompt_algorithm
  }, analysisPromptAad(analysisId)));
}

export function normalizeBookId(bookId) {
  const value = String(bookId || "").trim();
  if (!value) {
    const error = new Error("book_id 不能为空。");
    error.status = 400;
    throw error;
  }
  return value;
}

export function normalizeBookName(bookName) {
  return String(bookName || "").trim().slice(0, 120);
}

export function normalizePromptCategory(category) {
  return String(category || "未分类").trim().slice(0, 80) || "未分类";
}

export function normalizeChapterIndex(value) {
  const index = Number.parseInt(value, 10);
  if (!Number.isFinite(index) || index <= 0) {
    const error = new Error("章节编号必须是大于 0 的整数。");
    error.status = 400;
    throw error;
  }
  return index;
}

export function normalizeRange(startChapter, endChapter) {
  const start = normalizeChapterIndex(startChapter);
  const end = normalizeChapterIndex(endChapter);
  return {
    startChapter: start,
    endChapter: end < start ? start : end,
    total: Math.max(1, (end < start ? start : end) - start + 1)
  };
}

export function promptHash(settings) {
  return sha256(`${settings.chapter_prompt}\n---SUMMARY---\n${settings.summary_prompt}`);
}

export function schemaHash(settings) {
  return sha256(settings.output_schema);
}

export function l1IndexPromptHash(settings = getPromptSettings()) {
  return isDefaultL1IndexPrompt(settings.l1_index_prompt)
    ? DEFAULT_L1_INDEX_PROMPT_HASH
    : sha256(`l1-route-v1\n${settings.l1_index_prompt}`);
}

export function l2IndexPromptHash(settings = getPromptSettings()) {
  return isDefaultL2IndexPrompt(settings.l2_index_prompt)
    ? DEFAULT_L2_INDEX_PROMPT_HASH
    : sha256(`l2-index-v2\n${settings.l2_index_prompt}`);
}

export function bookL1IndexPromptHash(bookPrompts = getPromptSettings()) {
  return isDefaultL1IndexPrompt(bookPrompts.l1_index_prompt)
    ? DEFAULT_L1_INDEX_PROMPT_HASH
    : sha256(`book-l1-route-v1\n${bookPrompts.l1_index_prompt}`);
}

export function bookL2IndexPromptHash(bookPrompts = getPromptSettings()) {
  return isDefaultL2IndexPrompt(bookPrompts.l2_index_prompt)
    ? DEFAULT_L2_INDEX_PROMPT_HASH
    : sha256(`book-l2-index-v1\n${bookPrompts.l2_index_prompt}`);
}

export function indexGroupL2PromptHash(group = {}) {
  const prompt = normalizeIndexPrompt(group.l2_index_prompt, DEFAULT_L2_INDEX_PROMPT);
  if (normalizeIndexGroupKey(group.group_key) === BASE_INDEX_GROUP_KEY) {
    return isDefaultL2IndexPrompt(prompt)
      ? DEFAULT_L2_INDEX_PROMPT_HASH
      : sha256(`book-l2-index-v1\n${prompt}`);
  }
  return sha256(`book-l2-index-group-v1\n${normalizeIndexGroupKey(group.group_key)}\n${prompt}`);
}

export function normalizePromptSettings(settings = {}) {
  const schemaMode = normalizeSchemaMode(settings.schema_mode);
  const schemaFields = normalizeSchemaFields(settings.schema_fields);
  const schema = schemaMode === "fields"
    ? schemaFromFields(schemaFields)
    : parseSchemaOrThrow(settings.output_schema || defaultOutputSchema());
  return {
    name: String(settings.name || "默认小说理解模板").trim() || "默认小说理解模板",
    model: String(settings.model || config.openai.model || "gpt-5.5").trim(),
    reasoning_effort: normalizeReasoningEffort(settings.reasoning_effort || "medium"),
    chapter_prompt: String(settings.chapter_prompt || defaultChapterPrompt()).trim(),
    summary_prompt: String(settings.summary_prompt || defaultSummaryPrompt()).trim(),
    output_schema: JSON.stringify(schema, null, 2),
    schema_mode: schemaMode,
    schema_fields: schemaFields,
    l1_index_prompt: normalizeIndexPrompt(settings.l1_index_prompt, DEFAULT_L1_INDEX_PROMPT),
    l2_index_prompt: normalizeIndexPrompt(settings.l2_index_prompt, DEFAULT_L2_INDEX_PROMPT)
  };
}

function normalizeReasoningEffort(value) {
  return ["none", "low", "medium", "high", "xhigh"].includes(value) ? value : "medium";
}

function normalizeIndexPrompt(value, fallback) {
  const prompt = String(value || fallback || "").trim();
  return prompt || fallback;
}

function isDefaultL1IndexPrompt(value) {
  return normalizeIndexPrompt(value, DEFAULT_L1_INDEX_PROMPT) === DEFAULT_L1_INDEX_PROMPT;
}

function isDefaultL2IndexPrompt(value) {
  return normalizeIndexPrompt(value, DEFAULT_L2_INDEX_PROMPT) === DEFAULT_L2_INDEX_PROMPT;
}

function migrateSchema() {
  ensureColumn("books", "book_name", "book_name TEXT NOT NULL DEFAULT ''");
  ensureColumn("prompt_groups", "book_id", "book_id TEXT NOT NULL DEFAULT ''");
  ensureColumn("prompt_groups", "index_group_keys", "index_group_keys TEXT NOT NULL DEFAULT '[]'");
  ensureColumn("prompt_settings", "schema_mode", "schema_mode TEXT NOT NULL DEFAULT 'fields'");
  ensureColumn("prompt_settings", "schema_fields", "schema_fields TEXT NOT NULL DEFAULT '[]'");
  ensureColumn("prompt_settings", "l1_index_prompt", "l1_index_prompt TEXT NOT NULL DEFAULT ''");
  ensureColumn("prompt_settings", "l2_index_prompt", "l2_index_prompt TEXT NOT NULL DEFAULT ''");
  ensureColumn("l1_chapter_indexes", "route_schema_version", "route_schema_version TEXT NOT NULL DEFAULT ''");
  ensureColumn("l1_chapter_indexes", "route_summary", "route_summary TEXT NOT NULL DEFAULT ''");
  ensureColumn("l1_chapter_indexes", "route_entities", "route_entities TEXT NOT NULL DEFAULT '[]'");
  ensureColumn("l1_chapter_indexes", "route_keywords", "route_keywords TEXT NOT NULL DEFAULT '[]'");
  ensureColumn("l1_chapter_indexes", "signals", "signals TEXT NOT NULL DEFAULT '[]'");
  ensureColumn("l1_chapter_indexes", "category_scores", "category_scores TEXT NOT NULL DEFAULT '{}'");
  ensureColumn("l1_chapter_indexes", "has_major_signal", "has_major_signal INTEGER NOT NULL DEFAULT 0");
  ensureColumn("analysis_runs", "name", "name TEXT NOT NULL DEFAULT ''");
  ensureColumn("analysis_runs", "chapter_selection", "chapter_selection TEXT NOT NULL DEFAULT ''");
  ensureColumn("analysis_runs", "source_stats", "source_stats TEXT NOT NULL DEFAULT ''");
  ensureColumn("analysis_runs", "prompt_ciphertext", "prompt_ciphertext TEXT");
  ensureColumn("analysis_runs", "prompt_iv", "prompt_iv TEXT");
  ensureColumn("analysis_runs", "prompt_tag", "prompt_tag TEXT");
  ensureColumn("analysis_runs", "prompt_algorithm", "prompt_algorithm TEXT NOT NULL DEFAULT 'aes-256-gcm'");
  ensureColumn("analysis_summary_parts", "trace_summary", "trace_summary TEXT NOT NULL DEFAULT ''");
  migrateL2IndexGroupColumns();
  migrateBookIndexPrompts();
  migrateBookIndexGroups();
  migratePromptGroupsToBooks();
}

function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (columns.some((entry) => entry.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
}

function migrateL2IndexGroupColumns() {
  const statusColumns = db.prepare("PRAGMA table_info(l2_chapter_statuses)").all();
  const indexGroupColumn = statusColumns.find((entry) => entry.name === "index_group_key");
  const oldPrimaryKey = !indexGroupColumn || (indexGroupColumn.pk || 0) === 0;
  if (oldPrimaryKey) {
    const sourceIndexGroupSql = indexGroupColumn
      ? "CASE WHEN index_group_key IS NULL OR index_group_key = '' THEN 'base' ELSE index_group_key END"
      : "'base'";
    db.exec(`
      ALTER TABLE l2_chapter_statuses RENAME TO l2_chapter_statuses_old;
      CREATE TABLE l2_chapter_statuses (
        book_id TEXT NOT NULL,
        index_group_key TEXT NOT NULL DEFAULT 'base',
        chapter_index INTEGER NOT NULL,
        status TEXT NOT NULL,
        source_hmac TEXT NOT NULL DEFAULT '',
        model TEXT NOT NULL DEFAULT '',
        prompt_hash TEXT NOT NULL DEFAULT '',
        schema_version TEXT NOT NULL DEFAULT '',
        facts_count INTEGER NOT NULL DEFAULT 0,
        error_summary TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (book_id, index_group_key, chapter_index),
        FOREIGN KEY (book_id) REFERENCES books(book_id) ON DELETE CASCADE
      );
      INSERT OR REPLACE INTO l2_chapter_statuses (
        book_id, index_group_key, chapter_index, status, source_hmac, model, prompt_hash,
        schema_version, facts_count, error_summary, created_at, updated_at
      )
      SELECT book_id,
        ${sourceIndexGroupSql},
        chapter_index, status, source_hmac, model, prompt_hash,
        schema_version, facts_count, error_summary, created_at, updated_at
      FROM l2_chapter_statuses_old;
      DROP TABLE l2_chapter_statuses_old;
    `);
  }
  migrateResidualL2StatusOldTable();
  ensureColumn("l2_facts", "index_group_key", "index_group_key TEXT NOT NULL DEFAULT 'base'");
  db.exec(`
    UPDATE l2_chapter_statuses SET index_group_key = 'base' WHERE index_group_key = '' OR index_group_key IS NULL;
    UPDATE l2_facts SET index_group_key = 'base' WHERE index_group_key = '' OR index_group_key IS NULL;
    CREATE INDEX IF NOT EXISTS idx_l2_facts_lookup
      ON l2_facts(book_id, index_group_key, category, entity, chapter_index);
    CREATE INDEX IF NOT EXISTS idx_l2_facts_chapter
      ON l2_facts(book_id, index_group_key, chapter_index);
  `);
}

function migrateResidualL2StatusOldTable() {
  const oldTable = db.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table' AND name = 'l2_chapter_statuses_old'
  `).get();
  if (!oldTable) return;
  const oldColumns = db.prepare("PRAGMA table_info(l2_chapter_statuses_old)").all();
  const sourceIndexGroupSql = oldColumns.some((entry) => entry.name === "index_group_key")
    ? "CASE WHEN index_group_key IS NULL OR index_group_key = '' THEN 'base' ELSE index_group_key END"
    : "'base'";
  db.exec(`
    INSERT OR REPLACE INTO l2_chapter_statuses (
      book_id, index_group_key, chapter_index, status, source_hmac, model, prompt_hash,
      schema_version, facts_count, error_summary, created_at, updated_at
    )
    SELECT book_id,
      ${sourceIndexGroupSql},
      chapter_index, status, source_hmac, model, prompt_hash,
      schema_version, facts_count, error_summary, created_at, updated_at
    FROM l2_chapter_statuses_old;
    DROP TABLE l2_chapter_statuses_old;
  `);
}

function seedDefaultPrompts() {
  const exists = db.prepare("SELECT id FROM prompt_settings WHERE id = 'default'").get();
  if (exists) return;
  savePromptSettings({});
}

function seedDefaultPromptGroups() {
  const exists = db.prepare("SELECT id FROM prompt_groups LIMIT 1").get();
  if (exists) return;
  const settings = getPromptSettings();
  createPromptGroup({
    name: settings.name || "默认小说理解 Prompt",
    category: "通用",
    chapter_prompt: settings.chapter_prompt,
    summary_prompt: settings.summary_prompt
  });
}

function normalizePromptGroup(payload = {}) {
  const summaryPrompt = String(payload.summary_prompt || "").trim();
  const rawBookId = String(payload.book_id ?? payload.bookId ?? "").trim();
  return {
    book_id: rawBookId ? normalizeBookId(rawBookId) : "",
    name: String(payload.name || "未命名分析 Prompt").trim().slice(0, 120) || "未命名分析 Prompt",
    category: normalizePromptCategory(payload.category),
    chapter_prompt: String(payload.chapter_prompt || "").trim(),
    summary_prompt: summaryPrompt || defaultSummaryPrompt(),
    index_group_keys: normalizeOptionalIndexGroupKeys(payload.index_group_keys ?? payload.indexGroupKeys ?? [])
  };
}

function publicPromptGroup(row) {
  if (!row) return null;
  return {
    ...row,
    index_group_keys: parseJsonArray(row.index_group_keys)
  };
}

function publicBookIndexPrompts(row) {
  if (!row) return null;
  const prompts = {
    ...row,
    l1_index_prompt: normalizeIndexPrompt(row.l1_index_prompt, DEFAULT_L1_INDEX_PROMPT),
    l2_index_prompt: normalizeIndexPrompt(row.l2_index_prompt, DEFAULT_L2_INDEX_PROMPT)
  };
  return {
    ...prompts,
    l1_index_prompt_hash: bookL1IndexPromptHash(prompts),
    l2_index_prompt_hash: bookL2IndexPromptHash(prompts)
  };
}

function publicBookIndexGroup(row) {
  if (!row) return null;
  const group = {
    ...row,
    group_key: normalizeIndexGroupKey(row.group_key),
    category_scope: parseJsonArray(row.category_scope),
    trigger_keywords: parseJsonArray(row.trigger_keywords),
    l2_index_prompt: normalizeIndexPrompt(row.l2_index_prompt, DEFAULT_L2_INDEX_PROMPT),
    enabled: Boolean(row.enabled)
  };
  return {
    ...group,
    l2_index_prompt_hash: indexGroupL2PromptHash(group)
  };
}

function publicPromptSettings(row) {
  if (!row) return normalizePromptSettings({});
  const settings = {
    ...row,
    schema_mode: normalizeSchemaMode(row.schema_mode),
    schema_fields: normalizeSchemaFields(row.schema_fields),
    l1_index_prompt: normalizeIndexPrompt(row.l1_index_prompt, DEFAULT_L1_INDEX_PROMPT),
    l2_index_prompt: normalizeIndexPrompt(row.l2_index_prompt, DEFAULT_L2_INDEX_PROMPT)
  };
  return {
    ...settings,
    l1_index_prompt_hash: l1IndexPromptHash(settings),
    l2_index_prompt_hash: l2IndexPromptHash(settings)
  };
}

function migrateBookIndexPrompts() {
  const settings = getPromptSettings();
  const books = db.prepare("SELECT book_id FROM books").all();
  const now = nowIso();
  const insert = db.prepare(`
    INSERT OR IGNORE INTO book_index_prompts (book_id, l1_index_prompt, l2_index_prompt, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  for (const book of books) {
    insert.run(
      book.book_id,
      normalizeIndexPrompt(settings.l1_index_prompt, DEFAULT_L1_INDEX_PROMPT),
      normalizeIndexPrompt(settings.l2_index_prompt, DEFAULT_L2_INDEX_PROMPT),
      now,
      now
    );
  }
}

function migrateBookIndexGroups() {
  const books = db.prepare("SELECT book_id FROM books").all();
  for (const book of books) {
    ensureBaseIndexGroup(book.book_id);
  }
}

function migratePromptGroupsToBooks() {
  const books = db.prepare("SELECT book_id, book_name FROM books").all();
  if (!books.length) return;
  const groups = db.prepare("SELECT id, category, book_id FROM prompt_groups WHERE book_id = '' OR book_id IS NULL").all();
  const update = db.prepare("UPDATE prompt_groups SET book_id = ?, updated_at = ? WHERE id = ?");
  const now = nowIso();
  for (const group of groups) {
    const category = normalizePromptCategory(group.category);
    const matched = books.find((book) => book.book_name && normalizePromptCategory(book.book_name) === category)
      || books.find((book) => normalizePromptCategory(book.book_id) === category);
    if (matched) update.run(matched.book_id, now, group.id);
  }
}

function normalizeAnalysisName(name, bookId, startChapter, endChapter) {
  const value = String(name || "").trim();
  if (value) return value.slice(0, 120);
  return `${normalizeBookId(bookId)} ${normalizeChapterIndex(startChapter)}-${normalizeChapterIndex(endChapter)}`;
}

function publicL1ChapterIndex(row) {
  if (!row) return null;
  const rest = { ...row };
  delete rest.route_summary;
  delete rest.confidence;
  delete rest.has_major_signal;
  return {
    ...rest,
    keywords: parseJsonArray(row.keywords),
    entities: parseJsonArray(row.entities),
    key_events: parseJsonArray(row.key_events),
    items_places_orgs: parseJsonArray(row.items_places_orgs),
    open_questions: parseJsonArray(row.open_questions),
    route_schema_version: row.route_schema_version || "",
    route_entities: parseJsonArray(row.route_entities),
    route_keywords: parseJsonArray(row.route_keywords),
    signals: parseJsonArray(row.signals),
    category_scores: parseJsonObject(row.category_scores)
  };
}

function publicL1WindowIndex(row) {
  if (!row) return null;
  return {
    ...row,
    timeline: parseJsonArray(row.timeline),
    entity_changes: parseJsonArray(row.entity_changes),
    relationship_changes: parseJsonArray(row.relationship_changes),
    foreshadowing: parseJsonArray(row.foreshadowing),
    covered_chapters: parseJsonArray(row.covered_chapters),
    missing_chapters: parseJsonArray(row.missing_chapters),
    confidence: Number(row.confidence || 0)
  };
}

function publicL2ChapterStatus(row) {
  if (!row) return null;
  return {
    ...row,
    index_group_key: normalizeIndexGroupKey(row.index_group_key),
    facts_count: Number(row.facts_count || 0)
  };
}

function publicL2Fact(row) {
  if (!row) return null;
  return {
    id: row.id,
    book_id: row.book_id,
    index_group_key: normalizeIndexGroupKey(row.index_group_key),
    chapter_index: row.chapter_index,
    status: row.status,
    source_hmac: row.source_hmac,
    model: row.model,
    prompt_hash: row.prompt_hash,
    schema_version: row.schema_version,
    category: row.category,
    entity: row.entity,
    aliases: parseJsonArray(row.aliases),
    tags: parseJsonArray(row.tags),
    related_entities: parseJsonArray(row.related_entities),
    fact_type: row.fact_type,
    importance: Number(row.importance || 0),
    confidence: Number(row.confidence || 0),
    review_source: row.review_source,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function publicAnalysisSummaryPart(row) {
  if (!row) return null;
  return {
    analysis_id: row.analysis_id,
    part_key: row.part_key,
    parent_key: row.parent_key || "",
    stage: row.stage,
    status: row.status,
    content_hash: row.content_hash || "",
    prompt_hash: row.prompt_hash || "",
    schema_hash: row.schema_hash || "",
    model: row.model || "",
    reasoning_effort: row.reasoning_effort || "",
    input_summary: row.input_summary || "",
    trace_summary: parseJsonObject(row.trace_summary),
    error_summary: row.error_summary || "",
    has_result: Boolean(row.has_result),
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

async function publicL2FactWithContent(row) {
  const payload = row.ciphertext
    ? JSON.parse(await decryptText(row, l2FactAad(row.id)))
    : {};
  return {
    ...publicL2Fact(row),
    fact: payload.fact || "",
    evidence: Array.isArray(payload.evidence) ? payload.evidence : [],
    review_note: payload.review_note || ""
  };
}

function stringifyJsonArray(value) {
  return JSON.stringify(Array.isArray(value) ? value : []);
}

function stringifyJsonObject(value) {
  return JSON.stringify(value && typeof value === "object" && !Array.isArray(value) ? value : {});
}

function parseJsonArray(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseJsonObject(value) {
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function safeStat(filePath) {
  try {
    return fs.statSync(filePath);
  } catch {
    return {};
  }
}

function countRows(table, where = "", params = []) {
  const sql = `SELECT COUNT(*) AS count FROM ${table}${where ? ` WHERE ${where}` : ""}`;
  return Number(db.prepare(sql).get(...params)?.count || 0);
}

function countStatuses(table) {
  return Object.fromEntries(db.prepare(`
    SELECT status, COUNT(*) AS count
    FROM ${table}
    GROUP BY status
    ORDER BY status ASC
  `).all().map((row) => [row.status || "unknown", Number(row.count || 0)]));
}

function countStatusesForBook(table, bookId) {
  return Object.fromEntries(db.prepare(`
    SELECT status, COUNT(*) AS count
    FROM ${table}
    WHERE book_id = ?
    GROUP BY status
    ORDER BY status ASC
  `).all(normalizeBookId(bookId)).map((row) => [row.status || "unknown", Number(row.count || 0)]));
}

function normalizeConfidence(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(1, number));
}

const L2_CATEGORIES = new Set([
  "character",
  "relationship",
  "cultivation",
  "force",
  "item",
  "location",
  "event",
  "foreshadowing",
  "other"
]);

const L1_ROUTE_SCHEMA_VERSION = "l1-route-v1";

function normalizeL1RouteValue(value = {}) {
  const routeEntities = normalizeRouteEntities(value.route_entities ?? value.entities ?? []);
  const routeKeywords = normalizeStringArray(value.route_keywords ?? value.keywords ?? [], 24, 80);
  const signals = normalizeRouteSignals(value.signals ?? []);
  const categoryScores = normalizeRouteCategoryScores(value.category_scores ?? {}, signals);
  return {
    summary: String(value.summary ?? "").trim().slice(0, 1000),
    keywords: normalizeStringArray(value.keywords ?? routeKeywords, 24, 80),
    entities: normalizeRouteEntities(value.entities ?? routeEntities),
    route_schema_version: String(value.route_schema_version || L1_ROUTE_SCHEMA_VERSION).trim().slice(0, 40),
    route_entities: routeEntities,
    route_keywords: routeKeywords,
    signals,
    category_scores: categoryScores
  };
}

function deriveRouteMajorSignal(routeValue) {
  const signals = Array.isArray(routeValue?.signals) ? routeValue.signals : [];
  const scores = routeValue?.category_scores && typeof routeValue.category_scores === "object"
    ? routeValue.category_scores
    : {};
  if (signals.some((signal) => Number(signal?.strength || 0) >= 0.72)) return true;
  return Object.values(scores).some((score) => Number(score || 0) >= 0.8);
}

function normalizeRouteEntities(value) {
  const raw = Array.isArray(value) ? value : [];
  return raw.map((entry) => {
    if (typeof entry === "string") {
      return {
        name: entry.trim().slice(0, 120),
        type: "",
        aliases: [],
        role: "",
        note: ""
      };
    }
    if (!entry || typeof entry !== "object") return null;
    const name = String(entry.name || "").trim().slice(0, 120);
    if (!name) return null;
    return {
      name,
      type: String(entry.type || "").trim().slice(0, 60),
      aliases: normalizeStringArray(entry.aliases, 12, 80),
      role: String(entry.role || "").trim().slice(0, 80),
      note: String(entry.note || "").trim().slice(0, 160)
    };
  }).filter(Boolean).slice(0, 24);
}

function normalizeRouteSignals(value) {
  const raw = Array.isArray(value) ? value : [];
  return raw.map((entry) => {
    if (!entry || typeof entry !== "object") return null;
    const category = normalizeL2Category(entry.category);
    const reason = String(entry.reason || "").trim().slice(0, 160);
    const entities = normalizeStringArray(entry.entities, 12, 120);
    const keywords = normalizeStringArray(entry.keywords, 12, 80);
    if (!reason && !entities.length && !keywords.length) return null;
    return {
      category,
      strength: normalizeConfidence(entry.strength),
      entities,
      keywords,
      reason
    };
  }).filter(Boolean).slice(0, 16);
}

function normalizeRouteCategoryScores(value, signals = []) {
  const scores = {};
  for (const category of L2_CATEGORIES) {
    const raw = Number(value?.[category]);
    const signalStrength = Math.max(0, ...signals
      .filter((signal) => signal.category === category)
      .map((signal) => Number(signal.strength || 0)));
    scores[category] = normalizeConfidence(Number.isFinite(raw) ? Math.max(raw, signalStrength) : signalStrength);
  }
  return scores;
}

function normalizeL2Fact(value) {
  if (!value || typeof value !== "object") return null;
  const fact = String(value.fact || "").trim();
  const entity = String(value.entity || "").trim().slice(0, 120);
  const category = normalizeL2Category(value.category);
  if (!fact && !entity) return null;
  return {
    category,
    entity,
    aliases: normalizeStringArray(value.aliases, 12, 80),
    tags: normalizeStringArray(value.tags, 12, 80),
    related_entities: normalizeStringArray(value.related_entities, 12, 120),
    fact_type: String(value.fact_type || category).trim().slice(0, 80),
    fact,
    evidence: normalizeStringArray(value.evidence, 8, 300),
    importance: normalizeConfidence(value.importance),
    confidence: normalizeConfidence(value.confidence),
    review_source: ["index", "source_review"].includes(value.review_source) ? value.review_source : "index",
    review_note: String(value.review_note || "").trim().slice(0, 1000)
  };
}

function normalizeL2Category(value) {
  const category = String(value || "other").trim().toLowerCase();
  return L2_CATEGORIES.has(category) ? category : "other";
}

function normalizeL2Categories(value) {
  const raw = Array.isArray(value)
    ? value
    : String(value || "").split(",");
  return [...new Set(raw.map(normalizeL2Category).filter(Boolean))].filter((category) => category !== "other" || raw.some((entry) => String(entry).trim().toLowerCase() === "other"));
}

function normalizeBookIndexGroupPayload(payload = {}) {
  const groupKey = normalizeIndexGroupKey(payload.group_key ?? payload.groupKey ?? payload.key);
  const prompt = normalizeIndexPrompt(payload.l2_index_prompt ?? payload.l2IndexPrompt, DEFAULT_L2_INDEX_PROMPT);
  return {
    group_key: groupKey,
    name: String(payload.name || groupKey).trim().slice(0, 80) || groupKey,
    description: String(payload.description || "").trim().slice(0, 500),
    category_scope: normalizeL2Categories(payload.category_scope ?? payload.categoryScope ?? []),
    trigger_keywords: normalizeStringArray(payload.trigger_keywords ?? payload.triggerKeywords ?? [], 40, 80),
    l2_index_prompt: prompt,
    enabled: payload.enabled === undefined ? true : Boolean(payload.enabled)
  };
}

export function normalizeIndexGroupKey(value) {
  const raw = String(value || BASE_INDEX_GROUP_KEY).trim().toLowerCase();
  const key = raw
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "")
    .slice(0, 64);
  return key || BASE_INDEX_GROUP_KEY;
}

function isBookIndexGroupUniqueError(error) {
  const message = String(error?.message || "");
  return error?.code === "SQLITE_CONSTRAINT_PRIMARYKEY"
    || error?.code === "SQLITE_CONSTRAINT_UNIQUE"
    || message.includes("UNIQUE constraint failed: book_index_groups.book_id, book_index_groups.group_key");
}

function resolveAvailableBookIndexGroupKey(bookId, rawKey) {
  const id = normalizeBookId(bookId);
  const baseKey = normalizeIndexGroupKey(rawKey);
  const rows = db.prepare("SELECT group_key FROM book_index_groups WHERE book_id = ?").all(id);
  const used = new Set(rows.map((row) => normalizeIndexGroupKey(row.group_key)));
  if (!used.has(baseKey)) return baseKey;
  for (let index = 2; index <= 999; index += 1) {
    const candidate = normalizeIndexGroupKey(`${baseKey}-${index}`);
    if (!used.has(candidate)) return candidate;
  }
  return normalizeIndexGroupKey(`${baseKey}-${Date.now()}`);
}

function normalizeIndexGroupKeys(value) {
  const raw = Array.isArray(value)
    ? value
    : String(value || "").split(/[,\s]+/);
  const keys = [...new Set(raw.map(normalizeIndexGroupKey).filter(Boolean))];
  return keys.length ? keys : [BASE_INDEX_GROUP_KEY];
}

function normalizeOptionalIndexGroupKeys(value) {
  const raw = Array.isArray(value)
    ? value
    : String(value || "").split(/[,\s]+/);
  return [...new Set(raw
    .map((entry) => String(entry || "").trim())
    .filter(Boolean)
    .map(normalizeIndexGroupKey)
    .filter(Boolean))];
}

function normalizeEntityQueries(entity, entities) {
  const values = [
    entity,
    ...(Array.isArray(entities) ? entities : [])
  ];
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const normalized = String(value || "").trim().toLowerCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result.slice(0, 8);
}

function normalizeStringArray(value, maxItems, maxChars) {
  const items = Array.isArray(value) ? value : [];
  return items
    .map((entry) => String(entry || "").trim().slice(0, maxChars))
    .filter(Boolean)
    .slice(0, maxItems);
}

export function buildAlignedWindowRanges(startChapter, endChapter, windowSize = 10) {
  const range = normalizeRange(startChapter, endChapter);
  const size = Math.max(1, Math.min(50, Number.parseInt(windowSize, 10) || 10));
  const windows = [];
  const firstStart = Math.floor((range.startChapter - 1) / size) * size + 1;
  for (let start = firstStart; start <= range.endChapter; start += size) {
    const end = start + size - 1;
    if (end < range.startChapter) continue;
    windows.push({
      startChapter: start,
      endChapter: end
    });
  }
  return windows;
}

function normalizeSummaryPartKey(value) {
  const key = String(value || "").trim();
  if (!key) {
    const error = new Error("summary part key 不能为空。");
    error.status = 400;
    throw error;
  }
  return key.slice(0, 240);
}

function chapterAad(bookId, chapterIndex) {
  return `chapter:${bookId}:${chapterIndex}`;
}

function analysisChapterAad(analysisId, chapterIndex) {
  return `analysis-chapter:${analysisId}:${chapterIndex}`;
}

function analysisRunAad(analysisId) {
  return `analysis-final:${analysisId}`;
}

function analysisSummaryPartAad(analysisId, partKey) {
  return `analysis-summary-part:${analysisId}:${normalizeSummaryPartKey(partKey)}`;
}

function analysisPromptAad(analysisId) {
  return `analysis-prompt:${analysisId}`;
}

function l2FactAad(factId) {
  return `l2-fact:${factId}`;
}

function defaultChapterPrompt() {
  return [
    "你是小说章节理解助手。请只根据当前章节原文，提取与用户目标有关的信息。",
    "不要引用大段原文，不要补充后续剧情，不要输出 Markdown。",
    "请输出 JSON 对象，包含 chapter_index、chapter_title、summary、key_points、evidence_notes。"
  ].join("\n");
}

function defaultSummaryPrompt() {
  return [
    "你是小说多章节汇总助手。请基于逐章理解结果进行合并，去重、归纳并输出用户指定内容。",
    "不要输出 Markdown，不要复述长段原文。最终输出必须匹配给定 JSON Schema。"
  ].join("\n");
}

function defaultOutputSchema() {
  return JSON.stringify(schemaFromFields(defaultSchemaFields()), null, 2);
}
