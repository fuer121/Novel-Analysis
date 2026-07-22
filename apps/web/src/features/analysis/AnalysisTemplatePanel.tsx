import type { AnalysisRunSummary, AnalysisTemplateSummary } from "@novel-analysis/contracts";
import { FilePlus2, Pencil, Plus } from "lucide-react";
import { useEffect, useRef } from "react";

import { modeLabels } from "./analysis-api.js";

type Props = {
  templates: AnalysisTemplateSummary[];
  runs: AnalysisRunSummary[];
  selectedTemplateId: string | null;
  selectedRunId: string | null;
  onSelectTemplate: (id: string) => void;
  onSelectRun: (id: string) => void;
  onCreateTemplate: () => void;
  onEditTemplate: () => void;
  drawerOpen: boolean;
  onClose: () => void;
};

const runStatus: Record<AnalysisRunSummary["status"], string> = { queued: "等待中", running: "运行中", retrying: "重试中", paused: "已暂停", completed: "已完成", failed: "失败", cancelled: "已取消" };

export function AnalysisTemplatePanel(props: Props) {
  const drawer = useRef<HTMLElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!props.drawerOpen) return;
    close.current?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { props.onClose(); return; }
      if (event.key !== "Tab") return;
      const focusable = [...(drawer.current?.querySelectorAll<HTMLElement>('button:not(:disabled), [href], [tabindex]:not([tabindex="-1"])') ?? [])];
      const first = focusable[0]; const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [props.drawerOpen, props.onClose]);

  const contents = <>
    <div className="analysis-rail-heading"><strong>模板</strong><button className="text-button icon-command" type="button" onClick={props.onCreateTemplate}><Plus size={15} />新建模板</button></div>
    <div className="analysis-rail-list">
      {props.templates.map((template) => <button key={template.id} type="button" aria-current={template.id === props.selectedTemplateId ? "true" : undefined} onClick={() => { props.onSelectTemplate(template.id); props.onClose(); }}><strong>{template.name}</strong><small>版本 {template.currentVersionId.slice(0, 8)}</small></button>)}
      {!props.templates.length ? <p className="analysis-empty">还没有私有模板</p> : null}
    </div>
    {props.selectedTemplateId ? <button className="analysis-rail-action text-button icon-command" type="button" onClick={props.onEditTemplate}><Pencil size={14} />编辑模板</button> : null}
    <div className="analysis-rail-heading analysis-run-heading"><strong>任务</strong><FilePlus2 size={16} /></div>
    <div className="analysis-rail-list analysis-run-list">
      {props.runs.map((run) => <button key={run.id} type="button" aria-current={run.id === props.selectedRunId ? "true" : undefined} onClick={() => { props.onSelectRun(run.id); props.onClose(); }}><strong>{modeLabels[run.mode]}</strong><small>{runStatus[run.status]} · {run.completedParts}/{run.totalParts} parts</small></button>)}
      {!props.runs.length ? <p className="analysis-empty">还没有分析任务</p> : null}
    </div>
  </>;

  return <>
    <aside className="analysis-rail" aria-label="模板与任务">{contents}</aside>
    {props.drawerOpen ? <div className="analysis-drawer-backdrop" onMouseDown={props.onClose}><section ref={drawer} className="analysis-drawer" role="dialog" aria-modal="true" aria-label="模板与任务" onMouseDown={(event) => event.stopPropagation()}><button ref={close} className="text-button drawer-close" type="button" onClick={props.onClose}>关闭模板与任务列表</button>{contents}</section></div> : null}
  </>;
}
