"use client";

import { useCallback, useEffect, useState } from "react";
import { deleteGoal, listGoalContributions, listGoals, listMasters, saveGoal } from "@/lib/api";
import { fmtDate, money } from "@/lib/format";
import type { Goal, GoalContribution, MasterRow } from "@/lib/types";
import { TxnForm } from "@/components/txn-form";
import { useLookups } from "@/components/use-lookups";
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Modal, PageHeader, Pill, Select, Spinner, Textarea, cx, useToast } from "@/components/ui";

type F = { id?: string; name: string; type: string; target: string; date: string; status: Goal["status"]; notes: string; account: string };

export default function GoalsPage() {
  const toast = useToast();
  const { lookups, reload } = useLookups();
  const [goals, setGoals] = useState<Goal[] | null>(null);
  const [types, setTypes] = useState<MasterRow[]>([]);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<"active" | "all">("active");
  const [form, setForm] = useState<F | null>(null);
  const [busy, setBusy] = useState(false);
  const [contribute, setContribute] = useState<Goal | null>(null);
  const [history, setHistory] = useState<{ goal: Goal; rows: GoalContribution[] } | null>(null);

  const load = useCallback(() => { listGoals().then(setGoals).catch((e) => setError(e.message)); }, []);
  useEffect(() => { load(); listMasters("goal_types").then(setTypes).catch(() => {}); }, [load]);
  const refresh = () => { load(); reload(); };

  const shown = (goals ?? []).filter((g) => filter === "all" || g.status === "active" || g.status === "achieved");
  const totalTarget = shown.reduce((s, g) => s + Number(g.target_amount), 0);
  const totalSaved = shown.reduce((s, g) => s + Number(g.current_amount), 0);

  async function save() {
    if (!form) return;
    if (!form.name.trim() || !(Number(form.target) > 0)) return toast("err", "Name and a target amount are required");
    setBusy(true);
    try {
      await saveGoal({ name: form.name.trim(), goal_type_id: form.type || null, target_amount: Number(form.target), target_date: form.date || null,
        status: form.status, notes: form.notes.trim() || null, account_id: form.account || null }, form.id);
      toast("ok", form.id ? "Goal updated" : "Goal created");
      setForm(null); refresh();
    } catch (e) { toast("err", (e as Error).message); } finally { setBusy(false); }
  }
  async function remove() {
    if (!form?.id || !confirm(`Delete goal "${form.name}"? Contributions stay in your transactions.`)) return;
    try { await deleteGoal(form.id); toast("ok", "Goal deleted"); setForm(null); refresh(); } catch (e) { toast("err", (e as Error).message); }
  }
  async function openHistory(g: Goal) {
    try { setHistory({ goal: g, rows: await listGoalContributions(g.id) }); } catch (e) { toast("err", (e as Error).message); }
  }

  return (
    <>
      <PageHeader title="Goals" subtitle={goals ? `${money(totalSaved, true)} saved of ${money(totalTarget, true)}` : undefined}
        actions={<Button variant="primary" onClick={() => setForm({ name: "", type: "", target: "", date: "", status: "active", notes: "", account: "" })}>+ New goal</Button>} />
      <div className="mb-3 flex gap-2">
        <Pill active={filter === "active"} onClick={() => setFilter("active")}>Active & achieved</Pill>
        <Pill active={filter === "all"} onClick={() => setFilter("all")}>All</Pill>
      </div>
      {error && <ErrorBox message={error} />}
      {!goals && !error && <Spinner />}
      {goals && shown.length === 0 && (
        <Card><Empty title="No goals yet" hint="Create an Emergency Fund goal and any savings targets (trip, gadget, down payment). The monthly plan will suggest how much to save each month."
          action={<Button variant="primary" onClick={() => setForm({ name: "Emergency Fund", type: types.find((t) => /emergency/i.test(t.name))?.id ?? "", target: "", date: "", status: "active", notes: "", account: "" })}>+ Emergency fund goal</Button>} /></Card>
      )}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {shown.map((g) => (
          <Card key={g.id} className="p-4">
            <div className="mb-2 flex items-start justify-between gap-2">
              <div><p className="font-semibold">{g.name}</p><p className="text-xs text-muted">{g.goal_type ?? "Goal"}{g.account_name && ` · ${g.account_name}`}</p></div>
              <Badge tone={g.status === "achieved" ? "success" : g.status === "active" ? "primary" : "neutral"}>{g.status}</Badge>
            </div>
            <div className="flex items-end justify-between">
              <p className="num text-xl font-semibold">{money(g.current_amount, true)}</p>
              <p className="num text-sm text-muted">of {money(g.target_amount, true)}</p>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-2">
              <div className={cx("h-full rounded-full", g.status === "achieved" ? "bg-success" : "bg-primary")} style={{ width: `${g.progress_percent}%` }} />
            </div>
            <p className="mt-1 flex justify-between text-xs text-muted">
              <span>{g.progress_percent}% · {money(g.remaining_amount, true)} to go</span>
              <span>{g.target_date ? `by ${fmtDate(g.target_date)}` : "no deadline"}</span>
            </p>
            {g.monthly_needed != null && g.status === "active" && <p className="mt-2 rounded-md bg-primary-soft px-2 py-1 text-xs text-primary">Save {money(g.monthly_needed, true)} per month to reach it on time</p>}
            <div className="mt-3 flex gap-2">
              <Button variant="primary" className="flex-1" disabled={!lookups || g.status === "cancelled"} onClick={() => setContribute(g)}>Add money</Button>
              <Button onClick={() => openHistory(g)}>History ({g.contribution_count})</Button>
              <Button onClick={() => setForm({ id: g.id, name: g.name, type: g.goal_type_id ?? "", target: String(g.target_amount), date: g.target_date ?? "",
                status: g.status, notes: g.notes ?? "", account: g.account_id ?? "" })}>Edit</Button>
            </div>
          </Card>
        ))}
      </div>

      <Modal open={!!form} onClose={() => setForm(null)} title={form?.id ? "Edit goal" : "New goal"}
        footer={<>{form?.id && <Button variant="ghost" className="mr-auto text-danger" onClick={remove}>Delete</Button>}
          <Button onClick={() => setForm(null)}>Cancel</Button><Button variant="primary" busy={busy} onClick={save}>Save</Button></>}>
        {form && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Goal name" className="col-span-2"><Input autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="Target amount (₹)"><Input type="number" value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value })} /></Field>
            <Field label="Target date (optional)"><Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
            <Field label="Type">
              <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                <option value="">— none —</option>{types.filter((t) => t.active).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </Select>
            </Field>
            <Field label="Money kept in (optional)" hint="Contributions go into this account">
              <Select value={form.account} onChange={(e) => setForm({ ...form, account: e.target.value })}>
                <option value="">— none —</option>{lookups?.accounts.filter((a) => a.active).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </Select>
            </Field>
            <Field label="Status">
              <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as Goal["status"] })}>
                <option value="active">Active</option><option value="paused">Paused</option><option value="achieved">Achieved</option><option value="cancelled">Cancelled</option>
              </Select>
            </Field>
            <Field label="Notes" className="col-span-2"><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
          </div>
        )}
      </Modal>

      {lookups && <TxnForm open={!!contribute} onClose={() => setContribute(null)} onSaved={refresh} lookups={lookups} defaultType="goal_contribution"
        preset={contribute ? { goal: contribute.id, to: contribute.account_id ?? "", remarks: `${contribute.name} contribution` } : undefined} />}

      <Modal open={!!history} onClose={() => setHistory(null)} title={`${history?.goal.name ?? ""} · contributions`}>
        {history && (history.rows.length === 0 ? <p className="text-sm text-muted">No contributions yet.</p> : (
          <div className="divide-y divide-line text-sm">
            {history.rows.map((r) => (
              <div key={r.id} className="flex justify-between py-2"><span>{fmtDate(r.contribution_date)}{r.remarks && <span className="ml-2 text-muted">{r.remarks}</span>}</span>
                <span className="num font-medium">{money(r.amount)}</span></div>
            ))}
          </div>
        ))}
        <p className="mt-3 text-xs text-muted">To correct a contribution, edit or delete it in Transactions. The goal updates automatically.</p>
      </Modal>
    </>
  );
}
