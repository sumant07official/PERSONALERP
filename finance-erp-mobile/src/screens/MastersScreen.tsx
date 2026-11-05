import { useCallback, useEffect, useState } from "react";
import { Alert, Switch, View } from "react-native";
import { deleteMaster, listMasters, saveMaster } from "../lib/api";
import type { MasterRow } from "../lib/types";
import { AppFrame } from "../navigation";
import { Badge, Button, Card, Empty, ErrorText, Fab, Field, Input, Loading, Pills, Row, ScreenScroll, Sheet, T, useToast } from "../components/ui";

type Table = "categories" | "payment_modes" | "commitment_types" | "goal_types";
const TABS: { value: Table; label: string }[] = [
  { value: "categories", label: "Categories" }, { value: "payment_modes", label: "Payment modes" },
  { value: "commitment_types", label: "Commitment types" }, { value: "goal_types", label: "Goal types" },
];

export function MastersScreen() {
  const toast = useToast();
  const [tab, setTab] = useState<Table>("categories");
  const [rows, setRows] = useState<MasterRow[] | null>(null);
  const [error, setError] = useState("");
  const [edit, setEdit] = useState<Partial<MasterRow> | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setRows(await listMasters(tab)); setError(""); } catch (e) { setError((e as Error).message); }
  }, [tab]);
  useEffect(() => { setRows(null); load(); }, [load]);

  async function save() {
    if (!edit?.name?.trim()) return toast("err", "Name is required");
    setBusy(true);
    try {
      const row: Partial<MasterRow> & { id?: string } = { id: edit.id, name: edit.name.trim(), active: edit.active ?? true, sort_order: Number(edit.sort_order ?? 0) };
      if (tab === "categories") row.category_group = edit.category_group ?? "expense";
      await saveMaster(tab, row); toast("ok", "Saved"); setEdit(null); load();
    } catch (e) {
      const m = (e as Error).message; toast("err", m.includes("duplicate") ? "That name already exists" : m);
    } finally { setBusy(false); }
  }
  function remove() {
    if (!edit?.id) return;
    Alert.alert("Delete", `Delete "${edit.name}"?`, [{ text: "Cancel", style: "cancel" }, { text: "Delete", style: "destructive", onPress: async () => {
      try { await deleteMaster(tab, edit.id!); toast("ok", "Deleted"); setEdit(null); load(); } catch (e) { toast("err", (e as Error).message); }
    } }]);
  }
  async function toggle(r: MasterRow) {
    try { await saveMaster(tab, { id: r.id, active: !r.active }); load(); } catch (e) { toast("err", (e as Error).message); }
  }

  return (
    <AppFrame title="Masters" subtitle="Your own lists">
      <ScreenScroll>
        <Pills options={TABS} value={tab} onChange={setTab} />
        {error ? <ErrorText message={error} /> : null}
        {!rows && !error && <Loading />}
        {rows && rows.length === 0 && <Empty title="Nothing here yet" hint="Tap + to add" />}
        {rows && rows.length > 0 && (
          <Card style={{ padding: 0 }}>
            {rows.map((r, i) => (
              <Row key={r.id} style={{ paddingHorizontal: 12, paddingVertical: 10, borderTopWidth: i ? 1 : 0, borderColor: "rgba(128,128,128,0.15)" }}>
                <View style={{ flex: 1 }}><T weight="500" style={{ opacity: r.active ? 1 : 0.5 }}>{r.name}</T></View>
                {r.category_group && <Badge label={r.category_group} tone={r.category_group === "income" ? "success" : r.category_group === "expense" ? "danger" : "primary"} />}
                <Switch value={r.active} onValueChange={() => toggle(r)} />
                <Button small variant="ghost" title="Edit" onPress={() => setEdit(r)} />
              </Row>
            ))}
          </Card>
        )}
      </ScreenScroll>
      <Fab onPress={() => setEdit({ active: true, sort_order: 0, category_group: "expense" })} />
      <Sheet open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? "Edit" : "Add"}
        footer={<>{edit?.id && <Button variant="ghost" title="Delete" onPress={remove} style={{ marginRight: "auto" }} />}
          <Button title="Cancel" onPress={() => setEdit(null)} /><Button variant="primary" title="Save" busy={busy} onPress={save} /></>}>
        {edit && <>
          <Field label="Name"><Input autoFocus value={edit.name ?? ""} onChangeText={(v) => setEdit({ ...edit, name: v })} /></Field>
          {tab === "categories" && <Field label="Used for"><Pills options={[{ value: "expense", label: "Expenses" }, { value: "income", label: "Income" }, { value: "both", label: "Both" }]}
            value={edit.category_group ?? "expense"} onChange={(v) => setEdit({ ...edit, category_group: v })} /></Field>}
          <Field label="Sort order"><Input keyboardType="number-pad" value={String(edit.sort_order ?? 0)} onChangeText={(v) => setEdit({ ...edit, sort_order: Number(v) || 0 })} /></Field>
          <Row style={{ justifyContent: "space-between" }}><T>Active</T><Switch value={edit.active ?? true} onValueChange={(v) => setEdit({ ...edit, active: v })} /></Row>
        </>}
      </Sheet>
    </AppFrame>
  );
}
