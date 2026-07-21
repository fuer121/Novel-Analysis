import type {
  AnalysisSummaryOutput,
  ChapterImportOutput,
  DifyTarget,
  L1IndexOutput,
  L2IndexOutput,
} from "@novel-analysis/contracts";
import {
  DifyAdapterError,
  type AnalysisSummaryInput,
  type ChapterImportInput,
  type DifyAdapter,
  type DifyAdapterErrorCode,
  type L1IndexInput,
  type L2IndexInput,
} from "./adapter.js";

type OutputByTarget = {
  "chapter-import": ChapterImportOutput;
  "l1-index": L1IndexOutput;
  "l2-index": L2IndexOutput;
  "analysis-summary": AnalysisSummaryOutput;
};

type SuccessScript<T extends DifyTarget = DifyTarget> = {
  target: T;
  invocationKey: string;
  output: OutputByTarget[T];
  error?: never;
  delayMs?: number;
};

type FailureScript<T extends DifyTarget = DifyTarget> = {
  target: T;
  invocationKey: string;
  error: DifyAdapterError;
  output?: never;
  delayMs?: number;
};

export type FakeDifyScript = {
  [T in DifyTarget]: SuccessScript<T> | FailureScript<T>;
}[DifyTarget];

export type FakeDifyCall = {
  target: DifyTarget;
  invocationKey: string;
  input: ChapterImportInput | L1IndexInput | L2IndexInput | AnalysisSummaryInput;
};

type StoredScript = {
  delayMs?: number;
  output?: OutputByTarget[DifyTarget];
  errorCode?: DifyAdapterErrorCode;
};

function scriptKey(target: DifyTarget, invocationKey: string): string {
  return JSON.stringify([target, invocationKey]);
}

function snapshot<T>(value: T): T {
  return structuredClone(value);
}

export class FakeDifyAdapter implements DifyAdapter {
  readonly #calls: FakeDifyCall[] = [];
  readonly #scripts = new Map<string, StoredScript[]>();

  constructor(scripts: readonly FakeDifyScript[]) {
    for (const script of scripts) {
      const key = scriptKey(script.target, script.invocationKey);
      const queue = this.#scripts.get(key) ?? [];
      queue.push(script.error
        ? { delayMs: script.delayMs, errorCode: script.error.code }
        : { delayMs: script.delayMs, output: snapshot(script.output) });
      this.#scripts.set(key, queue);
    }
  }

  get calls(): FakeDifyCall[] {
    return snapshot(this.#calls);
  }

  runChapterImport(input: ChapterImportInput): Promise<ChapterImportOutput> {
    return this.#run("chapter-import", input);
  }

  runL1Index(input: L1IndexInput): Promise<L1IndexOutput> {
    return this.#run("l1-index", input);
  }

  runL2Index(input: L2IndexInput): Promise<L2IndexOutput> {
    return this.#run("l2-index", input);
  }

  runAnalysisSummary(input: AnalysisSummaryInput): Promise<AnalysisSummaryOutput> {
    return this.#run("analysis-summary", input);
  }

  async #run<T extends DifyTarget>(
    target: T,
    input: ChapterImportInput | L1IndexInput | L2IndexInput | AnalysisSummaryInput,
  ): Promise<OutputByTarget[T]> {
    this.#calls.push({ target, invocationKey: input.invocationKey, input: snapshot(input) });
    const script = this.#scripts.get(scriptKey(target, input.invocationKey))?.shift();
    if (!script) throw new DifyAdapterError("provider_unavailable");
    if (script.delayMs) await new Promise((resolve) => setTimeout(resolve, script.delayMs));
    if (script.errorCode) throw new DifyAdapterError(script.errorCode);
    return snapshot(script.output) as OutputByTarget[T];
  }
}
