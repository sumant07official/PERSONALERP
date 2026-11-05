import { Suspense } from "react";
import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";

// The shell reads the URL (active menu item), so it streams in behind Suspense.
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center"><span className="size-6 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>}>
      <AppShell>{children}</AppShell>
    </Suspense>
  );
}
