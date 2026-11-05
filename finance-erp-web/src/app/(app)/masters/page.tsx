"use client";

import { useCallback, useEffect, useState } from "react";
import { deleteMaster, listMasters, saveMaster } from "@/lib/api";
import type { MasterRow } from "@/lib/types";
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Modal, PageHeader, Pill, Select, Spinner, useToast } from "@/components/ui";

type Table = "categories" | "payment_modes" | "commitment_types" | "goal_types";
const TABS: { key: Table; label: string }[] = [
  { key: "categories", label: "Categories" },
  { key: "payment_modes", label: "Payment modes" },
  { key: "commitment_types", label: "Commitment types" },
  { key: "goal_types", label: "Goal types" },
];

export default function MastersPage() {
  const toast = useToast();
  const [tab, setTab] = useState<Table>("categories");
  const [rows, setRows] = useState<MasterRow[] | null>(null);
  const [error, setError] = useState("");
  const [edit, setEdit] = useState<Partial<MasterRow> | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setRows(null); setError("");
    listMasters(tab).then(setRows).catch((e) => setError(e.message));
  }, [tab]);
  useEffect(load, [load]);

  async function save() {
    if (!edit?.name?.trim()) return;
    setBusy(true);
    try {
      const row: Partial<MasterRow> & { id?: string } = { id: edit.id, name: edit.name.trim(), active: edit.active ?? true, sort_order: Number(edit.sort_order ?? 0) };
      if (tab === "categories") row.category_group = edit.category_group ?? "expense";
      await saveMaster(tab, row);
      toast("ok", "Saved");
      setEdit(null);
      load();
    } catch (e) {
      const m = (e as Error).message;
      toast("err", m.includes("duplicate") ? "That name already exists" : m);
    } finally { setBusy(false); }
  }

  async function remove() {
    if (!edit?.id || !confirm(`Delete "${edit.name}"?`)) return;
    try { await deleteMaster(tab, edit.id); toast("ok", "Deleted"); setEdit(null); load(); }
    catch (e) { toast("err", (e as Error).message); }
  }

  async function toggle(r: MasterRow) {
    try { await saveMaster(tab, { id: r.id, active: !r.active }); load(); }
    catch (e) { toast("err", (e as Error).message); }
  }

  return (
    <>
      <PageHeader title="Masters" subtitle="Your own lists used across the app"
        actions={<Button variant="primary" onClick={() => setEdit({ active: true, sort_order: 0, category_group: "expense" })}>+ Add</Button>} />
      <div className="mb-3 flex flex-wrap gap-2">
        {TABS.map((t) => <Pill key={t.key} active={tab === t.key} onClick={() => setTab(t.key)}>{t.label}</Pill>)}
      </div>
      {error && <ErrorBox message={error} />}
      {!rows && !error && <Spinner />}
      {rows && rows.length === 0 && (
        <Card><Empty title="Nothing here yet"
          hint={tab === "categories" ? "Add categories like Groceries, Fuel, Salary, Rent so transactions can be grouped in reports." : undefined}
          action={<Button variant="primary" onClick={() => setEdit({ active: true, sort_order: 0, category_group: "expense" })}>+ Add</Button>} /></Card>
      )}
      {rows && rows.length > 0 && (
        <Card className="divide-y divide-line">
          {rows.map((r) => (
            <div key={r.id} className="flex items-center gap-3 px-4 py-2.5">
              <span className="flex-1 font-medium">{r.name}</span>
              {r.category_group && <Badge tone={r.category_group === "income" ? "success" : r.category_group === "expense" ? "danger" : "primary"}>{r.category_group}</Badge>}
              <button onClick={() => toggle(r)}>{r.active ? <Badge tone="success">Active</Badge> : <Badge>Inactive</Badge>}</button>
              <button className="text-xs text-primary hover:underline" onClick={() => setEdit(r)}>Edit</button>
            </div>
          ))}
        </Card>
      )}

      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? "Edit" : `Add ${TABS.find((t) => t.key === tab)?.label.toLowerCase().replace(/s$/, "")}`}
        footer={<>
          {edit?.id && <Button variant="ghost" className="mr-auto text-danger" onClick={remove}>Delete</Button>}
          <Button onClick={() => setEdit(null)}>Cancel</Button>
          <Button variant="primary" busy={busy} disabled={!edit?.name?.trim()} onClick={save}>Save</Button>
        </>}>
        {edit && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Name" className="col-span-2"><Input autoFocus value={edit.name ?? ""} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            {tab === "categories" && (
              <Field label="Used for">
                <Select value={edit.category_group ?? "expense"} onChange={(e) => setEdit({ ...edit, category_group: e.target.value as MasterRow["category_group"] })}>
                  <option value="expense">Expenses</option><option value="income">Income</option><option value="both">Both</option>
                </Select>
              </Field>
            )}
            <Field label="Sort order"><Input type="number" value={edit.sort_order ?? 0} onChange={(e) => setEdit({ ...edit, sort_order: Number(e.target.value) })} /></Field>
            <label className="col-span-2 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={edit.active ?? true} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> Active
            </label>
          </div>
        )}
      </Modal>
    </>
  );
}
