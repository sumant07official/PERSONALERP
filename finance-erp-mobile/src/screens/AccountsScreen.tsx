import { useFocusEffect } from "@react-navigation/native";
import { useCallback, useState } from "react";
import { Alert, Switch, View } from "react-native";
import { createAccount, listAccounts, setOpeningBalance, updateAccount } from "../lib/api";
import { money, shareCsv } from "../lib/format";
import { ACCOUNT_TYPES, isLiability, type Account, type AccountType } from "../lib/types";
import { AppFrame, HeaderButton, navigationRef } from "../navigation";
import { Badge, Button, Card, Empty, ErrorText, Fab, Field, Input, Loading, Pills, Row, ScreenScroll, Select, Sheet, T, useToast } from "../components/ui";

type Form = { id?: string; name: string; account_type: AccountType; opening: string; credit_limit: string; billing_day: string;
  due_day: string; account_code: string; notes: string; active: boolean };
const blank: Form = { name: "", account_type: "bank", opening: "0", credit_limit: "", billing_day: "", due_day: "", account_code: "", notes: "", active: true };
const numOrNull = (s: string) => (s.trim() === "" ? null : Number(s));

export function AccountsScreen() {
  const toast = useToast();
  const [rows, setRows] = useState<Account[] | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<"active" | "liabilities" | "all">("active");
  const [form, setForm] = useState<Form | null>(null);
  const [origOpening, setOrigOpening] = useState(0);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try { setRows(await listAccounts()); setError(""); } catch (e) { setError((e as Error).message); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const display = (a: Account, n: number) => (isLiability(a.account_type) ? -n : n);
  const shown = (rows ?? []).filter((a) => (filter === "all" ? true : filter === "active" ? a.active : isLiability(a.account_type)));

  function openEdit(a: Account) {
    const o = display(a, Number(a.opening_balance));
    setOrigOpening(o);
    setForm({ id: a.id, name: a.name, account_type: a.account_type, opening: String(o), credit_limit: a.credit_limit?.toString() ?? "",
      billing_day: a.billing_day?.toString() ?? "", due_day: a.due_day?.toString() ?? "", account_code: a.account_code ?? "", notes: a.notes ?? "", active: a.active });
  }

  async function save() {
    if (!form?.name.trim()) return toast("err", "Name is required");
    setBusy(true);
    try {
      const sign = isLiability(form.account_type) ? -1 : 1;
      const input = { name: form.name.trim(), account_type: form.account_type, credit_limit: numOrNull(form.credit_limit),
        billing_day: numOrNull(form.billing_day), due_day: numOrNull(form.due_day), account_code: form.account_code.trim() || null,
        notes: form.notes.trim() || null, active: form.active };
      if (form.id) {
        await updateAccount(form.id, input);
        if (Number(form.opening) !== origOpening) await setOpeningBalance(form.id, sign * Number(form.opening));
        toast("ok", "Account updated");
      } else {
        await createAccount({ ...input, opening_balance: sign * Number(form.opening || 0) });
        toast("ok", "Account added");
      }
      setForm(null); load();
    } catch (e) { toast("err", (e as Error).message); } finally { setBusy(false); }
  }

  function remove() {
    if (!form?.id) return;
    Alert.alert("Delete account", `Delete "${form.name}"? History is kept.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: async () => {
        try { await updateAccount(form.id!, { is_deleted: true }); toast("ok", "Account deleted"); setForm(null); load(); }
        catch (e) { toast("err", (e as Error).message); }
      } },
    ]);
  }

  const liab = form ? isLiability(form.account_type) : false;
  return (
    <AppFrame title="Accounts" right={<HeaderButton label="Export" onPress={() => rows && shareCsv("accounts.csv", rows.map((a) => ({
      name: a.name, type: a.account_type, opening_balance: a.opening_balance, current_balance: a.current_balance, active: a.active }))).catch((e) => toast("err", e.message))} />}>
      <ScreenScroll refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }}>
        <Pills options={[{ value: "active", label: "Active" }, { value: "liabilities", label: "Cards & loans" }, { value: "all", label: "All" }]} value={filter} onChange={setFilter} />
        {error ? <ErrorText message={error} /> : null}
        {!rows && !error && <Loading />}
        {rows && shown.length === 0 && <Empty title="No accounts yet" hint="Add bank, cash, UPI, credit cards and emergency fund." />}
        {shown.map((a) => {
          const l = isLiability(a.account_type);
          const owed = l ? Math.max(-a.current_balance, 0) : 0;
          return (
            <Card key={a.id} onPress={() => navigationRef.navigate("Ledger", { id: a.id, name: a.name })}>
              <Row style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                <View style={{ flex: 1, gap: 2 }}>
                  <T weight="600">{a.name}{a.account_code ? `  ·  ${a.account_code}` : ""}</T>
                  <T muted size={12}>{ACCOUNT_TYPES.find((t) => t.value === a.account_type)?.label}{l && a.credit_limit != null ? ` · limit ${money(a.credit_limit, true)}` : ""}</T>
                  {!a.active && <Badge label="Inactive" />}
                </View>
                <View style={{ alignItems: "flex-end", gap: 4 }}>
                  {l ? <T weight="700" tone={owed > 0 ? "warning" : undefined}>{money(owed)}{owed > 0 ? " owed" : ""}</T>
                     : <T weight="700" tone={a.current_balance < 0 ? "danger" : undefined}>{money(a.current_balance)}</T>}
                  <Button small variant="ghost" title="Edit" onPress={() => openEdit(a)} />
                </View>
              </Row>
            </Card>
          );
        })}
      </ScreenScroll>
      <Fab onPress={() => { setOrigOpening(0); setForm({ ...blank }); }} />

      <Sheet full open={!!form} onClose={() => setForm(null)} title={form?.id ? "Edit account" : "Add account"}
        footer={<>{form?.id && <Button variant="ghost" title="Delete" onPress={remove} style={{ marginRight: "auto" }} />}
          <Button title="Cancel" onPress={() => setForm(null)} /><Button variant="primary" title="Save" busy={busy} onPress={save} /></>}>
        {form && <>
          <Field label="Account name"><Input value={form.name} onChangeText={(v) => setForm({ ...form, name: v })} autoFocus={!form.id} /></Field>
          <Field label="Type"><Select title="Account type" value={form.account_type} onChange={(v) => v && setForm({ ...form, account_type: v })} options={ACCOUNT_TYPES} /></Field>
          <Field label={liab ? "Amount owed at start" : "Opening balance"} hint={form.id ? "Changing this adjusts the current balance by the difference." : undefined}>
            <Input keyboardType="decimal-pad" value={form.opening} onChangeText={(v) => setForm({ ...form, opening: v })} />
          </Field>
          {liab && <>
            <Field label="Credit limit"><Input keyboardType="decimal-pad" value={form.credit_limit} onChangeText={(v) => setForm({ ...form, credit_limit: v })} /></Field>
            <Row>
              <Field label="Bill day" style={{ flex: 1 }}><Input keyboardType="number-pad" value={form.billing_day} onChangeText={(v) => setForm({ ...form, billing_day: v })} /></Field>
              <Field label="Due day" style={{ flex: 1 }}><Input keyboardType="number-pad" value={form.due_day} onChangeText={(v) => setForm({ ...form, due_day: v })} /></Field>
            </Row>
          </>}
          <Field label="Code / last 4 digits"><Input value={form.account_code} onChangeText={(v) => setForm({ ...form, account_code: v })} /></Field>
          <Field label="Notes"><Input multiline value={form.notes} onChangeText={(v) => setForm({ ...form, notes: v })} /></Field>
          <Row style={{ justifyContent: "space-between" }}><T>Active</T><Switch value={form.active} onValueChange={(v) => setForm({ ...form, active: v })} /></Row>
        </>}
      </Sheet>
    </AppFrame>
  );
}
