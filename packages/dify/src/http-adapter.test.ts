import { describe, expect, it, vi } from "vitest";
import type { DifyTarget, L1IndexOutput } from "@novel-analysis/contracts";
import {
  chapterImportOutput,
  legacyChapterImportRaw,
  legacyL1IndexRaw,
  legacyL2IndexRaw,
  l1IndexOutput,
  l2IndexOutput,
} from "../../../test/phase2/fixtures/dify-golden.js";
import {
  DifyAdapterError,
  FakeDifyAdapter,
  HttpDifyAdapter,
  type DifyAdapter,
  type DifyAdapterErrorCode,
  type L1IndexInput,
} from "./index.js";

const credentials = {
  "chapter-import": "chapter-secret",
  "l1-index": "l1-secret",
  "l2-index": "l2-secret",
} as const;

const typedL1Output = l1IndexOutput as L1IndexOutput;

const inputs = {
  "chapter-import": {
    invocationKey: "import:215243:1-2",
    bookId: 215243,
    startChapter: 1,
    endChapter: 2,
  },
  "l1-index": {
    invocationKey: "l1:book-1:221",
    bookId: "book-1",
    chapterIndex: 221,
    chapterTitle: "Synthetic chapter",
    chapterContent: "Synthetic non-sensitive chapter content",
    indexPrompt: "Return the declared synthetic route",
  },
  "l2-index": {
    invocationKey: "l2:book-1:items:221",
    bookId: "book-1",
    indexGroupKey: "items",
    chapterIndex: 221,
    chapterTitle: "Synthetic chapter",
    chapterContent: "Synthetic non-sensitive chapter content",
    l1Route: typedL1Output,
    indexPrompt: "Return declared synthetic facts",
    knownSubjects: [{ entity: "Synthetic subject" }],
  },
} as const;

const expectedProviderInputs = {
  "chapter-import": { book_id: 215243, start_chapter: 1, end_chapter: 2 },
  "l1-index": {
    book_id: "book-1",
    chapter_index: 221,
    chapter_title: "Synthetic chapter",
    chapter_content: "Synthetic non-sensitive chapter content",
    index_prompt: "Return the declared synthetic route",
  },
  "l2-index": {
    book_id: "book-1",
    index_group_key: "items",
    chapter_index: 221,
    chapter_title: "Synthetic chapter",
    chapter_content: "Synthetic non-sensitive chapter content",
    l1_route_json: JSON.stringify(typedL1Output),
    index_prompt: "Return declared synthetic facts",
    known_subjects_json: JSON.stringify([{ entity: "Synthetic subject" }]),
  },
} as const;

const outputs = {
  "chapter-import": chapterImportOutput,
  "l1-index": l1IndexOutput,
  "l2-index": l2IndexOutput,
} as const;

const providerOutputs = {
  "chapter-import": legacyChapterImportRaw,
  "l1-index": legacyL1IndexRaw,
  "l2-index": legacyL2IndexRaw,
} as const;

function response(body: unknown, status = 200): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function adapter(fetch: typeof globalThis.fetch, timeoutMs = 100): HttpDifyAdapter {
  return new HttpDifyAdapter({
    fetch,
    baseUrl: "https://dify.invalid/api",
    credentials,
    timeoutMs,
  });
}

async function runTarget(client: DifyAdapter, target: DifyTarget): Promise<unknown> {
  if (target === "chapter-import") return client.runChapterImport(inputs[target]);
  if (target === "l1-index") return client.runL1Index(inputs[target]);
  return client.runL2Index(inputs[target]);
}

describe("HttpDifyAdapter request mapping", () => {
  it.each(["chapter-import", "l1-index", "l2-index"] as const)(
    "maps only declared %s inputs into a blocking workflow request",
    async (target) => {
      const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response({
        data: { outputs: { result: providerOutputs[target] } },
      }));

      await expect(runTarget(adapter(fetch), target)).resolves.toEqual(outputs[target]);

      expect(fetch).toHaveBeenCalledOnce();
      const [url, init] = fetch.mock.calls[0]!;
      expect(url).toBe("https://dify.invalid/api/workflows/run");
      expect(init?.method).toBe("POST");
      expect(init?.headers).toEqual({
        Authorization: `Bearer ${credentials[target]}`,
        "Content-Type": "application/json",
      });
      expect(JSON.parse(String(init?.body))).toEqual({
        inputs: expectedProviderInputs[target],
        response_mode: "blocking",
        user: "novel-analysis-adapter",
      });
      expect(String(url)).not.toContain(credentials[target]);
    },
  );

  it.each(["chapter-import", "l1-index", "l2-index"] as const)(
    "normalizes direct and enveloped golden %s outputs",
    async (target) => {
      for (const providerOutput of [providerOutputs[target], { output: JSON.stringify(providerOutputs[target]) }]) {
        const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response({ data: { outputs: providerOutput } }));
        await expect(runTarget(adapter(fetch), target)).resolves.toEqual(outputs[target]);
      }
    },
  );
});

describe("HttpDifyAdapter failures", () => {
  it("maps timeout aborts without retrying", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    }));
    await expect(runTarget(adapter(fetch, 5), "chapter-import")).rejects.toMatchObject({ code: "provider_timeout" });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("keeps the timeout active while reading the blocking response body", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async (_url, init) => ({
      ok: true,
      status: 200,
      text: () => new Promise<string>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        setTimeout(() => reject(new Error("body remained stalled")), 20);
      }),
    }) as Response);
    await expect(runTarget(adapter(fetch, 5), "chapter-import")).rejects.toMatchObject({ code: "provider_timeout" });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each([
    [429, "provider_rate_limited"],
    [500, "provider_unavailable"],
    [503, "provider_unavailable"],
  ] as const)("maps HTTP %i to %s without exposing the provider body", async (status, code) => {
    const providerSecret = "provider-body-secret";
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response({ message: providerSecret }, status));
    const error = await runTarget(adapter(fetch), "l1-index").catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code });
    expect(JSON.stringify(error)).not.toContain(providerSecret);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("maps network failure to provider_unavailable without leaking inputs or credentials", async () => {
    const networkSecret = "network-secret";
    const fetch = vi.fn<typeof globalThis.fetch>().mockRejectedValue(new Error(networkSecret));
    const error = await runTarget(adapter(fetch), "l2-index").catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: "provider_unavailable" });
    const serialized = JSON.stringify(error);
    expect(serialized).not.toContain(networkSecret);
    expect(serialized).not.toContain(credentials["l2-index"]);
    expect(serialized).not.toContain(inputs["l2-index"].chapterContent);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each([
    "not json",
    { data: { outputs: { result: { unexpected: true } } } },
  ])("maps malformed or structural output to provider_invalid_response", async (body) => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response(body));
    await expect(runTarget(adapter(fetch), "chapter-import")).rejects.toMatchObject({ code: "provider_invalid_response" });
  });
});

describe("FakeDifyAdapter", () => {
  it("returns target-and-key scripted typed output after the requested delay and records calls", async () => {
    vi.useFakeTimers();
    const fake = new FakeDifyAdapter([{ target: "l1-index", invocationKey: inputs["l1-index"].invocationKey, output: typedL1Output, delayMs: 20 }]);
    const pending = fake.runL1Index(inputs["l1-index"]);
    expect(fake.calls).toEqual([{ target: "l1-index", invocationKey: inputs["l1-index"].invocationKey, input: inputs["l1-index"] }]);
    await vi.advanceTimersByTimeAsync(20);
    await expect(pending).resolves.toEqual(typedL1Output);
    vi.useRealTimers();
  });

  it.each([
    "provider_timeout",
    "provider_rate_limited",
    "provider_unavailable",
    "provider_invalid_response",
  ] as const)("throws the shared %s typed failure", async (code: DifyAdapterErrorCode) => {
    const fake = new FakeDifyAdapter([{ target: "chapter-import", invocationKey: inputs["chapter-import"].invocationKey, error: new DifyAdapterError(code) }]);
    await expect(fake.runChapterImport(inputs["chapter-import"])).rejects.toEqual(new DifyAdapterError(code));
  });

  it("consumes failure then success scripts for the same target and invocation key", async () => {
    const input = inputs["chapter-import"];
    const fake = new FakeDifyAdapter([
      { target: "chapter-import", invocationKey: input.invocationKey, error: new DifyAdapterError("provider_timeout") },
      { target: "chapter-import", invocationKey: input.invocationKey, output: chapterImportOutput },
    ]);
    await expect(fake.runChapterImport(input)).rejects.toMatchObject({ code: "provider_timeout" });
    await expect(fake.runChapterImport(input)).resolves.toEqual(chapterImportOutput);
    await expect(fake.runChapterImport(input)).rejects.toMatchObject({ code: "provider_unavailable" });
  });

  it("assigns concurrent same-key scripts in invocation order before delays", async () => {
    vi.useFakeTimers();
    const input = inputs["chapter-import"];
    const secondOutput = { chapters: [{ ...chapterImportOutput.chapters[0]!, chapter_index: 2 }] };
    const fake = new FakeDifyAdapter([
      { target: "chapter-import", invocationKey: input.invocationKey, output: chapterImportOutput, delayMs: 20 },
      { target: "chapter-import", invocationKey: input.invocationKey, output: secondOutput, delayMs: 5 },
    ]);
    const first = fake.runChapterImport(input);
    const second = fake.runChapterImport(input);
    await vi.advanceTimersByTimeAsync(5);
    await expect(second).resolves.toEqual(secondOutput);
    await vi.advanceTimersByTimeAsync(15);
    await expect(first).resolves.toEqual(chapterImportOutput);
    vi.useRealTimers();
  });

  it("snapshots inputs and protects internal calls from mutations", async () => {
    const input: L1IndexInput = structuredClone(inputs["l1-index"]);
    const fake = new FakeDifyAdapter([{ target: "l1-index", invocationKey: input.invocationKey, output: typedL1Output }]);
    const pending = fake.runL1Index(input);
    input.chapterContent = "mutated after invocation";
    const observed = fake.calls;
    expect((observed[0]!.input as typeof input).chapterContent).toBe("Synthetic non-sensitive chapter content");
    (observed[0]!.input as typeof input).chapterContent = "mutated observed call";
    expect((fake.calls[0]!.input as typeof input).chapterContent).toBe("Synthetic non-sensitive chapter content");
    await pending;
  });

  it("snapshots scripted outputs and returns independent success values", async () => {
    const input = inputs["chapter-import"];
    const scriptedOutput = structuredClone(chapterImportOutput);
    const fake = new FakeDifyAdapter([
      { target: "chapter-import", invocationKey: input.invocationKey, output: scriptedOutput },
      { target: "chapter-import", invocationKey: input.invocationKey, output: scriptedOutput },
    ]);
    scriptedOutput.chapters[0]!.chapter_title = "mutated script source";
    const first = await fake.runChapterImport(input);
    first.chapters[0]!.chapter_title = "mutated returned output";
    await expect(fake.runChapterImport(input)).resolves.toEqual(chapterImportOutput);
  });

  it("creates independent typed errors from the scripted code", async () => {
    const input = inputs["chapter-import"];
    const scriptedError = new DifyAdapterError("provider_timeout");
    const fake = new FakeDifyAdapter([
      { target: "chapter-import", invocationKey: input.invocationKey, error: scriptedError },
      { target: "chapter-import", invocationKey: input.invocationKey, error: scriptedError },
    ]);
    scriptedError.message = "mutated script error";
    let first: DifyAdapterError;
    try {
      await fake.runChapterImport(input);
      throw new Error("expected scripted failure");
    } catch (error) {
      first = error as DifyAdapterError;
    }
    first.message = "mutated caught error";
    let second: DifyAdapterError;
    try {
      await fake.runChapterImport(input);
      throw new Error("expected scripted failure");
    } catch (error) {
      second = error as DifyAdapterError;
    }
    expect(second).toEqual(new DifyAdapterError("provider_timeout"));
    expect(second).not.toBe(first);
  });
});

const smokeConfigured = process.env.DIFY_SMOKE === "1"
  && Boolean(process.env.DIFY_SMOKE_BASE_URL)
  && Boolean(process.env.DIFY_SMOKE_CHAPTER_CREDENTIAL)
  && Boolean(process.env.DIFY_SMOKE_L1_CREDENTIAL)
  && Boolean(process.env.DIFY_SMOKE_L2_CREDENTIAL);

describe.skipIf(!smokeConfigured)("Dify smoke", () => {
  it("calls all three targets with synthetic non-sensitive inputs", async () => {
    const client = new HttpDifyAdapter({
      fetch: globalThis.fetch,
      baseUrl: process.env.DIFY_SMOKE_BASE_URL!,
      credentials: {
        "chapter-import": process.env.DIFY_SMOKE_CHAPTER_CREDENTIAL!,
        "l1-index": process.env.DIFY_SMOKE_L1_CREDENTIAL!,
        "l2-index": process.env.DIFY_SMOKE_L2_CREDENTIAL!,
      },
      timeoutMs: 60_000,
    });
    await client.runChapterImport(inputs["chapter-import"]);
    await client.runL1Index(inputs["l1-index"]);
    await client.runL2Index(inputs["l2-index"]);
  });
});
