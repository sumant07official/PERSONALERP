-- =====================================================================
-- Finance ERP OS · Migration 001 · Ownership, security & integrity
-- Repo path : finance-erp-sql/migrations/001_security_foundation.sql
-- Target    : project foceiczwbtiuvbindgps (fresh: 0 users, 0 transactions)
-- Runs as ONE transaction. If any guard fails, nothing changes.
--
-- What it does
--   0. Guards: aborts if users or real data exist; removes the 4 zero-balance
--      ownerless test accounts (BOI, Cash, Emergency Fund, Credit Card).
--   1. Adds user_id (owner) to every table; masters seeds become system
--      templates copied to each new user on signup.
--   2. Fixes broken updated_at triggers (transactions/goals/commitments had
--      the trigger but no column → every UPDATE would fail).
--   3. Replaces single FKs with owner-safe composite FKs (id, user_id),
--      adds missing FKs, CHECKs, uniques and indexes.
--   4. Adds columns the engines need (credit card limits/days, idempotency
--      key, void fields, installment fields, plan suggestion fields...).
--   5. Creates finance.comments (listed in the brief, missing in the DB).
--   6. RLS owner policies + least-privilege grants (money columns are
--      read-only to clients; posting RPCs arrive in migration 002).
--   7. Rebuilds reports views with security_invoker + owner columns.
--
-- Sign convention (accounts.current_balance): "money I have".
--   Assets positive. Credit card / loan balances go NEGATIVE as you owe;
--   outstanding = -current_balance.
-- =====================================================================

begin;

-- ---------- 0. Guards & test data --------------------------------------
do $$
declare t text; n bigint;
begin
  if exists (select 1 from auth.users) then
    raise exception 'auth.users is not empty — 001 expects a fresh project';
  end if;
  foreach t in array array['assets','commitment_schedules','commitments','goal_contributions',
    'goals','history_logs','monthly_plans','payment_plans','plan_items','tasks','transactions'] loop
    execute format('select count(*) from finance.%I', t) into n;
    if n > 0 then raise exception 'finance.% has % rows — aborting', t, n; end if;
  end loop;
  if exists (select 1 from finance.accounts where current_balance <> 0 or opening_balance <> 0) then
    raise exception 'finance.accounts has non-zero balances — aborting';
  end if;
end $$;

delete from finance.accounts;   -- ownerless zero-balance test rows

drop view if exists reports.vw_account_summary, reports.vw_goal_progress, reports.vw_commitment_status;

-- Drop existing FKs, CHECKs and masters name-uniques (re-created owner-aware below)
do $$
declare r record;
begin
  for r in
    select n.nspname, c.relname, co.conname
    from pg_constraint co
    join pg_class c on c.oid = co.conrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('finance','masters')
      and (co.contype in ('f','c') or (co.contype = 'u' and n.nspname = 'masters'))
  loop
    execute format('alter table %I.%I drop constraint %I', r.nspname, r.relname, r.conname);
  end loop;
end $$;

alter function finance.fn_update_timestamp() set search_path = '';

-- ---------- 1. Ownership ------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['accounts','assets','commitment_schedules','commitments','goal_contributions',
    'goals','history_logs','monthly_plans','payment_plans','plan_items','tasks','transactions'] loop
    execute format('alter table finance.%I add column user_id uuid not null default auth.uid() references auth.users(id) on delete cascade', t);
    execute format('create index %I on finance.%I (user_id)', t || '_user_idx', t);
    execute format('alter table finance.%I add constraint %I unique (id, user_id)', t, t || '_id_user_uk');
  end loop;

  foreach t in array array['categories','payment_modes','commitment_types','goal_types'] loop
    execute format('alter table masters.%I
        add column user_id uuid default auth.uid() references auth.users(id) on delete cascade,
        add column is_system boolean not null default false,
        add column updated_at timestamptz not null default now()', t);
    execute format('update masters.%I set is_system = true where user_id is null', t);
    execute format('alter table masters.%I add constraint %I check (is_system = (user_id is null))', t, t || '_owner_ck');
    execute format('alter table masters.%I add constraint %I unique (id, user_id)', t, t || '_id_user_uk');
    execute format('create unique index %I on masters.%I (user_id, lower(name)) nulls not distinct', t || '_user_name_uk', t);
    execute format('create index %I on masters.%I (user_id)', t || '_user_idx', t);
    execute format('alter table masters.%I alter column active set not null', t);
    execute format('create trigger %I before update on masters.%I for each row execute function finance.fn_update_timestamp()',
                   'trg_' || t || '_updated_at', t);
  end loop;

  -- updated_at everywhere (fixes the 3 broken triggers) + triggers where missing
  foreach t in array array['assets','commitment_schedules','commitments','goal_contributions','goals',
    'monthly_plans','payment_plans','plan_items','tasks','transactions'] loop
    execute format('alter table finance.%I add column if not exists updated_at timestamptz not null default now()', t);
  end loop;
  foreach t in array array['assets','commitment_schedules','goal_contributions','monthly_plans','payment_plans','plan_items','tasks'] loop
    execute format('create trigger %I before update on finance.%I for each row execute function finance.fn_update_timestamp()',
                   'trg_' || t || '_updated_at', t);
  end loop;

  foreach t in array array['accounts','assets','commitments','goals','tasks','transactions'] loop
    execute format('alter table finance.%I alter column is_deleted set not null', t);
  end loop;
end $$;

-- ---------- 2. Masters --------------------------------------------------
alter table masters.categories
  add column parent_id uuid,
  add column icon text,
  add column color text,
  add constraint categories_group_ck check (category_group in ('income','expense','both')),
  add constraint categories_parent_fk foreign key (parent_id, user_id) references masters.categories (id, user_id);
create index categories_parent_idx on masters.categories (parent_id);

alter table masters.payment_modes    add column sort_order int not null default 0;
alter table masters.commitment_types add column sort_order int not null default 0;
alter table masters.goal_types       add column sort_order int not null default 0;

-- ---------- 3. Accounts -------------------------------------------------
alter table finance.accounts
  alter column opening_balance set not null,
  alter column current_balance set not null,
  alter column active set not null,
  add column credit_limit numeric(14,2),
  add column billing_day smallint,
  add column due_day smallint,
  add column sort_order int not null default 0,
  add constraint accounts_type_ck check (account_type in
      ('cash','bank','upi','credit_card','savings','investment','emergency_fund','loan','other')),
  add constraint accounts_credit_limit_ck check (credit_limit is null or credit_limit >= 0),
  add constraint accounts_billing_day_ck check (billing_day between 1 and 31),
  add constraint accounts_due_day_ck check (due_day between 1 and 31);
create unique index accounts_user_name_uk on finance.accounts (user_id, lower(name)) where not is_deleted;
comment on column finance.accounts.current_balance is
  'Maintained only by posting functions. Assets positive; credit_card/loan negative when owed (outstanding = -balance).';

create or replace function finance.fn_accounts_init_balance()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.current_balance := coalesce(new.opening_balance, 0);
  return new;
end $$;
create trigger trg_accounts_init_balance before insert on finance.accounts
  for each row execute function finance.fn_accounts_init_balance();

-- ---------- 4. Commitments & schedules ----------------------------------
alter table finance.commitments
  add column installment_amount numeric(14,2),
  add column due_day smallint,
  add column total_installments int,
  add column category_id uuid,
  add column default_account_id uuid,
  alter column total_amount set not null,
  alter column frequency set not null,
  alter column status set not null,
  add constraint commitments_amounts_ck check (total_amount >= 0 and (installment_amount is null or installment_amount > 0)),
  add constraint commitments_due_day_ck check (due_day between 1 and 31),
  add constraint commitments_installments_ck check (total_installments is null or total_installments > 0),
  add constraint commitments_dates_ck check (end_date is null or start_date is null or end_date >= start_date),
  add constraint commitments_frequency_ck check (frequency in ('one_time','monthly','quarterly','half_yearly','yearly')),
  add constraint commitments_status_ck check (status in ('active','paused','completed','cancelled')),
  add constraint commitments_type_fk foreign key (commitment_type_id, user_id) references masters.commitment_types (id, user_id),
  add constraint commitments_category_fk foreign key (category_id, user_id) references masters.categories (id, user_id),
  add constraint commitments_account_fk foreign key (default_account_id, user_id) references finance.accounts (id, user_id);
create index commitments_type_idx on finance.commitments (commitment_type_id);
create index commitments_category_idx on finance.commitments (category_id);
create index commitments_account_idx on finance.commitments (default_account_id);

alter table finance.commitment_schedules
  add column installment_no int,
  add column remarks text,
  alter column paid_amount set not null,
  alter column status set not null,
  add constraint schedules_amount_ck check (amount > 0),
  add constraint schedules_paid_ck check (paid_amount >= 0 and paid_amount <= amount),
  add constraint schedules_status_ck check (status in ('pending','partial','paid','cancelled')),
  add constraint schedules_commitment_fk foreign key (commitment_id, user_id)
      references finance.commitments (id, user_id) on delete cascade;
create index schedules_commitment_idx on finance.commitment_schedules (commitment_id);
create index schedules_open_due_idx on finance.commitment_schedules (user_id, due_date)
  where status in ('pending','partial');
create unique index schedules_installment_uk on finance.commitment_schedules (commitment_id, installment_no)
  where installment_no is not null;

alter table finance.payment_plans
  alter column status set not null,
  add constraint payment_plans_month_ck check (planned_month between 1 and 12 and planned_year between 2000 and 2100),
  add constraint payment_plans_amount_ck check (planned_amount > 0),
  add constraint payment_plans_status_ck check (status in ('planned','paid','cancelled')),
  add constraint payment_plans_schedule_fk foreign key (schedule_id, user_id)
      references finance.commitment_schedules (id, user_id) on delete cascade,
  add constraint payment_plans_schedule_month_uk unique (schedule_id, planned_year, planned_month);

-- ---------- 5. Goals ----------------------------------------------------
alter table finance.goals
  add column account_id uuid,
  alter column target_amount set not null,
  alter column current_amount set not null,
  alter column status set not null,
  add constraint goals_amounts_ck check (target_amount >= 0 and current_amount >= 0),
  add constraint goals_status_ck check (status in ('active','achieved','paused','cancelled')),
  add constraint goals_type_fk foreign key (goal_type_id, user_id) references masters.goal_types (id, user_id),
  add constraint goals_account_fk foreign key (account_id, user_id) references finance.accounts (id, user_id);
create index goals_type_idx on finance.goals (goal_type_id);
create index goals_account_idx on finance.goals (account_id);

-- ---------- 6. Transactions ---------------------------------------------
alter table finance.transactions
  add column reference_no text,
  add column attachment_path text,
  add column client_request_id uuid,
  add column voided_at timestamptz,
  add column void_reason text,
  alter column status set not null,
  add constraint transactions_amount_ck check (amount > 0),
  add constraint transactions_status_ck check (status in ('draft','posted','void')),
  add constraint transactions_type_ck check (transaction_type in
      ('income','expense','transfer','goal_contribution','commitment_payment','credit_card_payment','adjustment')),
  add constraint transactions_shape_ck check (case transaction_type
      when 'income'              then to_account_id is not null and from_account_id is null
      when 'expense'             then from_account_id is not null and to_account_id is null
      when 'transfer'            then from_account_id is not null and to_account_id is not null and from_account_id <> to_account_id
      when 'credit_card_payment' then from_account_id is not null and to_account_id is not null and from_account_id <> to_account_id
      when 'goal_contribution'   then from_account_id is not null and goal_id is not null and from_account_id is distinct from to_account_id
      when 'commitment_payment'  then from_account_id is not null and from_account_id is distinct from to_account_id
      when 'adjustment'          then (from_account_id is null) <> (to_account_id is null)
    end),
  add constraint transactions_void_ck check ((status = 'void') = (voided_at is not null)),
  add constraint transactions_request_uk unique (user_id, client_request_id),
  add constraint transactions_from_fk     foreign key (from_account_id, user_id) references finance.accounts (id, user_id),
  add constraint transactions_to_fk       foreign key (to_account_id, user_id)   references finance.accounts (id, user_id),
  add constraint transactions_category_fk foreign key (category_id, user_id)     references masters.categories (id, user_id),
  add constraint transactions_mode_fk     foreign key (payment_mode_id, user_id) references masters.payment_modes (id, user_id),
  add constraint transactions_goal_fk     foreign key (goal_id, user_id)         references finance.goals (id, user_id),
  add constraint transactions_schedule_fk foreign key (commitment_schedule_id, user_id) references finance.commitment_schedules (id, user_id);
create index transactions_user_date_idx on finance.transactions (user_id, transaction_date desc) where not is_deleted;
create index transactions_from_idx     on finance.transactions (from_account_id);
create index transactions_to_idx       on finance.transactions (to_account_id);
create index transactions_category_idx on finance.transactions (category_id);
create index transactions_mode_idx     on finance.transactions (payment_mode_id);
create index transactions_goal_idx     on finance.transactions (goal_id);
create index transactions_schedule_idx on finance.transactions (commitment_schedule_id);

alter table finance.goal_contributions
  add column transaction_id uuid,
  add constraint goal_contributions_amount_ck check (amount > 0),
  add constraint goal_contributions_goal_fk foreign key (goal_id, user_id)
      references finance.goals (id, user_id) on delete cascade,
  add constraint goal_contributions_txn_fk foreign key (transaction_id, user_id)
      references finance.transactions (id, user_id),
  add constraint goal_contributions_txn_uk unique (transaction_id);
create index goal_contributions_goal_idx on finance.goal_contributions (goal_id);

-- ---------- 7. Monthly planning -----------------------------------------
alter table finance.monthly_plans
  alter column status set not null,
  add constraint monthly_plans_period_ck check (plan_month between 1 and 12 and plan_year between 2000 and 2100),
  add constraint monthly_plans_status_ck check (status in ('draft','finalized','closed')),
  add constraint monthly_plans_period_uk unique (user_id, plan_year, plan_month);

alter table finance.plan_items
  add column planned_date date,
  add column suggestion_reason text,
  add column sort_order int not null default 0,
  alter column priority set not null,
  alter column status set not null,
  add constraint plan_items_amounts_ck check (planned_amount >= 0 and actual_amount >= 0),
  add constraint plan_items_priority_ck check (priority in ('low','normal','high','critical')),
  add constraint plan_items_status_ck check (status in ('suggested','accepted','rejected','pending','partial','paid','deferred')),
  add constraint plan_items_plan_fk foreign key (plan_id, user_id)
      references finance.monthly_plans (id, user_id) on delete cascade;
create index plan_items_plan_idx on finance.plan_items (plan_id);
create unique index plan_items_source_uk on finance.plan_items (plan_id, source_type, source_id)
  where source_id is not null;

-- ---------- 8. Tasks, assets, history, comments -------------------------
alter table finance.tasks
  add column completed_at timestamptz,
  add constraint tasks_priority_ck check (priority in ('low','normal','high','critical')),
  add constraint tasks_status_ck check (status in ('pending','in_progress','done','cancelled'));
create index tasks_due_idx on finance.tasks (user_id, due_date) where not is_deleted;

alter table finance.assets
  add constraint assets_values_ck check (purchase_value >= 0 and current_value >= 0);

alter table finance.history_logs
  alter column created_by type uuid using null,
  alter column created_by set default auth.uid(),
  alter column created_at set not null,
  add constraint history_logs_action_ck check (action in ('insert','update','delete','void','restore','post'));
create index history_logs_entity_idx on finance.history_logs (user_id, entity_type, entity_id, created_at desc);

create table finance.comments (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  entity_type text not null,
  entity_id   uuid not null,
  body        text not null check (length(btrim(body)) > 0),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  is_deleted  boolean not null default false
);
alter table finance.comments enable row level security;
create index comments_entity_idx on finance.comments (user_id, entity_type, entity_id);
create trigger trg_comments_updated_at before update on finance.comments
  for each row execute function finance.fn_update_timestamp();

-- ---------- 9. Per-user master seeding on signup ------------------------
create or replace function finance.fn_seed_user_masters()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into masters.payment_modes (name, active, sort_order, user_id)
    select name, active, sort_order, new.id from masters.payment_modes where is_system;
  insert into masters.commitment_types (name, active, sort_order, user_id)
    select name, active, sort_order, new.id from masters.commitment_types where is_system;
  insert into masters.goal_types (name, active, sort_order, user_id)
    select name, active, sort_order, new.id from masters.goal_types where is_system;
  insert into masters.categories (name, category_group, active, sort_order, icon, color, user_id)
    select name, category_group, active, sort_order, icon, color, new.id from masters.categories where is_system;
  return new;
end $$;
revoke execute on function finance.fn_seed_user_masters() from public, anon, authenticated;
create trigger trg_seed_user_masters after insert on auth.users
  for each row execute function finance.fn_seed_user_masters();

-- ---------- 10. Reports views (owner-scoped via security_invoker) -------
create view reports.vw_account_summary with (security_invoker = true) as
select id, user_id, name, account_type, opening_balance, current_balance,
       case when account_type in ('credit_card','loan') then greatest(-current_balance, 0) else 0 end as outstanding,
       credit_limit,
       case when account_type = 'credit_card' and credit_limit is not null
            then credit_limit + least(current_balance, 0) end as available_credit,
       active, sort_order
from finance.accounts
where not is_deleted;

create view reports.vw_goal_progress with (security_invoker = true) as
select id, user_id, name, goal_type_id, target_amount, current_amount,
       greatest(target_amount - current_amount, 0) as remaining_amount,
       case when target_amount > 0 then least(round(current_amount / target_amount * 100, 2), 100) else 0 end as progress_percent,
       target_date, status
from finance.goals
where not is_deleted;

create view reports.vw_commitment_status with (security_invoker = true) as
select c.id, c.user_id, c.name, c.status as commitment_status,
       count(cs.id)                                                                   as total_items,
       count(cs.id) filter (where cs.status = 'paid')                                 as paid_items,
       count(cs.id) filter (where cs.status in ('pending','partial')
                              and cs.due_date >= (now() at time zone 'Asia/Kolkata')::date) as pending_items,
       count(cs.id) filter (where cs.status in ('pending','partial')
                              and cs.due_date <  (now() at time zone 'Asia/Kolkata')::date) as overdue_items,
       coalesce(sum(cs.amount - cs.paid_amount) filter (where cs.status in ('pending','partial')), 0) as outstanding_amount,
       min(cs.due_date) filter (where cs.status in ('pending','partial'))             as next_due_date
from finance.commitments c
left join finance.commitment_schedules cs on cs.commitment_id = c.id
where not c.is_deleted
group by c.id, c.user_id, c.name, c.status;

-- ---------- 11. RLS policies --------------------------------------------
do $$
declare t text;
begin
  -- read own rows: every table
  foreach t in array array['masters.categories','masters.payment_modes','masters.commitment_types','masters.goal_types',
    'finance.accounts','finance.assets','finance.commitment_schedules','finance.commitments','finance.goal_contributions',
    'finance.goals','finance.history_logs','finance.monthly_plans','finance.payment_plans','finance.plan_items',
    'finance.tasks','finance.transactions','finance.comments'] loop
    execute format('create policy owner_select on %s for select to authenticated using ((select auth.uid()) = user_id)', t);
  end loop;

  -- insert / update own rows (column grants below limit what can change)
  foreach t in array array['masters.categories','masters.payment_modes','masters.commitment_types','masters.goal_types',
    'finance.accounts','finance.assets','finance.commitment_schedules','finance.commitments','finance.goals',
    'finance.monthly_plans','finance.payment_plans','finance.plan_items','finance.tasks','finance.comments'] loop
    execute format('create policy owner_insert on %s for insert to authenticated with check ((select auth.uid()) = user_id)', t);
    execute format('create policy owner_update on %s for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)', t);
  end loop;

  -- hard delete own rows (accounts use soft delete; money tables via RPC only)
  foreach t in array array['masters.categories','masters.payment_modes','masters.commitment_types','masters.goal_types',
    'finance.assets','finance.commitment_schedules','finance.commitments','finance.goals',
    'finance.monthly_plans','finance.payment_plans','finance.plan_items','finance.tasks','finance.comments'] loop
    execute format('create policy owner_delete on %s for delete to authenticated using ((select auth.uid()) = user_id)', t);
  end loop;
end $$;

-- ---------- 12. Grants (least privilege) --------------------------------
revoke all on all tables in schema masters, finance, reports from anon, authenticated;
revoke usage on schema masters, finance, reports from anon;
grant usage on schema masters, finance, reports to authenticated, service_role;
grant all on all tables in schema masters, finance, reports to service_role;

grant select, insert, update, delete on
  masters.categories, masters.payment_modes, masters.commitment_types, masters.goal_types,
  finance.commitments, finance.payment_plans, finance.monthly_plans, finance.plan_items,
  finance.tasks, finance.assets, finance.comments
to authenticated;

-- Accounts: balances are server-owned
grant select on finance.accounts to authenticated;
grant insert (name, account_type, opening_balance, account_code, notes, active,
              credit_limit, billing_day, due_day, sort_order) on finance.accounts to authenticated;
grant update (name, account_type, account_code, notes, active,
              credit_limit, billing_day, due_day, sort_order, is_deleted) on finance.accounts to authenticated;

-- Goals: current_amount is server-owned
grant select, delete on finance.goals to authenticated;
grant insert (name, goal_type_id, target_amount, target_date, status, notes, account_id) on finance.goals to authenticated;
grant update (name, goal_type_id, target_amount, target_date, status, notes, account_id, is_deleted) on finance.goals to authenticated;

-- Schedules: due_date/amount are immutable to clients after creation; paid_amount/status server-owned
grant select, delete on finance.commitment_schedules to authenticated;
grant insert (commitment_id, due_date, amount, installment_no, remarks) on finance.commitment_schedules to authenticated;
grant update (remarks) on finance.commitment_schedules to authenticated;

-- Ledger tables: read-only to clients (posting RPCs in migration 002)
grant select on finance.transactions, finance.goal_contributions, finance.history_logs to authenticated;

grant select on all tables in schema reports to authenticated;

commit;
