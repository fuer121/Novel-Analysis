import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";

import type { JobResponse, PublicJob } from "@novel-analysis/contracts";
import { apiRead, apiWrite } from "../../shared/api.js";
import { useCurrentUser } from "../auth/useCurrentUser.js";
import { formatTime, percent, statusLabel, typeLabel } from "./TaskCenterPage.js";

type Control = "pause" | "resume" | "cancel";

function availableControls(job: PublicJob): Control[] {
  if (job.status === "paused") return ["resume", "cancel"];
  if (["queued", "running", "retrying"].includes(job.status)) return ["pause", "cancel"];
  return [];
}

const controlLabel: Record<Control, string> = {
  pause: "暂停",
  resume: "继续",
  cancel: "取消",
};

export function TaskDetailPage() {
  const { id = "" } = useParams();
  const queryClient = useQueryClient();
  const currentUser = useCurrentUser();
  const detail = useQuery({
    queryKey: ["job", id],
    queryFn: () => apiRead<JobResponse>(`/jobs/${id}`),
    enabled: Boolean(id),
  });
  const control = useMutation({
    mutationFn: (action: Control) => apiWrite<JobResponse>(`/jobs/${id}/${action}`, { method: "POST" }),
    onSuccess: (result) => {
      queryClient.setQueryData(["job", id], result);
      void queryClient.invalidateQueries({ queryKey: ["jobs"] });
    },
  });

  if (detail.isPending) return <p className="empty-state">正在读取任务...</p>;
  if (!detail.data) return <p className="error-notice">任务不存在或读取失败</p>;
  const job = detail.data.job;
  const canControl = currentUser.data?.role === "admin" || currentUser.data?.id === job.requestedBy;

  return (
    <section>
      <div className="page-header detail-header">
        <div>
          <Link className="back-link" to="/tasks">返回任务中心</Link>
          <h1>{typeLabel[job.type]}任务</h1>
          <p className="task-id">{job.id}</p>
        </div>
        {canControl ? (
          <div className="button-row">
            {availableControls(job).map((action) => (
              <button
                className={action === "cancel" ? "danger-button" : "secondary-button"}
                type="button"
                key={action}
                disabled={control.isPending}
                onClick={() => control.mutate(action)}
              >{controlLabel[action]}</button>
            ))}
          </div>
        ) : null}
      </div>
      {control.isError ? <p className="error-notice">操作未完成，任务状态可能已变化</p> : null}
      <dl className="detail-grid">
        <div><dt>状态</dt><dd><span className={`status status-${job.status}`}>{statusLabel[job.status]}</span></dd></div>
        <div><dt>创建人</dt><dd>{job.requestedBy}</dd></div>
        <div><dt>进度</dt><dd>{percent(job)}% ({job.progress.completed}/{job.progress.total})</dd></div>
        <div><dt>当前步骤</dt><dd>{job.progress.current || "等待调度"}</dd></div>
        <div><dt>创建时间</dt><dd>{formatTime(job.createdAt)}</dd></div>
        <div><dt>更新时间</dt><dd>{formatTime(job.updatedAt)}</dd></div>
        <div><dt>失败摘要</dt><dd>{job.progress.failed > 0 ? `${job.progress.failed} 项失败` : "无"}</dd></div>
      </dl>
    </section>
  );
}
