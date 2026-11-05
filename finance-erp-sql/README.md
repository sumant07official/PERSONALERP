# finance-erp-sql

Database for **Finance ERP OS** (Supabase project `foceiczwbtiuvbindgps`).
Web and Android apps share this database and call the same RPCs, so business rules live here once.

## Status

| Migration | What it does | Applied |
|---|---|---|
| 001_security_foundation | Owners (`user_id`), RLS, least-privilege grants, constraints, per-user masters on signup | ✅ 05 Nov 2026 |
| 002_posting_engine | Posting, edit/delete with reversal, stored balances, duplicate-post protection, audit trail, ledger | ✅ 05 Nov 2026 |
| 003_commitments_engine | Installment generator, carry-forward, split/reschedule, overpayment guard | ✅ 05 Nov 2026 |
| 004_planning_engine | Monthly Planning Assistant with reasons, pay-from-plan, finalize/reopen | ✅ 05 Nov 2026 |
| 005_reports_dashboard | Dashboard RPC, reports, calendar, profiles, CSV/Excel import + undo, attachments bucket | ✅ 05 Nov 2026 |
| 006_fk_covering_indexes | Covering indexes for every owner-safe foreign key | ✅ 05 Nov 2026 |

**Never re-run an applied migration.** New changes go in a new numbered file.
Verify any time with `verification/999_full_verify.sql` (every row must be `ok = true`).

## Folder layout

```
audit/          read-only inspection scripts
migrations/     numbered, applied in order
verification/   read-only checks + self-cleaning tests (they always end in an error that starts with TEST_RESULT; that is how they roll back)
```

## Accounting model

* `accounts.current_balance` means **money I have**. Credit card and loan balances go **negative** when you owe. Outstanding = `-current_balance`.
* Every posted transaction writes one row per touched account in `account_postings`. Balances change **only** through the posting engine.
* Edit = reverse old effects, apply new ones, in one database transaction. Delete = soft void with full reversal. Both are logged in `history_logs`.
* Installments (`commitment_schedules`) never change their original due date or amount. Payments link to them through `payment_allocations`.

| Type | From account | To account | Extra effect |
|---|---|---|---|
| income | — | +amount | |
| expense | −amount (a card here raises outstanding) | — | optional installment allocation |
| transfer | −amount | +amount | not income/expense |
| credit_card_payment | bank −amount | card +amount | not an expense (no double count) |
| goal_contribution | −amount | optional goal account +amount | goal progress |
| commitment_payment | −amount | optional loan account | allocated to installment(s) |
| adjustment | exactly one side | | |

## Client API (call with supabase-js `.schema('finance').rpc(...)`)

**Transactions**
* `post_transaction(p jsonb)`: fields `transaction_type, amount, transaction_date, from_account_id, to_account_id, category_id, payment_mode_id, goal_id, commitment_schedule_id, allocations [{schedule_id, amount}], remarks, reference_no, attachment_path, client_request_id`. **Always send a fresh `client_request_id` (uuid) per form submit.** Retries then never double-post.
* `post_transactions_bulk(p_items jsonb)`: daily spending (Tea 10, Travel 50, Milk 40) in one call.
* `update_transaction(p_id, p jsonb)`: send only the fields that change.
* `void_transaction(p_id, p_reason)`: delete with full reversal.
* `set_opening_balance(p_account_id, p_amount)`, `reconcile_balances()` (should return 0 rows).

**Commitments**
* `generate_schedules(p_commitment_id, p_until)`, `generate_all_schedules(p_until)`
* `distribute_outstanding(p_schedule_ids uuid[], p_months date[], p_mode 'equal'|'all'|'custom', p_amounts numeric[])`: installment order = payment order.
* `clear_payment_plans(p_schedule_ids)`, `cancel_schedule(p_schedule_id, p_reason)`, `restore_schedule(p_schedule_id)`

**Monthly plan**
* `generate_month_plan(p_year, p_month)`: safe to run repeatedly. It never duplicates items or overwrites accepted, edited or rejected ones.
* Accept/reject/edit/add/remove items: normal insert/update/delete on `finance.plan_items` (editing a suggestion auto-accepts it).
* `pay_plan_item(p_item_id, p_from_account_id, p_amount?, p_date?, p_client_request_id?)`
* `finalize_month_plan(p_plan_id)`, `reopen_month_plan(p_plan_id)`

**Import**: `import_transactions(p_file_name, p_source 'csv'|'excel'|'bank_statement', p_items jsonb)` (all rows or none), `undo_import(p_batch_id)`

**Dashboard**: `.schema('reports').rpc('dashboard_summary', { p_month })` → one JSON with income, expense, savings, balances, card outstanding, pending/overdue, upcoming, emergency fund, budget utilization, net worth.

## Read models (`reports` schema, all owner-scoped)

`vw_transactions`, `vw_account_summary`, `vw_account_ledger` (running balance), `vw_credit_cards`, `vw_installments` (outstanding/overdue/planned/unplanned), `vw_commitment_status`, `vw_plan_items` (paid, remaining, display status), `vw_monthly_plans`, `vw_goal_progress`, `vw_monthly_summary`, `vw_category_spend`, `vw_calendar_events`.

Directly editable tables (RLS-protected): `masters.*`, `finance.commitments`, `finance.goals` (except `current_amount`), `finance.accounts` (except balances), `finance.monthly_plans`, `finance.plan_items`, `finance.payment_plans`, `finance.tasks`, `finance.assets`, `finance.comments`, `public.profiles` (name, avatar, currency).

## Attachments

Private bucket `attachments`. Upload to `<user_id>/<anything>` and store the path in `transactions.attachment_path`.

## One-time dashboard setting

Project Settings → Data API → Exposed schemas: `public, graphql_public, masters, finance, reports`.

## Timezone

"Today", overdue checks and default dates use **Asia/Kolkata** (`finance._today()`).
