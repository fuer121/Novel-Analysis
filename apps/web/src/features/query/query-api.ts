import type { QuerySession, QueryTurnDetail, QueryTurnHistoryPage } from "@novel-analysis/contracts";

import { apiRead, apiWrite } from "../../shared/api.js";

export const queryKeys = {
  sessions: (bookId: string) => ["query", bookId, "sessions"] as const,
  session: (bookId: string, sessionId: string) => ["query", bookId, "session", sessionId] as const,
  turns: (bookId: string, sessionId: string) => ["query", bookId, "session", sessionId, "turns"] as const,
  turn: (bookId: string, sessionId: string, turnId: string) => ["query", bookId, "session", sessionId, "turn", turnId] as const,
};

export type QueryPreview = {
  book: { id: string; title: string };
  group: { id: string; key: string; name: string };
  defaultRange: { startChapter: number; endChapter: number };
  effectiveRange: { startChapter: number; endChapter: number };
  queryableChapterCount: number;
  coverageGaps: number[];
  executionVersions: { summaryWorkflowVersion: string; recallPolicyVersion: string };
  estimatedQueuePosition: number;
  scopeHash: string;
};

export function listSessions(bookId: string) { return apiRead<{ sessions: QuerySession[] }>(`/books/${bookId}/query-sessions`); }
export function readSession(bookId: string, sessionId: string) { return apiRead<{ session: QuerySession }>(`/books/${bookId}/query-sessions/${sessionId}`); }
export function listTurns(bookId: string, sessionId: string) { return apiRead<QueryTurnHistoryPage>(`/books/${bookId}/query-sessions/${sessionId}/turns?limit=50`); }
export function readTurn(bookId: string, sessionId: string, turnId: string) { return apiRead<{ turn: QueryTurnDetail }>(`/books/${bookId}/query-sessions/${sessionId}/turns/${turnId}`); }
export function writeQuery<T>(path: string, body: unknown, key?: string) { return apiWrite<T>(path, { method: "POST", body: JSON.stringify(body) }, key); }
