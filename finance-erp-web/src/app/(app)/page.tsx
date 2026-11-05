"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getDashboard } from "@/lib/api";
import { fmtDate, money, monthLabel, todayIST } from "@/lib/format";
import type { Dashboard } from "@/lib/types";
import { Badge, Card, ErrorBox, Input, PageHeader, Spinner, cx } from "@/components/ui";

function Metric({ label, value, tone, hint, href }:
  { label: string; value: string; tone?: "success" | "danger" | "warning"; hint?: string; href?: string }) {
  const body = (
    <Card className={cx("p-4", href && "hover:border-primary/50")}>
      <p className="text-xs font-medium text-muted">{label}</p>
      <p className={cx("num mt-1 text-xl font-semibold",
        tone === "success" && "text-success", tone === "danger" && "text-danger", tone === "warning" && "text-warning")}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
    </Card>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

function Bar({ pct, tone = "primary" }: { pct: number; tone?: "primary" | "warning" | "danger" }) {
  const c = { primary: "bg-primary", warning: "bg-warning", danger: "bg-danger" }[tone];
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
      <div className={cx("h-full rounded-full", c)} style={{ width: `${Math.min(Math.max(pct, 0), 100)}%` }} />
    </div>
  );
}

export default function DashboardPage() {
  const [month, setMonth] = useState(todayIST().slice(0, 7));
  const [d, setD] = useState<Dashboard | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    setD(null); setError("");
    getDashboard(`${month}-01`).then((x) => alive && setD(x)).catch((e) => alive && setError(e.message));
    return () => { alive = false; };
  }, [month]);

  return (
    <>
      <PageHeader title="Dashboard" subtitle={monthLabel(`${month}-01`)}
        actions={<Input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} className="w-40" />} />
      {error && <ErrorBox message={error} />}
      {!d && !error && <Spinner />}
      {d && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Metric label="Income" value={money(d.income, true)} tone="success" href="/transactions" />
            <Metric label="Expenses" value={money(d.expense, true)} tone="danger" href="/transactions" />
            <Metric label="Net savings" value={money(d.net_savings, true)} tone={d.net_savings >= 0 ? "success" : "danger"}
              hint={d.goal_contributions > 0 ? `+ ${money(d.goal_contributions, true)} to goals` : undefined} />
            <Metric label="Available balance" value={money(d.available_balance, true)} hint="Cash, bank, UPI, savings" href="/accounts" />
            <Metric label="Credit card outstanding" value={money(d.credit_card_outstanding, true)}
              tone={d.credit_card_outstanding > 0 ? "warning" : undefined} href="/accounts" />
            <Metric label="Pending payments" value={money(d.pending_payments.amount, true)}
              hint={`${d.pending_payments.count} due this month${d.pending_payments.overdue_count ? ` · ${d.pending_payments.overdue_count} overdue` : ""}`}
              tone={d.pending_payments.overdue_count ? "danger" : undefined} />
            <Metric label="Loans outstanding" value={money(d.loan_outstanding, true)} />
            <Metric label="Net worth" value={money(d.net_worth, true)} hint="Accounts + assets − liabilities" />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="p-4">
              <h2 className="mb-3 font-semibold">Monthly budget</h2>
              {d.budget ? (
                <>
                  <div className="mb-2 flex justify-between text-sm">
                    <span className="text-muted">Paid {money(d.budget.paid, true)} of {money(d.budget.planned, true)}</span>
                    <span className="num font-medium">{d.budget.utilization_percent}%</span>
                  </div>
                  <Bar pct={d.budget.utilization_percent} tone={d.budget.utilization_percent > 100 ? "danger" : "primary"} />
                  <p className="mt-2 text-xs text-muted">
                    {money(d.budget.remaining, true)} remaining · plan {d.budget.plan_status}
                    {d.budget.critical_open > 0 && <> · <span className="text-danger">{d.budget.critical_open} critical open</span></>}
                  </p>
                </>
              ) : <p className="text-sm text-muted">No plan for this month yet. Monthly planning arrives in the next batch.</p>}
            </Card>

            <Card className="p-4">
              <h2 className="mb-3 font-semibold">Emergency fund</h2>
              {d.emergency_fund && d.emergency_fund.target > 0 ? (
                <>
                  <div className="mb-2 flex justify-between text-sm">
                    <span className="text-muted">{money(d.emergency_fund.current, true)} of {money(d.emergency_fund.target, true)}</span>
                    <span className="num font-medium">{d.emergency_fund.progress_percent}%</span>
                  </div>
                  <Bar pct={d.emergency_fund.progress_percent} />
                </>
              ) : (
                <p className="text-sm text-muted">
                  No emergency fund goal yet.
                  {d.emergency_fund && d.emergency_fund.account_balance > 0 && <> Emergency fund accounts hold {money(d.emergency_fund.account_balance, true)}.</>}
                </p>
              )}
            </Card>

            <Card className="p-4">
              <h2 className="mb-3 font-semibold">Upcoming (30 days)</h2>
              {d.upcoming_commitments.length === 0 ? <p className="text-sm text-muted">Nothing due in the next 30 days.</p> : (
                <ul className="flex flex-col divide-y divide-line">
                  {d.upcoming_commitments.map((u) => (
                    <li key={u.schedule_id} className="flex items-center justify-between py-2 text-sm">
                      <div><p className="font-medium">{u.commitment}</p><p className="text-xs text-muted">#{u.installment_no} · {fmtDate(u.due_date)}</p></div>
                      <span className="num">{money(u.amount)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <Card>
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <h2 className="font-semibold">Account balances</h2>
              <Link href="/accounts" className="text-sm text-primary hover:underline">Manage</Link>
            </div>
            {d.accounts.length === 0 ? (
              <p className="p-4 text-sm text-muted">No accounts yet. <Link href="/accounts" className="text-primary hover:underline">Add your first account</Link>.</p>
            ) : (
              <div className="grid divide-y divide-line sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-3">
                {d.accounts.map((a) => (
                  <Link key={a.id} href={`/accounts/${a.id}`} className="flex items-center justify-between px-4 py-3 hover:bg-surface-2">
                    <div><p className="font-medium">{a.name}</p><p className="text-xs capitalize text-muted">{a.account_type.replace("_", " ")}</p></div>
                    {a.outstanding > 0
                      ? <span className="text-right"><span className="num block font-medium text-warning">{money(a.outstanding)}</span><Badge tone="warning">outstanding</Badge></span>
                      : <span className={cx("num font-medium", a.current_balance < 0 && "text-danger")}>{money(a.current_balance)}</span>}
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
