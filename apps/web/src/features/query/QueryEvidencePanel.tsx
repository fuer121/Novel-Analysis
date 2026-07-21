import type { QueryTurnDetail } from "@novel-analysis/contracts";
import { useState } from "react";

export function QueryEvidencePanel({ turn }: { turn: QueryTurnDetail | null }) {
  const [tab, setTab] = useState<"used" | "candidates" | "trace">("used");
  if (!turn) return <p className="query-empty">选择一轮对话后查看证据</p>;
  const evidence = tab === "used" ? turn.evidence.filter((item) => item.disposition === "used") : turn.evidence;
  return <>
    <div className="query-evidence-tabs" role="tablist" aria-label="证据视图">
      <button role="tab" aria-selected={tab === "used"} onClick={() => setTab("used")}>采用证据</button>
      <button role="tab" aria-selected={tab === "candidates"} onClick={() => setTab("candidates")}>候选召回</button>
      <button role="tab" aria-selected={tab === "trace"} onClick={() => setTab("trace")}>执行 Trace</button>
    </div>
    {tab !== "trace" ? <div className="query-evidence-list">{evidence.map((item) => <article key={item.factId}>
      <div><span>第 {item.chapterIndex} 章</span><span>排序 {item.rank}</span><span>{item.disposition === "used" ? "已采用" : "已排除"}</span></div>
      <p>{item.body}</p><small>{item.recallReason}{item.exclusionReason ? ` · ${item.exclusionReason}` : ""}</small>
    </article>)}{evidence.length === 0 ? <p className="query-empty">暂无证据</p> : null}</div> : <dl className="query-trace">
      <div><dt>查询类型</dt><dd>{turn.trace.kind ?? "待解析"}</dd></div>
      <div><dt>目标</dt><dd>{turn.trace.target ?? "无"}</dd></div>
      <div><dt>候选 / 采用 / 排除</dt><dd>{turn.trace.sourceCounts.candidates} / {turn.trace.sourceCounts.used} / {turn.trace.sourceCounts.excluded}</dd></div>
      <div><dt>召回策略</dt><dd>{turn.trace.recallPolicyVersion ?? "待执行"}</dd></div>
      <div><dt>汇总工作流</dt><dd>{turn.trace.summaryWorkflowVersion ?? "待执行"}</dd></div>
      <div><dt>关键词</dt><dd>{turn.trace.keywords.join("、") || "无"}</dd></div>
    </dl>}
  </>;
}
