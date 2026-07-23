import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import type { JobListResponse, PublicJob } from "@novel-analysis/contracts";
import { apiRead, apiWrite } from "../../shared/api.js";
import { useCurrentUser } from "../auth/useCurrentUser.js";

const typeLabel: Record<PublicJob["type"], string> = {
  import: "导入",
  "l1-index": "L1 索引",
  "l2-index": "L2 索引",
  query: "提问",
  "advanced-analysis": "高级分析",
  migration: "迁移",
  "library-rebuild": "书库索引重建",
};

const statusLabel: Record<PublicJob["status"], string> = {
  queued: "排队中",
  running: "运行中",
  retrying: "重试中",
  paused: "已暂停",
  completed: "已完成",
  failed: "失败",
  cancelled: "已取消",
};

function percent(job: PublicJob): number {
  if (job.progress.total === 0) return 0;
  return Math.round(
    ((job.progress.completed + job.progress.failed + job.progress.skipped) / job.progress.total) * 100,
  );
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function TaskCenterPage() {
  const queryClient = useQueryClient();
  const currentUser = useCurrentUser();
  const tasks = useQuery({
    queryKey: ["jobs"],
    queryFn: () => apiRead<JobListResponse>("/jobs"),
  });
  const createTask = useMutation({
    mutationFn: () => apiWrite<{ job: PublicJob }>("/jobs/example", { method: "POST" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["jobs"] }),
  });

  return (
    <section>
      <div className="page-header">
        <div>
          <p className="eyebrow">团队执行队列</p>
          <h1>任务中心</h1>
        </div>
        <button className="primary-button" type="button" onClick={() => createTask.mutate()} disabled={createTask.isPending}>
          {createTask.isPending ? "正在创建..." : "新建示例任务"}
        </button>
      </div>
      {createTask.isError ? <p className="error-notice">任务创建失败，请稍后重试</p> : null}
      {tasks.isPending ? <p className="empty-state">正在读取任务...</p> : null}
      {tasks.isError ? <p className="error-notice">任务读取失败</p> : null}
      {tasks.data?.jobs.length === 0 ? <p className="empty-state">暂无任务</p> : null}
      {tasks.data?.jobs.length ? (
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>类型</th><th>创建人</th><th>状态</th><th>进度</th><th>当前步骤</th><th>更新时间</th><th>失败摘要</th><th><span className="sr-only">操作</span></th>
              </tr>
            </thead>
            <tbody>
              {tasks.data.jobs.map((job) => (
                <tr key={job.id}>
                  <td><Link className="task-link" to={`/tasks/${job.id}`}>{typeLabel[job.type]}</Link></td>
                  <td>{job.requestedBy === currentUser.data?.id ? "我" : job.requestedBy.slice(0, 8)}</td>
                  <td><span className={`status status-${job.status}`}>{statusLabel[job.status]}</span></td>
                  <td><span className="progress-value">{percent(job)}%</span><progress max={100} value={percent(job)} /></td>
                  <td>{job.progress.current || "等待调度"}</td>
                  <td>{formatTime(job.updatedAt)}</td>
                  <td>{job.progress.failed > 0 ? `${job.progress.failed} 项失败` : "无"}</td>
                  <td><Link className="text-link" to={`/tasks/${job.id}`}>查看</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

export { formatTime, percent, statusLabel, typeLabel };
