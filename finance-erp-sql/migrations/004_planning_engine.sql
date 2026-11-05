-- =====================================================================
-- Finance ERP OS · Migration 004 · Monthly Planning Assistant (rule-based)
-- Repo path : finance-erp-sql/migrations/004_planning_engine.sql
--
-- finance.generate_month_plan(year, month) builds/refreshes a DRAFT plan:
--   1. Installments due this month                          (priority high)
--   2. Overdue unpaid installments — carry-forward           (priority critical)
--   3. Installments you planned for this month via
--      distribute_outstanding (rescheduled / split / advance)
--   4. Credit card outstanding                               (priority high)
--   5. Goal contributions needed to hit target dates         (priority normal)
--   6. Unpaid manual items carried from last month's plan
-- Every item stores suggestion_reason. Regenerating never duplicates and
-- never overwrites items you accepted, edited or rejected.
--
-- Client API
--   finance.generate_month_plan(p_year, p_month)  → monthly_plans
--   finance.pay_plan_item(p_item_id, p_from_account_id, p_amount?, p_date?, p_client_request_id?)
--   finance.finalize_month_plan(p_plan_id) / finance.reopen_month_plan(p_plan_id)
--   Accept/reject/edit/add/remove items: plain insert/update/delete on finance.plan_items
--   Spread outstanding across months: finance.distribute_outstanding (003)
--   reports.vw_plan_items, reports.vw_monthly_plans
-- =====================================================================

-- ---------- Columns -----------------------------------------------------
alter table finance.plan_items
  add column account_id uuid,
  add column category_id uuid,
  add constraint plan_items_account_fk  foreign key (account_id, user_id)  references finance.accounts (id, user_id),
  add constraint plan_items_category_fk foreign key (category_id, user_id) references masters.categories (id, user_id),
  add constraint plan_items_source_ck check (source_type is null or source_type in ('schedule','account','goal','plan_item'));
create index plan_items_account_idx  on finance.plan_items (account_id);
create index plan_items_category_idx on finance.plan_items (category_id);
create index transactions_reference_idx on finance.transactions (reference_type, reference_id) where reference_id is not null;

comment on column finance.plan_items.actual_amount is 'Amount paid OUTSIDE the app for a manual item. Payments recorded in the app are computed in reports.vw_plan_items.';

-- ---------- Plan totals -------------------------------------------------
create or replace function finance.fn_monthly_plans_totals()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.expected_savings := coalesce(new.expected_income, 0) - coalesce(new.planned_expense, 0);
  return new;
end $$;
create trigger trg_monthly_plans_totals before insert or update on finance.monthly_plans
  for each row execute function finance.fn_monthly_plans_totals();

create or replace function finance.fn_plan_items_totals()
returns trigger language plpgsql set search_path = '' as $$
declare v_plan uuid := coalesce(new.plan_id, old.plan_id);
begin
  update finance.monthly_plans mp
     set planned_expense = coalesce((select sum(planned_amount) from finance.plan_items
                                     where plan_id = v_plan and status <> 'rejected'), 0)
   where mp.id = v_plan;
  return null;
end $$;
create trigger trg_plan_items_totals after insert or update or delete on finance.plan_items
  for each row execute function finance.fn_plan_items_totals();

-- A user editing a still-'suggested' item implicitly accepts it, so
-- regeneration will not overwrite the edit.
create or replace function finance.fn_plan_items_touch()
returns trigger language plpgsql set search_path = '' as $$
begin
  if coalesce(current_setting('finance.engine', true), '') = 'on' then return new; end if;
  if old.status = 'suggested' and new.status = 'suggested'
     and (new.planned_amount, new.planned_date, new.priority, new.account_id)
         is distinct from (old.planned_amount, old.planned_date, old.priority, old.account_id) then
    new.status := 'accepted';
  end if;
  return new;
end $$;
create trigger trg_plan_items_touch before update on finance.plan_items
  for each row execute function finance.fn_plan_items_touch();

-- Plans that are not drafts are read-only for item content.
create or replace function finance.fn_plan_items_lock()
returns trigger language plpgsql set search_path = '' as $$
declare v_status text;
begin
  if coalesce(current_setting('finance.engine', true), '') = 'on' then return coalesce(new, old); end if;
  select status into v_status from finance.monthly_plans where id = coalesce(new.plan_id, old.plan_id);
  if v_status = 'closed' then
    raise exception 'This month''s plan is closed. Reopen it to change items.';
  end if;
  return coalesce(new, old);
end $$;
create trigger trg_plan_items_lock before insert or update or delete on finance.plan_items
  for each row execute function finance.fn_plan_items_lock();

-- ---------- Actual paid against a plan item -----------------------------
create or replace function finance._plan_item_actual(p_item_id uuid)
returns numeric language sql stable set search_path = '' as $$
  select coalesce(case pi.source_type
    when 'schedule' then (
      select sum(a.amount) from finance.payment_allocations a
      join finance.transactions t on t.id = a.transaction_id
      where a.schedule_id = pi.source_id
        and t.transaction_date between make_date(mp.plan_year, mp.plan_month, 1)
                                   and (make_date(mp.plan_year, mp.plan_month, 1) + interval '1 month - 1 day')::date)
    when 'account' then (
      select sum(t.amount) from finance.transactions t
      where t.to_account_id = pi.source_id and t.transaction_type = 'credit_card_payment' and t.status = 'posted'
        and t.transaction_date between make_date(mp.plan_year, mp.plan_month, 1)
                                   and (make_date(mp.plan_year, mp.plan_month, 1) + interval '1 month - 1 day')::date)
    when 'goal' then (
      select sum(gc.amount) from finance.goal_contributions gc
      where gc.goal_id = pi.source_id
        and gc.contribution_date between make_date(mp.plan_year, mp.plan_month, 1)
                                     and (make_date(mp.plan_year, mp.plan_month, 1) + interval '1 month - 1 day')::date)
    else (
      select sum(t.amount) from finance.transactions t
      where t.reference_type = 'plan_item' and t.reference_id = pi.id and t.status = 'posted')
  end, 0) + case when pi.source_type is null or pi.source_type = 'plan_item' then pi.actual_amount else 0 end
  from finance.plan_items pi
  join finance.monthly_plans mp on mp.id = pi.plan_id
  where pi.id = p_item_id
$$;

-- ---------- Suggestion upsert -------------------------------------------
create or replace function finance._upsert_suggestion(
  p_plan_id uuid, p_user_id uuid, p_source_type text, p_source_id uuid, p_name text, p_item_type text,
  p_amount numeric, p_date date, p_priority text, p_reason text, p_account_id uuid, p_category_id uuid)
returns void language plpgsql set search_path = '' as $$
begin
  insert into finance.plan_items (user_id, plan_id, item_name, item_type, planned_amount, planned_date, priority,
                                  status, source_type, source_id, suggestion_reason, account_id, category_id)
  values (p_user_id, p_plan_id, p_name, p_item_type, round(p_amount, 2), p_date, p_priority,
          'suggested', p_source_type, p_source_id, p_reason, p_account_id, p_category_id)
  on conflict (plan_id, source_type, source_id) where source_id is not null
  do update set item_name = excluded.item_name, planned_amount = excluded.planned_amount,
                planned_date = excluded.planned_date, priority = excluded.priority,
                suggestion_reason = excluded.suggestion_reason, account_id = excluded.account_id,
                category_id = excluded.category_id
  where finance.plan_items.status = 'suggested';
end $$;

-- ---------- The engine --------------------------------------------------
create or replace function finance.generate_month_plan(p_year int, p_month int)
returns finance.monthly_plans language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := finance._uid();
  v_start  date;
  v_end    date;
  v_today  date := finance._today();
  v_plan   finance.monthly_plans%rowtype;
  v_prev   finance.monthly_plans%rowtype;
  v_keys   text[] := '{}';
  v_amt    numeric(14,2);
  v_reason text;
  v_prio   text;
  v_date   date;
  v_months int;
  v_label  text;
  s        record;
begin
  if p_month not between 1 and 12 or p_year not between 2000 and 2100 then raise exception 'Invalid month'; end if;
  v_start := make_date(p_year, p_month, 1);
  v_end   := (v_start + interval '1 month - 1 day')::date;
  perform set_config('finance.engine', 'on', true);

  insert into finance.monthly_plans (user_id, plan_year, plan_month)
  values (v_uid, p_year, p_month)
  on conflict (user_id, plan_year, plan_month) do nothing;
  select * into v_plan from finance.monthly_plans
   where user_id = v_uid and plan_year = p_year and plan_month = p_month for update;
  if v_plan.status <> 'draft' then
    raise exception 'The % plan is %. Reopen it to regenerate suggestions.', to_char(v_start, 'Mon YYYY'), v_plan.status;
  end if;

  -- make sure installments exist up to the end of this month
  for s in select id from finance.commitments
           where user_id = v_uid and status = 'active' and not is_deleted
             and start_date is not null and start_date <= v_end
  loop
    perform finance._generate_schedules(s.id, v_end);
  end loop;

  -- 1-3. installments (due, overdue/carry-forward, planned via distribution)
  for s in
    select cs.id, cs.installment_no, cs.due_date, cs.amount, cs.amount - cs.paid_amount as remaining,
           c.name, c.total_installments, c.default_account_id, c.category_id,
           coalesce((select sum(p.planned_amount) from finance.payment_plans p
                     where p.schedule_id = cs.id and p.status = 'planned'
                       and p.planned_year = p_year and p.planned_month = p_month), 0) as plan_this,
           exists (select 1 from finance.payment_plans p where p.schedule_id = cs.id and p.status = 'planned') as has_plans
    from finance.commitment_schedules cs
    join finance.commitments c on c.id = cs.commitment_id
    where cs.user_id = v_uid and cs.status in ('pending','partial') and not c.is_deleted
  loop
    v_label := s.name || ' · installment ' || s.installment_no
               || coalesce(' of ' || s.total_installments, '');
    if s.has_plans then
      continue when s.plan_this <= 0;
      v_amt := least(s.plan_this, s.remaining);
      v_reason := case
        when s.due_date < v_start then format('Carry-forward: %s was due %s. You scheduled ₹%s of the unpaid ₹%s for this month.',
                                              v_label, to_char(s.due_date, 'DD Mon YYYY'), v_amt, s.remaining)
        when s.due_date > v_end   then format('Advance payment: %s is due %s. You scheduled ₹%s for this month.',
                                              v_label, to_char(s.due_date, 'DD Mon YYYY'), v_amt)
        else format('%s is due %s. You scheduled ₹%s of ₹%s for this month.',
                    v_label, to_char(s.due_date, 'DD Mon YYYY'), v_amt, s.remaining) end;
    else
      continue when s.due_date > v_end;
      v_amt := s.remaining;
      v_reason := case
        when s.due_date < v_start then format('Overdue: %s was due %s (%s days ago). Unpaid ₹%s carried forward.',
                                              v_label, to_char(s.due_date, 'DD Mon YYYY'), v_today - s.due_date, s.remaining)
        when s.remaining < s.amount then format('%s is due %s. ₹%s of ₹%s already paid; ₹%s remaining.',
                                              v_label, to_char(s.due_date, 'DD Mon YYYY'), s.amount - s.remaining, s.amount, s.remaining)
        else format('%s is due %s.', v_label, to_char(s.due_date, 'DD Mon YYYY')) end;
    end if;
    continue when v_amt <= 0;
    v_prio := case when s.due_date < v_start then 'critical' when s.due_date <= v_end then 'high' else 'normal' end;
    v_date := least(greatest(s.due_date, v_start), v_end);
    perform finance._upsert_suggestion(v_plan.id, v_uid, 'schedule', s.id, v_label, 'commitment',
                                       v_amt, v_date, v_prio, v_reason, s.default_account_id, s.category_id);
    v_keys := v_keys || ('schedule:' || s.id);
  end loop;

  -- 4. credit card outstanding
  for s in select id, name, current_balance, credit_limit, due_day from finance.accounts
           where user_id = v_uid and account_type = 'credit_card' and active and not is_deleted and current_balance < 0
  loop
    v_date := v_start + (least(coalesce(s.due_day, extract(day from v_end)::int), extract(day from v_end)::int) - 1);
    v_reason := format('%s outstanding is ₹%s%s. Pay in full to avoid interest.',
                       s.name, -s.current_balance,
                       case when s.due_day is not null then format(' (bill due on day %s)', s.due_day) else '' end);
    perform finance._upsert_suggestion(v_plan.id, v_uid, 'account', s.id, s.name || ' bill', 'credit_card',
                                       -s.current_balance, v_date, 'high', v_reason, null, null);
    v_keys := v_keys || ('account:' || s.id);
  end loop;

  -- 5. goals with a target date
  for s in select id, name, target_amount, current_amount, target_date, account_id from finance.goals
           where user_id = v_uid and status = 'active' and not is_deleted
             and target_date is not null and target_amount > current_amount
  loop
    v_months := greatest(((extract(year from s.target_date)::int - p_year) * 12
                          + extract(month from s.target_date)::int - p_month) + 1, 1);
    v_amt := round((s.target_amount - s.current_amount) / v_months, 2);
    v_reason := case when s.target_date < v_start
      then format('Target date %s has passed; ₹%s still needed to reach ₹%s.',
                  to_char(s.target_date, 'DD Mon YYYY'), s.target_amount - s.current_amount, s.target_amount)
      else format('₹%s still needed by %s; %s month(s) left → ₹%s per month.',
                  s.target_amount - s.current_amount, to_char(s.target_date, 'DD Mon YYYY'), v_months, v_amt) end;
    perform finance._upsert_suggestion(v_plan.id, v_uid, 'goal', s.id, s.name || ' contribution', 'goal',
                                       v_amt, v_start, 'normal', v_reason, s.account_id, null);
    v_keys := v_keys || ('goal:' || s.id);
  end loop;

  -- 6. unpaid manual items carried from last month's plan
  select * into v_prev from finance.monthly_plans
   where user_id = v_uid
     and plan_year = extract(year from v_start - 1)::int and plan_month = extract(month from v_start - 1)::int;
  if found then
    for s in select pi.id, pi.item_name, pi.planned_amount, pi.priority, pi.account_id, pi.category_id,
                    finance._plan_item_actual(pi.id) as actual
             from finance.plan_items pi
             where pi.plan_id = v_prev.id
               and (pi.source_type is null or pi.source_type = 'plan_item')
               and pi.status not in ('rejected','paid')
    loop
      v_amt := s.planned_amount - s.actual;
      continue when v_amt <= 0;
      v_reason := format('Carried forward from %s: ₹%s of ₹%s was paid; ₹%s unpaid.',
                         to_char(v_start - 1, 'Mon YYYY'), s.actual, s.planned_amount, v_amt);
      perform finance._upsert_suggestion(v_plan.id, v_uid, 'plan_item', s.id, s.item_name, 'manual',
                                         v_amt, v_start, s.priority, v_reason, s.account_id, s.category_id);
      v_keys := v_keys || ('plan_item:' || s.id);
    end loop;
  end if;

  -- drop untouched suggestions that no longer apply (never drop anything with payments)
  delete from finance.plan_items pi
   where pi.plan_id = v_plan.id and pi.status = 'suggested' and pi.source_id is not null
     and not ((pi.source_type || ':' || pi.source_id) = any (v_keys))
     and finance._plan_item_actual(pi.id) = 0;

  -- expected income: average of the last 3 months' income, only if not set by you
  if v_plan.expected_income = 0 then
    update finance.monthly_plans
       set expected_income = coalesce((
             select round(sum(amount) / 3, 2) from finance.transactions
             where user_id = v_uid and transaction_type = 'income' and status = 'posted'
               and transaction_date >= (v_start - interval '3 months')::date and transaction_date < v_start), 0)
     where id = v_plan.id;
  end if;

  perform set_config('finance.engine', 'off', true);
  select * into v_plan from finance.monthly_plans where id = v_plan.id;
  return v_plan;
end $$;

-- ---------- Pay straight from the plan ----------------------------------
create or replace function finance.pay_plan_item(
  p_item_id uuid, p_from_account_id uuid, p_amount numeric default null,
  p_date date default null, p_client_request_id uuid default null)
returns finance.transactions language plpgsql security definer set search_path = '' as $$
declare
  v_uid  uuid := finance._uid();
  pi     finance.plan_items%rowtype;
  v_goal finance.goals%rowtype;
  v_amt  numeric(14,2);
  v_p    jsonb;
  t      finance.transactions%rowtype;
begin
  select * into pi from finance.plan_items where id = p_item_id and user_id = v_uid for update;
  if not found then raise exception 'Plan item not found'; end if;
  if pi.status = 'rejected' then raise exception 'This item was rejected. Accept it before paying.'; end if;

  v_amt := coalesce(p_amount, pi.planned_amount - finance._plan_item_actual(pi.id));
  if v_amt is null or v_amt <= 0 then raise exception 'Nothing left to pay on this item'; end if;

  v_p := jsonb_build_object(
    'amount', v_amt, 'transaction_date', p_date, 'from_account_id', p_from_account_id,
    'remarks', pi.item_name, 'reference_type', 'plan_item', 'reference_id', pi.id,
    'client_request_id', p_client_request_id);

  if pi.source_type = 'schedule' then
    v_p := v_p || jsonb_build_object('transaction_type', 'commitment_payment',
                                      'commitment_schedule_id', pi.source_id, 'category_id', pi.category_id);
  elsif pi.source_type = 'account' then
    v_p := v_p || jsonb_build_object('transaction_type', 'credit_card_payment', 'to_account_id', pi.source_id);
  elsif pi.source_type = 'goal' then
    select * into v_goal from finance.goals where id = pi.source_id;
    v_p := v_p || jsonb_build_object('transaction_type', 'goal_contribution', 'goal_id', pi.source_id,
                                      'to_account_id', case when v_goal.account_id is distinct from p_from_account_id
                                                            then v_goal.account_id end);
  else
    v_p := v_p || jsonb_build_object('transaction_type', 'expense', 'category_id', pi.category_id);
  end if;

  t := finance.post_transaction(v_p);

  perform set_config('finance.engine', 'on', true);
  update finance.plan_items set status = 'accepted' where id = pi.id and status = 'suggested';
  perform set_config('finance.engine', 'off', true);
  return t;
end $$;

-- ---------- Plan status -------------------------------------------------
create or replace function finance.finalize_month_plan(p_plan_id uuid)
returns finance.monthly_plans language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := finance._uid(); p finance.monthly_plans%rowtype;
begin
  select * into p from finance.monthly_plans where id = p_plan_id and user_id = v_uid for update;
  if not found then raise exception 'Plan not found'; end if;
  perform set_config('finance.engine', 'on', true);
  update finance.plan_items set status = 'accepted' where plan_id = p_plan_id and status = 'suggested';
  update finance.monthly_plans set status = 'finalized' where id = p_plan_id returning * into p;
  perform set_config('finance.engine', 'off', true);
  return p;
end $$;

create or replace function finance.reopen_month_plan(p_plan_id uuid)
returns finance.monthly_plans language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := finance._uid(); p finance.monthly_plans%rowtype;
begin
  select * into p from finance.monthly_plans where id = p_plan_id and user_id = v_uid for update;
  if not found then raise exception 'Plan not found'; end if;
  update finance.monthly_plans set status = 'draft' where id = p_plan_id returning * into p;
  return p;
end $$;

-- ---------- Views -------------------------------------------------------
create view reports.vw_plan_items with (security_invoker = true) as
select pi.id, pi.user_id, pi.plan_id, mp.plan_year, mp.plan_month, mp.status as plan_status,
       pi.item_name, pi.item_type, pi.source_type, pi.source_id, pi.suggestion_reason,
       pi.planned_amount, pi.planned_date, pi.priority, pi.status, pi.sort_order,
       pi.account_id, a.name as account_name, pi.category_id, c.name as category_name,
       x.actual as paid_amount,
       greatest(pi.planned_amount - x.actual, 0) as remaining_amount,
       case when pi.status = 'rejected' then 'rejected'
            when pi.planned_amount > 0 and x.actual >= pi.planned_amount then 'paid'
            when x.actual > 0 then 'partial'
            else pi.status end as display_status,
       pi.remarks, pi.created_at, pi.updated_at
from finance.plan_items pi
join finance.monthly_plans mp on mp.id = pi.plan_id
left join finance.accounts a on a.id = pi.account_id
left join masters.categories c on c.id = pi.category_id
cross join lateral (select finance._plan_item_actual(pi.id) as actual) x;

create view reports.vw_monthly_plans with (security_invoker = true) as
select mp.id, mp.user_id, mp.plan_year, mp.plan_month, make_date(mp.plan_year, mp.plan_month, 1) as month_start,
       mp.status, mp.expected_income, mp.planned_expense, mp.expected_savings, mp.notes,
       coalesce(sum(v.paid_amount) filter (where v.status <> 'rejected'), 0)                 as paid_amount,
       coalesce(sum(v.remaining_amount) filter (where v.status <> 'rejected'), 0)            as remaining_amount,
       count(v.id)                                                                            as item_count,
       count(v.id) filter (where v.status = 'suggested')                                      as suggested_count,
       count(v.id) filter (where v.display_status = 'paid')                                   as paid_count,
       count(v.id) filter (where v.priority = 'critical' and v.display_status not in ('paid','rejected')) as critical_open_count,
       mp.created_at, mp.updated_at
from finance.monthly_plans mp
left join reports.vw_plan_items v on v.plan_id = mp.id
group by mp.id;

-- ---------- Grants ------------------------------------------------------
revoke all on reports.vw_plan_items, reports.vw_monthly_plans from anon;
grant select on reports.vw_plan_items, reports.vw_monthly_plans to authenticated;

revoke execute on all functions in schema finance from public, anon;
revoke execute on function
  finance._upsert_suggestion(uuid, uuid, text, uuid, text, text, numeric, date, text, text, uuid, uuid),
  finance.fn_monthly_plans_totals(), finance.fn_plan_items_totals(), finance.fn_plan_items_touch(), finance.fn_plan_items_lock()
from authenticated;
grant execute on function finance._plan_item_actual(uuid) to authenticated;
grant execute on function
  finance.generate_month_plan(int, int), finance.pay_plan_item(uuid, uuid, numeric, date, uuid),
  finance.finalize_month_plan(uuid), finance.reopen_month_plan(uuid)
to authenticated;
