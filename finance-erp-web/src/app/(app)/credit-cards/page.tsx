"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { listCreditCards } from "@/lib/api";
import { fmtDate, money } from "@/lib/format";
import type { CreditCard } from "@/lib/types";
import { TxnForm } from "@/components/txn-form";
import { useLookups } from "@/components/use-lookups";
import { Badge, Button, Card, Empty, ErrorBox, PageHeader, Spinner, cx } from "@/components/ui";

export default function CreditCardsPage() {
  const { lookups, reload } = useLookups();
  const [cards, setCards] = useState<CreditCard[] | null>(null);
  const [error, setError] = useState("");
  const [pay, setPay] = useState<CreditCard | null>(null);
  const [spend, setSpend] = useState<CreditCard | null>(null);

  const load = useCallback(() => { listCreditCards().then(setCards).catch((e) => setError(e.message)); }, []);
  useEffect(load, [load]);
  const refresh = () => { load(); reload(); };
  const total = (cards ?? []).reduce((s, c) => s + Number(c.outstanding), 0);

  return (
    <>
      <PageHeader title="Credit cards" subtitle={cards ? `Total outstanding ${money(total)}` : undefined}
        actions={<Link href="/accounts"><Button>+ Add card (Accounts)</Button></Link>} />
      {error && <ErrorBox message={error} />}
      {!cards && !error && <Spinner />}
      {cards && cards.length === 0 && (
        <Card><Empty title="No credit cards" hint="Add a card in Accounts with type “Credit card”, its limit and due day." /></Card>
      )}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {cards?.map((c) => {
          const util = Number(c.utilization_pct ?? 0);
          return (
            <Card key={c.id} className="p-4">
              <div className="mb-3 flex items-start justify-between">
                <div><p className="font-semibold">{c.name}</p>
                  <p className="text-xs text-muted">{c.due_day ? `Bill due ${fmtDate(c.next_due_date)}` : "Set a due day in Accounts"}</p></div>
                {!c.active && <Badge>Inactive</Badge>}
              </div>
              <p className="text-xs text-muted">Outstanding</p>
              <p className={cx("num text-2xl font-semibold", c.outstanding > 0 && "text-warning")}>{money(c.outstanding)}</p>
              {c.credit_limit != null && (
                <>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-2">
                    <div className={cx("h-full", util > 70 ? "bg-danger" : util > 30 ? "bg-warning" : "bg-primary")} style={{ width: `${Math.min(util, 100)}%` }} />
                  </div>
                  <p className="mt-1 flex justify-between text-xs text-muted">
                    <span>{util}% of {money(c.credit_limit, true)}</span><span>Available {money(c.available_credit, true)}</span>
                  </p>
                </>
              )}
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-md bg-surface-2 p-2"><p className="text-muted">Spent this month</p><p className="num font-medium">{money(c.spend_this_month)}</p></div>
                <div className="rounded-md bg-surface-2 p-2"><p className="text-muted">Paid this month</p><p className="num font-medium">{money(c.payments_this_month)}</p></div>
              </div>
              <div className="mt-3 flex gap-2">
                <Button variant="primary" className="flex-1" disabled={!lookups || c.outstanding <= 0} onClick={() => setPay(c)}>Pay bill</Button>
                <Button className="flex-1" disabled={!lookups} onClick={() => setSpend(c)}>Add spend</Button>
                <Link href={`/accounts/${c.id}`}><Button>Ledger</Button></Link>
              </div>
            </Card>
          );
        })}
      </div>
      <p className="mt-4 text-xs text-muted">Card spends are recorded as expenses. Paying the bill moves money from your bank to the card and is not counted as an expense again.</p>
      {lookups && (
        <>
          <TxnForm open={!!pay} onClose={() => setPay(null)} onSaved={refresh} lookups={lookups} defaultType="credit_card_payment"
            preset={pay ? { to: pay.id, amount: String(pay.outstanding), remarks: `${pay.name} bill` } : undefined} />
          <TxnForm open={!!spend} onClose={() => setSpend(null)} onSaved={refresh} lookups={lookups} defaultType="expense"
            preset={spend ? { from: spend.id } : undefined} />
        </>
      )}
    </>
  );
}
