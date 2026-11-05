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
