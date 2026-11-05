import { useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { postTransaction, updateTransaction, type TxnPayload } from "../lib/api";
import { fmtDate, money, todayIST, uuid } from "../lib/format";
import { TXN_TYPES, isLiability, type TxnRow, type TxnType } from "../lib/types";
import type { Lookups } from "./useLookups";
import { Button, DateField, Field, Input, Pills, Row, Select, Sheet, T, useToast } from "./ui";

type F = {
  type: TxnType; amount: string; date: string; from: string; to: string; category: string; mode: string;
  goal: string; schedule: string; remarks: string; reference: string; direction: "in" | "out";
};
export type TxnPreset = Partial<Pick<F, "from" | "to" | "amount" | "remarks" | "goal" | "schedule">>;

const shape: Record<TxnType, { from?: string; to?: string; toOptional?: boolean; category?: "income" | "expense" }> = {
  income: { to: "Received into", category: "income" },
  expense: { from: "Paid from", category: "expense" },
  transfer: { from: "From account", to: "To account" },
  credit_card_payment: { from: "Paid from", to: "Card / loan paid" },
  goal_contribution: { from: "From account", to: "Into goal account (optional)", toOptional: true },
  commitment_payment: { from: "Paid from", category: "expense" },
  adjustment: { from: "Account" },
};
const empty = (type: TxnType = "expense"): F => ({
  type, amount: "", date: todayIST(), from: "", to: "", category: "", mode: "", goal: "", schedule: "", remarks: "", reference: "", direction: "out",
});
function fromRow(r: TxnRow): F {
  const adj = r.transaction_type === "adjustment";
  return {
    type: r.transaction_type, amount: String(r.amount), date: r.transaction_date,
    from: adj ? (r.from_account_id ?? r.to_account_id ?? "") : (r.from_account_id ?? ""), to: adj ? "" : (r.to_account_id ?? ""),
    category: r.category_id ?? "", mode: r.payment_mode_id ?? "", goal: r.goal_id ?? "", schedule: r.commitment_schedule_id ?? "",
    remarks: r.remarks ?? "", reference: r.reference_no ?? "", direction: adj && r.to_account_id ? "in" : "out",
  };
}

/** Full-screen form for every transaction type (same rules as the web form). */
export function TxnForm({ open, onClose, onSaved, lookups, editing, defaultType, preset }:
  { open: boolean; onClose: () => void; onSaved: () => void; lookups: Lookups; editing?: TxnRow | null; defaultType?: TxnType; preset?: TxnPreset }) {
  const toast = useToast();
  const [f, setF] = useState<F>(empty());
  const [requestId, setRequestId] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setF(editing ? fromRow(editing) : { ...empty(defaultType), ...preset });
    setRequestId(uuid());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing, defaultType]);

  const s = shape[f.type];
  const set = <K extends keyof F>(k: K, v: F[K]) => setF((x) => ({ ...x, [k]: v }));
  const active = lookups.accounts.filter((a) => a.active);
  const accountOptions = (role: "from" | "to") =>
    (f.type === "credit_card_payment" ? active.filter((a) => (role === "to" ? isLiability(a.account_type) : a.account_type !== "credit_card")) : active)
      .map((a) => ({ value: a.id, label: a.name, sub: isLiability(a.account_type) ? `owed ${money(Math.max(-a.current_balance, 0), true)}` : money(a.current_balance, true) }));
  const cats = useMemo(() => lookups.categories.filter((c) => c.active && (!s.category || c.category_group === "both" || c.category_group === s.category))
    .map((c) => ({ value: c.id, label: c.name })), [lookups.categories, s.category]);
  const installment = lookups.installments.find((i) => i.id === f.schedule);

  async function save() {
    const amount = Number(f.amount);
    if (!(amount > 0)) return toast("err", "Enter an amount greater than zero");
    const p: TxnPayload = {
      transaction_type: f.type, amount, transaction_date: f.date, from_account_id: null, to_account_id: null,
      category_id: s.category ? f.category || null : null, payment_mode_id: f.mode || null,
      goal_id: f.type === "goal_contribution" ? f.goal || null : null,
      commitment_schedule_id: f.type === "commitment_payment" ? f.schedule || null : null,
      remarks: f.remarks.trim() || null, reference_no: f.reference.trim() || null,
    };
    if (f.type === "adjustment") { if (f.direction === "in") p.to_account_id = f.from || null; else p.from_account_id = f.from || null; }
    else { if (s.from) p.from_account_id = f.from || null; if (s.to) p.to_account_id = f.to || null; }
    setBusy(true);
    try {
      if (editing) await updateTransaction(editing.id, p);
      else await postTransaction({ ...p, client_request_id: requestId });
      toast("ok", editing ? "Transaction updated" : "Transaction saved");
      onSaved(); onClose();
    } catch (e) { toast("err", (e as Error).message); } finally { setBusy(false); }
  }

  return (
    <Sheet full open={open} onClose={onClose} title={editing ? "Edit transaction" : "New transaction"}
      footer={<><Button title="Cancel" onPress={onClose} /><Button variant="primary" title={editing ? "Save changes" : "Save"} busy={busy} onPress={save} /></>}>
      <Pills options={TXN_TYPES} value={f.type} onChange={(v) => set("type", v)} />
      <Row style={{ alignItems: "flex-start" }}>
        <Field label="Amount (₹)" style={{ flex: 1 }}>
          <Input keyboardType="decimal-pad" value={f.amount} onChangeText={(v) => set("amount", v)} autoFocus={!editing} style={{ fontSize: 20, fontWeight: "600" }} />
        </Field>
        <Field label="Date" style={{ flex: 1 }}><DateField value={f.date} onChange={(v) => set("date", v)} /></Field>
      </Row>
      {f.type === "adjustment" && (
        <Field label="Direction">
          <Pills options={[{ value: "out", label: "Decrease balance" }, { value: "in", label: "Increase balance" }]} value={f.direction} onChange={(v) => set("direction", v as F["direction"])} />
        </Field>
      )}
      {s.from && <Field label={s.from}><Select title={s.from} value={f.from} onChange={(v) => set("from", v)} options={accountOptions("from")} placeholder="Select account" /></Field>}
      {s.to && <Field label={s.to}><Select title={s.to} value={f.to} onChange={(v) => set("to", v)} options={accountOptions("to")} placeholder="Select account" allowEmpty={s.toOptional ? "— none —" : undefined} /></Field>}
      {f.type === "goal_contribution" && (
        <Field label="Goal">
          <Select title="Goal" value={f.goal} placeholder="Select goal" options={lookups.goals.map((g) => ({ value: g.id, label: g.name }))}
            onChange={(v) => { const g = lookups.goals.find((x) => x.id === v); setF((x) => ({ ...x, goal: v, to: g?.account_id && !x.to ? g.account_id : x.to })); }} />
        </Field>
      )}
      {f.type === "commitment_payment" && (
        <Field label="Installment" hint={installment ? `Remaining ${money(installment.remaining_amount)}` : "Open installments from your commitments"}>
          <Select title="Installment" value={f.schedule} placeholder="Select installment"
            options={lookups.installments.map((i) => ({ value: i.id, label: `${i.commitment_name} #${i.installment_no}`, sub: `due ${fmtDate(i.due_date)} · ${money(i.remaining_amount)}` }))}
            onChange={(v) => { const i = lookups.installments.find((x) => x.id === v);
              setF((x) => ({ ...x, schedule: v, amount: x.amount || (i ? String(i.remaining_amount) : ""), remarks: x.remarks || (i ? `${i.commitment_name} #${i.installment_no}` : "") })); }} />
        </Field>
      )}
      {s.category && <Field label="Category"><Select title="Category" value={f.category} onChange={(v) => set("category", v)} options={cats} allowEmpty="— none —" placeholder="— none —" /></Field>}
      <Field label="Payment mode">
        <Select title="Payment mode" value={f.mode} onChange={(v) => set("mode", v)} allowEmpty="— none —" placeholder="— none —"
          options={lookups.modes.filter((m) => m.active).map((m) => ({ value: m.id, label: m.name }))} />
      </Field>
      <Field label="Reference no."><Input value={f.reference} onChangeText={(v) => set("reference", v)} /></Field>
      <Field label="Remarks"><Input multiline value={f.remarks} onChangeText={(v) => set("remarks", v)} /></Field>
      {f.type === "credit_card_payment" && <View><T muted size={12}>Card payments reduce the card outstanding and are not counted as an expense again.</T></View>}
    </Sheet>
  );
}
