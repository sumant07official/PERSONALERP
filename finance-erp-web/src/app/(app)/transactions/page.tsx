"use client";

import { useCallback, useEffect, useState } from "react";
import {
  listAccounts, listGoalOptions, listMasters, listOpenInstallments, listTransactions, postBulk, voidTransaction,
} from "@/lib/api";
import { downloadCsv, fmtDate, money, todayIST } from "@/lib/format";
import { TXN_TYPES, txnLabel, type TxnRow, type TxnType } from "@/lib/types";
import { TxnForm, type Lookups } from "@/components/txn-form";
import {
  Badge, Button, Card, Empty, ErrorBox, Field, Input, Modal, PageHeader, Pill, Select, Spinner, cx, useToast,
} from "@/components/ui";

const PAGE_SIZE = 25;

function flow(r: TxnRow) {
  if (r.transaction_type === "income") return "in";
  if (r.transaction_type === "adjustment") return r.to_account_id ? "in" : "out";
  if (["transfer", "credit_card_payment"].includes(r.transaction_type)) return "move";
  return "out";
}

export default function TransactionsPage() {
  const toast = useToast();
  const [lookups, setLookups] = useState<Lookups | null>(null);
  const [rows, setRows] = useState<TxnRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState("");

  const [search, setSearch] = useState("");
  const [types, setTypes] = useState<TxnType[]>([]);
  const [accountId, setAccountId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [showDeleted, setShowDeleted] = useState(false);
  const [page, setPage] = useState(1);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<TxnRow | null>(null);
  const [voiding, setVoiding] = useState<TxnRow | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [quickOpen, setQuickOpen] = useState(false);

  const loadLookups = useCallback(async () => {
    const [accounts, categories, modes, goals, installments] = await Promise.all([
      listAccounts(), listMasters("categories"), listMasters("payment_modes"), listGoalOptions(), listOpenInstallments(),
    ]);
    setLookups({ accounts, categories, modes, goals, installments });
  }, []);

  const load = useCallback(() => {
    setError("");
    listTransactions({ search, types, accountId, from, to, showDeleted, page, pageSize: PAGE_SIZE })
      .then((r) => { setRows(r.rows); setTotal(r.total); })
      .catch((e) => setError(e.message));
  }, [search, types, accountId, from, to, showDeleted, page]);

  useEffect(() => { loadLookups().catch((e) => setError(e.message)); }, [loadLookups]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);
  useEffect(() => setPage(1), [search, types, accountId, from, to, showDeleted]);

  const refresh = () => { load(); loadLookups().catch(() => {}); };
  const toggleType = (t: TxnType) => setTypes((x) => (x.includes(t) ? x.filter((y) => y !== t) : [...x, t]));
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  async function doVoid() {
    if (!voiding) return;
    try {
      await voidTransaction(voiding.id, voidReason);
      toast("ok", "Transaction deleted and balances reversed");
      setVoiding(null); setVoidReason("");
      refresh();
    } catch (e) { toast("err", (e as Error).message); }
  }

  async function exportAll() {
    try {
      const all: TxnRow[] = [];
      for (let p = 1; p <= 40; p++) {
        const r = await listTransactions({ search, types, accountId, from, to, showDeleted, page: p, pageSize: 500 });
        all.push(...r.rows);
        if (all.length >= r.total) break;
      }
      downloadCsv(`transactions-${todayIST()}.csv`, all.map((r) => ({
        date: r.transaction_date, type: txnLabel(r.transaction_type), amount: r.amount, from: r.from_account_name, to: r.to_account_name,
        category: r.category_name, mode: r.payment_mode_name, goal: r.goal_name, remarks: r.remarks, reference: r.reference_no, status: r.status,
      })));
    } catch (e) { toast("err", (e as Error).message); }
  }

  return (
    <>
      <PageHeader title="Transactions" subtitle={`${total} transaction${total === 1 ? "" : "s"}`}
        actions={<>
          <Button onClick={exportAll}>Export CSV</Button>
          <Button onClick={() => setQuickOpen(true)} disabled={!lookups}>Daily spending</Button>
          <Button variant="primary" disabled={!lookups} onClick={() => { setEditing(null); setFormOpen(true); }}>+ New</Button>
        </>} />

      <Card className="mb-3 p-3">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Input placeholder="Search remarks, reference, category, account" value={search} onChange={(e) => setSearch(e.target.value)} />
          <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">All accounts</option>
            {lookups?.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </Select>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} title="From date" />
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} title="To date" />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {TXN_TYPES.map((t) => <Pill key={t.value} active={types.includes(t.value)} onClick={() => toggleType(t.value)}>{t.label}</Pill>)}
          <span className="flex-1" />
          <label className="flex items-center gap-1.5 text-xs text-muted">
            <input type="checkbox" checked={showDeleted} onChange={(e) => setShowDeleted(e.target.checked)} /> Show deleted
          </label>
        </div>
      </Card>

      {error && <ErrorBox message={error} />}
      {!rows && !error && <Spinner />}
      {rows && rows.length === 0 && (
        <Card><Empty title="No transactions found"
          hint={lookups && lookups.accounts.length === 0 ? "Add an account first, then record income and expenses." : "Try clearing the filters, or add a new transaction."} /></Card>
      )}
      {rows && rows.length > 0 && (
        <>
          {/* Desktop table */}
          <Card className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead className="border-b border-line bg-surface-2 text-left text-xs text-muted">
                <tr><th className="px-3 py-2">Date</th><th className="px-3 py-2">Type</th><th className="px-3 py-2">Account</th>
                  <th className="px-3 py-2">Category</th><th className="px-3 py-2">Remarks</th><th className="px-3 py-2 text-right">Amount</th><th className="px-3 py-2" /></tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r) => {
                  const fl = flow(r);
                  return (
                    <tr key={r.id} className={cx("hover:bg-surface-2", r.status === "void" && "opacity-50 line-through")}>
                      <td className="px-3 py-2 whitespace-nowrap">{fmtDate(r.transaction_date)}</td>
                      <td className="px-3 py-2"><Badge tone={fl === "in" ? "success" : fl === "out" ? "danger" : "primary"}>{txnLabel(r.transaction_type)}</Badge></td>
                      <td className="px-3 py-2 text-muted">
                        {r.from_account_name && r.to_account_name ? `${r.from_account_name} → ${r.to_account_name}` : r.from_account_name ?? r.to_account_name}
                      </td>
                      <td className="px-3 py-2 text-muted">{r.category_name ?? r.goal_name ?? "—"}</td>
                      <td className="max-w-64 truncate px-3 py-2" title={r.remarks ?? ""}>{r.remarks ?? "—"}{r.reference_no && <span className="ml-1 text-xs text-muted">#{r.reference_no}</span>}</td>
                      <td className={cx("num px-3 py-2 text-right font-medium whitespace-nowrap", fl === "in" && "text-success", fl === "out" && "text-danger")}>
                        {fl === "in" ? "+" : fl === "out" ? "−" : ""}{money(r.amount)}
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        {r.status !== "void" && <>
                          <button className="mr-3 text-xs text-primary hover:underline" onClick={() => { setEditing(r); setFormOpen(true); }}>Edit</button>
                          <button className="text-xs text-danger hover:underline" onClick={() => setVoiding(r)}>Delete</button>
                        </>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
          {/* Phone cards */}
          <div className="flex flex-col gap-2 md:hidden">
            {rows.map((r) => {
              const fl = flow(r);
              return (
                <Card key={r.id} className={cx("p-3", r.status === "void" && "opacity-50")}
                  onClick={r.status !== "void" ? () => { setEditing(r); setFormOpen(true); } : undefined}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{r.remarks || r.category_name || txnLabel(r.transaction_type)}</p>
                      <p className="text-xs text-muted">{fmtDate(r.transaction_date)} · {r.from_account_name ?? r.to_account_name}</p>
                    </div>
                    <span className={cx("num font-semibold", fl === "in" && "text-success", fl === "out" && "text-danger")}>
                      {fl === "in" ? "+" : fl === "out" ? "−" : ""}{money(r.amount)}
                    </span>
                  </div>
                </Card>
              );
            })}
          </div>
          <div className="mt-3 flex items-center justify-between text-sm">
            <span className="text-muted">Page {page} of {pages}</span>
            <div className="flex gap-2">
              <Button disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
              <Button disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button>
            </div>
          </div>
        </>
      )}

      {lookups && (
        <TxnForm open={formOpen} onClose={() => setFormOpen(false)} onSaved={refresh} lookups={lookups} editing={editing} />
      )}

      <Modal open={!!voiding} onClose={() => setVoiding(null)} title="Delete transaction"
        footer={<><Button onClick={() => setVoiding(null)}>Cancel</Button><Button variant="danger" onClick={doVoid}>Delete</Button></>}>
        {voiding && (
          <div className="flex flex-col gap-3 text-sm">
            <p>Delete <b>{txnLabel(voiding.transaction_type)}</b> of <b>{money(voiding.amount)}</b> on {fmtDate(voiding.transaction_date)}?
              All its effects (balances, installments, goals) will be reversed. It stays in the history as deleted.</p>
            <Field label="Reason (optional)"><Input value={voidReason} onChange={(e) => setVoidReason(e.target.value)} /></Field>
          </div>
        )}
      </Modal>

      {lookups && <QuickSpend open={quickOpen} onClose={() => setQuickOpen(false)} onSaved={refresh} lookups={lookups} />}
    </>
  );
}

/** Tea ₹10, Travel ₹50, Milk ₹40 … several small expenses in one go. */
function QuickSpend({ open, onClose, onSaved, lookups }: { open: boolean; onClose: () => void; onSaved: () => void; lookups: Lookups }) {
  const toast = useToast();
  const cash = lookups.accounts.find((a) => a.active && a.account_type === "cash");
  const [account, setAccount] = useState("");
  const [date, setDate] = useState(todayIST());
  const [lines, setLines] = useState([{ remarks: "", amount: "", category: "" }]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) { setAccount(cash?.id ?? ""); setDate(todayIST()); setLines([{ remarks: "", amount: "", category: "" }]); }
  }, [open, cash?.id]);

  const valid = lines.filter((l) => Number(l.amount) > 0);
  const totalAmt = valid.reduce((s, l) => s + Number(l.amount), 0);

  async function save() {
    if (!account) return toast("err", "Choose the account you paid from");
    if (!valid.length) return toast("err", "Add at least one amount");
    setBusy(true);
    try {
      await postBulk(valid.map((l) => ({
        transaction_type: "expense" as const, amount: Number(l.amount), transaction_date: date, from_account_id: account,
        category_id: l.category || null, remarks: l.remarks || null, client_request_id: crypto.randomUUID(),
      })));
      toast("ok", `${valid.length} expenses saved (${money(totalAmt)})`);
      onSaved(); onClose();
    } catch (e) { toast("err", (e as Error).message); } finally { setBusy(false); }
  }

  const expenseCats = lookups.categories.filter((c) => c.active && c.category_group !== "income");
  return (
    <Modal open={open} onClose={onClose} title="Daily spending" wide
      footer={<><span className="num mr-auto self-center text-sm text-muted">Total {money(totalAmt)}</span>
        <Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} onClick={save}>Save {valid.length || ""}</Button></>}>
      <div className="mb-3 grid grid-cols-2 gap-3">
        <Field label="Paid from">
          <Select value={account} onChange={(e) => setAccount(e.target.value)}>
            <option value="">Select account</option>
            {lookups.accounts.filter((a) => a.active).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </Select>
        </Field>
        <Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      </div>
      <div className="flex flex-col gap-2">
        {lines.map((l, i) => (
          <div key={i} className="grid grid-cols-[1fr_6rem] gap-2 sm:grid-cols-[1fr_8rem_10rem_2rem]">
            <Input placeholder="What (e.g. Tea)" value={l.remarks} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, remarks: e.target.value } : x)))} />
            <Input type="number" inputMode="decimal" placeholder="₹" value={l.amount}
              onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))}
              onKeyDown={(e) => { if (e.key === "Enter" && i === lines.length - 1) setLines([...lines, { remarks: "", amount: "", category: "" }]); }} />
            <Select value={l.category} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, category: e.target.value } : x)))} className="hidden sm:block">
              <option value="">Category</option>
              {expenseCats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
            <button className="hidden text-muted hover:text-danger sm:block" onClick={() => setLines(lines.length > 1 ? lines.filter((_, j) => j !== i) : lines)}>✕</button>
          </div>
        ))}
        <Button variant="ghost" className="self-start text-primary" onClick={() => setLines([...lines, { remarks: "", amount: "", category: "" }])}>+ Add line</Button>
      </div>
    </Modal>
  );
}

