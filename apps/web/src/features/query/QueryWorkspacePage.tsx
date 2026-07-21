import type { QuerySession } from "@novel-analysis/contracts";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { useOutletContext, useSearchParams } from "react-router-dom";

import { ApiError, apiRead } from "../../shared/api.js";
import type { BookSummary, IndexGroup } from "../library/types.js";
import { QueryConversation } from "./QueryConversation.js";
import { QueryEvidencePanel } from "./QueryEvidencePanel.js";
import { QuerySessionList } from "./QuerySessionList.js";
import { listSessions, listTurns, queryKeys, readSession, readTurn, writeQuery, type QueryPreview } from "./query-api.js";

export function QueryWorkspacePage() {
  const { book } = useOutletContext<{ book: BookSummary }>();
  const client = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [evidenceOpen, setEvidenceOpen] = useState(() => !window.matchMedia?.("(max-width: 720px)").matches);
  const [creating, setCreating] = useState(false);
  const drawerTrigger = useRef<HTMLButtonElement>(null);
  const sessions = useQuery({ queryKey: queryKeys.sessions(book.id), queryFn: () => listSessions(book.id) });
  const groups = useQuery({ queryKey: ["book", book.id, "index-groups"], queryFn: () => apiRead<{ indexGroups: IndexGroup[] }>(`/books/${book.id}/index-groups`) });
  const requestedSessionId = params.get("session");
  const requestedSession = sessions.data?.sessions.find((session) => session.id === requestedSessionId);
  const selectedId = sessions.isSuccess ? requestedSession?.id ?? sessions.data.sessions[0]?.id ?? null : requestedSessionId;
  const selectedSession = useQuery({ queryKey: queryKeys.session(book.id, selectedId ?? "none"), queryFn: () => readSession(book.id, selectedId!), enabled: Boolean(selectedId) });
  const turns = useInfiniteQuery({ queryKey: queryKeys.turns(book.id, selectedId ?? "none"), queryFn: ({ pageParam }) => listTurns(book.id, selectedId!, pageParam), initialPageParam: undefined as string | undefined, getNextPageParam: (page) => page.nextCursor ?? undefined, enabled: Boolean(selectedId) });
  const history = turns.data?.pages.flatMap((page) => page.turns) ?? [];
  const selectedTurnId = params.get("turn") ?? history[0]?.id ?? null;
  const turn = useQuery({ queryKey: queryKeys.turn(book.id, selectedId ?? "none", selectedTurnId ?? "none"), queryFn: () => readTurn(book.id, selectedId!, selectedTurnId!), enabled: Boolean(selectedId && selectedTurnId) });
  useEffect(() => {
    if (!sessions.isSuccess || requestedSessionId === selectedId) return;
    const next = new URLSearchParams(params);
    if (selectedId) next.set("session", selectedId); else next.delete("session");
    setParams(next, { replace: true });
  }, [params, requestedSessionId, selectedId, sessions.isSuccess, setParams]);
  useEffect(() => {
    if (!(turn.error instanceof ApiError) || turn.error.status !== 404 || !selectedId || params.get("turn") !== selectedTurnId) return;
    const next = new URLSearchParams(params);
    if (history[0]) next.set("turn", history[0].id); else next.delete("turn");
    setParams(next, { replace: true });
  }, [history, params, selectedId, selectedTurnId, setParams, turn.error]);

  const selectSession = (session: QuerySession) => setParams({ session: session.id });
  const selectTurn = (turnId: string) => { if (selectedId) setParams({ session: selectedId, turn: turnId }); };
  const invalidate = async () => { await client.invalidateQueries({ queryKey: ["query", book.id] }); };
  const createAttempt = useRef<{ fingerprint: string; key: string } | null>(null);
  const createLock = useRef(false);
  const create = useMutation({ mutationFn: ({ body, key }: { body: unknown; key: string }) => writeQuery<{ session: QuerySession }>(`/books/${book.id}/query-sessions`, body, key), onSuccess: async ({ session }) => { createAttempt.current = null; await invalidate(); setParams({ session: session.id }); setCreating(false); }, onSettled: () => { createLock.current = false; } });
  const preview = (value: { question: string; startChapter: number; endChapter: number }) => writeQuery<QueryPreview>(`/books/${book.id}/query-sessions/${selectedId}/turn-preview`, value);
  const submit = async (body: unknown, key: string) => { await writeQuery(`/books/${book.id}/query-sessions/${selectedId}/turns`, body, key); await invalidate(); };
  const fallback = async (turnId: string, kind: "retry-summary" | "local-summary", key: string) => { await writeQuery(`/books/${book.id}/query-sessions/${selectedId}/turns/${turnId}/${kind}`, {}, key); await invalidate(); };
  const closeDrawer = useCallback(() => { drawerTrigger.current?.focus(); setDrawerOpen(false); }, []);
  const active = selectedSession.data?.session;
  return <div className={`query-workspace ${evidenceOpen ? "evidence-open" : "evidence-closed"}`} data-testid="query-workspace">
    <button className="text-button query-evidence-desktop-toggle" type="button" aria-label={evidenceOpen ? "收起桌面证据面板" : "展开桌面证据面板"} onClick={() => setEvidenceOpen((value) => !value)}>{evidenceOpen ? "收起证据面板" : "展开证据面板"}</button>
    <div className="query-mobile-tools"><button ref={drawerTrigger} className="secondary-button" onClick={() => setDrawerOpen(true)}>打开会话列表</button><button className="secondary-button" onClick={() => setEvidenceOpen((value) => !value)}>{evidenceOpen ? "收起证据面板" : "展开证据面板"}</button></div>
    <QuerySessionList sessions={sessions.data?.sessions ?? []} selectedId={selectedId} onSelect={selectSession} onCreate={() => setCreating(true)} drawerOpen={drawerOpen} onClose={closeDrawer} />
    {creating ? <form className="query-create" onSubmit={(event) => { event.preventDefault(); if (createLock.current) return; createLock.current = true; const form = new FormData(event.currentTarget); const body = { title: form.get("title"), groupId: form.get("groupId"), visibility: form.get("visibility"), defaultStartChapter: Number(form.get("start")), defaultEndChapter: Number(form.get("end")) }; const fingerprint = JSON.stringify(body); if (createAttempt.current?.fingerprint !== fingerprint) createAttempt.current = { fingerprint, key: crypto.randomUUID() }; create.mutate({ body, key: createAttempt.current.key }); }}>
      <h2>新建研究会话</h2><label>会话标题<input name="title" required /></label><label>索引组<select name="groupId" aria-label="索引组" required>{groups.data?.indexGroups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label><label>可见范围<select name="visibility" defaultValue="private"><option value="private">仅自己</option><option value="team">团队</option></select></label><label>默认开始章节<input name="start" type="number" min="1" max={book.chapterCount || 1} defaultValue="1" required /></label><label>默认结束章节<input name="end" type="number" min="1" max={book.chapterCount || 1} defaultValue={book.chapterCount || 1} required /></label>{create.isError ? <p className="warning-notice">创建结果未确认，请重试</p> : null}<div className="button-row"><button className="primary-button" disabled={create.isPending}>创建会话</button><button className="text-button" type="button" onClick={() => setCreating(false)}>取消</button></div>
    </form> : null}
    {active ? <QueryConversation session={active} turns={history} selectedTurnId={selectedTurnId} detail={turn.data?.turn ?? null} onSelectTurn={selectTurn} hasOlderTurns={turns.hasNextPage} loadingOlderTurns={turns.isFetchingNextPage} onLoadOlderTurns={() => void turns.fetchNextPage()} onPreview={preview} onSubmit={submit} onFallback={fallback} /> : <p className="query-empty query-main-empty">选择或新建研究会话</p>}
    <aside className={`query-evidence query-evidence-sheet ${evidenceOpen ? "open" : ""}`} data-testid="query-evidence-sheet" aria-label="本轮证据">{evidenceOpen ? <div role="region" aria-label="本轮证据"><QueryEvidencePanel turn={turn.data?.turn ?? null} /></div> : null}</aside>
  </div>;
}
