import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { BookOpen, ListTodo, Users } from "lucide-react";
import { NavLink, Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";

import { subscribeSessionExpired } from "../shared/api.js";
import { useCurrentUser } from "../features/auth/useCurrentUser.js";
import { loginPath } from "../features/auth/return-to.js";
import { clearPriorSessionQueries } from "../features/auth/session-query-cache.js";
import { useJobEvents } from "../features/task-center/useJobEvents.js";

export function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const currentUser = useCurrentUser();
  useJobEvents(Boolean(currentUser.data));

  useEffect(() => subscribeSessionExpired(() => {
    clearPriorSessionQueries(queryClient);
    queryClient.setQueryData(["current-user"], null);
    navigate(loginPath(location.pathname), { replace: true });
  }), [location.pathname, navigate, queryClient]);

  if (currentUser.isPending) return <main className="centered-state">正在加载工作区...</main>;
  if (!currentUser.data) return <Navigate to={loginPath(location.pathname)} replace />;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <span className="brand">小说分析工作台</span>
          <span className="environment-label">团队任务</span>
        </div>
        <div className="identity">
          <strong>{currentUser.data.displayName}</strong>
          <span>{currentUser.data.role === "admin" ? "管理员" : "成员"}</span>
        </div>
      </header>
      <div className="shell-body">
        <nav className="sidebar" aria-label="主导航">
          <NavLink to="/books"><BookOpen size={17} />书库</NavLink>
          <NavLink to="/tasks"><ListTodo size={17} />任务中心</NavLink>
          {currentUser.data.role === "admin"
            ? <NavLink to="/admin/members"><Users size={17} />成员管理</NavLink>
            : null}
        </nav>
        <main className="workspace"><Outlet /></main>
      </div>
    </div>
  );
}
