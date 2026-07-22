import type { AnalysisRunDetail } from "@novel-analysis/contracts";
import { Pause, Play, Square, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { modeLabels } from "./analysis-api.js";
import { AnalysisResultView } from "./AnalysisResultView.js";

type Props = {
  run: AnalysisRunDetail;
  pending: boolean;
  onControl: (action: "pause" | "resume" | "cancel") => void;
  onDelete: () => void;
};

const statusLabels: Record<AnalysisRunDetail["status"], string> = { queued: "等待中", running: "运行中", retrying: "重试中", paused: "已暂停", completed: "已完成", failed: "失败", cancelled: "已取消" };
const terminal = new Set<AnalysisRunDetail["status"]>(["completed", "failed", "cancelled"]);

export function AnalysisRunPanel({ run, pending, onControl, onDelete }: Props) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const deleteTrigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLElement>(null);
  const confirmDelete = useRef<HTMLButtonElement>(null);
  const closeDelete = () => { setConfirmingDelete(false); deleteTrigger.current?.focus(); };
  useEffect(() => {
    if (!confirmingDelete) return;
    confirmDelete.current?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { closeDelete(); return; }
      if (event.key !== "Tab") return;
      const focusable = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), [href], [tabindex]:not([tabindex="-1"])') ?? [])];
      const first = focusable[0]; const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [confirmingDelete]);
  const active = !terminal.has(run.status);
  const currentPart = run.parts.find((part) => part.status === "running") ?? run.parts.find((part) => part.status === "queued");
  return <section className="analysis-run-detail" aria-label="任务详情">
    <div className="analysis-section-heading"><div><p className="eyebrow">当前任务</p><h2>{modeLabels[run.mode]} · {run.startChapter}-{run.endChapter} 章</h2></div><span className={`status status-${run.status}`}>{statusLabels[run.status]}</span></div>
    <div className="analysis-progress-row"><div><strong>{run.completedParts} / {run.totalParts} parts</strong><span>{currentPart?.kind ?? (run.status === "completed" ? "全部步骤已完成" : "等待调度")}</span></div><progress value={run.completedParts} max={Math.max(1, run.totalParts)} aria-label="任务进度" /></div>
    <div className="button-row analysis-controls">
      {run.status === "paused" ? <button className="secondary-button icon-command" type="button" disabled={pending} onClick={() => onControl("resume")}><Play size={15} />继续</button> : null}
      {["queued", "running", "retrying"].includes(run.status) ? <button className="secondary-button icon-command" type="button" disabled={pending} onClick={() => onControl("pause")}><Pause size={15} />暂停</button> : null}
      {active ? <button className="danger-button icon-command" type="button" disabled={pending} onClick={() => onControl("cancel")}><Square size={14} />取消</button> : null}
      {terminal.has(run.status) ? <button ref={deleteTrigger} className="danger-button icon-command" type="button" disabled={pending} onClick={() => setConfirmingDelete(true)}><Trash2 size={15} />删除任务</button> : null}
    </div>
    <dl className="analysis-run-metrics"><div><dt>完成 parts</dt><dd>{run.completedParts}</dd></div><div><dt>总 parts</dt><dd>{run.totalParts}</dd></div><div><dt>模板版本</dt><dd>{run.templateVersionId.slice(0, 8)}</dd></div><div><dt>任务 ID</dt><dd>{run.jobId.slice(0, 8)}</dd></div></dl>
    <div className="analysis-parts"><h3>执行步骤</h3>{run.parts.length ? run.parts.map((part) => <div key={part.id}><span>{part.position + 1}</span><strong>{part.kind}</strong><span className={`status status-${part.status}`}>{part.status}</span>{part.errorCode ? <code>{part.errorCode}</code> : null}</div>) : <p className="analysis-empty">尚未生成执行步骤</p>}</div>
    {run.diagnostics.length ? <div className="warning-notice analysis-diagnostics"><strong>安全诊断</strong>{run.diagnostics.map((item) => <code key={item}>{item}</code>)}</div> : null}
    <AnalysisResultView title={`${modeLabels[run.mode]}-${run.id.slice(0, 8)}`} result={run.result} />
    {confirmingDelete ? <div className="analysis-modal-backdrop"><section ref={dialog} className="analysis-confirm-dialog" role="dialog" aria-modal="true" aria-label="永久删除分析任务"><h2>永久删除分析任务</h2><p>该操作会删除任务、执行步骤和结果，无法恢复</p><div className="button-row"><button ref={confirmDelete} className="danger-button" type="button" disabled={pending} onClick={onDelete}>确认永久删除</button><button className="secondary-button" type="button" onClick={closeDelete}>返回</button></div></section></div> : null}
  </section>;
}
