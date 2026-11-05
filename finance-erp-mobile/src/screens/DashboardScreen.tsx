import { useFocusEffect } from "@react-navigation/native";
import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { getDashboard } from "../lib/api";
import { fmtDate, money, monthLabel, todayIST } from "../lib/format";
import type { Dashboard } from "../lib/types";
import { AppFrame, HeaderButton, navigationRef } from "../navigation";
import { Badge, Card, ErrorText, Loading, Metric, ProgressBar, Row, ScreenScroll, T } from "../components/ui";

const shiftMonth = (ym: string, n: number) => {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

export function DashboardScreen() {
  const [month, setMonth] = useState(todayIST().slice(0, 7));
  const [d, setD] = useState<Dashboard | null>(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError("");
    try { setD(await getDashboard(`${month}-01`)); } catch (e) { setError((e as Error).message); }
  }, [month]);
  useEffect(() => { setD(null); }, [month]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const go = (r: "Transactions" | "Accounts") => navigationRef.navigate(r);

  return (
    <AppFrame title="Dashboard" subtitle={monthLabel(`${month}-01`)}
      right={<Row style={{ gap: 0 }}><HeaderButton label="‹" onPress={() => setMonth(shiftMonth(month, -1))} /><HeaderButton label="›" onPress={() => setMonth(shiftMonth(month, 1))} /></Row>}>
      <ScreenScroll refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }}>
        {error ? <ErrorText message={error} /> : null}
        {!d && !error && <Loading />}
        {d && (
          <>
            <Row style={{ flexWrap: "wrap" }}>
              <Metric label="Income" value={money(d.income, true)} tone="success" onPress={() => go("Transactions")} />
              <Metric label="Expenses" value={money(d.expense, true)} tone="danger" onPress={() => go("Transactions")} />
              <Metric label="Net savings" value={money(d.net_savings, true)} tone={d.net_savings >= 0 ? "success" : "danger"}
                hint={d.goal_contributions > 0 ? `+${money(d.goal_contributions, true)} to goals` : undefined} />
              <Metric label="Available balance" value={money(d.available_balance, true)} hint="Cash, bank, UPI, savings" onPress={() => go("Accounts")} />
              <Metric label="Card outstanding" value={money(d.credit_card_outstanding, true)} tone={d.credit_card_outstanding > 0 ? "warning" : undefined} />
              <Metric label="Pending payments" value={money(d.pending_payments.amount, true)} tone={d.pending_payments.overdue_count ? "danger" : undefined}
                hint={`${d.pending_payments.count} due${d.pending_payments.overdue_count ? ` · ${d.pending_payments.overdue_count} overdue` : ""}`} />
              <Metric label="Loans outstanding" value={money(d.loan_outstanding, true)} />
              <Metric label="Net worth" value={money(d.net_worth, true)} />
            </Row>

            <Card style={{ gap: 8 }}>
              <T weight="600">Monthly budget</T>
              {d.budget ? (
                <>
                  <Row style={{ justifyContent: "space-between" }}>
                    <T muted size={13}>Paid {money(d.budget.paid, true)} of {money(d.budget.planned, true)}</T>
                    <T weight="600">{d.budget.utilization_percent}%</T>
                  </Row>
                  <ProgressBar pct={d.budget.utilization_percent} tone={d.budget.utilization_percent > 100 ? "danger" : "primary"} />
                  <T muted size={12}>{money(d.budget.remaining, true)} remaining · plan {d.budget.plan_status}{d.budget.critical_open ? ` · ${d.budget.critical_open} critical open` : ""}</T>
                </>
              ) : <T muted size={13}>No plan for this month yet.</T>}
            </Card>

            <Card style={{ gap: 8 }}>
              <T weight="600">Emergency fund</T>
              {d.emergency_fund && d.emergency_fund.target > 0 ? (
                <>
                  <Row style={{ justifyContent: "space-between" }}>
                    <T muted size={13}>{money(d.emergency_fund.current, true)} of {money(d.emergency_fund.target, true)}</T>
                    <T weight="600">{d.emergency_fund.progress_percent}%</T>
                  </Row>
                  <ProgressBar pct={d.emergency_fund.progress_percent} />
                </>
              ) : <T muted size={13}>No emergency fund goal yet.</T>}
            </Card>

            <Card style={{ gap: 4 }}>
              <T weight="600">Upcoming (30 days)</T>
              {d.upcoming_commitments.length === 0 ? <T muted size={13}>Nothing due in the next 30 days.</T> :
                d.upcoming_commitments.map((u) => (
                  <Row key={u.schedule_id} style={{ justifyContent: "space-between", paddingVertical: 6 }}>
                    <View style={{ flex: 1 }}><T weight="500">{u.commitment}</T><T muted size={12}>#{u.installment_no} · {fmtDate(u.due_date)}</T></View>
                    <T>{money(u.amount)}</T>
                  </Row>
                ))}
            </Card>

            <Card style={{ gap: 2 }}>
              <T weight="600">Account balances</T>
              {d.accounts.length === 0 ? <T muted size={13}>No accounts yet. Add one from Accounts.</T> :
                d.accounts.map((a) => (
                  <Row key={a.id} style={{ justifyContent: "space-between", paddingVertical: 8 }}>
                    <View style={{ flex: 1 }}><T weight="500">{a.name}</T><T muted size={12}>{a.account_type.replace("_", " ")}</T></View>
                    {a.outstanding > 0 ? <View style={{ alignItems: "flex-end" }}><T tone="warning" weight="600">{money(a.outstanding)}</T><Badge label="owed" tone="warning" /></View>
                      : <T weight="600" tone={a.current_balance < 0 ? "danger" : undefined}>{money(a.current_balance)}</T>}
                  </Row>
                ))}
            </Card>
          </>
        )}
      </ScreenScroll>
    </AppFrame>
  );
}
