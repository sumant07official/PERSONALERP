"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  deletePlanItem, finalizePlan, generatePlan, getPlan, listInstallments, listPlanItems, payPlanItem, reopenPlan, savePlanItem, updatePlan,
} from "@/lib/api";
import { downloadCsv, fmtDate, money, monthLabel, todayIST } from "@/lib/format";
import { isLiability, type Installment, type MonthlyPlan, type PlanItem, type Priority } from "@/lib/types";
import { DistributeModal } from "@/components/installment-modals";
import { useLookups } from "@/components/use-lookups";
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Modal, PageHeader, Pill, Select, Spinner, Textarea, cx, useToast } from "@/components/ui";

const PRIORITY_ORDER: Record<Priority, number> = { critical: 0, high: 1, normal: 2, low: 3 };
const prioTone = (p: Priority) => (p === "critical" ? "danger" : p === "high" ? "warning" : p === "normal" ? "primary" : "neutral");
const statusTone = (s: string) =>
  s === "paid" ? "success" : s === "partial" ? "warning" : s === "rejected" ? "neutral" : s === "suggested" ? "primary" : "neutral";
const typeLabel: Record<string, string> = { commitment: "Commitment", credit_card: "Card bill", goal: "Goal", manual: "Manual" };

export default function PlanningPage() {
  const toast = useToast();
  const { lookups, reload: reloadLookups } = useLookups();
  const [month, setMonth] = useState(todayIST().slice(0, 7));
  const [plan, setPlan] = useState<MonthlyPlan | null | undefined>(undefined);
  const [items, setItems] = useState<PlanItem[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<"open" | "all" | "suggested" | "rejected">("all");
  const [edit, setEdit] = useState<Partial<PlanItem> | null>(null);
  const [pay, setPay] = useState<PlanItem | null>(null);
  const [spread, setSpread] = useState<Installment[] | null>(null);
  const [income, setIncome] = useState("");

  const [y, m] = month.split("-").map(Number);
  const load = useCallback(async () => {
    setError("");
    try {
      const p = await getPlan(y, m);
      setPlan(p);
      setIncome(p ? String(p.expected_income) : "");
      setItems(p ? await listPlanItems(p.id) : []);
    } catch (e) { setError((e as Error).message); }
  }, [y, m]);
  useEffect(() => { setPlan(undefined); load(); }, [load]);

  const refresh = () => { load(); reloadLookups(); };
  const editable = plan?.status !== "closed";
  const draft = plan?.status === "draft";

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    try { await fn(); toast("ok", ok); await load(); } catch (e) { toast("err", (e as Error).message); } finally { setBusy(false); }
  }

  const sorted = useMemo(() => [...items]
    .filter((i) => filter === "all" ? true : filter === "open" ? !["paid", "rejected"].includes(i.display_status)
      : filter === "suggested" ? i.status === "suggested" : i.status === "rejected")
    .sort((a, b) => (a.status === "rejected" ? 1 : 0) - (b.status === "rejected" ? 1 : 0)
      || PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] || (a.planned_date ?? "").localeCompare(b.planned_date ?? "")), [items, filter]);

  async function openSpread(i: PlanItem) {
    try {
      const rows = await listInstallments({ openOnly: true });
      const it = rows.find((r) => r.id === i.source_id);
      if (it) setSpread([it]); else toast("err", "This installment is no longer open");
    } catch (e) { toast("err", (e as Error).message); }
  }

  async function saveEdit() {
    if (!edit || !plan) return;
    if (!edit.item_name?.trim()) return toast("err", "Name is required");
    const input = {
      item_name: edit.item_name.trim(), planned_amount: Number(edit.planned_amount) || 0, planned_date: edit.planned_date || null,
      priority: (edit.priority ?? "normal") as Priority, account_id: edit.account_id || null, category_id: edit.category_id || null, remarks: edit.remarks || null,
    };
    await run(() => edit.id ? savePlanItem(input, edit.id)
      : savePlanItem({ ...input, plan_id: plan.id, item_type: "manual", status: "accepted" }), edit.id ? "Item updated" : "Item added");
    setEdit(null);
  }

  return (
    <>
      <PageHeader title="Monthly plan" subtitle={monthLabel(`${month}-01`)}
        actions={<>
          <Input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} className="w-40" />
          {plan && draft && <Button busy={busy} onClick={() => run(() => generatePlan(y, m), "Suggestions refreshed")}>Refresh suggestions</Button>}
          {plan && <Button onClick={() => downloadCsv(`plan-${month}.csv`, sorted.map((i) => ({
            item: i.item_name, type: i.item_type, date: i.planned_date, priority: i.priority, planned: i.planned_amount, paid: i.paid_amount,
            remaining: i.remaining_amount, status: i.display_status, reason: i.suggestion_reason })))}>Export</Button>}
          {plan && <Button onClick={() => window.print()}>Print</Button>}
          {plan && draft && <Button variant="primary" busy={busy} onClick={() => run(() => finalizePlan(plan.id), "Plan finalized")}>Finalize</Button>}
          {plan && !draft && <Button busy={busy} onClick={() => run(() => reopenPlan(plan.id), "Plan reopened as draft")}>Reopen</Button>}
        </>} />

      {error && <ErrorBox message={error} />}
      {plan === undefined && !error && <Spinner />}

      {plan === null && (
        <Card>
          <Empty title={`No plan for ${monthLabel(`${month}-01`)} yet`}
            hint="Generate a draft. It collects installments due this month, overdue ones carried forward, payments you scheduled here, credit card bills, goal contributions and last month's unpaid items, with a reason for each."
            action={<Button variant="primary" busy={busy} onClick={() => run(() => generatePlan(y, m), "Draft plan generated")}>Generate plan</Button>} />
        </Card>
      )}

      {plan && (
        <>
          <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Card className="p-3">
              <p className="text-xs text-muted">Expected income</p>
              {editable ? (
                <input className="num w-full bg-transparent text-lg font-semibold outline-none focus:text-primary" type="number" value={income}
                  onChange={(e) => setIncome(e.target.value)}
                  onBlur={() => Number(income) !== Number(plan.expected_income) && run(() => updatePlan(plan.id, { expected_income: Number(income) || 0 }), "Income updated")} />
              ) : <p className="num text-lg font-semibold">{money(plan.expected_income, true)}</p>}
            </Card>
            <Card className="p-3"><p className="text-xs text-muted">Planned payments</p><p className="num text-lg font-semibold">{money(plan.planned_expense, true)}</p></Card>
            <Card className="p-3"><p className="text-xs text-muted">Paid</p><p className="num text-lg font-semibold text-success">{money(plan.paid_amount, true)}</p></Card>
            <Card className="p-3"><p className="text-xs text-muted">Still to pay</p><p className="num text-lg font-semibold text-warning">{money(plan.remaining_amount, true)}</p></Card>
            <Card className="p-3"><p className="text-xs text-muted">Expected savings</p>
              <p className={cx("num text-lg font-semibold", plan.expected_savings < 0 ? "text-danger" : "text-success")}>{money(plan.expected_savings, true)}</p></Card>
          </div>

          <div className="no-print mb-3 flex flex-wrap items-center gap-2">
            <Badge tone={plan.status === "draft" ? "warning" : "success"}>{plan.status}</Badge>
            {plan.critical_open_count > 0 && <Badge tone="danger">{plan.critical_open_count} critical open</Badge>}
            {plan.suggested_count > 0 && <span className="text-xs text-muted">{plan.suggested_count} suggestions waiting for accept/reject</span>}
            <span className="flex-1" />
            <Pill active={filter === "all"} onClick={() => setFilter("all")}>All</Pill>
            <Pill active={filter === "open"} onClick={() => setFilter("open")}>To pay</Pill>
            <Pill active={filter === "suggested"} onClick={() => setFilter("suggested")}>Suggested</Pill>
            <Pill active={filter === "rejected"} onClick={() => setFilter("rejected")}>Rejected</Pill>
            {editable && <Button variant="primary" onClick={() => setEdit({ priority: "normal", planned_date: `${month}-01` })}>+ Add item</Button>}
          </div>

          {sorted.length === 0 ? <Card><Empty title="Nothing in this view" /></Card> : (
            <div className="flex flex-col gap-2">
              {sorted.map((i) => {
                const rejected = i.status === "rejected";
                return (
                  <Card key={i.id} className={cx("p-3", rejected && "opacity-60")}>
                    <div className="flex flex-wrap items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className={cx("font-medium", rejected && "line-through")}>{i.item_name}</span>
                          <Badge tone={prioTone(i.priority)}>{i.priority}</Badge>
                          <Badge>{typeLabel[i.item_type] ?? i.item_type}</Badge>
                          <Badge tone={statusTone(i.display_status)}>{i.display_status}</Badge>
                        </div>
                        {i.suggestion_reason && <p className="mt-1 text-xs text-muted">💡 {i.suggestion_reason}</p>}
                        <p className="mt-1 text-xs text-muted">
                          {i.planned_date && <>Pay by {fmtDate(i.planned_date)}</>}
                          {i.account_name && <> · from {i.account_name}</>}
                          {i.category_name && <> · {i.category_name}</>}
                          {i.remarks && <> · {i.remarks}</>}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="num font-semibold">{money(i.planned_amount)}</p>
                        {i.paid_amount > 0 && <p className="num text-xs text-success">paid {money(i.paid_amount)}</p>}
                        {i.paid_amount > 0 && i.remaining_amount > 0 && <p className="num text-xs text-warning">left {money(i.remaining_amount)}</p>}
                      </div>
                    </div>
                    {editable && (
                      <div className="no-print mt-2 flex flex-wrap gap-1.5 border-t border-line pt-2">
                        {i.status === "suggested" && <>
                          <Button className="h-7 text-xs" variant="primary" onClick={() => run(() => savePlanItem({ status: "accepted" }, i.id), "Accepted")}>Accept</Button>
                          <Button className="h-7 text-xs" onClick={() => run(() => savePlanItem({ status: "rejected" }, i.id), "Rejected")}>Reject</Button>
                        </>}
                        {rejected && <Button className="h-7 text-xs" onClick={() => run(() => savePlanItem({ status: "accepted" }, i.id), "Restored")}>Restore</Button>}
                        {!rejected && i.remaining_amount > 0 && <Button className="h-7 text-xs" variant={i.status === "suggested" ? "secondary" : "primary"} onClick={() => setPay(i)}>Pay</Button>}
                        {!rejected && <Button className="h-7 text-xs" onClick={() => setEdit(i)}>Edit</Button>}
                        {i.source_type === "schedule" && !rejected && i.remaining_amount > 0 &&
                          <Button className="h-7 text-xs" onClick={() => openSpread(i)}>Spread over months</Button>}
                        {i.status !== "suggested" && <Button className="h-7 text-xs" variant="ghost" onClick={() => run(() => savePlanItem({ status: "deferred" }, i.id), "Moved to next month")}>Defer</Button>}
                        {(i.source_type === null || i.source_type === "plan_item") && i.paid_amount === 0 &&
                          <Button className="ml-auto h-7 text-xs text-danger" variant="ghost"
                            onClick={() => confirm(`Remove "${i.item_name}"?`) && run(() => deletePlanItem(i.id), "Removed")}>Remove</Button>}
                      </div>
                    )}
                  </Card>
                );
              })}
            </div>
          )}

          {editable && (
            <Card className="no-print mt-3 p-3">
              <Field label="Notes for this month">
                <Textarea defaultValue={plan.notes ?? ""} key={plan.id}
                  onBlur={(e) => e.target.value !== (plan.notes ?? "") && run(() => updatePlan(plan.id, { notes: e.target.value || null }), "Notes saved")} />
              </Field>
            </Card>
          )}
        </>
      )}

      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? "Edit plan item" : "Add plan item"}
        footer={<><Button onClick={() => setEdit(null)}>Cancel</Button><Button variant="primary" busy={busy} onClick={saveEdit}>Save</Button></>}>
        {edit && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Item" className="col-span-2"><Input autoFocus value={edit.item_name ?? ""} disabled={!!edit.source_type && edit.source_type !== "plan_item"}
              onChange={(e) => setEdit({ ...edit, item_name: e.target.value })} placeholder="e.g. Gift, Car service, School fees" /></Field>
            <Field label="Amount (₹)"><Input type="number" step="0.01" value={edit.planned_amount ?? ""} onChange={(e) => setEdit({ ...edit, planned_amount: e.target.value as unknown as number })} /></Field>
            <Field label="Pay by"><Input type="date" value={edit.planned_date ?? ""} onChange={(e) => setEdit({ ...edit, planned_date: e.target.value })} /></Field>
            <Field label="Priority">
              <Select value={edit.priority ?? "normal"} onChange={(e) => setEdit({ ...edit, priority: e.target.value as Priority })}>
                <option value="critical">Critical</option><option value="high">High</option><option value="normal">Normal</option><option value="low">Low</option>
              </Select>
            </Field>
            <Field label="Pay from">
              <Select value={edit.account_id ?? ""} onChange={(e) => setEdit({ ...edit, account_id: e.target.value })}>
                <option value="">— choose later —</option>
                {lookups?.accounts.filter((a) => a.active).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </Select>
            </Field>
            {(!edit.source_type || edit.source_type === "plan_item") && (
              <Field label="Category" className="col-span-2">
                <Select value={edit.category_id ?? ""} onChange={(e) => setEdit({ ...edit, category_id: e.target.value })}>
                  <option value="">— none —</option>
                  {lookups?.categories.filter((c) => c.active && c.category_group !== "income").map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </Field>
            )}
            <Field label="Remarks" className="col-span-2"><Input value={edit.remarks ?? ""} onChange={(e) => setEdit({ ...edit, remarks: e.target.value })} /></Field>
            {edit.suggestion_reason && <p className="col-span-2 text-xs text-muted">Editing a suggestion accepts it, so refreshing suggestions will not overwrite your change.</p>}
          </div>
        )}
      </Modal>

      {pay && lookups && <PayItemModal item={pay} onClose={() => setPay(null)} onSaved={refresh} accounts={lookups.accounts} />}
      {spread && <DistributeModal open onClose={() => setSpread(null)} onSaved={refresh} installments={spread} />}
    </>
  );
}

function PayItemModal({ item, onClose, onSaved, accounts }:
  { item: PlanItem; onClose: () => void; onSaved: () => void; accounts: import("@/lib/types").Account[] }) {
  const toast = useToast();
  const isCard = item.source_type === "account";
  const options = accounts.filter((a) => a.active && a.id !== item.source_id && (!isCard || a.account_type !== "credit_card"));
  const [from, setFrom] = useState(item.account_id && options.some((a) => a.id === item.account_id) ? item.account_id : "");
  const [amount, setAmount] = useState(String(item.remaining_amount));
  const [date, setDate] = useState(todayIST());
  const [requestId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!from) return toast("err", "Choose the account you paid from");
    if (!(Number(amount) > 0)) return toast("err", "Enter an amount");
    setBusy(true);
    try {
      await payPlanItem(item.id, from, Number(amount), date, requestId);
      toast("ok", `Paid ${money(Number(amount))} for ${item.item_name}`);
      onSaved(); onClose();
    } catch (e) { toast("err", (e as Error).message); } finally { setBusy(false); }
  }

  return (
    <Modal open onClose={onClose} title={`Pay: ${item.item_name}`}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} onClick={save}>Record payment</Button></>}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Amount (₹)" hint={`Remaining ${money(item.remaining_amount)}`}><Input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus /></Field>
        <Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Paid from" className="col-span-2">
          <Select value={from} onChange={(e) => setFrom(e.target.value)}>
            <option value="">Select account</option>
            {options.map((a) => <option key={a.id} value={a.id}>{a.name} ({isLiability(a.account_type) ? "card/loan" : money(a.current_balance, true)})</option>)}
          </Select>
        </Field>
      </div>
      <p className="mt-3 text-xs text-muted">
        {item.source_type === "schedule" && "Recorded as a commitment payment against this installment."}
        {item.source_type === "account" && "Recorded as a card bill payment (not counted as an expense again)."}
        {item.source_type === "goal" && "Recorded as a goal contribution."}
        {(item.source_type === null || item.source_type === "plan_item") && "Recorded as an expense."}
      </p>
    </Modal>
  );
}
