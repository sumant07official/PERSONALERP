"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { supabase } from "@/lib/supabase/client";
import { currentProfile } from "@/lib/api";
import { ToastProvider, cx } from "./ui";

type NavItem = { href: string; label: string; icon: string; soon?: boolean };
const NAV: { group: string; items: NavItem[] }[] = [
  { group: "Overview", items: [{ href: "/", label: "Dashboard", icon: "▦" }] },
  {
    group: "Money", items: [
      { href: "/transactions", label: "Transactions", icon: "⇄" },
      { href: "/accounts", label: "Accounts", icon: "▤" },
      { href: "/credit-cards", label: "Credit cards", icon: "▭" },
    ],
  },
  {
    group: "Planning", items: [
      { href: "/planning", label: "Monthly plan", icon: "◷" },
      { href: "/commitments", label: "Commitments", icon: "↻" },
      { href: "/goals", label: "Goals", icon: "◎", soon: true },
    ],
  },
  {
    group: "More", items: [
      { href: "/reports", label: "Reports", icon: "▥", soon: true },
      { href: "/calendar", label: "Calendar", icon: "▣", soon: true },
      { href: "/masters", label: "Masters", icon: "≡" },
    ],
  },
];

export function AppShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [dark, setDark] = useState(false);
  const [profile, setProfile] = useState<{ full_name: string; role: string } | null>(null);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
    try { setCollapsed(localStorage.getItem("sidebar") === "collapsed"); } catch {}
    currentProfile().then(setProfile).catch(() => {});
  }, []);
  useEffect(() => setMobileOpen(false), [path]);

  function toggleTheme() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try { localStorage.setItem("theme", next ? "dark" : "light"); } catch {}
  }
  function toggleCollapse() {
    const next = !collapsed;
    setCollapsed(next);
    try { localStorage.setItem("sidebar", next ? "collapsed" : "open"); } catch {}
  }
  async function signOut() {
    await supabase().auth.signOut();
    window.location.href = "/login";
  }

  const isActive = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));

  const sidebar = (compact: boolean) => (
    <nav className="flex h-full flex-col bg-sidebar text-sidebar-text">
      <div className={cx("flex h-14 items-center gap-2 px-4", compact && "justify-center px-0")}>
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary font-bold text-primary-fg">₹</div>
        {!compact && <span className="font-semibold text-white">Finance ERP OS</span>}
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-4">
        {NAV.map((g) => (
          <div key={g.group} className="mt-3">
            {!compact && <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-sidebar-text/50">{g.group}</p>}
            {g.items.map((item) => item.soon ? (
              <span key={item.href} title={`${item.label} (next batch)`}
                className={cx("flex h-9 items-center gap-3 rounded-md px-2 text-sm opacity-40", compact && "justify-center")}>
                <span className="w-4 text-center">{item.icon}</span>
                {!compact && <><span className="flex-1">{item.label}</span><span className="text-[10px]">soon</span></>}
              </span>
            ) : (
              <Link key={item.href} href={item.href} title={item.label}
                className={cx("flex h-9 items-center gap-3 rounded-md px-2 text-sm hover:bg-sidebar-active hover:text-white",
                  isActive(item.href) && "bg-sidebar-active font-medium text-white", compact && "justify-center")}>
                <span className="w-4 text-center">{item.icon}</span>
                {!compact && item.label}
              </Link>
            ))}
          </div>
        ))}
      </div>
    </nav>
  );

  return (
    <ToastProvider>
      <div className="flex min-h-screen">
        <aside className={cx("sticky top-0 hidden h-screen shrink-0 transition-all md:block", collapsed ? "w-16" : "w-60")}>
          {sidebar(collapsed)}
        </aside>
        {mobileOpen && (
          <div className="fixed inset-0 z-40 md:hidden" onClick={() => setMobileOpen(false)}>
            <div className="absolute inset-0 bg-black/50" />
            <aside className="absolute inset-y-0 left-0 w-64" onClick={(e) => e.stopPropagation()}>{sidebar(false)}</aside>
          </div>
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-line bg-surface/90 px-3 backdrop-blur">
            <button className="rounded-md p-2 hover:bg-surface-2 md:hidden" onClick={() => setMobileOpen(true)} aria-label="Menu">☰</button>
            <button className="hidden rounded-md p-2 hover:bg-surface-2 md:block" onClick={toggleCollapse} aria-label="Collapse sidebar">☰</button>
            <div className="flex-1" />
            <button onClick={toggleTheme} className="rounded-md p-2 hover:bg-surface-2" aria-label="Toggle theme">{dark ? "☀" : "☾"}</button>
            {profile && (
              <div className="flex items-center gap-2 pl-2">
                <div className="hidden text-right sm:block">
                  <p className="text-sm font-medium leading-tight">{profile.full_name}</p>
                  <span className="text-[11px] uppercase tracking-wide text-primary">{profile.role}</span>
                </div>
                <div className="flex size-8 items-center justify-center rounded-full bg-primary-soft font-semibold text-primary">
                  {profile.full_name.slice(0, 1).toUpperCase()}
                </div>
              </div>
            )}
            <button onClick={signOut} className="rounded-md px-2 py-1.5 text-sm text-muted hover:bg-surface-2 hover:text-ink">Sign out</button>
          </header>
          <main className="mx-auto w-full max-w-7xl flex-1 p-4 md:p-6">{children}</main>
        </div>
      </div>
    </ToastProvider>
  );
}
