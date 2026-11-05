import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useCallback, useEffect, useState } from "react";
import { FlatList, View } from "react-native";
import { getLedger, listAccounts } from "../lib/api";
import { fmtDate, money, shareCsv } from "../lib/format";
import { isLiability, txnLabel, type Account, type LedgerRow } from "../lib/types";
import { AppFrame, HeaderButton, type RootStackParamList } from "../navigation";
import { Card, Empty, ErrorText, Loading, Row, T, useToast } from "../components/ui";

export function LedgerScreen({ route }: NativeStackScreenProps<RootStackParamList, "Ledger">) {
  const toast = useToast();
  const { id, name } = route.params;
  const [account, setAccount] = useState<Account | null>(null);
  const [rows, setRows] = useState<LedgerRow[] | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const [accs, led] = await Promise.all([listAccounts(), getLedger(id)]);
      setAccount(accs.find((a) => a.id === id) ?? null); setRows(led);
    } catch (e) { setError((e as Error).message); }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const liab = account ? isLiability(account.account_type) : false;
  const show = (n: number) => (liab ? -n : n);

  return (
    <AppFrame back title={name} subtitle={account ? (liab ? `Outstanding ${money(show(account.current_balance))}` : `Balance ${money(account.current_balance)}`) : "Ledger"}
      right={<HeaderButton label="Export" onPress={() => rows && shareCsv(`ledger-${name}.csv`, rows.map((r) => ({ date: r.transaction_date, type: r.transaction_type,
        remarks: r.remarks, reference: r.reference_no, money_in: r.money_in, money_out: r.money_out, balance: r.running_balance }))).catch((e) => toast("err", e.message))} />}>
      {error ? <View style={{ padding: 12 }}><ErrorText message={error} /></View> : null}
      {!rows && !error ? <Loading /> : (
        <FlatList data={rows ?? []} keyExtractor={(r) => r.posting_id} contentContainerStyle={{ padding: 12, gap: 8, paddingBottom: 40 }}
          ListEmptyComponent={<Empty title="No transactions on this account yet" />}
          ListFooterComponent={account && rows?.length ? (
            <Card><Row style={{ justifyContent: "space-between" }}><T muted>Opening balance</T><T weight="600">{money(show(account.opening_balance))}</T></Row></Card>
          ) : undefined}
          renderItem={({ item: r }) => (
            <Card>
              <Row style={{ alignItems: "flex-start" }}>
                <View style={{ flex: 1, gap: 2 }}>
                  <T weight="500" numberOfLines={1}>{r.remarks || txnLabel(r.transaction_type)}</T>
                  <T muted size={12}>{fmtDate(r.transaction_date)} · {txnLabel(r.transaction_type)}{r.reference_no ? ` · #${r.reference_no}` : ""}</T>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  {r.money_in > 0 ? <T tone="success" weight="600">+{money(r.money_in)}</T> : <T tone="danger" weight="600">−{money(r.money_out)}</T>}
                  <T muted size={12}>{liab ? "owed " : "bal "}{money(show(r.running_balance))}</T>
                </View>
              </Row>
            </Card>
          )} />
      )}
    </AppFrame>
  );
}
