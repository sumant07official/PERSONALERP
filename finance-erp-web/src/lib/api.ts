/**
 * Single data-access layer for the web app. Every money change goes through a
 * database RPC; the mobile app will use the same functions/contract.
 */
import { finance, masters, reports, supabase } from "./supabase/client";
import type {
  Account, Dashboard, GoalOption, InstallmentOption, LedgerRow, MasterRow, TxnRow, TxnType,
} from "./types";

function check<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

// ---------- session ----------
export async function currentProfile() {
  const { data: auth } = await supabase().auth.getUser();
  if (!auth.user) return null;
  const { data } = await supabase().from("profiles").select("full_name, role, currency").eq("id", auth.user.id).maybeSingle();
  return { id: auth.user.id, email: auth.user.email ?? "", full_name: data?.full_name ?? auth.user.email ?? "", role: data?.role ?? "owner" };
}

// ---------- dashboard ----------
export async function getDashboard(month?: string): Promise<Dashboard> {
  return check(await reports().rpc("dashboard_summary", { p_month: month ?? null })) as Dashboard;
}

// ---------- accounts ----------
export async function listAccounts(includeInactive = true): Promise<Account[]> {
  let q = finance().from("accounts").select("*").eq("is_deleted", false).order("sort_order").order("name");
  if (!includeInactive) q = q.eq("active", true);
  return check(await q) as Account[];
}

export type AccountInput = Pick<Account, "name" | "account_type" | "credit_limit" | "billing_day" | "due_day" | "account_code" | "notes" | "active">;

export async function createAccount(input: AccountInput & { opening_balance: number }) {
  return check(await finance().from("accounts").insert(input).select().single()) as Account;
}
export async function updateAccount(id: string, input: Partial<AccountInput> & { is_deleted?: boolean }) {
  return check(await finance().from("accounts").update(input).eq("id", id).select().single()) as Account;
}
export async function setOpeningBalance(id: string, amount: number) {
  return check(await finance().rpc("set_opening_balance", { p_account_id: id, p_amount: amount })) as Account;
}
export async function getLedger(accountId: string, limit = 500): Promise<LedgerRow[]> {
  return check(await reports().from("vw_account_ledger").select("*").eq("account_id", accountId)
    .order("transaction_date", { ascending: false }).order("created_at", { ascending: false }).limit(limit)) as LedgerRow[];
}

// ---------- transactions ----------
export interface TxnFilters {
  search?: string;
  types?: TxnType[];
  accountId?: string;
  from?: string;
  to?: string;
  showDeleted?: boolean;
  page: number;
  pageSize: number;
}

export async function listTransactions(f: TxnFilters): Promise<{ rows: TxnRow[]; total: number }> {
  let q = reports().from("vw_transactions").select("*", { count: "exact" });
  if (!f.showDeleted) q = q.eq("is_deleted", false);
  if (f.types?.length) q = q.in("transaction_type", f.types);
  if (f.accountId) q = q.or(`from_account_id.eq.${f.accountId},to_account_id.eq.${f.accountId}`);
  if (f.from) q = q.gte("transaction_date", f.from);
  if (f.to) q = q.lte("transaction_date", f.to);
  const s = f.search?.replace(/[,()%*\\]/g, " ").trim();
  if (s) q = q.or(`remarks.ilike.*${s}*,reference_no.ilike.*${s}*,category_name.ilike.*${s}*,from_account_name.ilike.*${s}*,to_account_name.ilike.*${s}*`);
  const start = (f.page - 1) * f.pageSize;
  const res = await q.order("transaction_date", { ascending: false }).order("created_at", { ascending: false })
    .range(start, start + f.pageSize - 1);
  if (res.error) throw new Error(res.error.message);
  return { rows: (res.data ?? []) as TxnRow[], total: res.count ?? 0 };
}

export interface TxnPayload {
  transaction_type: TxnType;
  amount: number;
  transaction_date: string;
  from_account_id?: string | null;
  to_account_id?: string | null;
  category_id?: string | null;
  payment_mode_id?: string | null;
  goal_id?: string | null;
  commitment_schedule_id?: string | null;
  remarks?: string | null;
  reference_no?: string | null;
  attachment_path?: string | null;
  client_request_id?: string;
}

export async function postTransaction(p: TxnPayload) {
  return check(await finance().rpc("post_transaction", { p }));
}
export async function postBulk(items: TxnPayload[]) {
  return check(await finance().rpc("post_transactions_bulk", { p_items: items }));
}
export async function updateTransaction(id: string, p: Partial<TxnPayload>) {
  return check(await finance().rpc("update_transaction", { p_id: id, p }));
}
export async function voidTransaction(id: string, reason: string) {
  return check(await finance().rpc("void_transaction", { p_id: id, p_reason: reason || null }));
}

// ---------- lookups ----------
export async function listMasters(table: "categories" | "payment_modes" | "commitment_types" | "goal_types", activeOnly = false): Promise<MasterRow[]> {
  let q = masters().from(table).select("*").order("sort_order").order("name");
  if (activeOnly) q = q.eq("active", true);
  return check(await q) as MasterRow[];
}
export async function saveMaster(table: "categories" | "payment_modes" | "commitment_types" | "goal_types", row: Partial<MasterRow> & { id?: string }) {
  const { id, ...rest } = row;
  if (id) return check(await masters().from(table).update(rest).eq("id", id).select().single());
  return check(await masters().from(table).insert(rest).select().single());
}
export async function deleteMaster(table: "categories" | "payment_modes" | "commitment_types" | "goal_types", id: string) {
  const res = await masters().from(table).delete().eq("id", id);
  if (res.error) {
    if (res.error.message.includes("foreign key")) throw new Error("It is already used by your records. Deactivate it instead.");
    throw new Error(res.error.message);
  }
}
export async function listGoalOptions(): Promise<GoalOption[]> {
  return check(await finance().from("goals").select("id, name, account_id").eq("is_deleted", false).in("status", ["active", "paused", "achieved"]).order("name")) as GoalOption[];
}
export async function listOpenInstallments(): Promise<InstallmentOption[]> {
  return check(await reports().from("vw_installments").select("id, commitment_name, installment_no, due_date, remaining_amount")
    .in("status", ["pending", "partial"]).order("due_date")) as InstallmentOption[];
}
