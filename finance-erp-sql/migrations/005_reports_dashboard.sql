-- =====================================================================
-- Finance ERP OS · Migration 005 · Dashboard, reports, calendar,
--                                  profiles, data import, attachments
-- Repo path : finance-erp-sql/migrations/005_reports_dashboard.sql
--
-- Client API
--   reports.dashboard_summary(p_month date default today) → jsonb (one call per dashboard)
--   reports.vw_monthly_summary, vw_category_spend, vw_credit_cards,
--   reports.vw_calendar_events, vw_goal_progress (rebuilt)
--   finance.import_transactions(p_file_name, p_source, p_items jsonb) / finance.undo_import(p_batch_id)
--   public.profiles (name, role badge, currency) — created on signup
--   Storage bucket "attachments": files under <user_id>/...
-- =====================================================================

-- ---------- Profiles (role badge / role-filtered menu) ------------------
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text,
  role        text not null default 'owner' check (role in ('owner','member','viewer')),
  avatar_path text,
  currency    text not null default 'INR',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table public.profiles enable row level security;
create policy owner_select on public.profiles for select to authenticated using ((select auth.uid()) = id);
create policy owner_update on public.profiles for update to authenticated
  using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
create trigger trg_profiles_updated_at before update on public.profiles
  for each row execute function finance.fn_update_timestamp();
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (full_name, avatar_path, currency) on public.profiles to authenticated;
grant all on public.profiles to service_role;

-- signup: profile + personal copies of master templates
create or replace function finance.fn_seed_user_masters()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
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

-- ---------- Tasks: completed_at bookkeeping -----------------------------
create or replace function finance.fn_tasks_completed()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status = 'done' and (tg_op = 'INSERT' or old.status <> 'done') then new.completed_at := now();
  elsif new.status <> 'done' then new.completed_at := null; end if;
  return new;
end $$;
create trigger trg_tasks_completed before insert or update on finance.tasks
  for each row execute function finance.fn_tasks_completed();

-- ---------- Data import (CSV/Excel now, bank statements later) ----------
create table finance.import_batches (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  file_name    text,
  source       text not null default 'csv' check (source in ('csv','excel','bank_statement','manual')),
  row_count    int not null default 0,
  posted_count int not null default 0,
  total_amount numeric(14,2) not null default 0,
  status       text not null default 'posted' check (status in ('posted','undone')),
  created_at   timestamptz not null default now(),
  undone_at    timestamptz
);
alter table finance.import_batches enable row level security;
create policy owner_select on finance.import_batches for select to authenticated using ((select auth.uid()) = user_id);
create index import_batches_user_idx on finance.import_batches (user_id, created_at desc);
revoke all on finance.import_batches from anon, authenticated;
grant select on finance.import_batches to authenticated;
grant all on finance.import_batches to service_role;

-- All rows post or none do. Each row is a post_transaction payload.
create or replace function finance.import_transactions(p_file_name text, p_source text, p_items jsonb)
returns finance.import_batches language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := finance._uid();
  b     finance.import_batches%rowtype;
  e     jsonb;
  n     int := 0;
  t     finance.transactions%rowtype;
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'The file has no rows to import';
  end if;
  insert into finance.import_batches (user_id, file_name, source, row_count)
  values (v_uid, p_file_name, coalesce(p_source, 'csv'), jsonb_array_length(p_items))
  returning * into b;

  for e in select value from jsonb_array_elements(p_items) loop
    n := n + 1;
    begin
      t := finance.post_transaction(e || jsonb_build_object('reference_type', 'import_batch', 'reference_id', b.id));
    exception when others then
      raise exception 'Row %: %', n, sqlerrm;
    end;
  end loop;

  update finance.import_batches
     set posted_count = n,
         total_amount = (select coalesce(sum(amount), 0) from finance.transactions
                         where reference_type = 'import_batch' and reference_id = b.id)
   where id = b.id returning * into b;
  return b;
end $$;

create or replace function finance.undo_import(p_batch_id uuid)
returns finance.import_batches language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := finance._uid(); b finance.import_batches%rowtype; r record;
begin
  select * into b from finance.import_batches where id = p_batch_id and user_id = v_uid for update;
  if not found then raise exception 'Import not found'; end if;
  if b.status = 'undone' then return b; end if;
  for r in select id from finance.transactions
           where user_id = v_uid and reference_type = 'import_batch' and reference_id = p_batch_id and status = 'posted'
  loop
    perform finance.void_transaction(r.id, 'Import undone');
  end loop;
  update finance.import_batches set status = 'undone', undone_at = now() where id = p_batch_id returning * into b;
  return b;
end $$;

-- ---------- Report views ------------------------------------------------
create view reports.vw_monthly_summary with (security_invoker = true) as
select t.user_id,
       date_trunc('month', t.transaction_date)::date as month_start,
       coalesce(sum(t.amount) filter (where t.transaction_type = 'income'), 0)                                as income,
       coalesce(sum(t.amount) filter (where t.transaction_type in ('expense','commitment_payment')), 0)      as expense,
       coalesce(sum(t.amount) filter (where t.transaction_type = 'commitment_payment'), 0)                   as commitment_payments,
       coalesce(sum(t.amount) filter (where t.transaction_type = 'goal_contribution'), 0)                    as goal_contributions,
       coalesce(sum(t.amount) filter (where t.transaction_type = 'transfer'), 0)                             as transfers,
       coalesce(sum(t.amount) filter (where t.transaction_type = 'credit_card_payment'), 0)                  as credit_card_payments,
       coalesce(sum(t.amount) filter (where t.transaction_type = 'income'), 0)
         - coalesce(sum(t.amount) filter (where t.transaction_type in ('expense','commitment_payment')), 0) as net_savings,
       count(*) as transaction_count
from finance.transactions t
where t.status = 'posted'
group by t.user_id, date_trunc('month', t.transaction_date);

create view reports.vw_category_spend with (security_invoker = true) as
select t.user_id,
       date_trunc('month', t.transaction_date)::date as month_start,
       t.category_id,
       coalesce(c.name, 'Uncategorised') as category_name,
       c.category_group,
       sum(t.amount) as amount,
       count(*) as transaction_count
from finance.transactions t
left join masters.categories c on c.id = t.category_id
where t.status = 'posted' and t.transaction_type in ('expense','commitment_payment')
group by t.user_id, date_trunc('month', t.transaction_date), t.category_id, c.name, c.category_group;

create view reports.vw_credit_cards with (security_invoker = true) as
select a.id, a.user_id, a.name, a.active,
       greatest(-a.current_balance, 0) as outstanding,
       a.credit_limit,
       case when a.credit_limit is not null then a.credit_limit + least(a.current_balance, 0) end as available_credit,
       case when a.credit_limit > 0 then round(greatest(-a.current_balance, 0) / a.credit_limit * 100, 1) end as utilization_pct,
       a.billing_day, a.due_day,
       case when a.due_day is null then null
            when make_date(extract(year from d.today)::int, extract(month from d.today)::int,
                           least(a.due_day, extract(day from (date_trunc('month', d.today) + interval '1 month - 1 day'))::int)) >= d.today
              then make_date(extract(year from d.today)::int, extract(month from d.today)::int,
                             least(a.due_day, extract(day from (date_trunc('month', d.today) + interval '1 month - 1 day'))::int))
            else make_date(extract(year from d.next)::int, extract(month from d.next)::int,
                           least(a.due_day, extract(day from (d.next + interval '1 month - 1 day'))::int)) end as next_due_date,
       coalesce((select sum(-p.amount) from finance.account_postings p
                 where p.account_id = a.id and p.amount < 0 and p.posting_date >= date_trunc('month', d.today)), 0) as spend_this_month,
       coalesce((select sum(p.amount) from finance.account_postings p
                 where p.account_id = a.id and p.amount > 0 and p.posting_date >= date_trunc('month', d.today)), 0) as payments_this_month
from finance.accounts a
cross join lateral (select finance._today() as today,
                           (date_trunc('month', finance._today()) + interval '1 month')::date as next) d
where a.account_type = 'credit_card' and not a.is_deleted;

drop view reports.vw_goal_progress;
create view reports.vw_goal_progress with (security_invoker = true) as
select g.id, g.user_id, g.name, g.goal_type_id, gt.name as goal_type, g.account_id, a.name as account_name,
       g.target_amount, g.current_amount,
       greatest(g.target_amount - g.current_amount, 0) as remaining_amount,
       case when g.target_amount > 0 then least(round(g.current_amount / g.target_amount * 100, 2), 100) else 0 end as progress_percent,
       g.target_date,
       case when g.target_date is not null and g.target_amount > g.current_amount
            then round((g.target_amount - g.current_amount)
                       / greatest(((extract(year from g.target_date)::int - extract(year from finance._today())::int) * 12
                                   + extract(month from g.target_date)::int - extract(month from finance._today())::int) + 1, 1), 2)
       end as monthly_needed,
       (select count(*) from finance.goal_contributions gc where gc.goal_id = g.id)              as contribution_count,
       (select max(gc.contribution_date) from finance.goal_contributions gc where gc.goal_id = g.id) as last_contribution_date,
       g.status, g.notes, g.created_at
from finance.goals g
left join masters.goal_types gt on gt.id = g.goal_type_id
left join finance.accounts a on a.id = g.account_id
where not g.is_deleted;

create view reports.vw_calendar_events with (security_invoker = true) as
select cs.user_id, cs.due_date as event_date, 'installment'::text as event_type,
       c.name || ' · #' || cs.installment_no as title, cs.amount - cs.paid_amount as amount,
       case when cs.due_date < finance._today() then 'overdue' else cs.status end as status,
       'finance.commitment_schedules'::text as ref_table, cs.id as ref_id
from finance.commitment_schedules cs
join finance.commitments c on c.id = cs.commitment_id
where cs.status in ('pending','partial') and not c.is_deleted
union all
select pi.user_id, pi.planned_date, 'plan_item', pi.item_name, pi.planned_amount, pi.status,
       'finance.plan_items', pi.id
from finance.plan_items pi
where pi.planned_date is not null and pi.status <> 'rejected'
union all
select t.user_id, t.due_date, 'task', t.title, null::numeric, t.status, 'finance.tasks', t.id
from finance.tasks t
where t.due_date is not null and not t.is_deleted
union all
select g.user_id, g.target_date, 'goal_target', g.name || ' target', g.target_amount - g.current_amount, g.status,
       'finance.goals', g.id
from finance.goals g
where g.target_date is not null and not g.is_deleted and g.status = 'active'
union all
select a.user_id,
       make_date(extract(year from m)::int, extract(month from m)::int,
                 least(a.due_day, extract(day from (m + interval '1 month - 1 day'))::int)),
       'card_due', a.name || ' bill due', greatest(-a.current_balance, 0),
       case when a.current_balance < 0 then 'pending' else 'paid' end,
       'finance.accounts', a.id
from finance.accounts a
cross join generate_series(date_trunc('month', finance._today()), date_trunc('month', finance._today()) + interval '2 months', interval '1 month') m
where a.account_type = 'credit_card' and a.due_day is not null and a.active and not a.is_deleted;

-- ---------- Dashboard (one round-trip) ----------------------------------
create or replace function reports.dashboard_summary(p_month date default null)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  v_uid   uuid := (select auth.uid());
  v_today date := finance._today();
  v_start date := date_trunc('month', coalesce(p_month, finance._today()))::date;
  v_end   date := (date_trunc('month', coalesce(p_month, finance._today())) + interval '1 month - 1 day')::date;
  v       jsonb;
begin
  if v_uid is null then raise exception 'Not authenticated' using errcode = '28000'; end if;

  select jsonb_build_object(
    'month_start', v_start,
    'income',  coalesce((select income  from reports.vw_monthly_summary where user_id = v_uid and month_start = v_start), 0),
    'expense', coalesce((select expense from reports.vw_monthly_summary where user_id = v_uid and month_start = v_start), 0),
    'net_savings', coalesce((select net_savings from reports.vw_monthly_summary where user_id = v_uid and month_start = v_start), 0),
    'goal_contributions', coalesce((select goal_contributions from reports.vw_monthly_summary where user_id = v_uid and month_start = v_start), 0),
    'available_balance', coalesce((select sum(current_balance) from finance.accounts
        where user_id = v_uid and active and not is_deleted and account_type in ('cash','bank','upi','savings')), 0),
    'credit_card_outstanding', coalesce((select sum(greatest(-current_balance, 0)) from finance.accounts
        where user_id = v_uid and not is_deleted and account_type = 'credit_card'), 0),
    'loan_outstanding', coalesce((select sum(greatest(-current_balance, 0)) from finance.accounts
        where user_id = v_uid and not is_deleted and account_type = 'loan'), 0),
    'net_worth', coalesce((select sum(current_balance) from finance.accounts where user_id = v_uid and not is_deleted), 0)
               + coalesce((select sum(current_value) from finance.assets where user_id = v_uid and not is_deleted and status = 'active'), 0),
    'accounts', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'account_type', account_type,
                                  'current_balance', current_balance, 'outstanding', outstanding) order by sort_order, name)
                          from reports.vw_account_summary where user_id = v_uid and active), '[]'::jsonb),
    'pending_payments', (select jsonb_build_object(
        'count', count(*), 'amount', coalesce(sum(amount - paid_amount), 0),
        'overdue_count', count(*) filter (where due_date < v_today),
        'overdue_amount', coalesce(sum(amount - paid_amount) filter (where due_date < v_today), 0))
      from finance.commitment_schedules where user_id = v_uid and status in ('pending','partial') and due_date <= v_end),
    'upcoming_commitments', coalesce((select jsonb_agg(x order by x->>'due_date') from (
        select jsonb_build_object('schedule_id', id, 'commitment', commitment_name, 'installment_no', installment_no,
                                  'due_date', due_date, 'amount', remaining_amount) as x
        from reports.vw_installments
        where user_id = v_uid and status in ('pending','partial') and due_date between v_today and v_today + 30
        order by due_date limit 10) q), '[]'::jsonb),
    'emergency_fund', (select jsonb_build_object(
        'target',  coalesce(sum(g.target_amount), 0),
        'current', coalesce(sum(g.current_amount), 0),
        'progress_percent', case when sum(g.target_amount) > 0
                                 then least(round(sum(g.current_amount) / sum(g.target_amount) * 100, 2), 100) else 0 end,
        'account_balance', coalesce((select sum(current_balance) from finance.accounts
                                     where user_id = v_uid and not is_deleted and account_type = 'emergency_fund'), 0))
      from finance.goals g join masters.goal_types gt on gt.id = g.goal_type_id
      where g.user_id = v_uid and not g.is_deleted and gt.name ilike '%emergency%'),
    'budget', (select jsonb_build_object(
        'plan_id', mp.id, 'plan_status', mp.status,
        'planned', mp.planned_expense, 'paid', mp.paid_amount, 'remaining', mp.remaining_amount,
        'utilization_percent', case when mp.planned_expense > 0 then round(mp.paid_amount / mp.planned_expense * 100, 1) else 0 end,
        'critical_open', mp.critical_open_count)
      from reports.vw_monthly_plans mp
      where mp.user_id = v_uid and mp.plan_year = extract(year from v_start)::int and mp.plan_month = extract(month from v_start)::int)
  ) into v;
  return v;
end $$;

-- ---------- Attachments bucket (private, one folder per user) -----------
insert into storage.buckets (id, name, public, file_size_limit)
values ('attachments', 'attachments', false, 10485760)
on conflict (id) do nothing;

create policy attachments_select on storage.objects for select to authenticated
  using (bucket_id = 'attachments' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy attachments_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'attachments' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy attachments_update on storage.objects for update to authenticated
  using (bucket_id = 'attachments' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy attachments_delete on storage.objects for delete to authenticated
  using (bucket_id = 'attachments' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ---------- Grants ------------------------------------------------------
revoke all on reports.vw_monthly_summary, reports.vw_category_spend, reports.vw_credit_cards,
              reports.vw_goal_progress, reports.vw_calendar_events from anon;
grant select on reports.vw_monthly_summary, reports.vw_category_spend, reports.vw_credit_cards,
               reports.vw_goal_progress, reports.vw_calendar_events to authenticated;

revoke execute on all functions in schema finance, reports from public, anon;
revoke execute on function finance.fn_tasks_completed() from authenticated;
grant execute on function reports.dashboard_summary(date) to authenticated;
grant execute on function finance.import_transactions(text, text, jsonb), finance.undo_import(uuid) to authenticated;
