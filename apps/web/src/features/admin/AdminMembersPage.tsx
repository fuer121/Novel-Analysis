import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiRead, apiWrite } from "../../shared/api.js";
import { useCurrentUser } from "../auth/useCurrentUser.js";

interface Member {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  role: "admin" | "member";
  status: "active" | "disabled";
}

export function AdminMembersPage() {
  const queryClient = useQueryClient();
  const currentUser = useCurrentUser();
  const [displayName, setDisplayName] = useState("");
  const [unionId, setUnionId] = useState("");
  const members = useQuery({
    queryKey: ["members"],
    queryFn: () => apiRead<{ members: Member[] }>("/admin/members"),
  });
  const createMember = useMutation({
    mutationFn: () => apiWrite<{ member: Member }>("/admin/members", {
      method: "POST",
      body: JSON.stringify({ displayName, unionId, role: "member" }),
    }),
    onSuccess: () => {
      setDisplayName("");
      setUnionId("");
      void queryClient.invalidateQueries({ queryKey: ["members"] });
    },
  });
  const updateMember = useMutation({
    mutationFn: ({ id, change }: { id: string; change: Pick<Member, "status"> | Pick<Member, "role"> }) =>
      apiWrite<{ member: Member }>(`/admin/members/${id}`, {
        method: "PATCH",
        body: JSON.stringify(change),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["members"] }),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    createMember.mutate();
  }

  function confirmUpdate(member: Member, change: "role" | "status"): void {
    const description = change === "role"
      ? `确认调整“${member.displayName}”的角色吗？`
      : `确认${member.status === "active" ? "停用" : "启用"}“${member.displayName}”吗？`;
    if (!window.confirm(description)) return;
    updateMember.mutate({
      id: member.id,
      change: change === "role"
        ? { role: member.role === "admin" ? "member" : "admin" }
        : { status: member.status === "active" ? "disabled" : "active" },
    });
  }

  return (
    <section>
      <div className="page-header">
        <div><p className="eyebrow">系统管理</p><h1>成员管理</h1></div>
      </div>
      <form className="member-form" onSubmit={submit}>
        <label>显示名称<input required value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label>
        <label>飞书 Union ID<input required value={unionId} onChange={(event) => setUnionId(event.target.value)} /></label>
        <button className="primary-button" type="submit" disabled={createMember.isPending}>添加成员</button>
      </form>
      {createMember.isError || updateMember.isError ? <p className="error-notice">成员操作失败</p> : null}
      {members.isPending ? <p className="empty-state">正在读取成员...</p> : null}
      {members.isError ? <p className="error-notice">成员列表读取失败</p> : null}
      {members.data ? (
        <div className="data-table-wrap">
          <table className="data-table">
            <thead><tr><th>成员</th><th>角色</th><th>状态</th><th>操作</th></tr></thead>
            <tbody>{members.data.members.map((member) => (
              <tr key={member.id}>
                <td><strong>{member.displayName}</strong><span className="secondary-line">{member.id}</span></td>
                <td>{member.role === "admin" ? "管理员" : "成员"}</td>
                <td>{member.status === "active" ? "启用" : "停用"}</td>
                <td className="button-row">
                  {member.id === currentUser.data?.id ? (
                    <span className="self-protection">当前账号不可修改</span>
                  ) : (
                    <>
                      <button className="text-button" type="button" onClick={() => confirmUpdate(member, "role")}>
                        设为{member.role === "admin" ? "成员" : "管理员"}
                      </button>
                      <button className="text-button" type="button" onClick={() => confirmUpdate(member, "status")}>
                        {member.status === "active" ? "停用" : "启用"}
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
