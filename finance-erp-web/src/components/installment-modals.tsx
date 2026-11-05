"use client";

import { useEffect, useMemo, useState } from "react";
import { distributeOutstanding, postTransaction } from "@/lib/api";
import { fmtDate, money, todayIST } from "@/lib/format";
import { isLiability, type Account, type Installment } from "@/lib/types";
import { Button, Field, Input, Modal, Select, useToast } from "./ui";

const addMonths = (ym: string, n: number) => {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};
const ymLabel = (ym: string) => new Date(ym + "-01T00:00:00").toLocaleDateString("en-IN", { month: "short", year: "numeric" });

/** Pay one or more installments in one payment. Oldest due is settled first. */
export function PayInstallmentsModal({ open, onClose, onSaved, installments, accounts }:
  { open: boolean; onClose: () => void; onSaved: () => void; installments: Installment[]; accounts: Account[] }) {
  const toast = useToast();
  const sorted = useMemo(() => [...installments].sort((a, b) => a.due_date.localeCompare(b.due_date)), [installments]);
  const total = sorted.reduce((s, i) => s + Number(i.remaining_amount), 0);
  const [from, setFrom] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayIST());
  const [requestId, setRequestId] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFrom(sorted[0]?.default_account_id ?? "");
    setAmount(total.toFixed(2));
    setDate(todayIST());
    setRequestId(crypto.randomUUID());
  }, [open, sorted, total]);

  // allocate the amount across installments, oldest first
  const plan = useMemo(() => {
    let left = Number(amount) || 0;
    return sorted.map((i) => {
      const take = Math.min(left, Number(i.remaining_amount));
      left = Math.round((left - take) * 100) / 100;
      return { i, take: Math.round(take * 100) / 100 };
    });
  }, [sorted, amount]);

  async function save() {
    const amt = Number(amount);
    if (!(amt > 0)) return toast("err", "Enter an amount");
    if (amt > total + 0.001) return toast("err", `Amount is more than the ${money(total)} outstanding`);
    if (!from) return toast("err", "Choose the account you paid from");
    setBusy(true);
    try {
      await postTransaction({
        transaction_type: "commitment_payment", amount: amt, transaction_date: date, from_account_id: from,
        remarks: sorted.length === 1 ? `${sorted[0].commitment_name} #${sorted[0].installment_no}` : `${sorted[0].commitment_name} · ${sorted.length} installments`,
        allocations: plan.filter((p) => p.take > 0).map((p) => ({ schedule_id: p.i.id, amount: p.take })),
        client_request_id: requestId,
      });
      toast("ok", `Payment of ${money(amt)} recorded`);
      onSaved(); onClose();
    } catch (e) { toast("err", (e as Error).message); } finally { setBusy(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title="Pay installments"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} onClick={save}>Record payment</Button></>}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Amount (₹)" hint={`Outstanding on selected: ${money(total)}`}>
          <Input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Paid from" className="col-span-2">
          <Select value={from} onChange={(e) => setFrom(e.target.value)}>
            <option value="">Select account</option>
            {accounts.filter((a) => a.active).map((a) => (
              <option key={a.id} value={a.id}>{a.name} ({isLiability(a.account_type) ? "card/loan" : money(a.current_balance, true)})</option>
            ))}
          </Select>
        </Field>
      </div>
      <p className="mt-4 mb-1 text-xs font-medium text-muted">How the payment is applied (oldest first)</p>
      <div className="divide-y divide-line rounded-md border border-line text-sm">
        {plan.map(({ i, take }) => (
          <div key={i.id} className="flex justify-between px-3 py-2">
            <span>{i.commitment_name} #{i.installment_no} <span className="text-muted">· due {fmtDate(i.due_date)}</span></span>
            <span className="num">{money(take)} <span className="text-muted">/ {money(i.remaining_amount)}</span></span>
          </div>
        ))}
      </div>
    </Modal>
  );
}

/** Spread outstanding installments across future months (equal / all at once / custom). */
export function DistributeModal({ open, onClose, onSaved, installments }:
  { open: boolean; onClose: () => void; onSaved: () => void; installments: Installment[] }) {
  const toast = useToast();
  const total = installments.reduce((s, i) => s + Number(i.remaining_amount), 0);
  const thisMonth = todayIST().slice(0, 7);
  const [mode, setMode] = useState<"equal" | "all" | "custom">("equal");
  const [start, setStart] = useState(thisMonth);
  const [count, setCount] = useState(2);
  const [rows, setRows] = useState<{ month: string; amount: string }[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setMode("equal"); setStart(thisMonth); setCount(2);
    setRows([{ month: thisMonth, amount: "" }, { month: addMonths(thisMonth, 1), amount: "" }]);
  }, [open, thisMonth]);

  const months = mode === "custom" ? rows.map((r) => r.month) : Array.from({ length: mode === "all" ? 1 : count }, (_, k) => addMonths(start, k));
  const customTotal = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const each = mode === "equal" && count > 0 ? total / count : total;

  async function save() {
    if (mode === "custom") {
      if (rows.some((r) => !(Number(r.amount) > 0))) return toast("err", "Every month needs an amount");
      if (customTotal > total + 0.001) return toast("err", `Total ${money(customTotal)} is more than the ${money(total)} outstanding`);
    }
    setBusy(true);
    try {
      await distributeOutstanding(installments.map((i) => i.id), months.map((m) => `${m}-01`), mode,
        mode === "custom" ? rows.map((r) => Number(r.amount)) : undefined);
      toast("ok", "Payment plan saved. It will appear in those months' plans.");
      onSaved(); onClose();
    } catch (e) { toast("err", (e as Error).message); } finally { setBusy(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title="Spread outstanding across months"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} onClick={save}>Save plan</Button></>}>
      <p className="mb-3 text-sm">
        {installments.length} installment{installments.length > 1 ? "s" : ""} · <b className="num">{money(total)}</b> outstanding.
        Original due dates and amounts never change; this only plans when you will pay.
      </p>
      <div className="mb-3 flex gap-1.5">
        {(["equal", "all", "custom"] as const).map((m) => (
          <button key={m} onClick={() => setMode(m)}
            className={`rounded-full border px-3 h-7 text-xs font-medium ${mode === m ? "border-primary bg-primary-soft text-primary" : "border-line text-muted"}`}>
            {m === "equal" ? "Split equally" : m === "all" ? "Pay all in one month" : "Custom amounts"}
          </button>
        ))}
      </div>
      {mode !== "custom" ? (
        <div className="grid grid-cols-2 gap-3">
          <Field label={mode === "all" ? "Month" : "Starting month"}><Input type="month" value={start} onChange={(e) => e.target.value && setStart(e.target.value)} /></Field>
          {mode === "equal" && (
            <Field label="Number of months"><Input type="number" min={1} max={36} value={count} onChange={(e) => setCount(Math.max(1, Number(e.target.value) || 1))} /></Field>
          )}
          <div className="col-span-2 rounded-md bg-surface-2 p-3 text-sm">
            {months.map((m) => <div key={m} className="flex justify-between"><span>{ymLabel(m)}</span><span className="num">≈ {money(each)}</span></div>)}
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_2rem] gap-2">
              <Input type="month" value={r.month} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, month: e.target.value } : x)))} />
              <Input type="number" placeholder="₹" value={r.amount} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} />
              <button className="text-muted hover:text-danger" onClick={() => rows.length > 1 && setRows(rows.filter((_, j) => j !== i))}>✕</button>
            </div>
          ))}
          <div className="flex items-center justify-between">
            <Button variant="ghost" className="text-primary" onClick={() => setRows([...rows, { month: addMonths(rows[rows.length - 1]?.month ?? thisMonth, 1), amount: "" }])}>+ Month</Button>
            <span className={`num text-sm ${customTotal > total ? "text-danger" : "text-muted"}`}>{money(customTotal)} of {money(total)}</span>
          </div>
        </div>
      )}
      <p className="mt-3 text-xs text-muted">Installments are paid in the order you selected them (oldest first by default).</p>
    </Modal>
  );
}
