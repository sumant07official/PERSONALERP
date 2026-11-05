"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { listCalendar } from "@/lib/api";
import { fmtDate, money, todayIST } from "@/lib/format";
import type { CalendarEvent } from "@/lib/types";
import { Badge, Button, Card, Empty, ErrorBox, PageHeader, Pill, Spinner, cx } from "@/components/ui";

const TYPES: { key: CalendarEvent["event_type"]; label: string; dot: string; href: (e: CalendarEvent) => string }[] = [
  { key: "installment", label: "Installments", dot: "bg-primary", href: () => "/commitments" },
  { key: "card_due", label: "Card bills", dot: "bg-warning", href: () => "/credit-cards" },
  { key: "plan_item", label: "Plan items", dot: "bg-success", href: () => "/planning" },
  { key: "task", label: "Tasks", dot: "bg-muted", href: () => "/tasks" },
  { key: "goal_target", label: "Goal targets", dot: "bg-danger", href: () => "/goals" },
];
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export default function CalendarPage() {
  const today = todayIST();
  const [cursor, setCursor] = useState(() => new Date(today.slice(0, 7) + "-01T00:00:00"));
  const [events, setEvents] = useState<CalendarEvent[] | null>(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(today);
  const [hidden, setHidden] = useState<string[]>([]);

  const grid = useMemo(() => {
    const first = new Date(cursor);
    const start = new Date(first); start.setDate(1 - ((first.getDay() + 6) % 7)); // weeks start Monday
    return Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
  }, [cursor]);

  useEffect(() => {
    setEvents(null);
    listCalendar(ymd(grid[0]), ymd(grid[41])).then(setEvents).catch((e) => setError(e.message));
  }, [grid]);

  const visible = (events ?? []).filter((e) => !hidden.includes(e.event_type));
  const byDay = useMemo(() => {
    const m = new Map<string, CalendarEvent[]>();
    visible.forEach((e) => m.set(e.event_date, [...(m.get(e.event_date) ?? []), e]));
    return m;
  }, [visible]);
  const dayEvents = byDay.get(selected) ?? [];
  const meta = (t: string) => TYPES.find((x) => x.key === t)!;
  const shift = (n: number) => { const d = new Date(cursor); d.setMonth(d.getMonth() + n); setCursor(d); };

  return (
    <>
      <PageHeader title="Calendar" subtitle={cursor.toLocaleDateString("en-IN", { month: "long", year: "numeric" })}
        actions={<>
          <Button onClick={() => shift(-1)}>‹ Prev</Button>
          <Button onClick={() => { setCursor(new Date(today.slice(0, 7) + "-01T00:00:00")); setSelected(today); }}>Today</Button>
          <Button onClick={() => shift(1)}>Next ›</Button>
        </>} />
      <div className="mb-3 flex flex-wrap gap-2">
        {TYPES.map((t) => (
          <Pill key={t.key} active={!hidden.includes(t.key)} onClick={() => setHidden((h) => (h.includes(t.key) ? h.filter((x) => x !== t.key) : [...h, t.key]))}>
            <span className={cx("mr-1 inline-block size-2 rounded-full", t.dot)} />{t.label}
          </Pill>
        ))}
      </div>
      {error && <ErrorBox message={error} />}
      {!events && !error && <Spinner />}
      {events && (
        <div className="grid gap-3 lg:grid-cols-[1fr_20rem]">
          <Card className="overflow-hidden">
            <div className="grid grid-cols-7 border-b border-line bg-surface-2 text-center text-xs text-muted">
              {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d} className="py-2">{d}</div>)}
            </div>
            <div className="grid grid-cols-7">
              {grid.map((d) => {
                const key = ymd(d);
                const evs = byDay.get(key) ?? [];
                const inMonth = d.getMonth() === cursor.getMonth();
                const total = evs.reduce((s, e) => s + Number(e.amount ?? 0), 0);
                return (
                  <button key={key} onClick={() => setSelected(key)}
                    className={cx("flex min-h-16 flex-col items-start gap-1 border-b border-r border-line p-1.5 text-left sm:min-h-24",
                      !inMonth && "bg-surface-2/50 text-muted", selected === key && "ring-2 ring-inset ring-primary")}>
                    <span className={cx("text-xs", key === today && "rounded-full bg-primary px-1.5 font-semibold text-primary-fg")}>{d.getDate()}</span>
                    <span className="flex flex-wrap gap-0.5">{evs.slice(0, 6).map((e, i) => <span key={i} className={cx("size-1.5 rounded-full", meta(e.event_type).dot)} />)}</span>
                    {total > 0 && <span className="num hidden text-[10px] text-muted sm:block">{money(total, true)}</span>}
                  </button>
                );
              })}
            </div>
          </Card>
          <Card className="p-3">
            <p className="mb-2 font-semibold">{fmtDate(selected)}</p>
            {dayEvents.length === 0 ? <Empty title="Nothing on this day" /> : (
              <div className="flex flex-col divide-y divide-line">
                {dayEvents.map((e, i) => (
                  <Link key={i} href={meta(e.event_type).href(e)} className="flex items-start gap-2 py-2 hover:bg-surface-2">
                    <span className={cx("mt-1.5 size-2 shrink-0 rounded-full", meta(e.event_type).dot)} />
                    <span className="min-w-0 flex-1"><span className="block text-sm font-medium">{e.title}</span>
                      <span className="text-xs text-muted">{meta(e.event_type).label}</span></span>
                    <span className="text-right">
                      {e.amount != null && <span className="num block text-sm">{money(e.amount)}</span>}
                      <Badge tone={e.status === "overdue" ? "danger" : e.status === "paid" || e.status === "done" ? "success" : "neutral"}>{e.status}</Badge>
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
