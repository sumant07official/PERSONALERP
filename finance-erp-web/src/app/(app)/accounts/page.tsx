"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { createAccount, listAccounts, setOpeningBalance, updateAccount } from "@/lib/api";
import { downloadCsv, money } from "@/lib/format";
import { ACCOUNT_TYPES, isLiability, type Account, type AccountType } from "@/lib/types";
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Modal, PageHeader, Pill, Select, Spinner, Textarea, cx, useToast } from "@/components/ui";

type Form = {
  id?: string; name: string; account_type: AccountType; opening: string; credit_limit: string;
  billing_day: string; due_day: string; account_code: string; notes: string; active: boolean;
};
const blank: Form = { name: "", account_type: "bank", opening: "0", credit_limit: "", billing_day: "", due_day: "", account_code: "", notes: "", active: true };
const numOrNull = (s: string) => (s.trim() === "" ? null : Number(s));

export default function AccountsPage() {
  const toast = useToast();
  const [rows, setRows] = useState<Account[] | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<"active" | "all" | "liabilities">("active");
  const [form, setForm] = useState<Form | null>(null);
  const [origOpening, setOrigOpening] = useState(0);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    listAccounts().then(setRows).catch((e) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  const shown = (rows ?? []).filter((a) =>
    filter === "all" ? true : filter === "active" ? a.active : isLiability(a.account_type));

  // Liabilities: the user types the amount they OWE; the database stores it negative.
  const toDisplay = (a: Account, n: number) => (isLiability(a.account_type) ? -n : n);

  function openEdit(a: Account) {
    const opening = toDisplay(a, Number(a.opening_balance));
    setOrigOpening(opening);
    setForm({
      id: a.id, name: a.name, account_type: a.account_type, opening: String(opening),
      credit_limit: a.credit_limit?.toString() ?? "", billing_day: a.billing_day?.toString() ?? "",
      due_day: a.due_day?.toString() ?? "", account_code: a.account_code ?? "", notes: a.notes ?? "", active: a.active,
    });
  }

  async function save() {
    if (!form) return;
    setBusy(true);
    try {
      const sign = isLiability(form.account_type) ? -1 : 1;
      const input = {
        name: form.name.trim(), account_type: form.account_type, credit_limit: numOrNull(form.credit_limit),
        billing_day: numOrNull(form.billing_day), due_day: numOrNull(form.due_day),
        account_code: form.account_code.trim() || null, notes: form.notes.trim() || null, active: form.active,
      };
      if (form.id) {
        await updateAccount(form.id, input);
        if (Number(form.opening) !== origOpening) await setOpeningBalance(form.id, sign * Number(form.opening));
        toast("ok", "Account updated");
      } else {
        await createAccount({ ...input, opening_balance: sign * Number(form.opening || 0) });
        toast("ok", "Account added");
      }
      setForm(null);
      load();
    } catch (e) {
      toast("err", (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(a: Account) {
    if (!confirm(`Delete "${a.name}"? Its history is kept, but it will disappear from lists.`)) return;
    try {
      await updateAccount(a.id, { is_deleted: true });
      toast("ok", "Account deleted");
      setForm(null);
      load();
    } catch (e) { toast("err", (e as Error).message); }
  }

  const liability = form && isLiability(form.account_type);

  return (
    <>
      <PageHeader title="Accounts" subtitle="Bank, cash, UPI, cards, savings and more"
        actions={<>
          <Button onClick={() => rows && downloadCsv("accounts.csv", rows.map((a) => ({
            name: a.name, type: a.account_type, opening_balance: a.opening_balance, current_balance: a.current_balance, active: a.active })))}>Export CSV</Button>
          <Button variant="primary" onClick={() => { setOrigOpening(0); setForm({ ...blank }); }}>+ Add account</Button>
        </>} />
      <div className="mb-3 flex gap-2">
        <Pill active={filter === "active"} onClick={() => setFilter("active")}>Active</Pill>
        <Pill active={filter === "liabilities"} onClick={() => setFilter("liabilities")}>Cards & loans</Pill>
        <Pill active={filter === "all"} onClick={() => setFilter("all")}>All</Pill>
      </div>
      {error && <ErrorBox message={error} />}
      {!rows && !error && <Spinner />}
      {rows && shown.length === 0 && (
        <Card><Empty title="No accounts yet" hint="Add your bank accounts, cash, UPI, credit cards and emergency fund to start tracking."
          action={<Button variant="primary" onClick={() => setForm({ ...blank })}>+ Add account</Button>} /></Card>
      )}
      {shown.length > 0 && (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-line bg-surface-2 text-left text-xs text-muted">
              <tr><th className="px-3 py-2">Account</th><th className="px-3 py-2">Type</th><th className="px-3 py-2 text-right">Opening</th>
                <th className="px-3 py-2 text-right">Balance / Outstanding</th><th className="px-3 py-2">Status</th><th className="px-3 py-2" /></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {shown.map((a) => {
                const liab = isLiability(a.account_type);
                const owed = liab ? Math.max(-a.current_balance, 0) : 0;
                return (
                  <tr key={a.id} className="hover:bg-surface-2">
                    <td className="px-3 py-2"><Link href={`/accounts/${a.id}`} className="font-medium hover:text-primary">{a.name}</Link>
                      {a.account_code && <span className="ml-2 text-xs text-muted">{a.account_code}</span>}</td>
                    <td className="px-3 py-2 text-muted">{ACCOUNT_TYPES.find((t) => t.value === a.account_type)?.label}</td>
                    <td className="num px-3 py-2 text-right text-muted">{money(toDisplay(a, Number(a.opening_balance)))}</td>
                    <td className="num px-3 py-2 text-right font-medium">
                      {liab ? <span className={cx(owed > 0 && "text-warning")}>{money(owed)} {owed > 0 && <span className="text-xs font-normal">owed</span>}
                        {a.credit_limit != null && <span className="block text-xs font-normal text-muted">limit {money(a.credit_limit, true)}</span>}</span>
                        : <span className={cx(a.current_balance < 0 && "text-danger")}>{money(a.current_balance)}</span>}
                    </td>
                    <td className="px-3 py-2">{a.active ? <Badge tone="success">Active</Badge> : <Badge>Inactive</Badge>}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <Link href={`/accounts/${a.id}`} className="mr-3 text-xs text-primary hover:underline">Ledger</Link>
                      <button onClick={() => openEdit(a)} className="text-xs text-primary hover:underline">Edit</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      <Modal open={!!form} onClose={() => setForm(null)} title={form?.id ? "Edit account" : "Add account"}
        footer={<>
          {form?.id && <Button variant="ghost" className="mr-auto text-danger" onClick={() => { const a = rows?.find((r) => r.id === form.id); if (a) remove(a); }}>Delete</Button>}
          <Button onClick={() => setForm(null)}>Cancel</Button>
          <Button variant="primary" busy={busy} disabled={!form?.name.trim()} onClick={save}>Save</Button>
        </>}>
        {form && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Account name" className="col-span-2"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus /></Field>
            <Field label="Type">
              <Select value={form.account_type} onChange={(e) => setForm({ ...form, account_type: e.target.value as AccountType })}>
                {ACCOUNT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </Select>
            </Field>
            <Field label={liability ? "Amount owed at start" : "Opening balance"}
              hint={form.id ? "Changing this adjusts the current balance by the difference." : undefined}>
              <Input type="number" step="0.01" value={form.opening} onChange={(e) => setForm({ ...form, opening: e.target.value })} />
            </Field>
            {liability && <>
              <Field label="Credit limit"><Input type="number" step="0.01" value={form.credit_limit} onChange={(e) => setForm({ ...form, credit_limit: e.target.value })} /></Field>
              <Field label="Bill generation day"><Input type="number" min={1} max={31} value={form.billing_day} onChange={(e) => setForm({ ...form, billing_day: e.target.value })} /></Field>
              <Field label="Payment due day"><Input type="number" min={1} max={31} value={form.due_day} onChange={(e) => setForm({ ...form, due_day: e.target.value })} /></Field>
            </>}
            <Field label="Code / last 4 digits"><Input value={form.account_code} onChange={(e) => setForm({ ...form, account_code: e.target.value })} /></Field>
            <Field label="Notes" className="col-span-2"><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
            <label className="col-span-2 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> Active (inactive accounts can&apos;t receive new transactions)
            </label>
          </div>
        )}
      </Modal>
    </>
  );
}
