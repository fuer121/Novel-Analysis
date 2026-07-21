import type {
  AnalysisSummaryOutput,
  ChapterImportOutput,
  L1IndexOutput,
  L2IndexOutput,
} from "@novel-analysis/contracts";

export type DifyAdapterErrorCode =
  | "provider_timeout"
  | "provider_rate_limited"
  | "provider_unavailable"
  | "provider_invalid_response";

const errorMessages: Record<DifyAdapterErrorCode, string> = {
  provider_timeout: "Dify provider request timed out",
  provider_rate_limited: "Dify provider rate limit exceeded",
  provider_unavailable: "Dify provider is unavailable",
  provider_invalid_response: "Dify provider returned an invalid response",
};

export class DifyAdapterError extends Error {
  readonly code: DifyAdapterErrorCode;

  constructor(code: DifyAdapterErrorCode) {
    super(errorMessages[code]);
    this.name = "DifyAdapterError";
    this.code = code;
  }
}

type Invocation = { invocationKey: string };

export type AnalysisSummaryInput = Invocation & {
  taskType: "l2_query";
  prompt: string;
  contextJson: string;
};

export type ChapterImportInput = Invocation & {
  bookId: number;
  startChapter: number;
  endChapter: number;
};

export type L1IndexInput = Invocation & {
  bookId: string;
  chapterIndex: number;
  chapterTitle: string;
  chapterContent: string;
  indexPrompt: string;
};

export type L2IndexInput = Invocation & {
  bookId: string;
  indexGroupKey: string;
  chapterIndex: number;
  chapterTitle: string;
  chapterContent: string;
  l1Route: L1IndexOutput | null;
  indexPrompt: string;
  knownSubjects: readonly unknown[];
};

export interface DifyAdapter {
  runChapterImport(input: ChapterImportInput): Promise<ChapterImportOutput>;
  runL1Index(input: L1IndexInput): Promise<L1IndexOutput>;
  runL2Index(input: L2IndexInput): Promise<L2IndexOutput>;
  runAnalysisSummary(input: AnalysisSummaryInput): Promise<AnalysisSummaryOutput>;
}
