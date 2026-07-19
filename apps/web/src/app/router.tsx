import { useMemo } from "react";
import {
  createBrowserRouter,
  createMemoryRouter,
  RouterProvider,
  type RouteObject,
} from "react-router-dom";

import { AdminMembersPage } from "../features/admin/AdminMembersPage.js";
import { AuthCompletePage } from "../features/auth/AuthCompletePage.js";
import { LoginPage } from "../features/auth/LoginPage.js";
import { TaskCenterPage } from "../features/task-center/TaskCenterPage.js";
import { TaskDetailPage } from "../features/task-center/TaskDetailPage.js";
import { AppShell } from "./AppShell.js";

const routes: RouteObject[] = [
  { path: "/login", element: <LoginPage /> },
  { path: "/auth/complete", element: <AuthCompletePage /> },
  {
    element: <AppShell />,
    children: [
      { path: "/tasks", element: <TaskCenterPage /> },
      { path: "/tasks/:id", element: <TaskDetailPage /> },
      { path: "/admin/members", element: <AdminMembersPage /> },
    ],
  },
  {
    path: "*",
    element: (
      <main className="centered-state">
        <div>
          <h1>页面不存在</h1>
          <a className="primary-button" href="/tasks">返回任务中心</a>
        </div>
      </main>
    ),
  },
];

export function AppRouter({ initialEntries }: { initialEntries?: string[] }) {
  const router = useMemo(
    () => initialEntries ? createMemoryRouter(routes, { initialEntries }) : createBrowserRouter(routes),
    [initialEntries],
  );
  return <RouterProvider router={router} />;
}
