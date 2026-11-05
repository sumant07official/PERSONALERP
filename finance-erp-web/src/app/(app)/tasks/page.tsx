"use client";

import { useCallback, useEffect, useState } from "react";
import { deleteTask, listTasks, saveTask } from "@/lib/api";
import { fmtDate, todayIST } from "@/lib/format";
import type { Priority, Task } from "@/lib/types";
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Modal, PageHeader, Pill, Select, Spinner, Textarea, cx, useToast } from "@/components/ui";

const prioTone = (p: Priority) => (p === "critical" ? "danger" : p === "high" ? "warning" : p === "normal" ? "primary" : "neutral");

export default function TasksPage() {
  const toast = useToast();
  const [rows, setRows] = useState<Task[] | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<"open" | "done" | "all">("open");
  const [edit, setEdit] = useState<Partial<Task> | null>(null);
  const [busy, setBusy] = useState(false);
  const today = todayIST();

  const load = useCallback(() => { listTasks().then(setRows).catch((e) => setError(e.message)); }, []);
  useEffect(load, [load]);

  const shown = (rows ?? []).filter((t) => filter === "all" || (filter === "done" ? t.status === "done" : !["done", "cancelled"].includes(t.status)));

  async function save() {
    if (!edit?.title?.trim()) return toast("err", "Title is required");
    setBusy(true);
    try {
      await saveTask({ title: edit.title.trim(), description: edit.description || null, due_date: edit.due_date || null,
        priority: edit.priority ?? "normal", status: edit.status ?? "pending" }, edit.id);
      toast("ok", "Saved"); setEdit(null); load();
    } catch (e) { toast("err", (e as Error).message); } finally { setBusy(false); }
  }
  async function toggleDone(t: Task) {
    try { await saveTask({ status: t.status === "done" ? "pending" : "done" }, t.id); load(); } catch (e) { toast("err", (e as Error).message); }
  }
  async function remove() {
    if (!edit?.id || !confirm("Delete this task?")) return;
    try { await deleteTask(edit.id); setEdit(null); load(); } catch (e) { toast("err", (e as Error).message); }
  }

  return (
    <>
      <PageHeader title="Tasks" subtitle="Reminders and to-dos (also shown on the Calendar)"
        actions={<Button variant="primary" onClick={() => setEdit({ priority: "normal", status: "pending", due_date: today })}>+ New task</Button>} />
      <div className="mb-3 flex gap-2">
        <Pill active={filter === "open"} onClick={() => setFilter("open")}>Open</Pill>
        <Pill active={filter === "done"} onClick={() => setFilter("done")}>Done</Pill>
        <Pill active={filter === "all"} onClick={() => setFilter("all")}>All</Pill>
      </div>
      {error && <ErrorBox message={error} />}
      {!rows && !error && <Spinner />}
      {rows && shown.length === 0 && <Card><Empty title="No tasks here" /></Card>}
      {shown.length > 0 && (
        <Card className="divide-y divide-line">
          {shown.map((t) => {
            const overdue = t.due_date && t.due_date < today && t.status !== "done";
            return (
              <div key={t.id} className="flex items-start gap-3 px-4 py-3">
                <input type="checkbox" className="mt-1 size-4" checked={t.status === "done"} onChange={() => toggleDone(t)} aria-label="Done" />
                <button className="min-w-0 flex-1 text-left" onClick={() => setEdit(t)}>
                  <p className={cx("font-medium", t.status === "done" && "text-muted line-through")}>{t.title}</p>
                  {t.description && <p className="truncate text-xs text-muted">{t.description}</p>}
                </button>
                <Badge tone={prioTone(t.priority)}>{t.priority}</Badge>
                {t.due_date && <span className={cx("text-xs whitespace-nowrap", overdue ? "text-danger" : "text-muted")}>{fmtDate(t.due_date)}</span>}
              </div>
            );
          })}
        </Card>
      )}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? "Edit task" : "New task"}
        footer={<>{edit?.id && <Button variant="ghost" className="mr-auto text-danger" onClick={remove}>Delete</Button>}
          <Button onClick={() => setEdit(null)}>Cancel</Button><Button variant="primary" busy={busy} onClick={save}>Save</Button></>}>
        {edit && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Title" className="col-span-2"><Input autoFocus value={edit.title ?? ""} onChange={(e) => setEdit({ ...edit, title: e.target.value })} /></Field>
            <Field label="Due date"><Input type="date" value={edit.due_date ?? ""} onChange={(e) => setEdit({ ...edit, due_date: e.target.value })} /></Field>
            <Field label="Priority">
              <Select value={edit.priority} onChange={(e) => setEdit({ ...edit, priority: e.target.value as Priority })}>
                <option value="critical">Critical</option><option value="high">High</option><option value="normal">Normal</option><option value="low">Low</option>
              </Select>
            </Field>
            <Field label="Status" className="col-span-2">
              <Select value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value as Task["status"] })}>
                <option value="pending">Pending</option><option value="in_progress">In progress</option><option value="done">Done</option><option value="cancelled">Cancelled</option>
              </Select>
            </Field>
            <Field label="Description" className="col-span-2"><Textarea value={edit.description ?? ""} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></Field>
          </div>
        )}
      </Modal>
    </>
  );
}
