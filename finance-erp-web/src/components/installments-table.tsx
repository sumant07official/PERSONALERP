"use client";

import { useState } from "react";
import { cancelSchedule, clearPaymentPlans, restoreSchedule } from "@/lib/api";
import { fmtDate, money } from "@/lib/format";
import type { Account, Installment } from "@/lib/types";
import { DistributeModal, PayInstallmentsModal } from "./installment-modals";
import { Badge, Button, Card, Empty, cx, useToast } from "./ui";

const monthShort = (y: number, m: number) => new Date(y, m - 1, 1).toLocaleDateString("en-IN", { month: "short", year: "2-digit" });

export function statusBadge(i: Installment) {
  if (i.status === "paid") return <Badge tone="success">Paid</Badge>;
  if (i.status === "cancelled") return <Badge>Cancelled</Badge>;
  if (i.is_overdue) return <Badge tone="danger">Overdue {i.days_overdue}d</Badge>;
  if (i.status === "partial") return <Badge tone="warning">Partial</Badge>;
  return <Badge tone="primary">Pending</Badge>;
}

/** Installments with multi-select → Pay / Spread / Clear plan / Cancel. */
export function InstallmentsTable({ rows, accounts, onChanged, showCommitment }:
  { rows: Installment[]; accounts: Account[]; onChanged: () => void; showCommitment?: boolean }) {
  const toast = useToast();
  const [sel, setSel] = useState<string[]>([]);
  const [payOpen, setPayOpen] = useState(false);
  const [spreadOpen, setSpreadOpen] = useState(false);

  const open = rows.filter((r) => r.status === "pending" || r.status === "partial");
  const selected = sel.map((id) => rows.find((r) => r.id === id)).filter(Boolean) as Installment[];
  const selectedTotal = selected.reduce((s, i) => s + Number(i.remaining_amount), 0);
  const toggle = (id: string) => setSel((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id]));
  const done = () => { setSel([]); onChanged(); };

  async function clearPlans() {
    try { const n = await clearPaymentPlans(sel); toast("ok", `${n} planned payment${n === 1 ? "" : "s"} removed`); done(); }
    catch (e) { toast("err", (e as Error).message); }
  }
  async function cancel(i: Installment) {
    const reason = prompt(`Cancel installment #${i.installment_no} due ${fmtDate(i.due_date)}? Reason (optional):`);
    if (reason === null) return;
    try { await cancelSchedule(i.id, reason); toast("ok", "Installment cancelled"); done(); }
    catch (e) { toast("err", (e as Error).message); }
  }
  async function restore(i: Installment) {
    try { await restoreSchedule(i.id); toast("ok", "Installment restored"); done(); }
    catch (e) { toast("err", (e as Error).message); }
  }

  if (!rows.length) return <Card><Empty title="No installments" hint="Generate installments from the commitment, or add a start date and amount." /></Card>;

  return (
    <>
      <div className={cx("no-print sticky top-14 z-20 mb-2 flex flex-wrap items-center gap-2 rounded-md border border-line bg-surface px-3 py-2", !sel.length && "hidden")}>
        <span className="text-sm"><b>{sel.length}</b> selected · <span className="num">{money(selectedTotal)}</span></span>
        <span className="flex-1" />
        <Button variant="primary" onClick={() => setPayOpen(true)}>Pay</Button>
        <Button onClick={() => setSpreadOpen(true)}>Spread across months</Button>
        <Button onClick={clearPlans}>Clear plan</Button>
        <Button variant="ghost" onClick={() => setSel([])}>Clear selection</Button>
      </div>
      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-line bg-surface-2 text-left text-xs text-muted">
            <tr>
              <th className="w-8 px-3 py-2">
                <input type="checkbox" checked={open.length > 0 && open.every((r) => sel.includes(r.id))}
                  onChange={(e) => setSel(e.target.checked ? open.map((r) => r.id) : [])} aria-label="Select all open" />
              </th>
              {showCommitment && <th className="px-3 py-2">Commitment</th>}
              <th className="px-3 py-2">#</th><th className="px-3 py-2">Due</th><th className="px-3 py-2 text-right">Amount</th>
              <th className="px-3 py-2 text-right">Paid</th><th className="px-3 py-2 text-right">Remaining</th>
              <th className="px-3 py-2">Status</th><th className="px-3 py-2">Planned</th><th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((i) => {
              const isOpen = i.status === "pending" || i.status === "partial";
              return (
                <tr key={i.id} className={cx("hover:bg-surface-2", i.status === "cancelled" && "opacity-50", sel.includes(i.id) && "bg-primary-soft/40")}>
                  <td className="px-3 py-2">{isOpen && <input type="checkbox" checked={sel.includes(i.id)} onChange={() => toggle(i.id)} />}</td>
                  {showCommitment && <td className="px-3 py-2 font-medium">{i.commitment_name}</td>}
                  <td className="px-3 py-2 text-muted">{i.installment_no}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{fmtDate(i.due_date)}</td>
                  <td className="num px-3 py-2 text-right">{money(i.amount)}</td>
                  <td className="num px-3 py-2 text-right text-success">{i.paid_amount > 0 ? money(i.paid_amount) : ""}</td>
                  <td className="num px-3 py-2 text-right font-medium">{isOpen ? money(i.remaining_amount) : ""}</td>
                  <td className="px-3 py-2">{statusBadge(i)}</td>
                  <td className="px-3 py-2 text-xs text-muted">
                    {i.plan_months?.map((p) => `${monthShort(p.year, p.month)} ${money(p.amount, true)}`).join(", ") || ""}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {isOpen && i.paid_amount === 0 && <button className="text-xs text-muted hover:text-danger" onClick={() => cancel(i)}>Cancel</button>}
                    {i.status === "cancelled" && <button className="text-xs text-primary hover:underline" onClick={() => restore(i)}>Restore</button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
      <PayInstallmentsModal open={payOpen} onClose={() => setPayOpen(false)} onSaved={done} installments={selected} accounts={accounts} />
      <DistributeModal open={spreadOpen} onClose={() => setSpreadOpen(false)} onSaved={done} installments={selected} />
    </>
  );
}
