/**
 * Single data-access layer for the web app. Every money change goes through a
 * database RPC; the mobile app will use the same functions/contract.
 */
import { finance, masters, reports, supabase } from "./supabase/client";
import type {
  Commitment, CommitmentStatus, CreditCard, Installment, MonthlyPlan, PlanItem, Priority,
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
  allocations?: { schedule_id: string; amount: number }[];
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

// ---------- credit cards ----------

export async function listCreditCards(): Promise<CreditCard[]> {
  return check(await reports().from("vw_credit_cards").select("*").order("name")) as CreditCard[];
}

// ---------- commitments ----------
export async function listCommitments(): Promise<(Commitment & { stats?: CommitmentStatus })[]> {
  const [c, s] = await Promise.all([
    finance().from("commitments").select("*").eq("is_deleted", false).order("name"),
    reports().from("vw_commitment_status").select("*"),
  ]);
  const rows = check(c) as Commitment[];
  const stats = new Map((check(s) as CommitmentStatus[]).map((x) => [x.id, x]));
  return rows.map((r) => ({ ...r, stats: stats.get(r.id) }));
}
export async function getCommitment(id: string): Promise<Commitment> {
  return check(await finance().from("commitments").select("*").eq("id", id).single()) as Commitment;
}
export type CommitmentInput = Omit<Commitment, "id">;
export async function saveCommitment(input: Partial<CommitmentInput>, id?: string): Promise<Commitment> {
  if (id) return check(await finance().from("commitments").update(input).eq("id", id).select().single()) as Commitment;
  return check(await finance().from("commitments").insert(input).select().single()) as Commitment;
}
export async function deleteCommitment(id: string) {
  check(await finance().from("commitments").update({ is_deleted: true }).eq("id", id).select("id"));
}
export async function generateSchedules(commitmentId: string, until?: string): Promise<number> {
  return check(await finance().rpc("generate_schedules", { p_commitment_id: commitmentId, p_until: until ?? null })) as number;
}
export async function listInstallments(opts: { commitmentId?: string; openOnly?: boolean }): Promise<Installment[]> {
  let q = reports().from("vw_installments").select("*");
  if (opts.commitmentId) q = q.eq("commitment_id", opts.commitmentId);
  if (opts.openOnly) q = q.in("status", ["pending", "partial"]);
  return check(await q.order("due_date").order("installment_no")) as Installment[];
}
export async function cancelSchedule(id: string, reason: string) {
  return check(await finance().rpc("cancel_schedule", { p_schedule_id: id, p_reason: reason || null }));
}
export async function restoreSchedule(id: string) {
  return check(await finance().rpc("restore_schedule", { p_schedule_id: id }));
}
export async function distributeOutstanding(ids: string[], months: string[], mode: "equal" | "all" | "custom", amounts?: number[]) {
  return check(await finance().rpc("distribute_outstanding", {
    p_schedule_ids: ids, p_months: months, p_mode: mode, p_amounts: mode === "custom" ? amounts : null,
  }));
}
export async function clearPaymentPlans(ids: string[]) {
  return check(await finance().rpc("clear_payment_plans", { p_schedule_ids: ids })) as number;
}

// ---------- monthly plan ----------
export async function getPlan(year: number, month: number): Promise<MonthlyPlan | null> {
  const res = await reports().from("vw_monthly_plans").select("*").eq("plan_year", year).eq("plan_month", month).maybeSingle();
  return check(res) as MonthlyPlan | null;
}
export async function generatePlan(year: number, month: number) {
  return check(await finance().rpc("generate_month_plan", { p_year: year, p_month: month }));
}
export async function listPlanItems(planId: string): Promise<PlanItem[]> {
  return check(await reports().from("vw_plan_items").select("*").eq("plan_id", planId)) as PlanItem[];
}
export async function updatePlan(planId: string, input: { expected_income?: number; notes?: string | null }) {
  return check(await finance().from("monthly_plans").update(input).eq("id", planId).select("id"));
}
export interface PlanItemInput {
  item_name?: string; item_type?: string; planned_amount?: number; planned_date?: string | null;
  priority?: Priority; status?: string; account_id?: string | null; category_id?: string | null; remarks?: string | null;
}
export async function savePlanItem(input: PlanItemInput & { plan_id?: string }, id?: string) {
  if (id) return check(await finance().from("plan_items").update(input).eq("id", id).select("id"));
  return check(await finance().from("plan_items").insert(input).select("id"));
}
export async function deletePlanItem(id: string) {
  check(await finance().from("plan_items").delete().eq("id", id).select("id"));
}
export async function payPlanItem(itemId: string, fromAccountId: string, amount: number, date: string, requestId: string) {
  return check(await finance().rpc("pay_plan_item", {
    p_item_id: itemId, p_from_account_id: fromAccountId, p_amount: amount, p_date: date, p_client_request_id: requestId,
  }));
}
export async function finalizePlan(planId: string) { return check(await finance().rpc("finalize_month_plan", { p_plan_id: planId })); }
export async function reopenPlan(planId: string) { return check(await finance().rpc("reopen_month_plan", { p_plan_id: planId })); }
