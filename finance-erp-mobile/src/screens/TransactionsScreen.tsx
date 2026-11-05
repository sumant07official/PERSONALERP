import { useFocusEffect } from "@react-navigation/native";
import { useCallback, useEffect, useRef, useState } from "react";
import { FlatList, Pressable, RefreshControl, View } from "react-native";
import { listTransactions, postBulk, voidTransaction, type TxnFilters } from "../lib/api";
import { fmtDate, money, shareCsv, todayIST, uuid } from "../lib/format";
import { TXN_TYPES, txnLabel, type TxnRow, type TxnType } from "../lib/types";
import { AppFrame, HeaderButton } from "../navigation";
import { TxnForm } from "../components/TxnForm";
import { useLookups, type Lookups } from "../components/useLookups";
import { Badge, Button, Card, DateField, Empty, ErrorText, Fab, Field, Input, Loading, Pills, Row, Select, Sheet, T, useToast } from "../components/ui";
import { useColors } from "../theme";

const PAGE = 30;
const flow = (r: TxnRow) => r.transaction_type === "income" ? "in"
  : r.transaction_type === "adjustment" ? (r.to_account_id ? "in" : "out")
  : ["transfer", "credit_card_payment"].includes(r.transaction_type) ? "move" : "out";

export function TransactionsScreen() {
  const c = useColors();
  const toast = useToast();
  const { lookups, reload: reloadLookups } = useLookups();
  const [rows, setRows] = useState<TxnRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [types, setTypes] = useState<TxnType[]>([]);
  const [accountId, setAccountId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [showDeleted, setShowDeleted] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<TxnRow | null>(null);
  const [actions, setActions] = useState<TxnRow | null>(null);
  const [voiding, setVoiding] = useState<TxnRow | null>(null);
  const [reason, setReason] = useState("");
  const [quickOpen, setQuickOpen] = useState(false);
  const loadingMore = useRef(false);

  const filters = useCallback((page: number, pageSize = PAGE): TxnFilters =>
    ({ search, types, accountId, from, to, showDeleted, page, pageSize }), [search, types, accountId, from, to, showDeleted]);

  const load = useCallback(async () => {
    setError("");
    try { const r = await listTransactions(filters(1)); setRows(r.rows); setTotal(r.total); }
    catch (e) { setError((e as Error).message); }
  }, [filters]);
  useEffect(() => { const t = setTimeout(load, 300); return () => clearTimeout(t); }, [load]);
  useFocusEffect(useCallback(() => { reloadLookups(); }, [reloadLookups]));

  async function more() {
    if (!rows || rows.length >= total || loadingMore.current) return;
    loadingMore.current = true;
    try { const r = await listTransactions(filters(Math.floor(rows.length / PAGE) + 1)); setRows([...rows, ...r.rows]); }
    finally { loadingMore.current = false; }
  }
  const refresh = () => { load(); reloadLookups(); };
  const activeFilters = types.length + (accountId ? 1 : 0) + (from ? 1 : 0) + (to ? 1 : 0) + (showDeleted ? 1 : 0);

  async function doVoid() {
    if (!voiding) return;
    try { await voidTransaction(voiding.id, reason); toast("ok", "Deleted and balances reversed"); setVoiding(null); setReason(""); refresh(); }
    catch (e) { toast("err", (e as Error).message); }
  }
  async function exportCsv() {
    try {
      const all: TxnRow[] = [];
      for (let p = 1; p <= 40; p++) { const r = await listTransactions(filters(p, 500)); all.push(...r.rows); if (all.length >= r.total) break; }
      await shareCsv(`transactions-${todayIST()}.csv`, all.map((r) => ({ date: r.transaction_date, type: txnLabel(r.transaction_type), amount: r.amount,
        from: r.from_account_name, to: r.to_account_name, category: r.category_name, mode: r.payment_mode_name, remarks: r.remarks, reference: r.reference_no, status: r.status })));
    } catch (e) { toast("err", (e as Error).message); }
  }

  return (
    <AppFrame title="Transactions" subtitle={`${total} transaction${total === 1 ? "" : "s"}`}
      right={<><HeaderButton label="Daily" onPress={() => setQuickOpen(true)} /><HeaderButton label="Export" onPress={exportCsv} /></>}>
      <View style={{ padding: 12, paddingBottom: 4, gap: 8 }}>
        <Row>
          <Input placeholder="Search remarks, category, account" value={search} onChangeText={setSearch} style={{ flex: 1 }} />
          <Button title={activeFilters ? `Filters (${activeFilters})` : "Filters"} onPress={() => setFiltersOpen(true)} />
        </Row>
      </View>
      {error ? <View style={{ paddingHorizontal: 12 }}><ErrorText message={error} /></View> : null}
      {!rows && !error ? <Loading /> : (
        <FlatList data={rows ?? []} keyExtractor={(r) => r.id} contentContainerStyle={{ padding: 12, gap: 8, paddingBottom: 96 }}
          onEndReached={more} onEndReachedThreshold={0.4}
          refreshControl={<RefreshControl refreshing={refreshing} colors={[c.primary]} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
          ListEmptyComponent={<Empty title="No transactions found" hint={lookups?.accounts.length === 0 ? "Add an account first (menu → Accounts)." : "Clear filters or add one with +"} />}
          renderItem={({ item: r }) => {
            const fl = flow(r);
            return (
              <Card onPress={r.status === "void" ? undefined : () => setActions(r)} style={r.status === "void" ? { opacity: 0.5 } : undefined}>
                <Row style={{ alignItems: "flex-start" }}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <T weight="600" numberOfLines={1}>{r.remarks || r.category_name || txnLabel(r.transaction_type)}</T>
                    <T muted size={12} numberOfLines={1}>{fmtDate(r.transaction_date)} · {r.from_account_name && r.to_account_name ? `${r.from_account_name} → ${r.to_account_name}` : r.from_account_name ?? r.to_account_name}</T>
                    <Row style={{ gap: 4 }}>
                      <Badge label={txnLabel(r.transaction_type)} tone={fl === "in" ? "success" : fl === "out" ? "danger" : "primary"} />
                      {r.category_name && r.remarks ? <Badge label={r.category_name} /> : null}
                      {r.status === "void" && <Badge label="deleted" />}
                    </Row>
                  </View>
                  <T weight="700" size={15} tone={fl === "in" ? "success" : fl === "out" ? "danger" : undefined}>{fl === "in" ? "+" : fl === "out" ? "−" : ""}{money(r.amount)}</T>
                </Row>
              </Card>
            );
          }} />
      )}
      <Fab onPress={() => { setEditing(null); setFormOpen(true); }} />

      <Sheet open={filtersOpen} onClose={() => setFiltersOpen(false)} title="Filters"
        footer={<><Button title="Clear all" onPress={() => { setTypes([]); setAccountId(""); setFrom(""); setTo(""); setShowDeleted(false); }} /><Button variant="primary" title="Apply" onPress={() => setFiltersOpen(false)} /></>}>
        <Field label="Types"><Pills multi options={TXN_TYPES} value={types} onChange={(v) => setTypes((x) => (x.includes(v) ? x.filter((y) => y !== v) : [...x, v]))} /></Field>
        <Field label="Account"><Select title="Account" value={accountId} onChange={setAccountId} allowEmpty="All accounts" placeholder="All accounts"
          options={(lookups?.accounts ?? []).map((a) => ({ value: a.id, label: a.name }))} /></Field>
        <Field label="From date"><DateField value={from} onChange={setFrom} clearable /></Field>
        <Field label="To date"><DateField value={to} onChange={setTo} clearable /></Field>
        <Field label="Deleted transactions"><Pills options={[{ value: "hide", label: "Hide" }, { value: "show", label: "Show" }]} value={showDeleted ? "show" : "hide"} onChange={(v) => setShowDeleted(v === "show")} /></Field>
      </Sheet>

      <Sheet open={!!actions} onClose={() => setActions(null)} title={actions ? `${txnLabel(actions.transaction_type)} · ${money(actions.amount)}` : ""}>
        {actions && <>
          <T muted size={13}>{fmtDate(actions.transaction_date)}{actions.category_name ? ` · ${actions.category_name}` : ""}{actions.payment_mode_name ? ` · ${actions.payment_mode_name}` : ""}</T>
          {actions.remarks ? <T>{actions.remarks}</T> : null}
          {actions.reference_no ? <T muted size={12}>Ref #{actions.reference_no}</T> : null}
          <Button variant="primary" title="Edit" onPress={() => { setEditing(actions); setActions(null); setFormOpen(true); }} />
          <Button variant="danger" title="Delete" onPress={() => { setVoiding(actions); setActions(null); }} />
        </>}
      </Sheet>

      <Sheet open={!!voiding} onClose={() => setVoiding(null)} title="Delete transaction"
        footer={<><Button title="Cancel" onPress={() => setVoiding(null)} /><Button variant="danger" title="Delete" onPress={doVoid} /></>}>
        {voiding && <>
          <T>Delete {txnLabel(voiding.transaction_type)} of {money(voiding.amount)} on {fmtDate(voiding.transaction_date)}? Balances, installments and goals are reversed. It stays in history as deleted.</T>
          <Field label="Reason (optional)"><Input value={reason} onChangeText={setReason} /></Field>
        </>}
      </Sheet>

      {lookups && <TxnForm open={formOpen} onClose={() => setFormOpen(false)} onSaved={refresh} lookups={lookups} editing={editing} />}
      {lookups && <QuickSpend open={quickOpen} onClose={() => setQuickOpen(false)} onSaved={refresh} lookups={lookups} />}
    </AppFrame>
  );
}

/** Tea ₹10, Travel ₹50, Milk ₹40 … several small expenses at once. */
function QuickSpend({ open, onClose, onSaved, lookups }: { open: boolean; onClose: () => void; onSaved: () => void; lookups: Lookups }) {
  const toast = useToast();
  const c = useColors();
  const cash = lookups.accounts.find((a) => a.active && a.account_type === "cash");
  const [account, setAccount] = useState("");
  const [date, setDate] = useState(todayIST());
  const [lines, setLines] = useState([{ remarks: "", amount: "", category: "" }]);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setAccount(cash?.id ?? ""); setDate(todayIST()); setLines([{ remarks: "", amount: "", category: "" }]); } }, [open, cash?.id]);
  const valid = lines.filter((l) => Number(l.amount) > 0);
  const total = valid.reduce((s, l) => s + Number(l.amount), 0);
  const setLine = (i: number, k: "remarks" | "amount" | "category", v: string) => setLines(lines.map((x, j) => (j === i ? { ...x, [k]: v } : x)));

  async function save() {
    if (!account) return toast("err", "Choose the account you paid from");
    if (!valid.length) return toast("err", "Add at least one amount");
    setBusy(true);
    try {
      await postBulk(valid.map((l) => ({ transaction_type: "expense" as const, amount: Number(l.amount), transaction_date: date, from_account_id: account,
        category_id: l.category || null, remarks: l.remarks.trim() || null, client_request_id: uuid() })));
      toast("ok", `${valid.length} expenses saved (${money(total)})`); onSaved(); onClose();
    } catch (e) { toast("err", (e as Error).message); } finally { setBusy(false); }
  }
  const cats = lookups.categories.filter((x) => x.active && x.category_group !== "income").map((x) => ({ value: x.id, label: x.name }));
  return (
    <Sheet full open={open} onClose={onClose} title="Daily spending"
      footer={<><T muted style={{ flex: 1 }}>Total {money(total)}</T><Button title="Cancel" onPress={onClose} /><Button variant="primary" title={`Save ${valid.length || ""}`} busy={busy} onPress={save} /></>}>
      <Row style={{ alignItems: "flex-start" }}>
        <Field label="Paid from" style={{ flex: 1 }}><Select title="Paid from" value={account} onChange={setAccount} placeholder="Select account"
          options={lookups.accounts.filter((a) => a.active).map((a) => ({ value: a.id, label: a.name }))} /></Field>
        <Field label="Date" style={{ flex: 1 }}><DateField value={date} onChange={setDate} /></Field>
      </Row>
      {lines.map((l, i) => (
        <Card key={i} style={{ gap: 8 }}>
          <Row>
            <Input placeholder="What (e.g. Tea)" value={l.remarks} onChangeText={(v) => setLine(i, "remarks", v)} style={{ flex: 1 }} />
            <Input placeholder="₹" keyboardType="decimal-pad" value={l.amount} onChangeText={(v) => setLine(i, "amount", v)} style={{ width: 96 }} />
            {lines.length > 1 && <Pressable hitSlop={8} onPress={() => setLines(lines.filter((_, j) => j !== i))}><T tone="danger">✕</T></Pressable>}
          </Row>
          <Select title="Category" value={l.category} onChange={(v) => setLine(i, "category", v)} options={cats} allowEmpty="No category" placeholder="Category (optional)" />
        </Card>
      ))}
      <Button variant="ghost" title="+ Add line" onPress={() => setLines([...lines, { remarks: "", amount: "", category: "" }])} />
      <View style={{ height: 1, backgroundColor: c.border }} />
    </Sheet>
  );
}
