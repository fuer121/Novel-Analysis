import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { apiRead } from "../../shared/api.js";
import type { IndexCoverage } from "./types.js";
import { CoverageStrip } from "./ScopePreview.js";

export function BookOverview() {
  const { bookId } = useParams();
  const coverage = useQuery({ queryKey: ["book", bookId, "l1-coverage"], queryFn: () => apiRead<IndexCoverage>(`/books/${bookId}/l1-coverage`) });
  return <div className="workspace-section"><div className="section-title"><div><h2>索引概况</h2><p>查看当前章节与 L1 索引健康度</p></div></div>{coverage.isPending ? <p className="empty-state">正在读取覆盖情况...</p> : null}{coverage.isError ? <div className="error-notice">覆盖情况读取失败 <button className="text-button" type="button" onClick={() => void coverage.refetch()}>重试覆盖情况</button></div> : null}{coverage.data ? <CoverageStrip value={coverage.data} /> : null}</div>;
}
