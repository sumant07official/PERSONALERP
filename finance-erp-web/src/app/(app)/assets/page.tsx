"use client";

import { useCallback, useEffect, useState } from "react";
import { deleteAsset, listAssets, saveAsset } from "@/lib/api";
import { downloadCsv, fmtDate, money } from "@/lib/format";
import type { Asset } from "@/lib/types";
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Modal, PageHeader, Select, Spinner, cx, useToast } from "@/components/ui";

const TYPES = ["Property", "Vehicle", "Gold / jewellery", "Electronics", "Investment", "Other"];

export default function AssetsPage() {
  const toast = useToast();
  const [rows, setRows] = useState<Asset[] | null>(null);
  const [error, setError] = useState("");
  const [edit, setEdit] = useState<Partial<Asset> | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => { listAssets().then(setRows).catch((e) => setError(e.message)); }, []);
  useEffect(load, [load]);
  const active = (rows ?? []).filter((a) => a.status === "active");
  const total = active.reduce((s, a) => s + Number(a.current_value), 0);
  const cost = active.reduce((s, a) => s + Number(a.purchase_value), 0);

  async function save() {
    if (!edit?.name?.trim() || !edit.asset_type) return toast("err", "Name and type are required");
    setBusy(true);
    try {
      await saveAsset({ name: edit.name.trim(), asset_type: edit.asset_type, purchase_value: Number(edit.purchase_value) || 0,
        current_value: Number(edit.current_value) || 0, purchase_date: edit.purchase_date || null, status: edit.status ?? "active" }, edit.id);
      toast("ok", "Saved"); setEdit(null); load();
    } catch (e) { toast("err", (e as Error).message); } finally { setBusy(false); }
  }
  async function remove() {
    if (!edit?.id || !confirm(`Delete "${edit.name}"?`)) return;
    try { await deleteAsset(edit.id); setEdit(null); load(); } catch (e) { toast("err", (e as Error).message); }
  }

  return (
    <>
      <PageHeader title="Assets" subtitle={rows ? `Current value ${money(total, true)} · counted in net worth` : undefined}
        actions={<>
          <Button onClick={() => rows && downloadCsv("assets.csv", rows.map((a) => ({ name: a.name, type: a.asset_type, purchase_value: a.purchase_value, current_value: a.current_value, purchase_date: a.purchase_date, status: a.status })))}>Export CSV</Button>
          <Button variant="primary" onClick={() => setEdit({ asset_type: TYPES[0], status: "active" })}>+ Add asset</Button>
        </>} />
      {error && <ErrorBox message={error} />}
      {!rows && !error && <Spinner />}
      {rows && rows.length === 0 && <Card><Empty title="No assets yet" hint="Add property, vehicles, gold and other things you own. Their current value is included in your net worth." /></Card>}
      {rows && rows.length > 0 && (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-line bg-surface-2 text-left text-xs text-muted">
              <tr><th className="px-3 py-2">Asset</th><th className="px-3 py-2">Type</th><th className="px-3 py-2">Bought</th>
                <th className="px-3 py-2 text-right">Cost</th><th className="px-3 py-2 text-right">Current value</th><th className="px-3 py-2 text-right">Gain / loss</th><th className="px-3 py-2">Status</th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((a) => {
                const gain = Number(a.current_value) - Number(a.purchase_value);
                return (
                  <tr key={a.id} className="cursor-pointer hover:bg-surface-2" onClick={() => setEdit(a)}>
                    <td className="px-3 py-2 font-medium">{a.name}</td><td className="px-3 py-2 text-muted">{a.asset_type}</td>
                    <td className="px-3 py-2 text-muted">{fmtDate(a.purchase_date)}</td>
                    <td className="num px-3 py-2 text-right">{money(a.purchase_value, true)}</td>
                    <td className="num px-3 py-2 text-right font-medium">{money(a.current_value, true)}</td>
                    <td className={cx("num px-3 py-2 text-right", gain >= 0 ? "text-success" : "text-danger")}>{gain >= 0 ? "+" : ""}{money(gain, true)}</td>
                    <td className="px-3 py-2"><Badge tone={a.status === "active" ? "success" : "neutral"}>{a.status}</Badge></td>
                  </tr>
                );
              })}
              <tr className="bg-surface-2 font-medium"><td className="px-3 py-2" colSpan={3}>Total (active)</td>
                <td className="num px-3 py-2 text-right">{money(cost, true)}</td><td className="num px-3 py-2 text-right">{money(total, true)}</td>
                <td className={cx("num px-3 py-2 text-right", total - cost >= 0 ? "text-success" : "text-danger")}>{money(total - cost, true)}</td><td /></tr>
            </tbody>
          </table>
        </Card>
      )}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? "Edit asset" : "Add asset"}
        footer={<>{edit?.id && <Button variant="ghost" className="mr-auto text-danger" onClick={remove}>Delete</Button>}
          <Button onClick={() => setEdit(null)}>Cancel</Button><Button variant="primary" busy={busy} onClick={save}>Save</Button></>}>
        {edit && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Name" className="col-span-2"><Input autoFocus value={edit.name ?? ""} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="Type">
              <Select value={edit.asset_type} onChange={(e) => setEdit({ ...edit, asset_type: e.target.value })}>
                {[...new Set([...TYPES, edit.asset_type ?? TYPES[0]])].map((t) => <option key={t}>{t}</option>)}
              </Select>
            </Field>
            <Field label="Purchase date"><Input type="date" value={edit.purchase_date ?? ""} onChange={(e) => setEdit({ ...edit, purchase_date: e.target.value })} /></Field>
            <Field label="Purchase value (₹)"><Input type="number" value={edit.purchase_value ?? ""} onChange={(e) => setEdit({ ...edit, purchase_value: e.target.value as unknown as number })} /></Field>
            <Field label="Current value (₹)"><Input type="number" value={edit.current_value ?? ""} onChange={(e) => setEdit({ ...edit, current_value: e.target.value as unknown as number })} /></Field>
            <Field label="Status" className="col-span-2">
              <Select value={edit.status ?? "active"} onChange={(e) => setEdit({ ...edit, status: e.target.value })}>
                <option value="active">Active (owned)</option><option value="sold">Sold</option><option value="disposed">Disposed</option>
              </Select>
            </Field>
          </div>
        )}
      </Modal>
    </>
  );
}
