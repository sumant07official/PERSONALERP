"use client";

import { useEffect, useState } from "react";
import { generateSchedules, saveCommitment } from "@/lib/api";
import { money, todayIST } from "@/lib/format";
import { FREQUENCIES, type Account, type Commitment, type Frequency, type MasterRow } from "@/lib/types";
import { Button, Field, Input, Modal, Select, Textarea, useToast } from "./ui";

type F = {
  name: string; type: string; frequency: Frequency; start: string; end: string; due_day: string;
  installment: string; total: string; count: string; category: string; account: string;
  status: Commitment["status"]; notes: string;
};
const n = (s: string) => (s.trim() === "" ? null : Number(s));

export function CommitmentForm({ open, onClose, onSaved, editing, types, categories, accounts }:
  { open: boolean; onClose: () => void; onSaved: (id: string) => void; editing?: Commitment | null;
    types: MasterRow[]; categories: MasterRow[]; accounts: Account[] }) {
  const toast = useToast();
  const [f, setF] = useState<F | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const c = editing;
    setF({
      name: c?.name ?? "", type: c?.commitment_type_id ?? "", frequency: c?.frequency ?? "monthly",
      start: c?.start_date ?? todayIST(), end: c?.end_date ?? "", due_day: c?.due_day?.toString() ?? "",
      installment: c?.installment_amount?.toString() ?? "", total: c?.total_amount ? String(c.total_amount) : "",
      count: c?.total_installments?.toString() ?? "", category: c?.category_id ?? "", account: c?.default_account_id ?? "",
      status: c?.status ?? "active", notes: c?.notes ?? "",
    });
  }, [open, editing]);

  if (!f) return null;
  const set = <K extends keyof F>(k: K, v: F[K]) => setF({ ...f, [k]: v });
  const oneTime = f.frequency === "one_time";
  const preview = Number(f.installment) > 0 ? Number(f.installment)
    : Number(f.total) > 0 && Number(f.count) > 0 ? Number(f.total) / Number(f.count) : Number(f.total) > 0 && oneTime ? Number(f.total) : 0;

  async function save() {
    if (!f) return;
    if (!f.name.trim()) return toast("err", "Name is required");
    if (!(preview > 0)) return toast("err", "Enter an installment amount, or a total amount with number of installments");
    setBusy(true);
    try {
      const c = await saveCommitment({
        name: f.name.trim(), commitment_type_id: f.type || null, frequency: f.frequency,
        start_date: f.start || null, end_date: f.end || null, due_day: n(f.due_day),
        installment_amount: n(f.installment), total_amount: Number(f.total) || 0,
        total_installments: oneTime ? null : n(f.count), category_id: f.category || null,
        default_account_id: f.account || null, status: f.status, notes: f.notes.trim() || null,
      }, editing?.id);
      let made = 0;
      if (c.status === "active" && c.start_date) made = await generateSchedules(c.id);
      toast("ok", editing ? `Saved${made ? ` · ${made} new installments` : ""}` : `Commitment added with ${made} installment${made === 1 ? "" : "s"}`);
      onSaved(c.id); onClose();
    } catch (e) { toast("err", (e as Error).message); } finally { setBusy(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title={editing ? "Edit commitment" : "New commitment"} wide
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} onClick={save}>Save</Button></>}>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Name" className="sm:col-span-2"><Input autoFocus value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Home loan EMI, LIC policy, Netflix" /></Field>
        <Field label="Type">
          <Select value={f.type} onChange={(e) => set("type", e.target.value)}>
            <option value="">— none —</option>
            {types.filter((t) => t.active).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </Select>
        </Field>
        <Field label="Frequency">
          <Select value={f.frequency} onChange={(e) => set("frequency", e.target.value as Frequency)}>
            {FREQUENCIES.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
          </Select>
        </Field>
        <Field label={oneTime ? "Due date" : "Start date"}><Input type="date" value={f.start} onChange={(e) => set("start", e.target.value)} /></Field>
        {!oneTime && <Field label="Due day of month" hint="Blank = same day as start date">
          <Input type="number" min={1} max={31} value={f.due_day} onChange={(e) => set("due_day", e.target.value)} /></Field>}
        <Field label={oneTime ? "Amount" : "Installment amount"} hint={!oneTime ? "Or leave blank and give total + count" : undefined}>
          <Input type="number" step="0.01" value={oneTime ? f.total : f.installment} onChange={(e) => set(oneTime ? "total" : "installment", e.target.value)} /></Field>
        {!oneTime && <>
          <Field label="Total amount (optional)"><Input type="number" step="0.01" value={f.total} onChange={(e) => set("total", e.target.value)} /></Field>
          <Field label="No. of installments" hint="Blank = ongoing"><Input type="number" min={1} value={f.count} onChange={(e) => set("count", e.target.value)} /></Field>
          <Field label="End date (optional)"><Input type="date" value={f.end} onChange={(e) => set("end", e.target.value)} /></Field>
        </>}
        <Field label="Usually paid from">
          <Select value={f.account} onChange={(e) => set("account", e.target.value)}>
            <option value="">— none —</option>
            {accounts.filter((a) => a.active).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </Select>
        </Field>
        <Field label="Category">
          <Select value={f.category} onChange={(e) => set("category", e.target.value)}>
            <option value="">— none —</option>
            {categories.filter((c) => c.active && c.category_group !== "income").map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label="Status">
          <Select value={f.status} onChange={(e) => set("status", e.target.value as F["status"])}>
            <option value="active">Active</option><option value="paused">Paused</option>
            <option value="completed">Completed</option><option value="cancelled">Cancelled</option>
          </Select>
        </Field>
        <Field label="Notes" className="sm:col-span-3"><Textarea value={f.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
      </div>
      {preview > 0 && <p className="mt-3 text-sm text-muted">Each installment ≈ <b className="num text-ink">{money(preview)}</b>
        {!oneTime && !f.count && !f.end && " · ongoing installments are created 12 months ahead and extended automatically by the monthly plan"}</p>}
      {editing && <p className="mt-1 text-xs text-muted">Changes apply to installments created from now on. Existing installments keep their original due date and amount.</p>}
    </Modal>
  );
}
