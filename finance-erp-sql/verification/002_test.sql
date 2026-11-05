-- =====================================================================
-- Finance ERP OS · Test migration 002 (self-cleaning)
-- Repo path : finance-erp-sql/verification/002_test.sql
-- Creates a throwaway user, posts every transaction type AS that user
-- (role authenticated, RLS on), then ABORTS so nothing is kept.
-- Expected: an error whose message starts with  TEST_RESULT {"pass": true, ...}
-- =====================================================================
begin;
do $$
declare
  u uuid := gen_random_uuid();
  req uuid := gen_random_uuid();
  r jsonb := '{}';
  v_bank uuid; v_cash uuid; v_cc uuid; v_ef uuid; v_cat uuid; v_goal uuid; v_cm uuid; s1 uuid; s2 uuid;
  t_transfer uuid; t_ccexp uuid; t_commit uuid; t finance.transactions;
  n int;
  function_bal numeric;
begin
  insert into auth.users (id, instance_id, aud, role, email)
  values (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'erp-test@example.invalid');
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  r := r || jsonb_build_object('masters_seeded', (select count(*) from masters.payment_modes) = 4
                                             and (select count(*) from masters.commitment_types) = 9);

  insert into finance.accounts (name, account_type, opening_balance) values ('Test Bank', 'bank', 10000) returning id into v_bank;
  insert into finance.accounts (name, account_type, opening_balance) values ('Test Cash', 'cash', 500) returning id into v_cash;
  insert into finance.accounts (name, account_type, opening_balance, credit_limit) values ('Test Card', 'credit_card', 0, 50000) returning id into v_cc;
  insert into finance.accounts (name, account_type, opening_balance) values ('Test EF', 'emergency_fund', 0) returning id into v_ef;
  insert into masters.categories (name, category_group) values ('Food', 'expense') returning id into v_cat;

  -- income, daily spending (bulk), transfer, card spend, card bill
  perform finance.post_transaction(jsonb_build_object('transaction_type','income','amount',20000,'to_account_id',v_bank));
  perform finance.post_transactions_bulk(jsonb_build_array(
    jsonb_build_object('transaction_type','expense','amount',10,'from_account_id',v_cash,'category_id',v_cat,'remarks','Tea'),
    jsonb_build_object('transaction_type','expense','amount',50,'from_account_id',v_cash,'remarks','Travel'),
    jsonb_build_object('transaction_type','expense','amount',40,'from_account_id',v_cash,'remarks','Milk')));
  select id into t_transfer from finance.post_transaction(jsonb_build_object('transaction_type','transfer','amount',1000,'from_account_id',v_bank,'to_account_id',v_cash));
  select id into t_ccexp    from finance.post_transaction(jsonb_build_object('transaction_type','expense','amount',500,'from_account_id',v_cc));
  r := r || jsonb_build_object('cc_outstanding_after_spend', (select outstanding from reports.vw_account_summary where id = v_cc));
  perform finance.post_transaction(jsonb_build_object('transaction_type','credit_card_payment','amount',500,'from_account_id',v_bank,'to_account_id',v_cc));

  -- goal contribution
  insert into finance.goals (name, target_amount) values ('Test Goal', 1000) returning id into v_goal;
  perform finance.post_transaction(jsonb_build_object('transaction_type','goal_contribution','amount',600,'from_account_id',v_bank,'to_account_id',v_ef,'goal_id',v_goal));

  -- commitment: two installments, one payment split across them
  insert into finance.commitments (name, frequency) values ('Test Loan', 'monthly') returning id into v_cm;
  insert into finance.commitment_schedules (commitment_id, due_date, amount, installment_no) values (v_cm, '2026-06-05', 1000, 1) returning id into s1;
  insert into finance.commitment_schedules (commitment_id, due_date, amount, installment_no) values (v_cm, '2026-07-05', 1000, 2) returning id into s2;
  select id into t_commit from finance.post_transaction(jsonb_build_object('transaction_type','commitment_payment','amount',1500,'from_account_id',v_bank,
    'allocations', jsonb_build_array(jsonb_build_object('schedule_id',s1,'amount',1000), jsonb_build_object('schedule_id',s2,'amount',500))));
  r := r || jsonb_build_object('s1_after_pay', (select status || ':' || paid_amount from finance.commitment_schedules where id = s1),
                               's2_after_pay', (select status || ':' || paid_amount from finance.commitment_schedules where id = s2));

  -- overpayment must be blocked (s2 has only 500 remaining)
  begin
    perform finance.post_transaction(jsonb_build_object('transaction_type','commitment_payment','amount',600,'from_account_id',v_bank,'commitment_schedule_id',s2));
    r := r || jsonb_build_object('overpay_blocked', false);
  exception when others then
    r := r || jsonb_build_object('overpay_blocked', true);
  end;

  -- same request twice → posted once
  perform finance.post_transaction(jsonb_build_object('transaction_type','expense','amount',100,'from_account_id',v_bank,'client_request_id',req));
  perform finance.post_transaction(jsonb_build_object('transaction_type','expense','amount',100,'from_account_id',v_bank,'client_request_id',req));
  r := r || jsonb_build_object('duplicate_blocked', (select count(*) from finance.transactions where client_request_id = req) = 1);

  -- edit transfer 1000 → 2000; delete card spend and loan payment
  perform finance.update_transaction(t_transfer, '{"amount": 2000}');
  perform finance.void_transaction(t_ccexp, 'test delete');
  perform finance.void_transaction(t_commit, 'test delete');
  r := r || jsonb_build_object('s1_after_void', (select status || ':' || paid_amount from finance.commitment_schedules where id = s1));

  -- clients must not be able to write balances directly
  begin
    update finance.accounts set current_balance = 999999 where id = v_bank;
    r := r || jsonb_build_object('direct_balance_write_blocked', false);
  exception when insufficient_privilege then
    r := r || jsonb_build_object('direct_balance_write_blocked', true);
  end;

  r := r || jsonb_build_object(
    'bank', (select current_balance from finance.accounts where id = v_bank),   -- expect 26800
    'cash', (select current_balance from finance.accounts where id = v_cash),   -- expect 2400
    'card', (select current_balance from finance.accounts where id = v_cc),     -- expect 500 (card in credit after deleting its spend)
    'ef',   (select current_balance from finance.accounts where id = v_ef),     -- expect 600
    'goal', (select current_amount  from finance.goals    where id = v_goal),   -- expect 600
    'reconcile_drift_rows', (select count(*) from finance.reconcile_balances()),
    'ledger_rows_bank', (select count(*) from reports.vw_account_ledger where account_id = v_bank),
    'history_rows', (select count(*) from finance.history_logs));

  r := r || jsonb_build_object('pass',
        (r->>'masters_seeded')::boolean
    and (r->>'cc_outstanding_after_spend')::numeric = 500
    and r->>'s1_after_pay' = 'paid:1000.00' and r->>'s2_after_pay' = 'partial:500.00'
    and (r->>'overpay_blocked')::boolean and (r->>'duplicate_blocked')::boolean
    and r->>'s1_after_void' = 'pending:0.00'
    and (r->>'direct_balance_write_blocked')::boolean
    and (r->>'bank')::numeric = 26800 and (r->>'cash')::numeric = 2400
    and (r->>'card')::numeric = 500 and (r->>'ef')::numeric = 600 and (r->>'goal')::numeric = 600
    and (r->>'reconcile_drift_rows')::int = 0);

  raise exception 'TEST_RESULT %', r::text;
end $$;
rollback;
