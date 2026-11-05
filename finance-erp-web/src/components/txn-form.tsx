"use client";

import { useEffect, useMemo, useState } from "react";
import { postTransaction, updateTransaction, type TxnPayload } from "@/lib/api";
import { money, todayIST } from "@/lib/format";
import { TXN_TYPES, isLiability, type Account, type GoalOption, type InstallmentOption, type MasterRow, type TxnRow, type TxnType } from "@/lib/types";
import { Button, Field, Input, Modal, Select, Textarea, useToast } from "./ui";

export interface Lookups {
  accounts: Account[];
  categories: MasterRow[];
  modes: MasterRow[];
  goals: GoalOption[];
  installments: InstallmentOption[];
}

type F = {
  type: TxnType; amount: string; date: string; from: string; to: string; category: string; mode: string;
  goal: string; schedule: string; remarks: string; reference: string; direction: "in" | "out";
};

function fromRow(r: TxnRow): F {
  const adjIn = r.transaction_type === "adjustment" && !!r.to_account_id;
  return {
    type: r.transaction_type, amount: String(r.amount), date: r.transaction_date,
    from: r.transaction_type === "adjustment" ? (r.from_account_id ?? r.to_account_id ?? "") : (r.from_account_id ?? ""),
    to: r.transaction_type === "adjustment" ? "" : (r.to_account_id ?? ""),
    category: r.category_id ?? "", mode: r.payment_mode_id ?? "", goal: r.goal_id ?? "",
    schedule: r.commitment_schedule_id ?? "", remarks: r.remarks ?? "", reference: r.reference_no ?? "",
    direction: adjIn ? "in" : "out",
  };
}
const empty = (type: TxnType = "expense"): F => ({
  type, amount: "", date: todayIST(), from: "", to: "", category: "", mode: "", goal: "", schedule: "", remarks: "", reference: "", direction: "out",
});

/** Which account fields each type needs. */
const shape: Record<TxnType, { from?: string; to?: string; toOptional?: boolean; category?: "income" | "expense" }> = {
  income: { to: "Received into", category: "income" },
  expense: { from: "Paid from", category: "expense" },
  transfer: { from: "From account", to: "To account" },
  credit_card_payment: { from: "Paid from", to: "Card / loan paid" },
  goal_contribution: { from: "From account", to: "Into goal account (optional)", toOptional: true },
  commitment_payment: { from: "Paid from", category: "expense" },
  adjustment: { from: "Account" },
};

export function TxnForm({ open, onClose, onSaved, lookups, editing, defaultType, preset }:
  { open: boolean; onClose: () => void; onSaved: () => void; lookups: Lookups; editing?: TxnRow | null; defaultType?: TxnType;
    preset?: Partial<Pick<F, "from" | "to" | "amount" | "remarks" | "goal">> }) {
  const toast = useToast();
  const [f, setF] = useState<F>(empty());
  const [requestId, setRequestId] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setF(editing ? fromRow(editing) : { ...empty(defaultType), ...preset });
    setRequestId(crypto.randomUUID()); // one id per form open → a double click can never post twice
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing, defaultType]);

  const s = shape[f.type];
  const active = lookups.accounts.filter((a) => a.active);
  const accountsFor = (role: "from" | "to") => {
    if (f.type === "credit_card_payment") return active.filter((a) => (role === "to" ? isLiability(a.account_type) : a.account_type !== "credit_card"));
    return active;
  };
  const cats = useMemo(() => lookups.categories.filter((c) => c.active &&
    (!s.category || c.category_group === "both" || c.category_group === s.category)), [lookups.categories, s.category]);
  const installment = lookups.installments.find((i) => i.id === f.schedule);

  function set<K extends keyof F>(k: K, v: F[K]) { setF((x) => ({ ...x, [k]: v })); }

  async function save() {
    const amount = Number(f.amount);
    if (!(amount > 0)) return toast("err", "Enter an amount greater than zero");
    const p: TxnPayload = {
      transaction_type: f.type, amount, transaction_date: f.date,
      from_account_id: null, to_account_id: null,
      category_id: s.category ? f.category || null : null,
      payment_mode_id: f.mode || null,
      goal_id: f.type === "goal_contribution" ? f.goal || null : null,
      commitment_schedule_id: f.type === "commitment_payment" ? f.schedule || null : null,
      remarks: f.remarks || null, reference_no: f.reference || null,
    };
    if (f.type === "adjustment") {
      if (f.direction === "in") p.to_account_id = f.from || null; else p.from_account_id = f.from || null;
    } else {
      if (s.from) p.from_account_id = f.from || null;
      if (s.to) p.to_account_id = f.to || null;
    }
    setBusy(true);
    try {
      if (editing) await updateTransaction(editing.id, p);
      else await postTransaction({ ...p, client_request_id: requestId });
      toast("ok", editing ? "Transaction updated" : "Transaction saved");
      onSaved();
      onClose();
    } catch (e) {
      toast("err", (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const accSelect = (role: "from" | "to", label: string, optional = false) => (
    <Field label={label}>
      <Select value={role === "from" ? f.from : f.to} onChange={(e) => set(role, e.target.value)}>
        <option value="">{optional ? "— none —" : "Select account"}</option>
        {accountsFor(role).map((a) => (
          <option key={a.id} value={a.id}>
            {a.name} ({isLiability(a.account_type) ? `owed ${money(Math.max(-a.current_balance, 0), true)}` : money(a.current_balance, true)})
          </option>
        ))}
      </Select>
    </Field>
  );

  return (
    <Modal open={open} onClose={onClose} title={editing ? "Edit transaction" : "New transaction"}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} onClick={save}>{editing ? "Save changes" : "Save"}</Button></>}>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2 flex flex-wrap gap-1.5">
          {TXN_TYPES.map((t) => (
            <button key={t.value} onClick={() => set("type", t.value)}
              className={`rounded-full border px-2.5 h-7 text-xs font-medium ${f.type === t.value ? "border-primary bg-primary-soft text-primary" : "border-line text-muted"}`}>
              {t.label}
            </button>
          ))}
        </div>
        <Field label="Amount (₹)"><Input type="number" inputMode="decimal" step="0.01" min="0" value={f.amount} onChange={(e) => set("amount", e.target.value)} autoFocus /></Field>
        <Field label="Date"><Input type="date" value={f.date} onChange={(e) => set("date", e.target.value)} /></Field>

        {f.type === "adjustment" && (
          <Field label="Direction">
            <Select value={f.direction} onChange={(e) => set("direction", e.target.value as F["direction"])}>
              <option value="out">Decrease balance</option><option value="in">Increase balance</option>
            </Select>
          </Field>
        )}
        {s.from && accSelect("from", s.from)}
        {s.to && accSelect("to", s.to, s.toOptional)}

        {f.type === "goal_contribution" && (
          <Field label="Goal">
            <Select value={f.goal} onChange={(e) => {
              const g = lookups.goals.find((x) => x.id === e.target.value);
              setF((x) => ({ ...x, goal: e.target.value, to: g?.account_id && !x.to ? g.account_id : x.to }));
            }}>
              <option value="">Select goal</option>
              {lookups.goals.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </Select>
          </Field>
        )}
        {f.type === "commitment_payment" && (
          <Field label="Installment" className="col-span-2"
            hint={installment ? `Remaining on this installment: ${money(installment.remaining_amount)}` : "Open installments from your commitments"}>
            <Select value={f.schedule} onChange={(e) => {
              const i = lookups.installments.find((x) => x.id === e.target.value);
              setF((x) => ({ ...x, schedule: e.target.value, amount: x.amount || (i ? String(i.remaining_amount) : ""), remarks: x.remarks || (i ? `${i.commitment_name} #${i.installment_no}` : "") }));
            }}>
              <option value="">Select installment</option>
              {lookups.installments.map((i) => (
                <option key={i.id} value={i.id}>{i.commitment_name} #{i.installment_no} · due {i.due_date} · {money(i.remaining_amount)}</option>
              ))}
            </Select>
          </Field>
        )}
        {s.category && (
          <Field label="Category">
            <Select value={f.category} onChange={(e) => set("category", e.target.value)}>
              <option value="">— none —</option>
              {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
        )}
        <Field label="Payment mode">
          <Select value={f.mode} onChange={(e) => set("mode", e.target.value)}>
            <option value="">— none —</option>
            {lookups.modes.filter((m) => m.active).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </Select>
        </Field>
        <Field label="Reference no."><Input value={f.reference} onChange={(e) => set("reference", e.target.value)} /></Field>
        <Field label="Remarks" className="col-span-2"><Textarea value={f.remarks} onChange={(e) => set("remarks", e.target.value)} /></Field>
        {f.type === "credit_card_payment" && (
          <p className="col-span-2 text-xs text-muted">Card payments reduce the card outstanding and are not counted as an expense (the purchases already were).</p>
        )}
      </div>
    </Modal>
  );
}
