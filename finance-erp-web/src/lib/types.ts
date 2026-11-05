export type AccountType =
  | "cash" | "bank" | "upi" | "credit_card" | "savings"
  | "investment" | "emergency_fund" | "loan" | "other";

export const ACCOUNT_TYPES: { value: AccountType; label: string }[] = [
  { value: "bank", label: "Bank" },
  { value: "cash", label: "Cash" },
  { value: "upi", label: "UPI / Wallet" },
  { value: "savings", label: "Savings" },
  { value: "credit_card", label: "Credit card" },
  { value: "emergency_fund", label: "Emergency fund" },
  { value: "investment", label: "Investment" },
  { value: "loan", label: "Loan" },
  { value: "other", label: "Other" },
];

/** Liability accounts store a negative balance when money is owed. */
export const isLiability = (t: AccountType) => t === "credit_card" || t === "loan";

export interface Account {
  id: string;
  name: string;
  account_type: AccountType;
  opening_balance: number;
  current_balance: number;
  credit_limit: number | null;
  billing_day: number | null;
  due_day: number | null;
  account_code: string | null;
  notes: string | null;
  active: boolean;
  is_deleted: boolean;
  sort_order: number;
}

export type TxnType =
  | "income" | "expense" | "transfer" | "credit_card_payment"
  | "goal_contribution" | "commitment_payment" | "adjustment";

export const TXN_TYPES: { value: TxnType; label: string }[] = [
  { value: "expense", label: "Expense" },
  { value: "income", label: "Income" },
  { value: "transfer", label: "Transfer" },
  { value: "credit_card_payment", label: "Card payment" },
  { value: "commitment_payment", label: "Commitment payment" },
  { value: "goal_contribution", label: "Goal contribution" },
  { value: "adjustment", label: "Adjustment" },
];

export const txnLabel = (t: string) => TXN_TYPES.find((x) => x.value === t)?.label ?? t;

export interface TxnRow {
  id: string;
  transaction_date: string;
  transaction_type: TxnType;
  amount: number;
  status: "draft" | "posted" | "void";
  is_deleted: boolean;
  from_account_id: string | null;
  from_account_name: string | null;
  to_account_id: string | null;
  to_account_name: string | null;
  category_id: string | null;
  category_name: string | null;
  payment_mode_id: string | null;
  payment_mode_name: string | null;
  goal_id: string | null;
  goal_name: string | null;
  commitment_schedule_id: string | null;
  remarks: string | null;
  reference_no: string | null;
  attachment_path: string | null;
  void_reason: string | null;
  created_at: string;
}

export interface MasterRow {
  id: string;
  name: string;
  active: boolean;
  sort_order: number;
  category_group?: "income" | "expense" | "both";
}

export interface GoalOption { id: string; name: string; account_id: string | null; }

export interface InstallmentOption {
  id: string;
  commitment_name: string;
  installment_no: number;
  due_date: string;
  remaining_amount: number;
}

export interface LedgerRow {
  posting_id: string;
  transaction_id: string;
  transaction_date: string;
  transaction_type: TxnType;
  remarks: string | null;
  reference_no: string | null;
  money_in: number;
  money_out: number;
  running_balance: number;
}

export interface Dashboard {
  month_start: string;
  income: number;
  expense: number;
  net_savings: number;
  goal_contributions: number;
  available_balance: number;
  credit_card_outstanding: number;
  loan_outstanding: number;
  net_worth: number;
  accounts: { id: string; name: string; account_type: AccountType; current_balance: number; outstanding: number }[];
  pending_payments: { count: number; amount: number; overdue_count: number; overdue_amount: number };
  upcoming_commitments: { schedule_id: string; commitment: string; installment_no: number; due_date: string; amount: number }[];
  emergency_fund: { target: number; current: number; progress_percent: number; account_balance: number } | null;
  budget: { plan_id: string; plan_status: string; planned: number; paid: number; remaining: number; utilization_percent: number; critical_open: number } | null;
}

// ---------- Batch 2 ----------
export interface CreditCard {
  id: string; name: string; active: boolean; outstanding: number; credit_limit: number | null;
  available_credit: number | null; utilization_pct: number | null; billing_day: number | null; due_day: number | null;
  next_due_date: string | null; spend_this_month: number; payments_this_month: number;
}

export type Frequency = "one_time" | "monthly" | "quarterly" | "half_yearly" | "yearly";
export const FREQUENCIES: { value: Frequency; label: string }[] = [
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "half_yearly", label: "Half-yearly" },
  { value: "yearly", label: "Yearly" },
  { value: "one_time", label: "One time" },
];

export interface Commitment {
  id: string; name: string; commitment_type_id: string | null; frequency: Frequency;
  start_date: string | null; end_date: string | null; due_day: number | null;
  installment_amount: number | null; total_amount: number; total_installments: number | null;
  category_id: string | null; default_account_id: string | null;
  status: "active" | "paused" | "completed" | "cancelled"; notes: string | null;
}
export interface CommitmentStatus {
  id: string; total_items: number; paid_items: number; pending_items: number; overdue_items: number;
  outstanding_amount: number; next_due_date: string | null;
}
export interface Installment {
  id: string; commitment_id: string; commitment_name: string; commitment_type: string | null;
  default_account_id: string | null; installment_no: number; due_date: string; amount: number;
  paid_amount: number; remaining_amount: number; status: "pending" | "partial" | "paid" | "cancelled";
  is_overdue: boolean; days_overdue: number | null; planned_amount: number; unplanned_amount: number;
  plan_months: { year: number; month: number; amount: number }[] | null; remarks: string | null;
}

export interface MonthlyPlan {
  id: string; plan_year: number; plan_month: number; month_start: string;
  status: "draft" | "finalized" | "closed"; expected_income: number; planned_expense: number;
  expected_savings: number; notes: string | null; paid_amount: number; remaining_amount: number;
  item_count: number; suggested_count: number; paid_count: number; critical_open_count: number;
}
export type Priority = "low" | "normal" | "high" | "critical";
export interface PlanItem {
  id: string; plan_id: string; item_name: string; item_type: string;
  source_type: "schedule" | "account" | "goal" | "plan_item" | null; source_id: string | null;
  suggestion_reason: string | null; planned_amount: number; planned_date: string | null;
  priority: Priority; status: string; account_id: string | null; account_name: string | null;
  category_id: string | null; category_name: string | null; paid_amount: number;
  remaining_amount: number; display_status: string; remarks: string | null;
}
