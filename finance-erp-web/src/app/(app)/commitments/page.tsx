"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { listCommitments, listInstallments, listMasters } from "@/lib/api";
import { fmtDate, money } from "@/lib/format";
import { FREQUENCIES, type Commitment, type CommitmentStatus, type Installment, type MasterRow } from "@/lib/types";
import { CommitmentForm } from "@/components/commitment-form";
import { InstallmentsTable } from "@/components/installments-table";
import { useLookups } from "@/components/use-lookups";
import { Badge, Button, Card, Empty, ErrorBox, PageHeader, Pill, Spinner } from "@/components/ui";

type Row = Commitment & { stats?: CommitmentStatus };

export default function CommitmentsPage() {
  const { lookups, reload: reloadLookups } = useLookups();
  const [tab, setTab] = useState<"list" | "outstanding">("list");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [open, setOpen] = useState<Installment[] | null>(null);
  const [types, setTypes] = useState<MasterRow[]>([]);
  const [error, setError] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [status, setStatus] = useState<"active" | "all">("active");

  const load = useCallback(() => {
    Promise.all([listCommitments(), listInstallments({ openOnly: true })])
      .then(([c, i]) => { setRows(c); setOpen(i); })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => { load(); listMasters("commitment_types").then(setTypes).catch(() => {}); }, [load]);

  const typeName = (id: string | null) => types.find((t) => t.id === id)?.name;
  const shown = (rows ?? []).filter((r) => status === "all" || r.status === "active");
  const overdue = (open ?? []).filter((i) => i.is_overdue);
  const totalOutstanding = (open ?? []).reduce((s, i) => s + Number(i.remaining_amount), 0);

  return (
    <>
      <PageHeader title="Commitments" subtitle="EMIs, insurance, SIPs, subscriptions, bills and one-time dues"
        actions={<Button variant="primary" disabled={!lookups} onClick={() => setFormOpen(true)}>+ New commitment</Button>} />

      <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card className="p-3"><p className="text-xs text-muted">Active commitments</p><p className="num text-lg font-semibold">{(rows ?? []).filter((r) => r.status === "active").length}</p></Card>
        <Card className="p-3"><p className="text-xs text-muted">Open installments</p><p className="num text-lg font-semibold">{open?.length ?? 0}</p></Card>
        <Card className="p-3" onClick={() => setTab("outstanding")}><p className="text-xs text-muted">Overdue</p>
          <p className="num text-lg font-semibold text-danger">{overdue.length} · {money(overdue.reduce((s, i) => s + Number(i.remaining_amount), 0), true)}</p></Card>
        <Card className="p-3" onClick={() => setTab("outstanding")}><p className="text-xs text-muted">Total outstanding (generated)</p><p className="num text-lg font-semibold">{money(totalOutstanding, true)}</p></Card>
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        <Pill active={tab === "list"} onClick={() => setTab("list")}>Commitments</Pill>
        <Pill active={tab === "outstanding"} onClick={() => setTab("outstanding")}>Open installments (carry-forward)</Pill>
        {tab === "list" && <><span className="flex-1" />
          <Pill active={status === "active"} onClick={() => setStatus("active")}>Active</Pill>
          <Pill active={status === "all"} onClick={() => setStatus("all")}>All</Pill></>}
      </div>

      {error && <ErrorBox message={error} />}
      {!rows && !error && <Spinner />}

      {rows && tab === "list" && (shown.length === 0 ? (
        <Card><Empty title="No commitments yet" hint="Add each recurring payment once: loan EMI, insurance, SIP, rent, subscriptions. Installments are created automatically."
          action={<Button variant="primary" disabled={!lookups} onClick={() => setFormOpen(true)}>+ New commitment</Button>} /></Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-line bg-surface-2 text-left text-xs text-muted">
              <tr><th className="px-3 py-2">Commitment</th><th className="px-3 py-2">Frequency</th><th className="px-3 py-2 text-right">Installment</th>
                <th className="px-3 py-2">Progress</th><th className="px-3 py-2">Next due</th><th className="px-3 py-2 text-right">Outstanding</th><th className="px-3 py-2">Status</th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {shown.map((r) => (
                <tr key={r.id} className="hover:bg-surface-2">
                  <td className="px-3 py-2"><Link href={`/commitments/${r.id}`} className="font-medium hover:text-primary">{r.name}</Link>
                    {typeName(r.commitment_type_id) && <span className="ml-2 text-xs text-muted">{typeName(r.commitment_type_id)}</span>}</td>
                  <td className="px-3 py-2 text-muted">{FREQUENCIES.find((f) => f.value === r.frequency)?.label}</td>
                  <td className="num px-3 py-2 text-right">{money(r.installment_amount ?? (r.total_installments ? r.total_amount / r.total_installments : r.total_amount))}</td>
                  <td className="px-3 py-2 text-muted">{r.stats ? `${r.stats.paid_items} / ${r.total_installments ?? r.stats.total_items} paid` : "—"}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{fmtDate(r.stats?.next_due_date)}</td>
                  <td className="num px-3 py-2 text-right font-medium">{money(r.stats?.outstanding_amount ?? 0)}
                    {!!r.stats?.overdue_items && <span className="block text-xs text-danger">{r.stats.overdue_items} overdue</span>}</td>
                  <td className="px-3 py-2"><Badge tone={r.status === "active" ? "success" : r.status === "completed" ? "primary" : "neutral"}>{r.status}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ))}

      {open && lookups && tab === "outstanding" && (
        <>
          <p className="mb-2 text-sm text-muted">Every unpaid installment stays here until paid. Select several (even across commitments) to pay together or spread across months.</p>
          <InstallmentsTable rows={open} accounts={lookups.accounts} onChanged={() => { load(); reloadLookups(); }} showCommitment />
        </>
      )}

      {lookups && (
        <CommitmentForm open={formOpen} onClose={() => setFormOpen(false)} onSaved={() => { load(); reloadLookups(); }}
          types={types} categories={lookups.categories} accounts={lookups.accounts} />
      )}
    </>
  );
}
