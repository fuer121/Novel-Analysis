import { z } from "zod";

const FactCategorySchema = z.enum([
  "character",
  "relationship",
  "cultivation",
  "force",
  "event",
  "item",
  "magical_creature",
  "location",
  "foreshadowing",
  "other",
  "organization",
  "power",
  "mystery",
]);

export const ChapterImportOutputSchema = z.strictObject({
  chapters: z.array(z.strictObject({
    book_id: z.string(),
    chapter_index: z.number().int().positive(),
    chapter_title: z.string(),
    content: z.string(),
    fetch_status: z.string(),
  })),
});

export const L1IndexOutputSchema = z.strictObject({
  route_schema_version: z.string(),
  route_entities: z.array(z.strictObject({
    name: z.string(),
    type: z.string(),
    aliases: z.array(z.string()),
    role: z.string(),
    note: z.string(),
  })),
  route_keywords: z.array(z.string()),
  signals: z.array(z.strictObject({
    category: FactCategorySchema,
    strength: z.number(),
    entities: z.array(z.string()),
    keywords: z.array(z.string()),
    reason: z.string(),
  })),
  category_scores: z.partialRecord(FactCategorySchema, z.number()),
});

const L2FactSchema = z.strictObject({
  category: FactCategorySchema,
  entity: z.string().min(1),
  aliases: z.array(z.string()),
  tags: z.array(z.string()),
  related_entities: z.array(z.string()),
  fact_type: z.string().min(1),
  fact: z.string().min(1),
  evidence: z.array(z.string()),
  importance: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
  scope_eligible: z.boolean(),
  scope_basis: z.string(),
  transformation_eligible: z.boolean(),
  scope_fields_complete: z.boolean(),
  creature_type: z.string(),
  original_form: z.string(),
  qualification_evidence: z.array(z.string()),
  subject_key: z.string(),
  identity_basis: z.string(),
});

export const L2IndexOutputSchema = z.strictObject({
  chapter_index: z.number().int().positive(),
  chapter_title: z.string(),
  facts: z.array(L2FactSchema),
});

export const AnalysisSummaryOutputSchema = z.strictObject({
  text: z.string().trim().min(1),
});

export type DifyTarget = "chapter-import" | "l1-index" | "l2-index" | "analysis-summary";
export type ChapterImportOutput = z.infer<typeof ChapterImportOutputSchema>;
export type L1IndexOutput = z.infer<typeof L1IndexOutputSchema>;
export type L2IndexOutput = z.infer<typeof L2IndexOutputSchema>;
export type AnalysisSummaryOutput = z.infer<typeof AnalysisSummaryOutputSchema>;

export type DifyContractErrorCode =
  | "MALFORMED_JSON"
  | "INVALID_ENVELOPE"
  | "INVALID_OUTPUT"
  | "MISSING_CHAPTER_INDEX"
  | "DUPLICATE_CHAPTER_INDEX"
  | "INVALID_L2_FACT";

export type DifyContractError = {
  code: DifyContractErrorCode;
  message: string;
};

type OutputByTarget = {
  "chapter-import": ChapterImportOutput;
  "l1-index": L1IndexOutput;
  "l2-index": L2IndexOutput;
  "analysis-summary": AnalysisSummaryOutput;
};

type NormalizeResult<T> = { ok: true; value: T } | { ok: false; error: DifyContractError };

const schemas = {
  "chapter-import": ChapterImportOutputSchema,
  "l1-index": L1IndexOutputSchema,
  "l2-index": L2IndexOutputSchema,
  "analysis-summary": AnalysisSummaryOutputSchema,
} as const;

function failure(code: DifyContractErrorCode, message: string): NormalizeResult<never> {
  return { ok: false, error: { code, message } };
}

function parseJson(value: string): NormalizeResult<unknown> {
  try {
    return { ok: true, value: JSON.parse(value) as unknown };
  } catch {
    return failure("MALFORMED_JSON", "Dify output is not valid JSON");
  }
}

function unwrap(raw: unknown): NormalizeResult<unknown> {
  if (typeof raw === "string") return parseJson(raw);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return failure("INVALID_OUTPUT", "Dify output does not match the declared contract");
  }
  const record = raw as Record<string, unknown>;
  const envelopeKeys = ["result", "text", "output", "data"].filter((key) => key in record);
  if (envelopeKeys.length === 0) {
    if (Object.keys(record).length === 1 && ["content", "response", "value"].some((key) => key in record)) {
      return failure("INVALID_ENVELOPE", "Dify output envelope is not declared");
    }
    return { ok: true, value: raw };
  }
  if (envelopeKeys.length !== 1 || Object.keys(record).length !== 1) {
    return failure("INVALID_ENVELOPE", "Dify output envelope is not declared");
  }
  const value = record[envelopeKeys[0]!];
  return typeof value === "string" ? parseJson(value) : { ok: true, value };
}

function normalizedString(value: unknown, fallback?: string): unknown {
  if (value === undefined) return fallback;
  return typeof value === "string" ? value.trim() : value;
}

function normalizedStringArray(value: unknown, fallback?: string[]): unknown {
  if (value === undefined) return fallback;
  if (!Array.isArray(value)) return value;
  return value.map((entry) => typeof entry === "string" ? entry.trim() : entry);
}

function normalizedChapterIndex(value: unknown): unknown {
  if (typeof value === "number") return Number.isInteger(value) ? value : value;
  if (typeof value !== "string" || !/^-?\d+$/.test(value.trim())) return value;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : value;
}

function canonicalizeChapterImport(value: unknown): unknown {
  if (!value || typeof value !== "object" || !Array.isArray((value as { chapters?: unknown }).chapters)) return value;
  return {
    chapters: (value as { chapters: unknown[] }).chapters.map((raw) => {
      if (!raw || typeof raw !== "object") return raw;
      const chapter = raw as Record<string, unknown>;
      const indexValue = chapter.chapter_index ?? chapter.chapterIndex ?? chapter.index ?? chapter.sortid ?? chapter.sort_id;
      return {
        book_id: normalizedString(chapter.book_id ?? chapter.bookId, ""),
        chapter_index: normalizedChapterIndex(indexValue),
        chapter_title: normalizedString(chapter.chapter_title ?? chapter.title),
        content: normalizedString(chapter.content ?? chapter.text ?? chapter.chapter_content ?? chapter.chapterContent),
        fetch_status: normalizedString(chapter.fetch_status ?? chapter.status, "ok"),
      };
    }),
  };
}

const scopeFieldNames = [
  "scope_eligible",
  "scope_basis",
  "transformation_eligible",
  "creature_type",
  "original_form",
  "subject_key",
  "identity_basis",
] as const;

function canonicalizeL2(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const output = value as Record<string, unknown>;
  if (!Array.isArray(output.facts)) return value;
  return {
    chapter_index: output.chapter_index,
    chapter_title: output.chapter_title,
    facts: output.facts.map((raw) => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
      const fact = raw as Record<string, unknown>;
      return {
        category: fact.category,
        entity: fact.entity,
        aliases: normalizedStringArray(fact.aliases),
        tags: normalizedStringArray(fact.tags),
        related_entities: normalizedStringArray(fact.related_entities ?? fact.relatedEntities),
        fact_type: fact.fact_type ?? fact.factType,
        fact: fact.fact,
        evidence: normalizedStringArray(fact.evidence),
        importance: fact.importance,
        confidence: fact.confidence,
        scope_eligible: fact.scope_eligible ?? false,
        scope_basis: normalizedString(fact.scope_basis, ""),
        transformation_eligible: fact.transformation_eligible ?? false,
        scope_fields_complete: scopeFieldNames.every((field) => Object.hasOwn(fact, field)),
        creature_type: normalizedString(fact.creature_type ?? fact.creatureType, ""),
        original_form: normalizedString(fact.original_form ?? fact.originalForm, ""),
        qualification_evidence: normalizedStringArray(fact.qualification_evidence ?? fact.qualificationEvidence, []),
        subject_key: normalizedString(fact.subject_key ?? fact.subjectKey, ""),
        identity_basis: normalizedString(fact.identity_basis ?? fact.identityBasis, ""),
      };
    }),
  };
}

export function normalizeDifyOutput<T extends DifyTarget>(target: T, raw: unknown): NormalizeResult<OutputByTarget[T]> {
  if (target === "analysis-summary") {
    const result = raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as { result?: unknown }).result
      : undefined;
    const parsed = AnalysisSummaryOutputSchema.safeParse({ text: result });
    return parsed.success
      ? { ok: true, value: parsed.data as OutputByTarget[T] }
      : failure("INVALID_OUTPUT", "Dify output does not match the declared contract");
  }

  const unwrapped = unwrap(raw);
  if (!unwrapped.ok) return unwrapped;

  const canonical = target === "chapter-import"
    ? canonicalizeChapterImport(unwrapped.value)
    : target === "l2-index"
      ? canonicalizeL2(unwrapped.value)
      : unwrapped.value;

  if (target === "chapter-import" && unwrapped.value && typeof unwrapped.value === "object") {
    const chapters = (unwrapped.value as { chapters?: unknown }).chapters;
    if (Array.isArray(chapters)) {
      if (chapters.some((chapter) => !chapter || typeof chapter !== "object" || !["chapter_index", "chapterIndex", "index", "sortid", "sort_id"].some((key) => key in chapter))) {
        return failure("MISSING_CHAPTER_INDEX", "Chapter output is missing chapter_index");
      }
      const canonicalChapters = (canonical as { chapters: Array<{ chapter_index: unknown }> }).chapters;
      const indexes = canonicalChapters.map((chapter) => chapter.chapter_index);
      if (new Set(indexes).size !== indexes.length) {
        return failure("DUPLICATE_CHAPTER_INDEX", "Chapter output contains duplicate chapter_index values");
      }
    }
  }
  if (target === "l2-index" && unwrapped.value && typeof unwrapped.value === "object" && !("chapter_index" in unwrapped.value)) {
    return failure("MISSING_CHAPTER_INDEX", "L2 output is missing chapter_index");
  }

  const parsed = schemas[target].safeParse(canonical);
  if (parsed.success) return { ok: true, value: parsed.data as OutputByTarget[T] };
  if (target === "l2-index" && parsed.error.issues.some((issue) => issue.path[0] === "facts")) {
    return failure("INVALID_L2_FACT", "L2 output contains an invalid fact");
  }
  return failure("INVALID_OUTPUT", "Dify output does not match the declared contract");
}
