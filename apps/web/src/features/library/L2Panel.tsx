import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";

import { apiRead } from "../../shared/api.js";
import { FactReview } from "./FactReview.js";
import { CoverageStrip } from "./ScopePreview.js";
import type { IndexCoverage, IndexGroup } from "./types.js";
import { WritePanel } from "./WritePanel.js";

export function L2Panel() {
  const { bookId = "" } = useParams();
  const groups = useQuery({ queryKey: ["book", bookId, "index-groups"], queryFn: () => apiRead<{ indexGroups: IndexGroup[] }>(`/books/${bookId}/index-groups`) });
  const [groupId, setGroupId] = useState(""); const [startChapter, setStartChapter] = useState(1); const [endChapter, setEndChapter] = useState(1); const [mode, setMode] = useState<"all" | "missing" | "retry_failed">("missing");
  useEffect(() => { if (!groupId && groups.data?.indexGroups[0]) setGroupId(groups.data.indexGroups[0].id); }, [groupId, groups.data]);
  const coverage = useQuery({ queryKey: ["book", bookId, "group", groupId, "coverage"], queryFn: () => apiRead<IndexCoverage>(`/books/${bookId}/index-groups/${groupId}/coverage`), enabled: Boolean(groupId) });
  if (groups.isPending) return <p className="empty-state">正在读取索引组...</p>;
  if (!groups.data?.indexGroups.length) return <div className="workspace-section"><p className="empty-state">尚未配置可用的 L2 索引组</p></div>;
  const scope = { startChapter, endChapter, mode, force: false };
  return <div className="workspace-section l2-layout"><div className="l2-controls"><label>索引组<select value={groupId} onChange={(event) => setGroupId(event.target.value)}>{groups.data.indexGroups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>{coverage.data ? <CoverageStrip value={coverage.data} /> : null}
    <WritePanel key={`${groupId}-${startChapter}-${endChapter}-${mode}`} title="建立 L2 索引" description="选择章节与执行模式，预览真实影响范围" previewPath={`/books/${bookId}/index-groups/${groupId}/l2-preview`} submitPath={`/books/${bookId}/index-groups/${groupId}/l2-jobs`} previewBody={scope}>
      <div className="scope-controls"><label>起始章节<input type="number" min="1" value={startChapter} onChange={(event) => setStartChapter(Number(event.target.value))} /></label><label>结束章节<input type="number" min="1" value={endChapter} onChange={(event) => setEndChapter(Number(event.target.value))} /></label><label>执行模式<select value={mode} onChange={(event) => setMode(event.target.value as typeof mode)}><option value="missing">仅缺失</option><option value="retry_failed">重试失败</option><option value="all">全部</option></select></label></div>
    </WritePanel></div><FactReview key={groupId} bookId={bookId} groupId={groupId} /></div>;
}
