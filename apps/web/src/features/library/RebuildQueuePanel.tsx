import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, RefreshCw } from "lucide-react";

import { apiRead, apiWrite } from "../../shared/api.js";

type RebuildStage = "waiting" | "l1" | "l2" | "verify";
type RebuildStep = {
  id: string;
  position: number;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  attemptCount: number;
  bookTitle: string;
  ref: { bookId: string; stage: RebuildStage };
  failureCode: string | null;
};
type RebuildDetail = {
  job: {
    id: string;
    status: string;
    progress: { total: number; completed: number; failed: number; skipped: number };
  };
  steps: RebuildStep[];
};

const key = ["library-rebuild", "current"] as const;
const stageLabel: Record<RebuildStage, string> = {
  waiting: "等待中",
  l1: "L1 构建中",
  l2: "L2 构建中",
  verify: "校验中",
};

export function RebuildQueuePanel() {
  const client = useQueryClient();
  const current = useQuery({
    queryKey: key,
    queryFn: () => apiRead<{ detail: RebuildDetail | null }>("/admin/library-rebuilds/current"),
    refetchInterval: (query) => {
      const detail = (query.state.data as { detail?: RebuildDetail } | undefined)?.detail;
      return detail && ["queued", "running", "retrying"].includes(detail.job.status) ? 2_000 : false;
    },
  });
  const create = useMutation({
    mutationFn: () => apiWrite<{ detail: RebuildDetail }>("/admin/library-rebuilds", {
      method: "POST",
      body: "{}",
    }),
    onSuccess: (result) => client.setQueryData(key, result),
  });
  const reorder = useMutation({
    mutationFn: ({ jobId, orderedStepIds }: { jobId: string; orderedStepIds: string[] }) =>
      apiWrite<{ detail: RebuildDetail }>(`/admin/library-rebuilds/${jobId}/order`, {
        method: "PUT",
        body: JSON.stringify({ orderedStepIds }),
      }),
    onSuccess: (result) => client.setQueryData(key, result),
  });
  const detail = current.data?.detail ?? null;
  const canCreate = !detail
    || ["completed", "failed", "cancelled"].includes(detail.job.status);

  function move(index: number, offset: -1 | 1): void {
    if (!detail) return;
    const target = index + offset;
    if (target < 0 || target >= detail.steps.length) return;
    const currentStep = detail.steps[index]!;
    const targetStep = detail.steps[target]!;
    const untouched = (step: RebuildStep) =>
      step.status === "queued" && step.attemptCount === 0 && step.ref.stage === "waiting";
    if (!untouched(currentStep) || !untouched(targetStep)) return;
    const orderedStepIds = detail.steps.map((step) => step.id);
    [orderedStepIds[index], orderedStepIds[target]] = [orderedStepIds[target]!, orderedStepIds[index]!];
    reorder.mutate({ jobId: detail.job.id, orderedStepIds });
  }

  return <section className="rebuild-queue" aria-labelledby="rebuild-queue-title">
    <div className="section-title">
      <div>
        <h2 id="rebuild-queue-title">索引重建队列</h2>
        <p>按书籍持续恢复 L1、L2 与可用性校验</p>
      </div>
      {canCreate && !current.isPending
        ? <button className="secondary-button icon-command" type="button" disabled={create.isPending} onClick={() => create.mutate()}>
            <RefreshCw size={16} />{detail ? "重新发起全库重建" : "开始全库重建"}
          </button>
        : null}
    </div>
    {current.isPending ? <p className="empty-state">正在读取重建队列...</p> : null}
    {current.isError || create.isError || reorder.isError
      ? <p className="error-notice">重建队列操作失败，请刷新后重试</p>
      : null}
    {!current.isPending && !detail ? <p className="empty-state">尚未创建重建队列</p> : null}
    {detail ? <>
      <div className="rebuild-summary">
        <span>已完成</span>
        <strong>{detail.job.progress.completed} / {detail.job.progress.total}</strong>
        {detail.job.progress.failed > 0 ? <span className="status-failed">失败 {detail.job.progress.failed}</span> : null}
      </div>
      <ol className="rebuild-steps" data-testid="rebuild-steps">
        {detail.steps.map((step, index) => {
          const movable = step.status === "queued" && step.attemptCount === 0
            && step.ref.stage === "waiting";
          return <li key={step.id}>
            <span className={`rebuild-stage status-${step.status}`}>{step.failureCode ? "失败" : stageLabel[step.ref.stage]}</span>
            <strong>{step.bookTitle}</strong>
            {step.failureCode ? <small>{step.failureCode}</small> : null}
            <div className="rebuild-order-actions">
              <button type="button" aria-label={`上移 ${step.bookTitle}`} title="上移" disabled={!movable || index === 0 || reorder.isPending} onClick={() => move(index, -1)}><ArrowUp size={16} /></button>
              <button type="button" aria-label={`下移 ${step.bookTitle}`} title="下移" disabled={!movable || index === detail.steps.length - 1 || reorder.isPending} onClick={() => move(index, 1)}><ArrowDown size={16} /></button>
            </div>
          </li>;
        })}
      </ol>
    </> : null}
  </section>;
}
