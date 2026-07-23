import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, Plus } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { apiRead, apiWrite } from "../../shared/api.js";
import type { BookSummary } from "./types.js";
import { useCurrentUser } from "../auth/useCurrentUser.js";
import { RebuildQueuePanel } from "./RebuildQueuePanel.js";

export function LibraryPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const currentUser = useCurrentUser();
  const books = useQuery({ queryKey: ["books"], queryFn: () => apiRead<{ books: BookSummary[] }>("/books") });
  const createBook = useMutation({
    mutationFn: (form: FormData) => apiWrite<{ book: BookSummary }>("/books", {
      method: "POST",
      body: JSON.stringify({
        title: String(form.get("title")),
        source: { provider: "dify", sourceId: String(form.get("sourceId")), startChapter: Number(form.get("startChapter")), endChapter: Number(form.get("endChapter")) },
      }),
    }),
    onSuccess: ({ book }) => { void queryClient.invalidateQueries({ queryKey: ["books"] }); navigate(`/books/${book.id}/overview`); },
  });

  return <section className="library-page">
    <div className="page-header">
      <div><p className="eyebrow">共享知识资产</p><h1>书库</h1></div>
      <button className="primary-button icon-command" type="button" onClick={() => setCreating((value) => !value)}><Plus size={17} />新建书籍</button>
    </div>
    {creating ? <form className="book-create-form" onSubmit={(event) => { event.preventDefault(); createBook.mutate(new FormData(event.currentTarget)); }}>
      <label>书名<input name="title" required maxLength={500} /></label>
      <label>Dify 数据源 ID<input name="sourceId" required inputMode="numeric" pattern="[1-9][0-9]*" /></label>
      <label>起始章节<input name="startChapter" required type="number" min="1" defaultValue="1" /></label>
      <label>结束章节<input name="endChapter" required type="number" min="1" defaultValue="1" /></label>
      <div className="button-row"><button className="primary-button" disabled={createBook.isPending}>创建并进入</button><button className="secondary-button" type="button" onClick={() => setCreating(false)}>取消</button></div>
      {createBook.isError ? <p className="form-error">创建失败，请检查数据源与章节范围</p> : null}
    </form> : null}
    {currentUser.data?.role === "admin" ? <RebuildQueuePanel /> : null}
    {books.isPending ? <p className="empty-state">正在读取书库...</p> : null}
    {books.isError ? <p className="error-notice">书库读取失败</p> : null}
    {books.data?.books.length === 0 ? <p className="empty-state">书库暂无书籍</p> : null}
    <div className="book-list">{books.data?.books.map((book) => <Link className="book-row" to={`/books/${book.id}/overview`} key={book.id}>
      <BookOpen size={19} /><span><strong>{book.title}</strong><small>{book.chapterCount} 章 · {book.status === "active" ? "使用中" : "已归档"}</small></span><span className="row-action">进入工作区</span>
    </Link>)}</div>
  </section>;
}
