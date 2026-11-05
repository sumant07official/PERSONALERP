"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { importTransactions, listImports, undoImport, type TxnPayload } from "@/lib/api";
import { downloadCsv, fmtDate, money } from "@/lib/format";
import type { ImportBatch } from "@/lib/types";
import { useLookups } from "@/components/use-lookups";
import { Badge, Button, Card, Empty, ErrorBox, Field, PageHeader, Select, Spinner, cx, useToast } from "@/components/ui";

type Cell = string | number | boolean | Date | null;
type MapKey = "date" | "amount" | "debit" | "credit" | "type" | "account" | "category" | "remarks" | "reference";
const FIELDS: { key: MapKey; label: string; hint: string }[] = [
  { key: "date", label: "Date *", hint: "DD-MM-YYYY, DD/MM/YYYY or YYYY-MM-DD" },
  { key: "amount", label: "Amount", hint: "Negative = expense" },
  { key: "debit", label: "Debit / withdrawal", hint: "Bank statement style" },
  { key: "credit", label: "Credit / deposit", hint: "Bank statement style" },
  { key: "type", label: "Type", hint: "income or expense" },
  { key: "account", label: "Account name", hint: "Must match an account" },
  { key: "category", label: "Category name", hint: "Matched by name" },
  { key: "remarks", label: "Remarks / narration", hint: "" },
  { key: "reference", label: "Reference no.", hint: "" },
];
const GUESS: Record<MapKey, RegExp> = {
  date: /date/i, amount: /^amount|amt/i, debit: /debit|withdraw|dr\b/i, credit: /credit|deposit|cr\b/i, type: /type/i,
  account: /account|bank/i, category: /categor/i, remarks: /remark|narration|description|particular|note/i, reference: /ref|cheque|chq/i,
};

function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let cur = ""; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cur); rows.push(row); row = []; cur = ""; }
    else cur += c;
  }
  if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ""));
}
function toDate(v: Cell): string | null {
  if (v instanceof Date && !isNaN(v.getTime())) return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`;
  const s = String(v ?? "").trim();
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (m) { const y = m[3].length === 2 ? `20${m[3]}` : m[3]; return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`; }
  m = s.match(/^(\d{1,2})[- ]([A-Za-z]{3})[a-z]*[- ,]+(\d{2,4})/);
  if (m) {
    const mon = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"].indexOf(m[2].toLowerCase()) + 1;
    if (mon) { const y = m[3].length === 2 ? `20${m[3]}` : m[3]; return `${y}-${String(mon).padStart(2, "0")}-${m[1].padStart(2, "0")}`; }
  }
  return null;
}
const toNum = (v: Cell) => { if (typeof v === "number") return v; const s = String(v ?? "").replace(/[₹,\s]/g, "").replace(/^\((.*)\)$/, "-$1"); return s === "" ? NaN : Number(s); };

export default function ImportPage() {
  const toast = useToast();
  const { lookups } = useLookups();
  const [file, setFile] = useState<{ name: string; source: "csv" | "excel" } | null>(null);
  const [header, setHeader] = useState<string[]>([]);
  const [data, setData] = useState<Cell[][]>([]);
  const [map, setMap] = useState<Partial<Record<MapKey, number>>>({});
  const [defaultAccount, setDefaultAccount] = useState("");
  const [defaultType, setDefaultType] = useState<"expense" | "income">("expense");
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<ImportBatch[] | null>(null);
  const [error, setError] = useState("");

  const loadHistory = useCallback(() => { listImports().then(setHistory).catch((e) => setError(e.message)); }, []);
  useEffect(loadHistory, [loadHistory]);

  async function onFile(f: File) {
    try {
      let rows: Cell[][];
      if (/\.xlsx$/i.test(f.name)) {
        const { readSheet } = await import("read-excel-file/browser");
        rows = (await readSheet(f)) as Cell[][];
      } else if (/\.csv$/i.test(f.name)) {
        rows = parseCsv((await f.text()).replace(/^﻿/, ""));
      } else return toast("err", "Choose a .csv or .xlsx file (old .xls: open in Excel and Save As .xlsx or .csv)");
      if (rows.length < 2) return toast("err", "The file needs a header row and at least one data row");
      const h = rows[0].map((c) => String(c ?? "").trim());
      const guess: Partial<Record<MapKey, number>> = {};
      (Object.keys(GUESS) as MapKey[]).forEach((k) => { const i = h.findIndex((x) => GUESS[k].test(x)); if (i >= 0 && !Object.values(guess).includes(i)) guess[k] = i; });
      if (guess.debit != null || guess.credit != null) delete guess.amount;
      setFile({ name: f.name, source: /\.xlsx$/i.test(f.name) ? "excel" : "csv" });
      setHeader(h); setData(rows.slice(1)); setMap(guess);
    } catch (e) { toast("err", `Could not read the file: ${(e as Error).message}`); }
  }

  const accounts = lookups?.accounts.filter((a) => a.active) ?? [];
  const parsed = useMemo(() => {
    if (!lookups) return [];
    const byName = (list: { id: string; name: string }[], v: Cell) => list.find((x) => x.name.toLowerCase() === String(v ?? "").trim().toLowerCase());
    const get = (r: Cell[], k: MapKey) => (map[k] != null ? r[map[k]!] : null);
    return data.map((r, idx) => {
      const errors: string[] = [];
      const date = toDate(get(r, "date"));
      if (!date) errors.push("bad date");
      let amount = NaN; let type: "income" | "expense" = defaultType;
      if (map.debit != null || map.credit != null) {
        const dr = toNum(get(r, "debit")); const cr = toNum(get(r, "credit"));
        if (dr > 0) { amount = dr; type = "expense"; } else if (cr > 0) { amount = cr; type = "income"; }
      } else {
        const a = toNum(get(r, "amount"));
        if (!isNaN(a)) { amount = Math.abs(a); type = a < 0 ? "expense" : defaultType; }
      }
      const t = String(get(r, "type") ?? "").toLowerCase();
      if (/income|credit|cr/.test(t)) type = "income"; else if (/expense|debit|dr/.test(t)) type = "expense";
      if (!(amount > 0)) errors.push("no amount");
      const acc = map.account != null ? byName(accounts, get(r, "account")) : accounts.find((a) => a.id === defaultAccount);
      if (!acc) errors.push(map.account != null ? `unknown account "${get(r, "account") ?? ""}"` : "choose default account");
      const cat = map.category != null && get(r, "category") ? byName(lookups.categories, get(r, "category")) : undefined;
      const payload: TxnPayload = {
        transaction_type: type, amount: Math.round(amount * 100) / 100, transaction_date: date ?? "",
        from_account_id: type === "expense" ? acc?.id ?? null : null, to_account_id: type === "income" ? acc?.id ?? null : null,
        category_id: cat?.id ?? null, remarks: get(r, "remarks") ? String(get(r, "remarks")).trim() : null,
        reference_no: get(r, "reference") ? String(get(r, "reference")).trim() : null,
      };
      return { row: idx + 2, payload, errors, accountName: acc?.name, categoryName: cat?.name };
    });
  }, [data, map, defaultAccount, defaultType, lookups, accounts]);

  const bad = parsed.filter((p) => p.errors.length);
  const good = parsed.filter((p) => !p.errors.length);
  const income = good.filter((p) => p.payload.transaction_type === "income").reduce((s, p) => s + p.payload.amount, 0);
  const expense = good.filter((p) => p.payload.transaction_type === "expense").reduce((s, p) => s + p.payload.amount, 0);

  async function run() {
    if (!file || bad.length || !good.length) return;
    setBusy(true);
    try {
      const b = await importTransactions(file.name, file.source, good.map((p) => p.payload));
      toast("ok", `Imported ${b.posted_count} transactions`);
      setFile(null); setData([]); setHeader([]); loadHistory();
    } catch (e) { toast("err", (e as Error).message); } finally { setBusy(false); }
  }
  async function undo(b: ImportBatch) {
    if (!confirm(`Undo import "${b.file_name}"? All ${b.posted_count} transactions will be deleted and balances reversed.`)) return;
    try { await undoImport(b.id); toast("ok", "Import undone"); loadHistory(); } catch (e) { toast("err", (e as Error).message); }
  }

  return (
    <>
      <PageHeader title="Import transactions" subtitle="CSV or Excel (.xlsx). All rows import together, or none do."
        actions={<Button onClick={() => downloadCsv("import-template.csv", [
          { date: "05-11-2026", type: "expense", amount: 250, account: "Cash", category: "Groceries", remarks: "Vegetables", reference: "" },
          { date: "05-11-2026", type: "income", amount: 50000, account: "BOI", category: "Salary", remarks: "November salary", reference: "" }])}>Download template</Button>} />

      {!file && (
        <Card className="mb-4 p-6">
          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed border-line p-8 text-center hover:border-primary">
            <span className="text-2xl">⇪</span>
            <span className="font-medium">Choose a .csv or .xlsx file</span>
            <span className="text-sm text-muted">Bank statement exports work too: map the Debit and Credit columns.</span>
            <input type="file" accept=".csv,.xlsx" className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
          </label>
        </Card>
      )}

      {file && lookups && (
        <>
          <Card className="mb-3 p-4">
            <div className="mb-3 flex items-center justify-between"><p className="font-medium">{file.name} · {data.length} rows</p>
              <Button variant="ghost" onClick={() => { setFile(null); setData([]); }}>Choose another file</Button></div>
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {FIELDS.map((f) => (
                <Field key={f.key} label={f.label} hint={f.hint}>
                  <Select value={map[f.key] ?? ""} onChange={(e) => setMap({ ...map, [f.key]: e.target.value === "" ? undefined : Number(e.target.value) })}>
                    <option value="">— not in file —</option>
                    {header.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
                  </Select>
                </Field>
              ))}
              {map.account == null && (
                <Field label="Account for all rows *">
                  <Select value={defaultAccount} onChange={(e) => setDefaultAccount(e.target.value)}>
                    <option value="">Select account</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </Select>
                </Field>
              )}
              {map.debit == null && map.credit == null && map.type == null && (
                <Field label="Positive amounts are">
                  <Select value={defaultType} onChange={(e) => setDefaultType(e.target.value as "expense" | "income")}>
                    <option value="expense">Expenses</option><option value="income">Income</option>
                  </Select>
                </Field>
              )}
            </div>
          </Card>

          <div className="mb-3 flex flex-wrap items-center gap-3">
            <Badge tone="success">{good.length} ready</Badge>
            {bad.length > 0 && <Badge tone="danger">{bad.length} with problems</Badge>}
            <span className="text-sm text-muted">Income <b className="num text-success">{money(income)}</b> · Expenses <b className="num text-danger">{money(expense)}</b></span>
            <span className="flex-1" />
            <Button variant="primary" busy={busy} disabled={!!bad.length || !good.length} onClick={run}>Import {good.length} transactions</Button>
          </div>
          {bad.length > 0 && <p className="mb-2 text-sm text-danger">Fix the highlighted rows (in the file or the column mapping) before importing. Nothing is saved until every row is valid.</p>}

          <Card className="mb-6 max-h-[28rem] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 border-b border-line bg-surface-2 text-left text-xs text-muted">
                <tr><th className="px-3 py-2">Row</th><th className="px-3 py-2">Date</th><th className="px-3 py-2">Type</th><th className="px-3 py-2">Account</th>
                  <th className="px-3 py-2">Category</th><th className="px-3 py-2">Remarks</th><th className="px-3 py-2 text-right">Amount</th><th className="px-3 py-2">Problem</th></tr>
              </thead>
              <tbody className="divide-y divide-line">
                {parsed.slice(0, 500).map((p) => (
                  <tr key={p.row} className={cx(p.errors.length > 0 && "bg-danger-soft")}>
                    <td className="px-3 py-1.5 text-muted">{p.row}</td>
                    <td className="px-3 py-1.5 whitespace-nowrap">{p.payload.transaction_date ? fmtDate(p.payload.transaction_date) : "—"}</td>
                    <td className="px-3 py-1.5">{p.payload.transaction_type}</td>
                    <td className="px-3 py-1.5">{p.accountName ?? "—"}</td>
                    <td className="px-3 py-1.5 text-muted">{p.categoryName ?? "—"}</td>
                    <td className="max-w-56 truncate px-3 py-1.5">{p.payload.remarks}</td>
                    <td className="num px-3 py-1.5 text-right">{p.payload.amount > 0 ? money(p.payload.amount) : "—"}</td>
                    <td className="px-3 py-1.5 text-xs text-danger">{p.errors.join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}

      <h2 className="mb-2 font-semibold">Previous imports</h2>
      {error && <ErrorBox message={error} />}
      {!history && !error && <Spinner />}
      {history && history.length === 0 && <Card><Empty title="No imports yet" /></Card>}
      {history && history.length > 0 && (
        <Card className="divide-y divide-line">
          {history.map((b) => (
            <div key={b.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
              <span className="flex-1"><b>{b.file_name}</b> <span className="text-muted">· {new Date(b.created_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</span></span>
              <span className="num">{b.posted_count} rows · {money(b.total_amount)}</span>
              <Badge tone={b.status === "posted" ? "success" : "neutral"}>{b.status}</Badge>
              {b.status === "posted" && <Button className="h-7 text-xs" onClick={() => undo(b)}>Undo</Button>}
            </div>
          ))}
        </Card>
      )}
    </>
  );
}
