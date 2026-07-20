import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { apiRead } from "../../shared/api.js";
import type { IndexCoverage } from "./types.js";
import { CoverageStrip } from "./ScopePreview.js";
import { WritePanel } from "./WritePanel.js";

export function L1Panel() { const { bookId } = useParams(); const coverage = useQuery({ queryKey: ["book", bookId, "l1-coverage"], queryFn: () => apiRead<IndexCoverage>(`/books/${bookId}/l1-coverage`) }); return <div className="workspace-section">{coverage.data ? <CoverageStrip value={coverage.data} /> : null}<WritePanel title="建立 L1 索引" description="只处理缺失、失败或已过期章节" previewPath={`/books/${bookId}/l1-preview`} submitPath={`/books/${bookId}/l1-jobs`} previewBody={{}} /></div>; }
