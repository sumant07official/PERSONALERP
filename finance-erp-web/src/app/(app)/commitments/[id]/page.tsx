"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { deleteCommitment, generateSchedules, getCommitment, listInstallments, listMasters } from "@/lib/api";
import { fmtDate, money, todayIST } from "@/lib/format";
import { FREQUENCIES, type Commitment, type Installment, type MasterRow } from "@/lib/types";
import { CommitmentForm } from "@/components/commitment-form";
import { InstallmentsTable } from "@/components/installments-table";
import { useLookups } from "@/components/use-lookups";
import { Badge, Button, Card, ErrorBox, PageHeader, Pill, Spinner, useToast } from "@/components/ui";

export default function CommitmentDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const { lookups, reload: reloadLookups } = useLookups();
  const [c, setC] = useState<Commitment | null>(null);
  const [rows, setRows] = useState<Installment[] | null>(null);
  const [types, setTypes] = useState<MasterRow[]>([]);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<"open" | "all">("open");
  const [editOpen, setEditOpen] = useState(false);

  const load = useCallback(() => {
    Promise.all([getCommitment(id), listInstallments({ commitmentId: id })])
      .then(([cc, ii]) => { setC(cc); setRows(ii); })
      .catch((e) => setError(e.message));
  }, [id]);
  useEffect(() => { load(); listMasters("commitment_types").then(setTypes).catch(() => {}); }, [load]);

  const shown = (rows ?? []).filter((r) => filter === "all" || r.status === "pending" || r.status === "partial");
  const paid = (rows ?? []).reduce((s, r) => s + Number(r.paid_amount), 0);
  const outstanding = (rows ?? []).filter((r) => r.status === "pending" || r.status === "partial").reduce((s, r) => s + Number(r.remaining_amount), 0);

  async function extend() {
    const until = prompt("Create installments up to which date? (YYYY-MM-DD)", `${Number(todayIST().slice(0, 4)) + 1}-12-31`);
    if (!until) return;
    try { const n = await generateSchedules(id, until); toast("ok", n ? `${n} installments added` : "Already up to date"); load(); }
    catch (e) { toast("err", (e as Error).message); }
  }
  async function remove() {
    if (!c || !confirm(`Delete "${c.name}"? Its payments stay in your transactions.`)) return;
    try { await deleteCommitment(id); toast("ok", "Commitment deleted"); router.push("/commitments"); }
    catch (e) { toast("err", (e as Error).message); }
  }

  return (
    <>
      <PageHeader title={c?.name ?? "Commitment"}
        subtitle={c ? `${FREQUENCIES.find((f) => f.value === c.frequency)?.label} · ${types.find((t) => t.id === c.commitment_type_id)?.name ?? "No type"} · from ${fmtDate(c.start_date)}` : undefined}
        actions={<>
          <Link href="/commitments"><Button>← All</Button></Link>
          <Button onClick={extend}>Generate more</Button>
          <Button onClick={() => setEditOpen(true)} disabled={!c || !lookups}>Edit</Button>
          <Button variant="ghost" className="text-danger" onClick={remove}>Delete</Button>
        </>} />
      {error && <ErrorBox message={error} />}
      {!rows && !error && <Spinner />}
      {c && rows && lookups && (
        <>
          <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Card className="p-3"><p className="text-xs text-muted">Installment</p><p className="num text-lg font-semibold">{money(c.installment_amount ?? (c.total_installments ? c.total_amount / c.total_installments : c.total_amount))}</p></Card>
            <Card className="p-3"><p className="text-xs text-muted">Paid so far</p><p className="num text-lg font-semibold text-success">{money(paid)}</p></Card>
            <Card className="p-3"><p className="text-xs text-muted">Outstanding</p><p className="num text-lg font-semibold">{money(outstanding)}</p></Card>
            <Card className="p-3"><p className="text-xs text-muted">Status</p><p className="mt-1"><Badge tone={c.status === "active" ? "success" : "neutral"}>{c.status}</Badge>
              {c.total_installments && <span className="ml-2 text-sm text-muted">{rows.filter((r) => r.status === "paid").length}/{c.total_installments} paid</span>}</p></Card>
          </div>
          <div className="mb-2 flex gap-2">
            <Pill active={filter === "open"} onClick={() => setFilter("open")}>Open</Pill>
            <Pill active={filter === "all"} onClick={() => setFilter("all")}>All installments</Pill>
          </div>
          <InstallmentsTable rows={shown} accounts={lookups.accounts} onChanged={() => { load(); reloadLookups(); }} />
          {c.notes && <p className="mt-3 text-sm text-muted">{c.notes}</p>}
          <CommitmentForm open={editOpen} onClose={() => setEditOpen(false)} onSaved={load} editing={c}
            types={types} categories={lookups.categories} accounts={lookups.accounts} />
        </>
      )}
    </>
  );
}
