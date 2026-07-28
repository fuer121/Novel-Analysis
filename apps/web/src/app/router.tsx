import type { ReactNode } from "react";

import { AdminMembersPage } from "../features/admin/AdminMembersPage.js";
import { AdvancedAnalysisPage } from "../features/analysis/AdvancedAnalysisPage.js";
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
import { Navigate, OutletSlot, RouterRoot, RouteScope, useLocation } from "./routing.js";

const bookTabs: Record<string, ReactNode> = {
  overview: <BookOverview />,
  import: <ImportPanel />,
  l1: <L1Panel />,
  l2: <L2Panel />,
  query: <QueryWorkspacePage />,
  analysis: <AdvancedAnalysisPage />,
};

function UnknownPage() {
  return (
    <main className="centered-state">
      <div>
        <h1>页面不存在</h1>
        <a className="primary-button" href="/tasks">返回任务中心</a>
      </div>
    </main>
  );
}

function protectedRoute(element: ReactNode) {
  return (
    <RouteScope basePath="/">
      <OutletSlot element={element}>
        <AppShell />
      </OutletSlot>
    </RouteScope>
  );
}

function bookRoute(bookId: string, segment: string | undefined) {
  const basePath = `/books/${encodeURIComponent(bookId)}`;
  const page = segment ? bookTabs[segment] : <Navigate to="overview" replace />;
  if (!page) return <UnknownPage />;
  return protectedRoute(
    <RouteScope basePath={basePath} params={{ bookId }}>
      <OutletSlot element={page}>
        <BookWorkspacePage />
      </OutletSlot>
    </RouteScope>,
  );
}

function Routes() {
  const { pathname } = useLocation();
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;

  if (normalized === "/login") return <LoginPage />;
  if (normalized === "/auth/complete") return <AuthCompletePage />;
  if (normalized === "/books") return protectedRoute(<LibraryPage />);
  if (normalized === "/tasks") return protectedRoute(<TaskCenterPage />);
  if (normalized === "/admin/members") return protectedRoute(<AdminMembersPage />);

  const task = normalized.match(/^\/tasks\/([^/]+)$/);
  if (task) {
    try {
      return protectedRoute(
        <RouteScope basePath={normalized} params={{ id: decodeURIComponent(task[1]!) }}>
          <TaskDetailPage />
        </RouteScope>,
      );
    } catch {
      return <UnknownPage />;
    }
  }

  const book = normalized.match(/^\/books\/([^/]+)(?:\/([^/]+))?$/);
  if (book) {
    try {
      return bookRoute(decodeURIComponent(book[1]!), book[2]);
    } catch {
      return <UnknownPage />;
    }
  }

  return <UnknownPage />;
}

export function AppRouter({ initialEntries }: { initialEntries?: string[] }) {
  return (
    <RouterRoot initialEntries={initialEntries}>
      <Routes />
    </RouterRoot>
  );
}
