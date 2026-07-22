import type { AnalysisMode, AnalysisScopePreview, AnalysisTemplateCreateInput, AnalysisTemplateDetail } from "@novel-analysis/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { List, Plus } from "lucide-react";
import { useCallback, useRef, useState, type FormEvent } from "react";
import { useOutletContext, useSearchParams } from "react-router-dom";

import { ApiError, apiRead } from "../../shared/api.js";
import type { BookSummary, IndexGroup } from "../library/types.js";
import {
  analysisKeys,
  controlAnalysisRun,
  createAnalysisRun,
  createAnalysisTemplate,
  deleteAnalysisRun,
  listAnalysisRuns,
  listAnalysisTemplates,
  modeDescriptions,
  modeLabels,
  previewAnalysis,
  readAnalysisRun,
  readAnalysisTemplate,
  updateAnalysisTemplate,
} from "./analysis-api.js";
import { AnalysisRunPanel } from "./AnalysisRunPanel.js";
import { AnalysisTemplatePanel } from "./AnalysisTemplatePanel.js";
import { LegacyAnalysisPanel } from "./LegacyAnalysisPanel.js";

type TemplateValue = Omit<AnalysisTemplateCreateInput, "bookId">;
type EditorProps = { bookId: string; groups: IndexGroup[]; template?: AnalysisTemplateDetail; pending: boolean; error: string | null; onCancel: () => void; onSave: (value: TemplateValue) => void };

function TemplateEditor({ bookId, groups, template, pending, error, onCancel, onSave }: EditorProps) {
  const [validation, setValidation] = useState<string | null>(null);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    let outputSchema: AnalysisTemplateCreateInput["outputSchema"];
    try { outputSchema = JSON.parse(String(form.get("outputSchema"))); } catch { setValidation("输出结构必须是有效 JSON"); return; }
    setValidation(null);
    onSave({ name: String(form.get("name")), prompt: String(form.get("prompt")), outputSchema, indexGroupId: String(form.get("indexGroupId") || "") || null });
  };
  return <form className="analysis-editor" onSubmit={submit}>
    <div className="analysis-section-heading"><div><p className="eyebrow">{template ? "私有模板" : "新模板"}</p><h2>{template ? "编辑分析模板" : "新建分析模板"}</h2></div><span>{bookId.slice(0, 8)}</span></div>
    <label>模板名称<input name="name" required defaultValue={template?.name ?? ""} /></label>
    <label>分析提示词<textarea name="prompt" required rows={6} defaultValue={template?.prompt ?? ""} /></label>
    <label>输出结构 JSON<textarea name="outputSchema" required rows={8} defaultValue={JSON.stringify(template?.outputSchema ?? { type: "object" }, null, 2)} /></label>
    <label>索引组<select name="indexGroupId" defaultValue={template?.indexGroupId ?? ""}><option value="">不绑定索引组</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
    {validation || error ? <p className="error-notice">{validation ?? error}</p> : null}
    <div className="button-row"><button className="primary-button" disabled={pending}>{template ? "更新模板" : "保存模板"}</button><button className="secondary-button" type="button" onClick={onCancel}>取消</button></div>
  </form>;
}

function sourceBoundary(preview: AnalysisScopePreview): string {
  if (!preview.readsOriginalChapters) return "仅读取 L1、L2 索引";
  if (preview.mode === "full_text") return "读取所选章节全文";
  return "读取 L1、L2 与少量原文";
}

function RunCreator({ book, template, groups, onCreated }: { book: BookSummary; template: AnalysisTemplateDetail; groups: IndexGroup[]; onCreated: (runId: string) => void }) {
  const client = useQueryClient();
  const [mode, setMode] = useState<AnalysisMode>("balanced");
  const [startChapter, setStartChapter] = useState(1);
  const [endChapter, setEndChapter] = useState(Math.min(Math.max(1, book.chapterCount), 20));
  const [message, setMessage] = useState<string | null>(null);
  const attemptKey = ["analysis", book.id, "create-attempt", template.id] as const;
  const validRange = Number.isInteger(startChapter) && Number.isInteger(endChapter) && startChapter >= 1 && endChapter <= book.chapterCount && startChapter <= endChapter;
  const preview = useMutation({ mutationFn: () => previewAnalysis(book.id, { bookId: book.id, templateId: template.id, mode, startChapter, endChapter }), onSuccess: (value) => { const fingerprint = JSON.stringify(value); const current = client.getQueryData<{ fingerprint: string; key: string }>(attemptKey); if (current?.fingerprint !== fingerprint) client.setQueryData(attemptKey, { fingerprint, key: crypto.randomUUID() }); setMessage(null); }, onError: (error) => setMessage(error instanceof ApiError && error.status === 404 ? "模板或范围不存在" : "范围预览失败，请重试") });
  const create = useMutation({
    mutationFn: (scope: AnalysisScopePreview) => {
      const fingerprint = JSON.stringify(scope);
      let attempt = client.getQueryData<{ fingerprint: string; key: string }>(attemptKey);
      if (attempt?.fingerprint !== fingerprint) { attempt = { fingerprint, key: crypto.randomUUID() }; client.setQueryData(attemptKey, attempt); }
      return createAnalysisRun(book.id, { bookId: book.id, templateId: template.id, templateVersionId: scope.templateVersionId, mode: scope.mode, startChapter: scope.startChapter, endChapter: scope.endChapter, scopeHash: scope.scopeHash, idempotencyKey: attempt.key });
    },
    onSuccess: async ({ run }) => { client.removeQueries({ queryKey: attemptKey, exact: true }); setMessage(null); await client.invalidateQueries({ queryKey: analysisKeys.runs(book.id) }); onCreated(run.id); },
    onError: (error) => {
      if (error instanceof ApiError && error.code === "scope_changed") { preview.reset(); client.removeQueries({ queryKey: attemptKey, exact: true }); setMessage("范围已变化，请重新预览"); return; }
      setMessage(error instanceof ApiError && error.code === "idempotency_conflict" ? "创建请求与先前内容冲突，请重新预览" : "提交结果未确认，请使用同一范围重试");
    },
  });
  const invalidatePreview = () => { preview.reset(); setMessage(null); };
  const selectedGroup = groups.find((group) => group.id === (preview.data?.sourceSummary.indexGroupId ?? template.indexGroupId));
  return <section className="analysis-creator" aria-label="创建分析任务">
    <div className="analysis-section-heading"><div><p className="eyebrow">新任务</p><h2>创建分析任务</h2></div><span>模板版本 {template.currentVersionId.slice(0, 8)}</span></div>
    <div className="analysis-scope-controls"><label>分析模式<select aria-label="分析模式" value={mode} onChange={(event) => { setMode(event.target.value as AnalysisMode); invalidatePreview(); }}>{Object.entries(modeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><span className="analysis-mode-description">{modeDescriptions[mode]}</span></label><label>起始章节<input type="number" min="1" max={Math.max(1, book.chapterCount)} value={startChapter} onChange={(event) => { setStartChapter(Number(event.target.value)); invalidatePreview(); }} /></label><label>结束章节<input type="number" min="1" max={Math.max(1, book.chapterCount)} value={endChapter} onChange={(event) => { setEndChapter(Number(event.target.value)); invalidatePreview(); }} /></label></div>
    {!validRange ? <p className="error-notice">请输入书籍范围内的有效章节区间</p> : null}
    <div className="button-row"><button className="secondary-button" type="button" disabled={preview.isPending || !validRange} onClick={() => preview.mutate()}>预览分析范围</button>{preview.data ? <button className="primary-button" type="button" disabled={create.isPending} onClick={() => create.mutate(preview.data)}>确认创建任务</button> : null}</div>
    {message ? <p className={message.includes("未确认") ? "warning-notice" : "error-notice"}>{message}</p> : null}
    {preview.data ? <section className="analysis-preview" role="region" aria-label="执行范围预览"><div><span>书籍</span><strong>{book.title}</strong></div><div><span>模板版本</span><strong>版本 {preview.data.templateVersionId.slice(0, 8)}</strong></div><div><span>模式</span><strong>{modeLabels[preview.data.mode]}</strong></div><div><span>章节范围</span><strong>{preview.data.startChapter}-{preview.data.endChapter} 章</strong></div><div><span>索引组</span><strong>{selectedGroup?.name ?? "未绑定"}</strong></div><div><span>来源边界</span><strong>{sourceBoundary(preview.data)}</strong></div><div><span>预计复核</span><strong>{preview.data.reviewChapterCount ? `最多复核 ${preview.data.reviewChapterCount} 章（范围 ${preview.data.sourceSummary.reviewedChapterBoundary?.startChapter ?? preview.data.startChapter}-${preview.data.sourceSummary.reviewedChapterBoundary?.endChapter ?? preview.data.endChapter} 章）` : "不读取原文"}</strong></div><p>创建后将锁定模板、章节、索引与执行版本，形成不可变快照</p></section> : null}
  </section>;
}

export function AdvancedAnalysisPage() {
  const { book } = useOutletContext<{ book: BookSummary }>();
  const client = useQueryClient();
  const [params, setParams] = useSearchParams();
  const view = params.get("view") === "legacy" ? "legacy" : "new";
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editor, setEditor] = useState<"create" | "edit" | null>(null);
  const [creatorOpen, setCreatorOpen] = useState(false);
  const drawerTrigger = useRef<HTMLButtonElement>(null);
  const templates = useQuery({ queryKey: analysisKeys.templates(book.id), queryFn: () => listAnalysisTemplates(book.id), staleTime: 60_000, enabled: view === "new" });
  const runs = useQuery({ queryKey: analysisKeys.runs(book.id), queryFn: () => listAnalysisRuns(book.id), staleTime: 60_000, enabled: view === "new" });
  const groups = useQuery({ queryKey: ["book", book.id, "index-groups"], queryFn: () => apiRead<{ indexGroups: IndexGroup[] }>(`/books/${book.id}/index-groups`), staleTime: 60_000, enabled: view === "new" });
  const selectedTemplateId = params.get("template") ?? templates.data?.templates[0]?.id ?? null;
  const selectedRunId = params.get("run") ?? runs.data?.runs[0]?.id ?? null;
  const template = useQuery({ queryKey: analysisKeys.template(book.id, selectedTemplateId ?? "none"), queryFn: () => readAnalysisTemplate(book.id, selectedTemplateId!), enabled: view === "new" && Boolean(selectedTemplateId) });
  const run = useQuery({ queryKey: analysisKeys.run(book.id, selectedRunId ?? "none"), queryFn: () => readAnalysisRun(book.id, selectedRunId!), enabled: view === "new" && Boolean(selectedRunId), refetchInterval: (query) => query.state.data && ["queued", "running", "retrying"].includes(query.state.data.run.status) ? 3_000 : false });
  const setParam = (key: string, value: string | null) => { const next = new URLSearchParams(params); if (value) next.set(key, value); else next.delete(key); setParams(next, { replace: true }); };
  const closeDrawer = useCallback(() => { setDrawerOpen(false); drawerTrigger.current?.focus(); }, []);

  const createTemplate = useMutation({ mutationFn: (value: TemplateValue) => createAnalysisTemplate(book.id, { bookId: book.id, ...value }), onSuccess: async ({ template: created }) => { await client.invalidateQueries({ queryKey: analysisKeys.templates(book.id) }); setParam("template", created.id); setEditor(null); } });
  const updateTemplate = useMutation({ mutationFn: (value: TemplateValue) => updateAnalysisTemplate(book.id, selectedTemplateId!, value), onSuccess: async () => { await client.invalidateQueries({ queryKey: ["analysis", book.id, "template"] }); await client.invalidateQueries({ queryKey: analysisKeys.templates(book.id) }); setEditor(null); } });
  const control = useMutation({ mutationFn: (action: "pause" | "resume" | "cancel") => controlAnalysisRun(run.data!.run.jobId, action), onSuccess: async () => { await Promise.all([client.invalidateQueries({ queryKey: analysisKeys.run(book.id, selectedRunId!) }), client.invalidateQueries({ queryKey: analysisKeys.runs(book.id) })]); } });
  const remove = useMutation({ mutationFn: () => deleteAnalysisRun(book.id, selectedRunId!), onSuccess: async () => { const removedId = selectedRunId!; client.setQueryData<Awaited<ReturnType<typeof listAnalysisRuns>>>(analysisKeys.runs(book.id), (current) => current ? { runs: current.runs.filter((item) => item.id !== removedId) } : current); client.removeQueries({ queryKey: analysisKeys.run(book.id, removedId) }); setParam("run", null); await client.invalidateQueries({ queryKey: analysisKeys.runs(book.id) }); } });

  const loading = view === "new" && (templates.isPending || runs.isPending || groups.isPending);
  const listError = view === "new" && (templates.isError || runs.isError || groups.isError);
  return <section className="workspace-section advanced-analysis-page">
    <div className="section-title analysis-page-title"><div><h2>高级分析</h2><p>私有模板、可恢复任务与旧系统只读历史</p></div>{view === "new" ? <button className="primary-button icon-command" type="button" disabled={!selectedTemplateId} onClick={() => setCreatorOpen(true)}><Plus size={16} />创建分析任务</button> : null}</div>
    <div className="analysis-toolbar"><div className="analysis-segments" role="tablist" aria-label="分析视图"><button type="button" role="tab" aria-selected={view === "new"} onClick={() => { setParam("view", null); setDrawerOpen(false); }}>新任务</button><button type="button" role="tab" aria-selected={view === "legacy"} onClick={() => { setParam("view", "legacy"); setDrawerOpen(false); }}>旧历史</button></div><button ref={drawerTrigger} className="secondary-button analysis-list-trigger icon-command" type="button" onClick={() => setDrawerOpen(true)}><List size={16} />{view === "new" ? "模板与任务" : "旧历史列表"}</button></div>
    {view === "legacy" ? <LegacyAnalysisPanel bookId={book.id} selectedId={params.get("legacy")} onSelect={(id) => setParam("legacy", id)} drawerOpen={drawerOpen} onClose={closeDrawer} /> : loading ? <p className="empty-state">正在读取模板与任务...</p> : listError ? <div className="error-notice">分析工作区读取失败 <button className="text-button" type="button" onClick={() => { void templates.refetch(); void runs.refetch(); void groups.refetch(); }}>重试工作区</button></div> : <div className="analysis-layout">
      <AnalysisTemplatePanel templates={templates.data?.templates ?? []} runs={runs.data?.runs ?? []} selectedTemplateId={selectedTemplateId} selectedRunId={selectedRunId} onSelectTemplate={(id) => setParam("template", id)} onSelectRun={(id) => setParam("run", id)} onCreateTemplate={() => setEditor("create")} onEditTemplate={() => setEditor("edit")} drawerOpen={drawerOpen} onClose={closeDrawer} />
      <main className="analysis-main">
        {editor === "create" ? <TemplateEditor key="create" bookId={book.id} groups={groups.data?.indexGroups ?? []} pending={createTemplate.isPending} error={createTemplate.isError ? "模板创建失败，请重试" : null} onCancel={() => setEditor(null)} onSave={(value) => createTemplate.mutate(value)} /> : editor === "edit" ? template.isPending ? <p className="empty-state">正在读取模板...</p> : template.isError || !template.data ? <div className="error-notice">模板不存在或读取失败 <button className="text-button" type="button" onClick={() => void template.refetch()}>重试模板</button></div> : <TemplateEditor key={template.data.template.currentVersionId} bookId={book.id} groups={groups.data?.indexGroups ?? []} template={template.data.template} pending={updateTemplate.isPending} error={updateTemplate.isError ? "模板更新失败，请重试" : null} onCancel={() => setEditor(null)} onSave={(value) => updateTemplate.mutate(value)} /> : null}
        {creatorOpen ? template.isPending ? <p className="empty-state">正在读取模板版本...</p> : template.isError || !template.data ? <div className="error-notice">模板不存在或无权访问 <button className="text-button" type="button" onClick={() => void template.refetch()}>重试模板</button></div> : <><RunCreator key={template.data.template.currentVersionId} book={book} template={template.data.template} groups={groups.data?.indexGroups ?? []} onCreated={(id) => { setCreatorOpen(false); setParam("run", id); }} /><button className="text-button analysis-close-creator" type="button" onClick={() => setCreatorOpen(false)}>收起创建区域</button></> : null}
        {!selectedRunId ? <p className="empty-state">选择模板创建任务，或从左侧打开已有任务</p> : run.isPending ? <p className="empty-state">正在读取任务进度...</p> : run.isError ? <div className="error-notice">{run.error instanceof ApiError && run.error.status === 404 ? "任务不存在或无权访问" : "任务读取失败，服务可能暂时不可用"} <button className="text-button" type="button" onClick={() => void run.refetch()}>重试读取任务</button></div> : run.data ? <><AnalysisRunPanel run={run.data.run} pending={control.isPending || remove.isPending} onControl={(action) => control.mutate(action)} onDelete={() => remove.mutate()} />{control.isError ? <p className="error-notice">操作未完成，任务状态可能已变化，请刷新后重试</p> : null}{remove.isError ? <p className="error-notice">删除失败，任务状态可能已变化</p> : null}</> : null}
      </main>
    </div>}
  </section>;
}
