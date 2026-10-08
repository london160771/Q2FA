import type { ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell, type AppShellProps } from "./AppShell.js";

export type DashboardPages = Record<"overview" | "send" | "deposit" | "activity" | "security" | "docs", ReactNode>;

export function AppRouter({ shell, pages }: { shell: AppShellProps; pages: DashboardPages }) {
  return (
    <Routes>
      <Route element={<AppShell {...shell} />}>
        <Route index element={<Navigate to="/overview" replace />} />
        <Route path="overview" element={pages.overview} />
        <Route path="send" element={pages.send} />
        <Route path="deposit" element={pages.deposit} />
        <Route path="activity" element={pages.activity} />
        <Route path="security" element={pages.security} />
        <Route path="docs" element={pages.docs} />
        <Route path="*" element={<Navigate to="/overview" replace />} />
      </Route>
    </Routes>
  );
}
