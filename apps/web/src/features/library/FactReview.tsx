import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";

import { apiRead } from "../../shared/api.js";
import type { FactReviewPage } from "./types.js";

export function FactReview({ bookId, groupId }: { bookId: string; groupId: string }) {
  const [cursors, setCursors] = useState<Array<string | undefined>>([undefined]);
  const cursor = cursors.at(-1);
  const facts = useQuery({ queryKey: ["book", bookId, "group", groupId, "facts", cursor ?? "first"], queryFn: () => apiRead<FactReviewPage>(`/books/${bookId}/index-groups/${groupId}/facts?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`) });
  return <section className="fact-review"><div className="section-title"><div><h2>事实审阅</h2><p>按索引组逐页检查已提取事实</p></div></div>
    {facts.isPending ? <p className="empty-state">正在读取事实...</p> : null}{facts.isError ? <p className="error-notice">事实读取失败</p> : null}{facts.data?.facts.length === 0 ? <p className="empty-state">当前索引组暂无事实</p> : null}
    {facts.data?.facts.length ? <div className="data-table-wrap fact-table-wrap"><table className="data-table fact-table"><thead><tr><th>章节</th><th>主体</th><th>类型</th><th>事实内容</th><th>分类</th></tr></thead><tbody>{facts.data.facts.map((fact) => <tr key={fact.id}><td>第 {fact.chapterIndex} 章</td><td>{fact.subjectKey}</td><td>{fact.factType}</td><td className="fact-body">{fact.body}</td><td>{fact.metadata.category ?? "未分类"}</td></tr>)}</tbody></table></div> : null}
    <div className="pagination"><button className="secondary-button icon-command" disabled={cursors.length === 1} onClick={() => setCursors((value) => value.slice(0, -1))}><ChevronLeft size={16} />上一页</button><span>第 {cursors.length} 页</span><button className="secondary-button icon-command" disabled={!facts.data?.nextCursor} onClick={() => setCursors((value) => [...value, facts.data!.nextCursor!])}>下一页<ChevronRight size={16} /></button></div>
  </section>;
}
