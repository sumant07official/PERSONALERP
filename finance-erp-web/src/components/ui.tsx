"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

// ---------- Button ----------
type Variant = "primary" | "secondary" | "ghost" | "danger";
export function Button({ variant = "secondary", className, busy, children, ...p }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; busy?: boolean }) {
  const v = {
    primary: "bg-primary text-primary-fg hover:opacity-90",
    secondary: "bg-surface border border-line hover:bg-surface-2",
    ghost: "hover:bg-surface-2",
    danger: "bg-danger text-white hover:opacity-90",
  }[variant];
  return (
    <button {...p} disabled={p.disabled || busy}
      className={cx("inline-flex items-center justify-center gap-1.5 rounded-md px-3 h-9 text-sm font-medium transition disabled:opacity-50 disabled:cursor-not-allowed", v, className)}>
      {busy && <span className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />}
      {children}
    </button>
  );
}

// ---------- Form fields ----------
export function Field({ label, hint, children, className }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cx("flex flex-col gap-1", className)}>
      <span className="text-xs font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </label>
  );
}
const fieldCls = "h-9 w-full rounded-md border border-line bg-surface px-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20";
export const Input = (p: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={cx(fieldCls, p.className)} />;
export const Select = (p: SelectHTMLAttributes<HTMLSelectElement>) => <select {...p} className={cx(fieldCls, p.className)} />;
export const Textarea = (p: TextareaHTMLAttributes<HTMLTextAreaElement>) =>
  <textarea {...p} className={cx(fieldCls, "h-auto min-h-16 py-2", p.className)} />;

// ---------- Card / Badge / Pill ----------
export function Card({ children, className, onClick }: { children: ReactNode; className?: string; onClick?: () => void }) {
  return <div onClick={onClick} className={cx("rounded-lg border border-line bg-surface", onClick && "cursor-pointer hover:border-primary/50", className)}>{children}</div>;
}
export function Badge({ tone = "neutral", children }: { tone?: "neutral" | "success" | "danger" | "warning" | "primary"; children: ReactNode }) {
  const t = {
    neutral: "bg-surface-2 text-muted",
    success: "bg-success-soft text-success",
    danger: "bg-danger-soft text-danger",
    warning: "bg-warning-soft text-warning",
    primary: "bg-primary-soft text-primary",
  }[tone];
  return <span className={cx("inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium whitespace-nowrap", t)}>{children}</span>;
}
export function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button onClick={onClick} className={cx("rounded-full border px-3 h-7 text-xs font-medium whitespace-nowrap",
      active ? "border-primary bg-primary-soft text-primary" : "border-line bg-surface text-muted hover:text-ink")}>
      {children}
    </button>
  );
}

// ---------- Page header ----------
export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold">{title}</h1>
        {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="no-print flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

// ---------- Modal (centered on desktop, full-screen sheet on phones) ----------
export function Modal({ open, onClose, title, children, footer, wide }:
  { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 sm:p-4" onMouseDown={onClose}>
      <div onMouseDown={(e) => e.stopPropagation()}
        className={cx("flex max-h-[100dvh] sm:max-h-[90vh] w-full flex-col rounded-t-xl sm:rounded-xl bg-surface shadow-xl", wide ? "sm:max-w-3xl" : "sm:max-w-lg")}>
        <div className="flex items-center justify-between border-b border-line px-4 h-12">
          <h2 className="font-semibold">{title}</h2>
          <button onClick={onClose} className="text-muted hover:text-ink text-lg" aria-label="Close">✕</button>
        </div>
        <div className="overflow-y-auto p-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line px-4 py-3">{footer}</div>}
      </div>
    </div>
  );
}

// ---------- Empty / loading / error ----------
export function Empty({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 py-12 text-center">
      <p className="font-medium">{title}</p>
      {hint && <p className="max-w-sm text-sm text-muted">{hint}</p>}
      {action}
    </div>
  );
}
export const Spinner = () => <div className="flex justify-center py-10"><span className="size-6 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>;
export const ErrorBox = ({ message }: { message: string }) =>
  <div className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">{message}</div>;

// ---------- Toasts ----------
type Toast = { id: number; kind: "ok" | "err"; text: string };
const ToastCtx = createContext<(kind: Toast["kind"], text: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((kind: Toast["kind"], text: string) => {
    const id = Date.now() + Math.random();
    setItems((t) => [...t, { id, kind, text }]);
    setTimeout(() => setItems((t) => t.filter((x) => x.id !== id)), kind === "err" ? 7000 : 3500);
  }, []);
  return (
    <ToastCtx value={push}>
      {children}
      <div className="fixed bottom-4 right-4 z-[60] flex w-[min(92vw,380px)] flex-col gap-2">
        {items.map((t) => (
          <div key={t.id} className={cx("rounded-md px-3 py-2 text-sm shadow-lg",
            t.kind === "ok" ? "bg-success text-white" : "bg-danger text-white")}>{t.text}</div>
        ))}
      </div>
    </ToastCtx>
  );
}

export { cx };
