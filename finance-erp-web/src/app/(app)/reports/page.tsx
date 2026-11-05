"use client";

import { useEffect, useState } from "react";
import { listCategorySpend, listHistory, listMonthlySummary } from "@/lib/api";
import { downloadCsv, money, todayIST } from "@/lib/format";
import type { CategorySpend, HistoryLog, MonthlySummary } from "@/lib/types";
import { Badge, Button, Card, Empty, ErrorBox, Input, PageHeader, Pill, Spinner } from "@/components/ui";

const monthShort = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("en-IN", { month: "short", year: "2-digit" });
const ACTION_TONE: Record<string, "success" | "danger" | "warning" | "primary" | "neutral"> =
  { post: "success", insert: "success", update: "primary", void: "danger", delete: "danger", restore: "warning" };

export default function ReportsPage() {
  const [tab, setTab] = useState<"monthly" | "category" | "history">("monthly");
  return (
    <>
      <PageHeader title="Reports" actions={<Button onClick={() => window.print()}>Print</Button>} />
      <div className="no-print mb-3 flex gap-2">
        <Pill active={tab === "monthly"} onClick={() => setTab("monthly")}>Income vs expense</Pill>
        <Pill active={tab === "category"} onClick={() => setTab("category")}>Spending by category</Pill>
        <Pill active={tab === "history"} onClick={() => setTab("history")}>Audit history</Pill>
      </div>
      {tab === "monthly" && <Monthly />}
      {tab === "category" && <Category />}
      {tab === "history" && <History />}
    </>
  );
}

function Monthly() {
  const [months, setMonths] = useState(12);
  const [rows, setRows] = useState<MonthlySummary[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const d = new Date(todayIST() + "T00:00:00");
    d.setMonth(d.getMonth() - (months - 1), 1);
    const from = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
    setRows(null);
    listMonthlySummary(from).then(setRows).catch((e) => setError(e.message));
  }, [months]);
  if (error) return <ErrorBox message={error} />;
  if (!rows) return <Spinner />;
  if (!rows.length) return <Card><Empty title="No transactions in this period" /></Card>;
  const max = Math.max(...rows.flatMap((r) => [Number(r.income), Number(r.expense)]), 1);
  const tot = rows.reduce((a, r) => ({ income: a.income + Number(r.income), expense: a.expense + Number(r.expense), net: a.net + Number(r.net_savings) }), { income: 0, expense: 0, net: 0 });

  return (
    <>
      <div className="no-print mb-3 flex items-center gap-2">
        {[3, 6, 12, 24].map((n) => <Pill key={n} active={months === n} onClick={() => setMonths(n)}>{n} months</Pill>)}
        <span className="flex-1" />
        <Button onClick={() => downloadCsv("monthly-summary.csv", rows.map((r) => ({ ...r })))}>Export CSV</Button>
      </div>
      <div className="mb-3 grid grid-cols-3 gap-3">
        <Card className="p-3"><p className="text-xs text-muted">Income</p><p className="num text-lg font-semibold text-success">{money(tot.income, true)}</p></Card>
        <Card className="p-3"><p className="text-xs text-muted">Expenses</p><p className="num text-lg font-semibold text-danger">{money(tot.expense, true)}</p></Card>
        <Card className="p-3"><p className="text-xs text-muted">Net savings</p><p className={`num text-lg font-semibold ${tot.net >= 0 ? "text-success" : "text-danger"}`}>{money(tot.net, true)}</p></Card>
      </div>
      <Card className="mb-3 p-4">
        <div className="flex h-48 items-end gap-2 overflow-x-auto">
          {rows.map((r) => (
            <div key={r.month_start} className="flex min-w-10 flex-1 flex-col items-center gap-1">
              <div className="flex h-40 w-full items-end justify-center gap-0.5">
                <div className="w-1/2 max-w-5 rounded-t bg-success" style={{ height: `${(Number(r.income) / max) * 100}%` }} title={`Income ${money(r.income)}`} />
                <div className="w-1/2 max-w-5 rounded-t bg-danger" style={{ height: `${(Number(r.expense) / max) * 100}%` }} title={`Expense ${money(r.expense)}`} />
              </div>
              <span className="text-[10px] text-muted">{monthShort(r.month_start)}</span>
            </div>
          ))}
        </div>
        <p className="mt-2 flex gap-4 text-xs text-muted"><span><span className="mr-1 inline-block size-2 rounded-sm bg-success" />Income</span><span><span className="mr-1 inline-block size-2 rounded-sm bg-danger" />Expenses (incl. commitment payments)</span></p>
      </Card>
      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-line bg-surface-2 text-left text-xs text-muted">
            <tr><th className="px-3 py-2">Month</th><th className="px-3 py-2 text-right">Income</th><th className="px-3 py-2 text-right">Expenses</th>
              <th className="px-3 py-2 text-right">of which commitments</th><th className="px-3 py-2 text-right">To goals</th>
              <th className="px-3 py-2 text-right">Card bills paid</th><th className="px-3 py-2 text-right">Net savings</th></tr>
          </thead>
          <tbody className="divide-y divide-line">
            {[...rows].reverse().map((r) => (
              <tr key={r.month_start}>
                <td className="px-3 py-2">{monthShort(r.month_start)}</td>
                <td className="num px-3 py-2 text-right text-success">{money(r.income, true)}</td>
                <td className="num px-3 py-2 text-right text-danger">{money(r.expense, true)}</td>
                <td className="num px-3 py-2 text-right text-muted">{money(r.commitment_payments, true)}</td>
                <td className="num px-3 py-2 text-right text-muted">{money(r.goal_contributions, true)}</td>
                <td className="num px-3 py-2 text-right text-muted">{money(r.credit_card_payments, true)}</td>
                <td className={`num px-3 py-2 text-right font-medium ${r.net_savings >= 0 ? "text-success" : "text-danger"}`}>{money(r.net_savings, true)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}

function Category() {
  const [month, setMonth] = useState(todayIST().slice(0, 7));
  const [rows, setRows] = useState<CategorySpend[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { setRows(null); listCategorySpend(`${month}-01`).then(setRows).catch((e) => setError(e.message)); }, [month]);
  const total = (rows ?? []).reduce((s, r) => s + Number(r.amount), 0);
  return (
    <>
      <div className="no-print mb-3 flex items-center gap-2">
        <Input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} className="w-40" />
        <span className="flex-1" />
        {rows && rows.length > 0 && <Button onClick={() => downloadCsv(`category-spend-${month}.csv`, rows.map((r) => ({ category: r.category_name, amount: r.amount, transactions: r.transaction_count })))}>Export CSV</Button>}
      </div>
      {error && <ErrorBox message={error} />}
      {!rows && !error && <Spinner />}
      {rows && rows.length === 0 && <Card><Empty title="No expenses this month" /></Card>}
      {rows && rows.length > 0 && (
        <Card className="p-4">
          <p className="mb-3 text-sm text-muted">Total <b className="num text-ink">{money(total)}</b></p>
          <div className="flex flex-col gap-2.5">
            {rows.map((r) => {
              const pct = total ? (Number(r.amount) / total) * 100 : 0;
              return (
                <div key={r.category_id ?? "none"}>
                  <div className="mb-1 flex justify-between text-sm">
                    <span>{r.category_name} <span className="text-xs text-muted">· {r.transaction_count}</span></span>
                    <span className="num">{money(r.amount)} <span className="text-xs text-muted">{pct.toFixed(1)}%</span></span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-surface-2"><div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} /></div>
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </>
  );
}

function History() {
  const [rows, setRows] = useState<HistoryLog[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { listHistory(200).then(setRows).catch((e) => setError(e.message)); }, []);
  if (error) return <ErrorBox message={error} />;
  if (!rows) return <Spinner />;
  if (!rows.length) return <Card><Empty title="No history yet" /></Card>;
  const describe = (h: HistoryLog) => {
    const v = (h.new_value ?? h.old_value ?? {}) as Record<string, unknown>;
    const name = (v.name ?? v.item_name ?? v.title ?? v.remarks) as string | undefined;
    const amount = v.amount ?? v.planned_amount ?? v.target_amount;
    return [name, amount != null ? money(amount as number) : null].filter(Boolean).join(" · ");
  };
  return (
    <Card className="overflow-x-auto">
      <p className="border-b border-line px-3 py-2 text-xs text-muted">Append-only log of every change (latest 200). It cannot be edited or deleted.</p>
      <table className="w-full text-sm">
        <thead className="border-b border-line bg-surface-2 text-left text-xs text-muted">
          <tr><th className="px-3 py-2">When</th><th className="px-3 py-2">Record</th><th className="px-3 py-2">Action</th><th className="px-3 py-2">Details</th></tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((h) => (
            <tr key={h.id}>
              <td className="px-3 py-2 whitespace-nowrap text-muted">{new Date(h.created_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</td>
              <td className="px-3 py-2">{h.entity_type.split(".").pop()?.replace(/_/g, " ")}</td>
              <td className="px-3 py-2"><Badge tone={ACTION_TONE[h.action] ?? "neutral"}>{h.action === "void" ? "deleted" : h.action}</Badge></td>
              <td className="px-3 py-2">{describe(h)}{h.remarks && <span className="ml-2 text-xs text-muted">({h.remarks})</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
