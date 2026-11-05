import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { randomUUID } from "expo-crypto";

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });
const inr0 = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });

export const money = (n: number | string | null | undefined, whole = false) =>
  (whole ? inr0 : inr).format(Number(n ?? 0));

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const fmtDate = (d: string | null | undefined) => {
  if (!d) return "—";
  const [y, m, day] = d.slice(0, 10).split("-");
  return `${day} ${MONTHS[Number(m) - 1]} ${y}`;
};
export const monthLabel = (d: string) => `${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;

/** Today in India as YYYY-MM-DD (matches finance._today() in the database). */
export const todayIST = () => {
  const ist = new Date(Date.now() + 330 * 60 * 1000);
  return ist.toISOString().slice(0, 10);
};
export const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Random v4 UUID (used as client_request_id so a retry can never post twice). */
export const uuid = () => randomUUID();

/** Writes a CSV to the cache folder and opens the Android share sheet (Drive, WhatsApp, email…). */
export async function shareCsv(filename: string, rows: Record<string, unknown>[]) {
  if (!rows.length) throw new Error("Nothing to export");
  const cols = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = "﻿" + [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
  const file = new File(Paths.cache, filename);
  if (file.exists) file.delete();
  file.create();
  await file.write(csv);
  await Sharing.shareAsync(file.uri, { mimeType: "text/csv", dialogTitle: filename });
}
