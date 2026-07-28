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

function bookTab(segment: string): ReactNode | undefined {
  return Object.hasOwn(bookTabs, segment) ? bookTabs[segment] : undefined;
}

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
  const page = segment ? bookTab(segment) : <Navigate to="overview" replace />;
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
  let segments: string[];
  try {
    segments = normalized.split("/").slice(1).map((segment) => decodeURIComponent(segment));
  } catch {
    return <UnknownPage />;
  }

  const staticSegments = segments.map((segment) => segment.toLowerCase());
  if (segments.length === 1 && staticSegments[0] === "login") return <LoginPage />;
  if (segments.length === 2 && staticSegments[0] === "auth" && staticSegments[1] === "complete") return <AuthCompletePage />;
  if (segments.length === 1 && staticSegments[0] === "books") return protectedRoute(<LibraryPage />);
  if (segments.length === 1 && staticSegments[0] === "tasks") return protectedRoute(<TaskCenterPage />);
  if (segments.length === 2 && staticSegments[0] === "admin" && staticSegments[1] === "members") return protectedRoute(<AdminMembersPage />);

  if (segments.length === 2 && staticSegments[0] === "tasks") {
    const id = segments[1]!;
    return protectedRoute(
      <RouteScope basePath={`/tasks/${encodeURIComponent(id)}`} params={{ id }}>
        <TaskDetailPage />
      </RouteScope>,
    );
  }

  if ((segments.length === 2 || segments.length === 3) && staticSegments[0] === "books") {
    return bookRoute(segments[1]!, staticSegments[2]);
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
