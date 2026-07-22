import type { LegacyAnalysisSummary } from "@novel-analysis/contracts";
import { useQuery } from "@tanstack/react-query";
import { Archive, LockKeyhole } from "lucide-react";
import { useEffect, useRef } from "react";

import { ApiError } from "../../shared/api.js";
import { analysisKeys, listLegacyAnalyses, readLegacyAnalysis } from "./analysis-api.js";
import { AnalysisResultView } from "./AnalysisResultView.js";

type Props = { bookId: string; selectedId: string | null; onSelect: (id: string) => void; drawerOpen: boolean; onClose: () => void };

function LegacyList({ analyses, selectedId, onSelect, onClose }: { analyses: LegacyAnalysisSummary[]; selectedId: string | null; onSelect: (id: string) => void; onClose: () => void }) {
  return <><div className="analysis-rail-heading"><strong>旧历史</strong><Archive size={16} /></div><div className="analysis-rail-list">{analyses.map((analysis) => <button type="button" key={analysis.id} aria-current={analysis.id === selectedId ? "true" : undefined} onClick={() => { onSelect(analysis.id); onClose(); }}><strong>{analysis.name}</strong><small>{analysis.startChapter}-{analysis.endChapter} 章 · {analysis.status}</small></button>)}{!analyses.length ? <p className="analysis-empty">没有可读取的旧历史</p> : null}</div></>;
}

export function LegacyAnalysisPanel({ bookId, selectedId: requestedId, onSelect, drawerOpen, onClose }: Props) {
  const list = useQuery({ queryKey: analysisKeys.legacy(bookId), queryFn: () => listLegacyAnalyses(bookId) });
  const selectedId = requestedId ?? list.data?.analyses[0]?.id ?? null;
  const detail = useQuery({ queryKey: analysisKeys.legacyDetail(bookId, selectedId ?? "none"), queryFn: () => readLegacyAnalysis(bookId, selectedId!), enabled: Boolean(selectedId) });
  const drawer = useRef<HTMLElement>(null); const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!drawerOpen) return;
    close.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { onClose(); return; }
      if (event.key !== "Tab") return;
      const focusable = [...(drawer.current?.querySelectorAll<HTMLElement>('button:not(:disabled), [href], [tabindex]:not([tabindex="-1"])') ?? [])];
      const first = focusable[0]; const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", keydown);
    return () => document.removeEventListener("keydown", keydown);
  }, [drawerOpen, onClose]);

  if (list.isPending) return <p className="empty-state">正在读取旧历史...</p>;
  if (list.isError) return <div className="error-notice">旧历史读取失败 <button className="text-button" type="button" onClick={() => void list.refetch()}>重试旧历史</button></div>;
  const contents = <LegacyList analyses={list.data.analyses} selectedId={selectedId} onSelect={onSelect} onClose={onClose} />;
  return <div className="analysis-layout">
    <aside className="analysis-rail" aria-label="旧历史列表">{contents}</aside>
    {drawerOpen ? <div className="analysis-drawer-backdrop" onMouseDown={onClose}><section ref={drawer} className="analysis-drawer" role="dialog" aria-modal="true" aria-label="旧历史列表" onMouseDown={(event) => event.stopPropagation()}><button ref={close} className="text-button drawer-close" type="button" onClick={onClose}>关闭旧历史列表</button>{contents}</section></div> : null}
    <main className="analysis-main">
      <div className="legacy-readonly"><LockKeyhole size={17} /><div><strong>旧系统只读</strong><span>当前为 Phase 4 fixture 历史，只能查看，不能恢复、修改或删除</span></div></div>
      {!selectedId ? <p className="empty-state">没有可查看的旧历史</p> : detail.isPending ? <p className="empty-state">正在打开旧历史...</p> : detail.isError ? <div className="error-notice">{detail.error instanceof ApiError && detail.error.status === 404 ? "旧历史不存在或无权访问" : "旧历史详情读取失败"} <button className="text-button" type="button" onClick={() => void detail.refetch()}>重试详情</button></div> : detail.data ? <section className="legacy-detail"><div className="analysis-section-heading"><div><p className="eyebrow">旧历史记录</p><h2>{detail.data.analysis.name}</h2></div><span className="status">只读</span></div><dl className="analysis-run-metrics"><div><dt>章节范围</dt><dd>{detail.data.analysis.startChapter}-{detail.data.analysis.endChapter}</dd></div><div><dt>旧状态</dt><dd>{detail.data.analysis.status}</dd></div></dl>{detail.data.analysis.diagnostics.length ? <div className="warning-notice analysis-diagnostics">{detail.data.analysis.diagnostics.map((item) => <code key={item}>{item}</code>)}</div> : null}<AnalysisResultView title={detail.data.analysis.name} result={detail.data.analysis.result} /></section> : null}
    </main>
  </div>;
}
