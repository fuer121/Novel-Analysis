import { useQuery } from "@tanstack/react-query";
import { NavLink, Navigate, Outlet, useParams } from "react-router-dom";

import { apiRead } from "../../shared/api.js";
import type { BookAnalysisReadiness, BookSummary } from "./types.js";

export function BookWorkspacePage() {
  const { bookId } = useParams();
  const book = useQuery({ queryKey: ["book", bookId], queryFn: () => apiRead<{ book: BookSummary }>(`/books/${bookId}`), enabled: Boolean(bookId) });
  const readiness = useQuery({ queryKey: ["analysis-readiness", bookId], queryFn: () => apiRead<BookAnalysisReadiness>(`/books/${bookId}/analysis-readiness`), enabled: Boolean(bookId) });
  const analysisLocked = readiness.data?.analysisAvailable !== true;
  const analysisProgress = readiness.data?.progressPercent ?? 0;
  if (!bookId) return <Navigate to="/books" replace />;
  if (book.isPending) return <p className="empty-state">正在打开书籍...</p>;
  if (!book.data) return <p className="error-notice">书籍不存在或无法访问</p>;
  return <section className="book-workspace">
    <div className="workspace-heading"><div><p className="eyebrow">书籍工作区</p><h1>{book.data.book.title}</h1></div><span>{book.data.book.chapterCount} 章</span></div>
    <nav className="workspace-tabs" aria-label="书籍工作区">
      <NavLink to="overview">概览</NavLink><NavLink to="import">导入</NavLink><NavLink to="l1">L1 索引</NavLink><NavLink to="l2">L2 索引与事实</NavLink>
      <NavLink to="query" aria-disabled={analysisLocked || undefined} onClick={(event) => { if (analysisLocked) event.preventDefault(); }}>连续提问</NavLink>
      <NavLink to="analysis" aria-disabled={analysisLocked || undefined} onClick={(event) => { if (analysisLocked) event.preventDefault(); }}>高级分析</NavLink>
    </nav>
    <div className="analysis-readiness" aria-live="polite">
      {analysisLocked ? <>
        <span>索引重建中</span>
        <progress aria-label="索引重建进度" value={analysisProgress} max={100} />
        <span className="progress-value">{analysisProgress}%</span>
      </> : null}
    </div>
    <Outlet context={{ book: book.data.book }} />
  </section>;
}
