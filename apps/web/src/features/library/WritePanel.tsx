import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Eye, Play } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

import type { PublicJob } from "@novel-analysis/contracts";
import { ApiError, apiWrite } from "../../shared/api.js";
import type { ActionPreview, ImportScopePreview, ScopePreview } from "./types.js";
import { ImportPreviewStrip, PreviewStrip } from "./ScopePreview.js";

export function WritePanel(props: { title: string; description: string; previewPath: string; submitPath: string; previewBody: object; submitBody?: object; previewKind?: "index" | "import"; children?: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [preview, setPreview] = useState<ActionPreview | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const [scopeChanged, setScopeChanged] = useState(false);
  const previewMutation = useMutation({ mutationFn: () => apiWrite<ActionPreview>(props.previewPath, { method: "POST", body: JSON.stringify(props.previewBody) }), onSuccess: (value) => { setPreview(value); setIdempotencyKey(crypto.randomUUID()); setScopeChanged(false); submit.reset(); } });
  const submit = useMutation({
    mutationFn: () => apiWrite<{ job: PublicJob }>(props.submitPath, { method: "POST", body: JSON.stringify({ ...props.submitBody, ...props.previewBody, scopeHash: preview!.scopeHash }) }, idempotencyKey!),
    onSuccess: () => { setPreview(null); setIdempotencyKey(null); void queryClient.invalidateQueries({ queryKey: ["jobs"] }); },
    onError: (error) => { if (error instanceof ApiError && error.code === "scope_changed") { setPreview(null); setIdempotencyKey(null); setScopeChanged(true); } },
  });
  return <div className="operation-panel"><div className="section-title"><div><h2>{props.title}</h2><p>{props.description}</p></div></div>{props.children}
    <div className="button-row"><button className="secondary-button icon-command" onClick={() => previewMutation.mutate()} disabled={previewMutation.isPending}><Eye size={16} />{previewMutation.isPending ? "正在预览" : "预览范围"}</button>{preview ? <button className="primary-button icon-command" onClick={() => submit.mutate()} disabled={submit.isPending || preview.executable === 0}><Play size={16} />{submit.isPending ? "正在提交" : `确认执行 ${preview.executable} 项`}</button> : null}</div>
    {preview ? <>{props.previewKind === "import" ? <ImportPreviewStrip value={preview as ImportScopePreview} /> : <PreviewStrip value={preview as ScopePreview} />}<p className="confirmation-note"><CheckCircle2 size={15} />预览有效，确认后才会创建任务</p></> : null}
    {scopeChanged ? <p className="warning-notice"><AlertTriangle size={16} />范围已变化，请重新预览并确认</p> : null}
    {submit.data ? <p className="success-notice">任务已创建，<Link to={`/tasks/${submit.data.job.id}`}>查看任务</Link></p> : null}
    {submit.isError && !scopeChanged ? <p className="error-notice">提交结果未确认，请使用同一范围重试</p> : null}
    {previewMutation.isError && !scopeChanged ? <p className="error-notice">范围预览失败</p> : null}
  </div>;
}
