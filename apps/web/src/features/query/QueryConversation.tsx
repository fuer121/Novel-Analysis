import type { QuerySession, QueryTurnDetail, QueryTurnHistoryItem } from "@novel-analysis/contracts";
import { useEffect, useRef, useState } from "react";

import type { QueryPreview } from "./query-api.js";

const labels: Record<QueryTurnHistoryItem["status"], string> = { queued: "排队中", running: "分析中", awaiting_fallback: "等待降级选择", completed: "已完成", degraded: "已降级", failed: "失败", cancelled: "已取消" };

type Props = {
  session: QuerySession;
  turns: QueryTurnHistoryItem[];
  selectedTurnId: string | null;
  detail: QueryTurnDetail | null;
  onSelectTurn: (id: string) => void;
  hasOlderTurns: boolean;
  loadingOlderTurns: boolean;
  onLoadOlderTurns: () => void;
  onPreview: (value: { question: string; startChapter: number; endChapter: number }) => Promise<QueryPreview>;
  onSubmit: (value: { question: string; startChapter: number; endChapter: number; scopeHash: string }, key: string) => Promise<void>;
  onFallback: (turnId: string, kind: "retry-summary" | "local-summary") => Promise<void>;
};

export function QueryConversation({ session, turns, selectedTurnId, detail, onSelectTurn, hasOlderTurns, loadingOlderTurns, onLoadOlderTurns, onPreview, onSubmit, onFallback }: Props) {
  const [question, setQuestion] = useState("");
  const [startChapter, setStartChapter] = useState(session.defaultStartChapter);
  const [endChapter, setEndChapter] = useState(session.defaultEndChapter);
  const [preview, setPreview] = useState<{ value: QueryPreview; input: { question: string; startChapter: number; endChapter: number } } | null>(null);
  const [key, setKey] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const previewGeneration = useRef(0);
  useEffect(() => { previewGeneration.current += 1; setQuestion(""); setStartChapter(session.defaultStartChapter); setEndChapter(session.defaultEndChapter); setPreview(null); setKey(null); setMessage(""); }, [session]);
  const invalidatePreview = () => { previewGeneration.current += 1; setPreview(null); setMessage(""); };
  const previewQuestion = async () => {
    setBusy(true); setMessage("");
    const generation = ++previewGeneration.current;
    const input = { question, startChapter, endChapter };
    try { const value = await onPreview(input); if (generation === previewGeneration.current) { setPreview({ value, input }); setKey(crypto.randomUUID()); } }
    catch { if (generation === previewGeneration.current) setMessage("预览失败，请重试"); }
    finally { setBusy(false); }
  };
  const submit = async () => {
    if (!preview || !key) return;
    setBusy(true); setMessage("");
    try { await onSubmit({ ...preview.input, scopeHash: preview.value.scopeHash }, key); setPreview(null); setKey(null); setQuestion(""); }
    catch (error) {
      if (error instanceof Error && error.message === "scope_changed") { setPreview(null); setKey(null); setMessage("范围已变化，请重新预览"); }
      else setMessage("提交结果未确认，请重试");
    } finally { setBusy(false); }
  };
  return <section className="query-conversation">
    <header><div><p className="eyebrow">连续提问</p><h2>{session.title}</h2></div><span>{session.defaultStartChapter}-{session.defaultEndChapter} 章</span></header>
    <div className="query-turns" aria-live="polite">
      {turns.map((turn) => <button className={turn.id === selectedTurnId ? "selected" : ""} type="button" key={turn.id} onClick={() => onSelectTurn(turn.id)}>
        <span className={`status status-${turn.status}`}>{labels[turn.status]}</span><strong>{turn.question}</strong>{turn.answer ? <p>{turn.answer}</p> : null}
      </button>)}
      {turns.length === 0 ? <p className="query-empty">提出第一个问题，开始研究</p> : null}
      {hasOlderTurns ? <button className="text-button query-load-older" type="button" disabled={loadingOlderTurns} onClick={onLoadOlderTurns}>加载更早</button> : null}
      {detail?.status === "awaiting_fallback" ? <div className="query-fallback"><p>远程汇总暂不可用，请选择后续处理</p><div className="button-row"><button className="secondary-button" onClick={() => void onFallback(detail.id, "retry-summary")}>重试 Dify 汇总</button><button className="secondary-button" onClick={() => void onFallback(detail.id, "local-summary")}>生成本地事实摘要</button></div></div> : null}
    </div>
    <div className="query-composer" data-testid="query-composer">
      <label>问题<textarea value={question} onChange={(event) => { setQuestion(event.target.value); invalidatePreview(); }} rows={3} /></label>
      <div className="query-range"><label>开始章节<input aria-label="问题开始章节" type="number" min={session.defaultStartChapter} max={endChapter} value={startChapter} onChange={(event) => { setStartChapter(Number(event.target.value)); invalidatePreview(); }} /></label><label>结束章节<input aria-label="问题结束章节" type="number" min={startChapter} max={session.defaultEndChapter} value={endChapter} onChange={(event) => { setEndChapter(Number(event.target.value)); invalidatePreview(); }} /></label></div>
      {preview ? <div className="query-preview"><strong>“{preview.input.question}”</strong><span>第 {preview.value.effectiveRange.startChapter}-{preview.value.effectiveRange.endChapter} 章 · {preview.value.queryableChapterCount} 章可查询 · 队列前方约 {Math.max(0, preview.value.estimatedQueuePosition - 1)} 项</span>{preview.value.coverageGaps.length ? <small>覆盖缺口：第 {preview.value.coverageGaps.join("、")} 章</small> : null}</div> : null}
      {message ? <p className="warning-notice">{message}</p> : null}
      <div className="button-row"><button className="secondary-button" type="button" disabled={busy || !question.trim()} onClick={() => void previewQuestion()}>预览问题范围</button>{preview ? <button className="primary-button" type="button" disabled={busy} onClick={() => void submit()}>发送问题</button> : null}</div>
    </div>
  </section>;
}
