import { useMemo } from "react";
import {
  createBrowserRouter,
  createMemoryRouter,
  Navigate,
  RouterProvider,
  type RouteObject,
} from "react-router-dom";

import { AdminMembersPage } from "../features/admin/AdminMembersPage.js";
import { AuthCompletePage } from "../features/auth/AuthCompletePage.js";
import { LoginPage } from "../features/auth/LoginPage.js";
import { TaskCenterPage } from "../features/task-center/TaskCenterPage.js";
import { TaskDetailPage } from "../features/task-center/TaskDetailPage.js";
import { BookOverview } from "../features/library/BookOverview.js";
import { BookWorkspacePage } from "../features/library/BookWorkspacePage.js";
import { ImportPanel } from "../features/library/ImportPanel.js";
import { L1Panel } from "../features/library/L1Panel.js";
import { L2Panel } from "../features/library/L2Panel.js";
import { LibraryPage } from "../features/library/LibraryPage.js";
import { QueryWorkspacePage } from "../features/query/QueryWorkspacePage.js";
import { AppShell } from "./AppShell.js";

const routes: RouteObject[] = [
  { path: "/login", element: <LoginPage /> },
  { path: "/auth/complete", element: <AuthCompletePage /> },
  {
    element: <AppShell />,
    children: [
      { path: "/books", element: <LibraryPage /> },
      { path: "/books/:bookId", element: <BookWorkspacePage />, children: [
        { index: true, element: <Navigate to="overview" replace /> },
        { path: "overview", element: <BookOverview /> },
        { path: "import", element: <ImportPanel /> },
        { path: "l1", element: <L1Panel /> },
        { path: "l2", element: <L2Panel /> },
        { path: "query", element: <QueryWorkspacePage /> },
      ] },
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
