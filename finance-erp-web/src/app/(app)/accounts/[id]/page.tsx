"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { getLedger, listAccounts } from "@/lib/api";
import { downloadCsv, fmtDate, money } from "@/lib/format";
import { isLiability, txnLabel, type Account, type LedgerRow } from "@/lib/types";
import { Button, Card, Empty, ErrorBox, PageHeader, Spinner, cx } from "@/components/ui";

export default function LedgerPage() {
  const { id } = useParams<{ id: string }>();
  const [account, setAccount] = useState<Account | null>(null);
  const [rows, setRows] = useState<LedgerRow[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([listAccounts(), getLedger(id)])
      .then(([accs, led]) => { setAccount(accs.find((a) => a.id === id) ?? null); setRows(led); })
      .catch((e) => setError(e.message));
  }, [id]);

  const liab = account ? isLiability(account.account_type) : false;
  const show = (n: number) => (liab ? -n : n); // liabilities show amount owed

  return (
    <>
      <PageHeader title={account ? `${account.name} · Ledger` : "Ledger"}
        subtitle={account ? (liab ? `Outstanding ${money(show(account.current_balance))}` : `Balance ${money(account.current_balance)}`) : undefined}
        actions={<>
          <Link href="/accounts"><Button>← Accounts</Button></Link>
          <Button onClick={() => rows && downloadCsv(`ledger-${account?.name ?? id}.csv`, rows.map((r) => ({
            date: r.transaction_date, type: r.transaction_type, remarks: r.remarks, reference: r.reference_no,
            money_in: r.money_in, money_out: r.money_out, balance: r.running_balance })))}>Export CSV</Button>
          <Button onClick={() => window.print()}>Print</Button>
        </>} />
      {error && <ErrorBox message={error} />}
      {!rows && !error && <Spinner />}
      {rows && rows.length === 0 && <Card><Empty title="No transactions on this account yet" /></Card>}
      {rows && rows.length > 0 && account && (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-line bg-surface-2 text-left text-xs text-muted">
              <tr><th className="px-3 py-2">Date</th><th className="px-3 py-2">Type</th><th className="px-3 py-2">Remarks</th>
                <th className="px-3 py-2 text-right">{liab ? "Payments" : "Money in"}</th>
                <th className="px-3 py-2 text-right">{liab ? "Spends" : "Money out"}</th>
                <th className="px-3 py-2 text-right">{liab ? "Outstanding" : "Balance"}</th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr key={r.posting_id}>
                  <td className="px-3 py-2 whitespace-nowrap">{fmtDate(r.transaction_date)}</td>
                  <td className="px-3 py-2 text-muted">{txnLabel(r.transaction_type)}</td>
                  <td className="px-3 py-2">{r.remarks ?? "—"}{r.reference_no && <span className="ml-2 text-xs text-muted">#{r.reference_no}</span>}</td>
                  <td className="num px-3 py-2 text-right text-success">{r.money_in > 0 ? money(r.money_in) : ""}</td>
                  <td className="num px-3 py-2 text-right text-danger">{r.money_out > 0 ? money(r.money_out) : ""}</td>
                  <td className={cx("num px-3 py-2 text-right font-medium")}>{money(show(r.running_balance))}</td>
                </tr>
              ))}
              <tr className="bg-surface-2 text-muted">
                <td className="px-3 py-2" colSpan={5}>Opening balance</td>
                <td className="num px-3 py-2 text-right">{money(show(account.opening_balance))}</td>
              </tr>
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}
