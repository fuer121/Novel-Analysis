import type { QueryTurnDetail } from "@novel-analysis/contracts";
import { useRef, useState, type KeyboardEvent } from "react";

const tabs = ["used", "candidates", "trace"] as const;
const kindLabels = { "single-target": "单一目标", collection: "集合查询", general: "一般查询" } as const;

export function QueryEvidencePanel({ turn }: { turn: QueryTurnDetail | null }) {
  const [tab, setTab] = useState<"used" | "candidates" | "trace">("used");
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  if (!turn) return <p className="query-empty">选择一轮对话后查看证据</p>;
  const selectByKeyboard = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    const next = (index + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length;
    setTab(tabs[next]!);
    tabRefs.current[next]?.focus();
  };
  const evidencePanel = (value: "used" | "candidates") => {
    const evidence = value === "used" ? turn.evidence.filter((item) => item.disposition === "used") : turn.evidence;
    return <div className="query-evidence-list">{evidence.map((item) => <article key={item.factId}>
      <div><span>第 {item.chapterIndex} 章</span><span>排序 {item.rank}</span><span>{item.disposition === "used" ? "已采用" : "已排除"}</span></div>
      <p>{item.body}</p><small>{item.recallReason}{item.exclusionReason ? ` · ${item.exclusionReason}` : ""}</small>
    </article>)}{evidence.length === 0 ? <p className="query-empty">暂无证据</p> : null}</div>;
  };
  return <>
    <div className="query-evidence-tabs" role="tablist" aria-label="证据视图">
      {tabs.map((value, index) => <button key={value} id={`query-evidence-tab-${value}`} ref={(node) => { tabRefs.current[index] = node; }} role="tab" aria-controls={`query-evidence-panel-${value}`} aria-selected={tab === value} tabIndex={tab === value ? 0 : -1} onKeyDown={(event) => selectByKeyboard(event, index)} onClick={() => setTab(value)}>{value === "used" ? "采用证据" : value === "candidates" ? "候选召回" : "执行 Trace"}</button>)}
    </div>
    <div id="query-evidence-panel-used" role="tabpanel" aria-labelledby="query-evidence-tab-used" tabIndex={0} hidden={tab !== "used"}>{tab === "used" ? evidencePanel("used") : null}</div>
    <div id="query-evidence-panel-candidates" role="tabpanel" aria-labelledby="query-evidence-tab-candidates" tabIndex={0} hidden={tab !== "candidates"}>{tab === "candidates" ? evidencePanel("candidates") : null}</div>
    <div id="query-evidence-panel-trace" role="tabpanel" aria-labelledby="query-evidence-tab-trace" tabIndex={0} hidden={tab !== "trace"}>{tab === "trace" ? <dl className="query-trace">
      <div><dt>查询类型</dt><dd>{turn.trace.kind ? kindLabels[turn.trace.kind] : "待解析"}</dd></div>
      <div><dt>目标</dt><dd>{turn.trace.target ?? "无"}</dd></div>
      <div><dt>别名</dt><dd>{turn.trace.aliases.join("、") || "无"}</dd></div>
      <div><dt>指代</dt><dd>{turn.trace.referents.join("、") || "无"}</dd></div>
      <div><dt>分类</dt><dd>{turn.trace.categories.join("、") || "无"}</dd></div>
      <div><dt>候选 / 采用 / 排除</dt><dd>{turn.trace.sourceCounts.candidates} / {turn.trace.sourceCounts.used} / {turn.trace.sourceCounts.excluded}</dd></div>
      <div><dt>证据缺口</dt><dd>{turn.trace.gapCount}</dd></div>
      <div><dt>召回策略</dt><dd>{turn.trace.recallPolicyVersion ?? "待执行"}</dd></div>
      <div><dt>汇总工作流</dt><dd>{turn.trace.summaryWorkflowVersion ?? "待执行"}</dd></div>
      <div><dt>关键词</dt><dd>{turn.trace.keywords.join("、") || "无"}</dd></div>
    </dl> : null}</div>
  </>;
}
