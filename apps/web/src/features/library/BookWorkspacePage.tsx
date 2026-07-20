import { useQuery } from "@tanstack/react-query";
import { NavLink, Navigate, Outlet, useParams } from "react-router-dom";

import { apiRead } from "../../shared/api.js";
import type { BookSummary } from "./types.js";

export function BookWorkspacePage() {
  const { bookId } = useParams();
  const book = useQuery({ queryKey: ["book", bookId], queryFn: () => apiRead<{ book: BookSummary }>(`/books/${bookId}`), enabled: Boolean(bookId) });
  if (!bookId) return <Navigate to="/books" replace />;
  if (book.isPending) return <p className="empty-state">正在打开书籍...</p>;
  if (!book.data) return <p className="error-notice">书籍不存在或无法访问</p>;
  return <section className="book-workspace">
    <div className="workspace-heading"><div><p className="eyebrow">书籍工作区</p><h1>{book.data.book.title}</h1></div><span>{book.data.book.chapterCount} 章</span></div>
    <nav className="workspace-tabs" aria-label="书籍工作区">
      <NavLink to="overview">概览</NavLink><NavLink to="import">导入</NavLink><NavLink to="l1">L1 索引</NavLink><NavLink to="l2">L2 索引与事实</NavLink>
    </nav>
    <Outlet context={{ book: book.data.book }} />
  </section>;
}
