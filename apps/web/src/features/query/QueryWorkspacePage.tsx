import type { QuerySession } from "@novel-analysis/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useOutletContext, useSearchParams } from "react-router-dom";

import { apiRead } from "../../shared/api.js";
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
  const sessions = useQuery({ queryKey: queryKeys.sessions(book.id), queryFn: () => listSessions(book.id) });
  const groups = useQuery({ queryKey: ["book", book.id, "index-groups"], queryFn: () => apiRead<{ indexGroups: IndexGroup[] }>(`/books/${book.id}/index-groups`) });
  const selectedId = params.get("session") ?? sessions.data?.sessions[0]?.id ?? null;
  const selectedSession = useQuery({ queryKey: queryKeys.session(book.id, selectedId ?? "none"), queryFn: () => readSession(book.id, selectedId!), enabled: Boolean(selectedId) });
  const turns = useQuery({ queryKey: queryKeys.turns(book.id, selectedId ?? "none"), queryFn: () => listTurns(book.id, selectedId!), enabled: Boolean(selectedId) });
  const selectedTurnId = params.get("turn") ?? turns.data?.turns[0]?.id ?? null;
  const turn = useQuery({ queryKey: queryKeys.turn(book.id, selectedId ?? "none", selectedTurnId ?? "none"), queryFn: () => readTurn(book.id, selectedId!, selectedTurnId!), enabled: Boolean(selectedId && selectedTurnId) });
  useEffect(() => { if (!params.get("session") && selectedId) setParams({ session: selectedId }, { replace: true }); }, [params, selectedId, setParams]);

  const selectSession = (session: QuerySession) => setParams({ session: session.id });
  const selectTurn = (turnId: string) => { if (selectedId) setParams({ session: selectedId, turn: turnId }); };
  const invalidate = async () => { await client.invalidateQueries({ queryKey: ["query", book.id] }); };
  const create = useMutation({ mutationFn: (body: unknown) => writeQuery<{ session: QuerySession }>(`/books/${book.id}/query-sessions`, body), onSuccess: async ({ session }) => { await invalidate(); setParams({ session: session.id }); setCreating(false); } });
  const preview = (value: { question: string; startChapter: number; endChapter: number }) => writeQuery<QueryPreview>(`/books/${book.id}/query-sessions/${selectedId}/turn-preview`, value);
  const submit = async (body: unknown, key: string) => { await writeQuery(`/books/${book.id}/query-sessions/${selectedId}/turns`, body, key); await invalidate(); };
  const fallback = async (turnId: string, kind: "retry-summary" | "local-summary") => { await writeQuery(`/books/${book.id}/query-sessions/${selectedId}/turns/${turnId}/${kind}`, {}); await invalidate(); };
  const active = selectedSession.data?.session;
  return <div className="query-workspace">
    <div className="query-mobile-tools"><button className="secondary-button" onClick={() => setDrawerOpen(true)}>打开会话列表</button><button className="secondary-button" onClick={() => setEvidenceOpen((value) => !value)}>{evidenceOpen ? "收起证据面板" : "展开证据面板"}</button></div>
    <QuerySessionList sessions={sessions.data?.sessions ?? []} selectedId={selectedId} onSelect={selectSession} onCreate={() => setCreating(true)} drawerOpen={drawerOpen} onClose={() => setDrawerOpen(false)} />
    {creating ? <form className="query-create" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); create.mutate({ title: form.get("title"), groupId: form.get("groupId"), visibility: form.get("visibility"), defaultStartChapter: Number(form.get("start")), defaultEndChapter: Number(form.get("end")) }); }}>
      <h2>新建研究会话</h2><label>会话标题<input name="title" required /></label><label>索引组<select name="groupId" aria-label="索引组" required>{groups.data?.indexGroups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label><label>可见范围<select name="visibility" defaultValue="private"><option value="private">仅自己</option><option value="team">团队</option></select></label><label>默认开始章节<input name="start" type="number" min="1" max={book.chapterCount || 1} defaultValue="1" required /></label><label>默认结束章节<input name="end" type="number" min="1" max={book.chapterCount || 1} defaultValue={book.chapterCount || 1} required /></label><div className="button-row"><button className="primary-button">创建会话</button><button className="text-button" type="button" onClick={() => setCreating(false)}>取消</button></div>
    </form> : null}
    {active ? <QueryConversation session={active} turns={turns.data?.turns ?? []} selectedTurnId={selectedTurnId} detail={turn.data?.turn ?? null} onSelectTurn={selectTurn} onPreview={preview} onSubmit={submit} onFallback={fallback} /> : <p className="query-empty query-main-empty">选择或新建研究会话</p>}
    <aside className={`query-evidence ${evidenceOpen ? "open" : ""}`} aria-label="本轮证据">{evidenceOpen ? <div role="region" aria-label="本轮证据"><QueryEvidencePanel turn={turn.data?.turn ?? null} /></div> : null}</aside>
  </div>;
}
