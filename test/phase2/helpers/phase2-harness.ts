import { createContentCipher, type DatabaseConnection } from "@novel-analysis/database";
import type { ChapterImportInput, DifyAdapter, L1IndexInput, L2IndexInput } from "@novel-analysis/dify";
import { L1_ROUTE_SCHEMA_VERSION } from "@novel-analysis/jobs";
import { LibraryImportExecutor } from "../../../apps/worker/src/library-executor.js";

export const PHASE2_SENTINELS = {
  chapter: "PHASE2_CHAPTER_PLAINTEXT",
  fact: "PHASE2_FACT_PLAINTEXT",
  credential: "PHASE2_CREDENTIAL_SENTINEL",
} as const;

class Phase2DifyFake implements DifyAdapter {
  async runChapterImport(input: ChapterImportInput) {
    return { chapters: [{ book_id: String(input.bookId), chapter_index: input.startChapter, chapter_title: `Chapter ${input.startChapter}`, content: `${PHASE2_SENTINELS.chapter}-${input.startChapter}`, fetch_status: "ok" as const }] };
  }

  async runL1Index(input: L1IndexInput) {
    return { route_schema_version: L1_ROUTE_SCHEMA_VERSION, route_entities: [{ name: `entity-${input.chapterIndex}`, type: "character", aliases: [], role: "subject", note: "phase2 test" }], route_keywords: [`keyword-${input.chapterIndex}`], signals: [], category_scores: {} };
  }

  async runL2Index(input: L2IndexInput) {
    return { chapter_index: input.chapterIndex, chapter_title: input.chapterTitle, facts: [{ category: "event" as const, entity: `entity-${input.chapterIndex}`, aliases: [], tags: [], related_entities: [], fact_type: "event", fact: `${PHASE2_SENTINELS.fact}-${input.chapterIndex}`, evidence: [`chapter ${input.chapterIndex}`], importance: 0.8, confidence: 0.9, scope_eligible: true, scope_basis: "explicit_event", transformation_eligible: false, scope_fields_complete: true, creature_type: "", original_form: "", qualification_evidence: [], subject_key: `entity-${input.chapterIndex}`, identity_basis: "explicit" }] };
  }
}

export function createPhase2LibraryExecutor(database: DatabaseConnection): LibraryImportExecutor {
  return new LibraryImportExecutor({ database, adapter: new Phase2DifyFake(), cipher: createContentCipher({ activeKeyVersion: "phase2-test", keys: { "phase2-test": Buffer.alloc(32, 8) } }), hmacKey: Buffer.from(PHASE2_SENTINELS.credential) });
}
