import { createHash } from "node:crypto";

import { buildL1Signature, buildL2Signature } from "@novel-analysis/domain";

import type { DatabaseExecutor } from "../db.js";

export const L1_ROUTE_SCHEMA_VERSION = "l1-route-v1";
export const L2_FACT_SCHEMA_VERSION = "l2-facts-v1";
export const L2_ADMISSION_VERSION = "l2-admission-v1";

type FreshnessState = "fresh" | "missing" | "failed" | "stale";

export type CanonicalPrompt = {
  id: string;
  version: string;
  content: string;
  contentHash: string;
};

export type CanonicalWorkflow = {
  id: string;
  dslHash: string;
  contractVersion: string;
  adapterContractVersion: string;
};

export type CanonicalVersionSelection = {
  promptVersionId: string;
  workflowVersionId: string;
};

export type CanonicalL1Chapter = {
  chapterId: string;
  chapterIndex: number;
  chapterTitle: string;
  sourceVersion: string;
  chapterHmac: string;
  inputSignature: string;
  state: FreshnessState;
};

export type CanonicalL2Chapter = CanonicalL1Chapter & {
  l1Signature: string;
};

export type CanonicalL1Selection = {
  kind: "selected";
  prompt: CanonicalPrompt;
  workflow: CanonicalWorkflow;
  chapters: CanonicalL1Chapter[];
};

export type CanonicalL2Selection = {
  kind: "selected";
  prompt: CanonicalPrompt;
  workflow: CanonicalWorkflow;
  indexGroup: {
    id: string;
    key: string;
    name: string;
    categoryScope: "general" | "magical_creature";
    configHash: string;
  };
  chapters: CanonicalL2Chapter[];
};

export type CanonicalSelectionFailure = {
  kind: "book_not_found";
  chapterTotal: number;
} | {
  kind: "configuration_error";
  chapterTotal: number;
};

export type CanonicalL2SelectionFailure = CanonicalSelectionFailure | {
  kind: "index_group_not_found";
  chapterTotal: number;
};

function classify(storedSignature: string | null, storedStatus: string | null, inputSignature: string): FreshnessState {
  if (storedSignature === null) return "missing";
  if (storedSignature !== inputSignature || storedStatus === "stale") return "stale";
  return storedStatus === "failed" ? "failed" : "fresh";
}

function validPrompt(content: string, contentHash: string): boolean {
  return content.trim().length > 0 && createHash("sha256").update(content).digest("hex") === contentHash;
}

export async function selectCanonicalL1Freshness(
  database: DatabaseExecutor,
  bookId: string,
  versions?: CanonicalVersionSelection,
): Promise<CanonicalL1Selection | CanonicalSelectionFailure> {
  const book = await database.selectFrom("books").select("id").where("id", "=", bookId).where("status", "=", "active").executeTakeFirst();
  if (!book) return { kind: "book_not_found", chapterTotal: 0 };

  let promptQuery = database.selectFrom("prompt_versions").selectAll()
    .where("target", "=", "l1-index");
  let workflowQuery = database.selectFrom("workflow_versions").selectAll()
    .where("target", "=", "l1-index").where("enabled", "=", true);
  if (versions) {
    promptQuery = promptQuery.where("id", "=", versions.promptVersionId);
    workflowQuery = workflowQuery.where("id", "=", versions.workflowVersionId);
  } else {
    promptQuery = promptQuery.orderBy("created_at", "desc").orderBy("id", "desc");
    workflowQuery = workflowQuery.orderBy("created_at", "desc").orderBy("id", "desc");
  }
  const [prompt, workflow] = await Promise.all([
    promptQuery.executeTakeFirst(),
    workflowQuery.executeTakeFirst(),
  ]);
  if (!prompt || !workflow || !validPrompt(prompt.content, prompt.content_hash)) {
    const count = await database.selectFrom("chapters").select(({ fn }) => fn.countAll<number>().as("count"))
      .where("book_id", "=", bookId).executeTakeFirstOrThrow();
    return { kind: "configuration_error", chapterTotal: Number(count.count) };
  }
  const rows = await database.selectFrom("chapters as c")
    .leftJoin("l1_indexes as l", (join) => join.onRef("l.chapter_id", "=", "c.id").on("l.is_current", "=", true))
    .select(["c.id", "c.chapter_index", "c.title", "c.source_version", "c.content_hmac", "l.input_signature", "l.status"])
    .where("c.book_id", "=", bookId).orderBy("c.chapter_index").execute();

  return {
    kind: "selected",
    prompt: { id: prompt.id, version: prompt.version, content: prompt.content, contentHash: prompt.content_hash },
    workflow: { id: workflow.id, dslHash: workflow.dsl_hash, contractVersion: workflow.contract_version, adapterContractVersion: workflow.contract_version },
    chapters: rows.map((row) => {
      const inputSignature = buildL1Signature({
        sourceVersion: row.source_version,
        chapterHmac: row.content_hmac,
        promptHash: prompt.content_hash,
        workflowDslHash: workflow.dsl_hash,
        adapterContractVersion: workflow.contract_version,
        schemaVersion: L1_ROUTE_SCHEMA_VERSION,
      });
      return {
        chapterId: row.id,
        chapterIndex: row.chapter_index,
        chapterTitle: row.title,
        sourceVersion: row.source_version,
        chapterHmac: row.content_hmac,
        inputSignature,
        state: classify(row.input_signature, row.status, inputSignature),
      };
    }),
  };
}

export async function selectCanonicalL2Freshness(
  database: DatabaseExecutor,
  input: { bookId: string; groupId: string; versions?: CanonicalVersionSelection },
): Promise<CanonicalL2Selection | CanonicalL2SelectionFailure> {
  const book = await database.selectFrom("books").select("id").where("id", "=", input.bookId).where("status", "=", "active").executeTakeFirst();
  if (!book) return { kind: "book_not_found", chapterTotal: 0 };

  let groupQuery = database.selectFrom("index_groups as g")
    .innerJoin("prompt_versions as p", "p.id", "g.prompt_version_id")
    .select(["g.id", "g.key", "g.name", "g.category_scope", "g.config_hash", "p.id as prompt_id", "p.version as prompt_version", "p.content as prompt_content", "p.content_hash as prompt_hash"])
    .where("g.id", "=", input.groupId).where("g.book_id", "=", input.bookId)
    .where("g.status", "=", "active").where("p.target", "=", "l2-index");
  if (input.versions) {
    groupQuery = groupQuery.where("p.id", "=", input.versions.promptVersionId);
  }
  const group = await groupQuery.executeTakeFirst();
  if (!group) {
    const count = await database.selectFrom("chapters").select(({ fn }) => fn.countAll<number>().as("count"))
      .where("book_id", "=", input.bookId).executeTakeFirstOrThrow();
    return { kind: "index_group_not_found", chapterTotal: Number(count.count) };
  }

  let workflowQuery = database.selectFrom("workflow_versions").selectAll()
    .where("target", "=", "l2-index").where("enabled", "=", true);
  if (input.versions) {
    workflowQuery = workflowQuery.where("id", "=", input.versions.workflowVersionId);
  } else {
    workflowQuery = workflowQuery.orderBy("created_at", "desc").orderBy("id", "desc");
  }
  const workflow = await workflowQuery.executeTakeFirst();
  if (!workflow || !validPrompt(group.prompt_content, group.prompt_hash)) {
    const count = await database.selectFrom("chapters").select(({ fn }) => fn.countAll<number>().as("count"))
      .where("book_id", "=", input.bookId).executeTakeFirstOrThrow();
    return { kind: "configuration_error", chapterTotal: Number(count.count) };
  }

  const rows = await database.selectFrom("chapters as c")
    .leftJoin("l1_indexes as l", (join) => join.onRef("l.chapter_id", "=", "c.id").on("l.is_current", "=", true))
    .leftJoin("l2_chapter_statuses as s", (join) => join.onRef("s.chapter_id", "=", "c.id").on("s.group_id", "=", input.groupId))
    .select(["c.id", "c.chapter_index", "c.title", "c.source_version", "c.content_hmac", "l.input_signature as l1_signature", "s.input_signature", "s.status"])
    .where("c.book_id", "=", input.bookId).orderBy("c.chapter_index").execute();

  return {
    kind: "selected",
    prompt: { id: group.prompt_id, version: group.prompt_version, content: group.prompt_content, contentHash: group.prompt_hash },
    workflow: { id: workflow.id, dslHash: workflow.dsl_hash, contractVersion: workflow.contract_version, adapterContractVersion: workflow.contract_version },
    indexGroup: { id: group.id, key: group.key, name: group.name, categoryScope: group.category_scope, configHash: group.config_hash },
    chapters: rows.map((row) => {
      const l1Signature = row.l1_signature ?? "";
      const inputSignature = buildL2Signature({
        sourceVersion: row.source_version,
        chapterHmac: row.content_hmac,
        promptHash: group.prompt_hash,
        workflowDslHash: workflow.dsl_hash,
        adapterContractVersion: workflow.contract_version,
        schemaVersion: L2_FACT_SCHEMA_VERSION,
        admissionVersion: L2_ADMISSION_VERSION,
        indexGroupConfigHash: group.config_hash,
        l1Signature,
      });
      return {
        chapterId: row.id,
        chapterIndex: row.chapter_index,
        chapterTitle: row.title,
        sourceVersion: row.source_version,
        chapterHmac: row.content_hmac,
        l1Signature,
        inputSignature,
        state: classify(row.input_signature, row.status, inputSignature),
      };
    }),
  };
}
