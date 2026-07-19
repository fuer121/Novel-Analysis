import type {
  ChapterImportOutput,
  DifyTarget,
  L1IndexOutput,
  L2IndexOutput,
} from "@novel-analysis/contracts";
import {
  DifyAdapterError,
  type ChapterImportInput,
  type DifyAdapter,
  type L1IndexInput,
  type L2IndexInput,
} from "./adapter.js";
import {
  normalizeChapterImportOutput,
  normalizeL1IndexOutput,
  normalizeL2IndexOutput,
} from "./normalizers.js";

type HttpDifyAdapterOptions = {
  fetch: typeof globalThis.fetch;
  baseUrl: string;
  credentials: Record<DifyTarget, string>;
  timeoutMs: number;
};

type TargetDefinition = {
  endpoint: "/workflows/run";
};

const targets: Record<DifyTarget, TargetDefinition> = {
  "chapter-import": { endpoint: "/workflows/run" },
  "l1-index": { endpoint: "/workflows/run" },
  "l2-index": { endpoint: "/workflows/run" },
};

export class HttpDifyAdapter implements DifyAdapter {
  readonly #fetch: typeof globalThis.fetch;
  readonly #baseUrl: string;
  readonly #credentials: Record<DifyTarget, string>;
  readonly #timeoutMs: number;

  constructor(options: HttpDifyAdapterOptions) {
    this.#fetch = options.fetch;
    this.#baseUrl = options.baseUrl.replace(/\/$/, "");
    this.#credentials = options.credentials;
    this.#timeoutMs = options.timeoutMs;
  }

  runChapterImport(input: ChapterImportInput): Promise<ChapterImportOutput> {
    return this.#run("chapter-import", {
      book_id: input.bookId,
      start_chapter: input.startChapter,
      end_chapter: input.endChapter,
    }, normalizeChapterImportOutput);
  }

  runL1Index(input: L1IndexInput): Promise<L1IndexOutput> {
    return this.#run("l1-index", {
      book_id: input.bookId,
      chapter_index: input.chapterIndex,
      chapter_title: input.chapterTitle,
      chapter_content: input.chapterContent,
      index_prompt: input.indexPrompt,
    }, normalizeL1IndexOutput);
  }

  runL2Index(input: L2IndexInput): Promise<L2IndexOutput> {
    return this.#run("l2-index", {
      book_id: input.bookId,
      index_group_key: input.indexGroupKey,
      chapter_index: input.chapterIndex,
      chapter_title: input.chapterTitle,
      chapter_content: input.chapterContent,
      l1_route_json: JSON.stringify(input.l1Route),
      index_prompt: input.indexPrompt,
      known_subjects_json: JSON.stringify(input.knownSubjects),
    }, normalizeL2IndexOutput);
  }

  async #run<T>(
    target: DifyTarget,
    inputs: Record<string, unknown>,
    normalize: (raw: unknown) => { ok: true; value: T } | { ok: false },
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.#timeoutMs);
    let response: Response;
    try {
      response = await this.#fetch(`${this.#baseUrl}${targets[target].endpoint}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.#credentials[target]}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ inputs, response_mode: "blocking", user: "novel-analysis-adapter" }),
        signal: controller.signal,
      });
    } catch {
      clearTimeout(timeout);
      throw new DifyAdapterError(controller.signal.aborted ? "provider_timeout" : "provider_unavailable");
    }

    try {
      if (response.status === 429) throw new DifyAdapterError("provider_rate_limited");
      if (response.status >= 500) throw new DifyAdapterError("provider_unavailable");
      if (!response.ok) throw new DifyAdapterError("provider_invalid_response");

      let body: unknown;
      try {
        body = JSON.parse(await response.text()) as unknown;
      } catch {
        throw new DifyAdapterError(controller.signal.aborted ? "provider_timeout" : "provider_invalid_response");
      }
      const outputs = body && typeof body === "object"
        ? (body as { data?: { outputs?: unknown } }).data?.outputs
        : undefined;
      const normalized = normalize(outputs);
      if (!normalized.ok) throw new DifyAdapterError("provider_invalid_response");
      return normalized.value;
    } finally {
      clearTimeout(timeout);
    }
  }
}
