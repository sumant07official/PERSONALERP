-- =====================================================================
-- Finance ERP OS · Migration 003 · Commitments, installments,
--                                  carry-forward & payment distribution
-- Repo path : finance-erp-sql/migrations/003_commitments_engine.sql
--
-- Rules
--   * Installments (commitment_schedules) keep their original due date and
--     amount forever. Payments are tracked in payment_allocations (002).
--   * Unpaid installments stay open and carry forward automatically.
--   * Distributing/rescheduling only writes payment_plans (which month you
--     intend to pay how much). Over-planning an installment is blocked.
--
-- Client API
--   finance.generate_schedules(p_commitment_id, p_until date default null)
--   finance.generate_all_schedules(p_until date default null)
--   finance.distribute_outstanding(p_schedule_ids uuid[], p_months date[],
--                                  p_mode 'equal'|'all'|'custom', p_amounts numeric[])
--   finance.clear_payment_plans(p_schedule_ids uuid[])
--   finance.cancel_schedule(p_schedule_id, p_reason) / finance.restore_schedule(p_schedule_id)
--   reports.vw_installments  (outstanding, overdue, planned, unplanned per installment)
-- =====================================================================

-- ---------- Installment generator ---------------------------------------
create or replace function finance._generate_schedules(p_commitment_id uuid, p_until date default null)
returns int language plpgsql set search_path = '' as $$
declare
  c        finance.commitments%rowtype;
  v_step   int;
  v_n      int;
  v_day    int;
  v_first  date;
  v_until  date;
  v_base   numeric(14,2);
  v_amt    numeric(14,2);
  v_no     int;
  v_due    date;
  v_made   int := 0;
begin
  select * into c from finance.commitments where id = p_commitment_id for update;
  if not found then raise exception 'Commitment not found'; end if;
  if c.is_deleted or c.status <> 'active' then return 0; end if;
  if c.start_date is null then
    raise exception 'Commitment "%" needs a start date before installments can be generated', c.name;
  end if;

  v_step := case c.frequency when 'monthly' then 1 when 'quarterly' then 3
                             when 'half_yearly' then 6 when 'yearly' then 12 else 0 end;
  v_n    := case when c.frequency = 'one_time' then 1 else c.total_installments end;
  v_day  := coalesce(c.due_day, extract(day from c.start_date)::int);
  v_until := least(coalesce(c.end_date, 'infinity'::date),
                   coalesce(p_until, (finance._today() + interval '12 months')::date));
  v_base := coalesce(c.installment_amount,
                     case when v_n is not null and c.total_amount > 0 then round(c.total_amount / v_n, 2) end);
  if v_base is null or v_base <= 0 then
    raise exception 'Commitment "%" needs an installment amount, or a total amount with a number of installments', c.name;
  end if;

  -- first due date is on/after the start date
  v_first := date_trunc('month', c.start_date)::date;
  if v_first + (least(v_day, extract(day from (v_first + interval '1 month - 1 day'))::int) - 1) < c.start_date then
    v_first := (v_first + interval '1 month')::date;
  end if;

  select coalesce(max(installment_no), 0) into v_no
  from finance.commitment_schedules where commitment_id = c.id;

  loop
    v_no := v_no + 1;
    exit when v_n is not null and v_no > v_n;
    exit when v_no > 1200;                                    -- hard safety stop
    v_due := (v_first + make_interval(months => (v_no - 1) * v_step))::date;
    v_due := v_due + (least(v_day, extract(day from (date_trunc('month', v_due) + interval '1 month - 1 day'))::int) - 1);
    exit when v_due > v_until;

    v_amt := v_base;
    if v_n is not null and v_no = v_n and c.installment_amount is null and c.total_amount > 0 then
      v_amt := c.total_amount - v_base * (v_n - 1);           -- last installment absorbs rounding
    end if;

    insert into finance.commitment_schedules (user_id, commitment_id, due_date, amount, installment_no)
    values (c.user_id, c.id, v_due, v_amt, v_no);
    v_made := v_made + 1;
    exit when v_step = 0;
  end loop;

  return v_made;
end $$;

create or replace function finance.generate_schedules(p_commitment_id uuid, p_until date default null)
returns int language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := finance._uid();
begin
  if not exists (select 1 from finance.commitments where id = p_commitment_id and user_id = v_uid) then
    raise exception 'Commitment not found';
  end if;
  return finance._generate_schedules(p_commitment_id, p_until);
end $$;

create or replace function finance.generate_all_schedules(p_until date default null)
returns int language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := finance._uid(); v_total int := 0; c record;
begin
  for c in select id from finance.commitments
           where user_id = v_uid and status = 'active' and not is_deleted and start_date is not null
           order by id
  loop
    v_total := v_total + finance._generate_schedules(c.id, p_until);
  end loop;
  return v_total;
end $$;

-- ---------- Cancel / restore an installment -----------------------------
create or replace function finance.cancel_schedule(p_schedule_id uuid, p_reason text default null)
returns finance.commitment_schedules language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := finance._uid(); s finance.commitment_schedules%rowtype;
begin
  select * into s from finance.commitment_schedules where id = p_schedule_id and user_id = v_uid for update;
  if not found then raise exception 'Installment not found'; end if;
  if s.paid_amount > 0 then
    raise exception 'This installment already has payments of %. Delete those payments before cancelling it.', s.paid_amount;
  end if;
  update finance.commitment_schedules
     set status = 'cancelled', remarks = coalesce(nullif(btrim(p_reason), ''), remarks)
   where id = p_schedule_id returning * into s;
  return s;
end $$;

create or replace function finance.restore_schedule(p_schedule_id uuid)
returns finance.commitment_schedules language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := finance._uid(); s finance.commitment_schedules%rowtype;
begin
  select * into s from finance.commitment_schedules where id = p_schedule_id and user_id = v_uid for update;
  if not found then raise exception 'Installment not found'; end if;
  if s.status <> 'cancelled' then return s; end if;
  update finance.commitment_schedules set status = 'pending' where id = p_schedule_id;
  perform finance._refresh_schedule(p_schedule_id);
  select * into s from finance.commitment_schedules where id = p_schedule_id;
  return s;
end $$;

-- ---------- Payment plans: guard + status sync --------------------------
create or replace function finance.fn_payment_plans_guard()
returns trigger language plpgsql set search_path = '' as $$
declare v_remaining numeric(14,2); v_planned numeric(14,2);
begin
  if new.status <> 'planned' then return new; end if;
  select amount - paid_amount into v_remaining from finance.commitment_schedules where id = new.schedule_id;
  select coalesce(sum(planned_amount), 0) into v_planned
  from finance.payment_plans
  where schedule_id = new.schedule_id and status = 'planned' and id <> new.id;
  if v_planned + new.planned_amount > v_remaining then
    raise exception 'Planned total % exceeds the outstanding % of this installment', v_planned + new.planned_amount, v_remaining;
  end if;
  return new;
end $$;
create trigger trg_payment_plans_guard before insert or update on finance.payment_plans
  for each row execute function finance.fn_payment_plans_guard();

create or replace function finance.fn_schedule_status_sync()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status = old.status then return new; end if;
  if new.status = 'paid' then
    update finance.payment_plans set status = 'paid' where schedule_id = new.id and status = 'planned';
  elsif new.status = 'cancelled' then
    update finance.payment_plans set status = 'cancelled' where schedule_id = new.id and status = 'planned';
  elsif old.status = 'paid' then
    update finance.payment_plans set status = 'planned' where schedule_id = new.id and status = 'paid';
  elsif old.status = 'cancelled' then
    update finance.payment_plans set status = 'planned' where schedule_id = new.id and status = 'cancelled';
  end if;
  return new;
end $$;
create trigger trg_schedule_status_sync after update of status on finance.commitment_schedules
  for each row execute function finance.fn_schedule_status_sync();

-- ---------- Carry-forward distribution ----------------------------------
-- p_schedule_ids : installments in the order they should be paid (first = paid first)
-- p_months       : target months (any day in the month; duplicates rejected)
-- p_mode         : 'equal'  split total equally across p_months
--                  'all'    pay everything in the first month
--                  'custom' p_amounts[i] goes to p_months[i] (total may be ≤ outstanding)
-- Replaces existing 'planned' rows for these installments (= reschedule).
create or replace function finance.distribute_outstanding(
  p_schedule_ids uuid[], p_months date[], p_mode text default 'equal', p_amounts numeric[] default null)
returns setof finance.payment_plans language plpgsql security definer set search_path = '' as $$
declare
  v_uid     uuid := finance._uid();
  v_months  date[];
  v_amts    numeric(14,2)[];
  v_n       int;
  v_distinct int;
  v_ids     int;
  v_total   numeric(14,2);
  v_cap     numeric(14,2)[];
  v_each    numeric(14,2);
  v_rem     numeric(14,2);
  v_take    numeric(14,2);
  i         int := 1;
  s         record;
begin
  if p_mode not in ('equal','all','custom') then raise exception 'Mode must be equal, all or custom'; end if;
  if coalesce(cardinality(p_schedule_ids), 0) = 0 then raise exception 'Choose at least one installment'; end if;
  if coalesce(cardinality(p_months), 0) = 0 then raise exception 'Choose at least one month'; end if;

  select array_agg(m order by m), array_agg(a order by m), count(*), count(distinct m)
    into v_months, v_amts, v_n, v_distinct
  from (select date_trunc('month', x.m)::date as m, x.a::numeric(14,2) as a
        from unnest(p_months, coalesce(p_amounts, '{}'::numeric[])) as x(m, a)
        where x.m is not null) q;
  if v_n <> v_distinct then raise exception 'Each month can be chosen only once'; end if;
  if p_mode = 'custom' and (p_amounts is null or cardinality(p_amounts) <> cardinality(p_months)) then
    raise exception 'Custom mode needs exactly one amount per month';
  end if;

  select count(distinct x) into v_ids from unnest(p_schedule_ids) x;
  perform 1 from finance.commitment_schedules where id = any(p_schedule_ids) order by id for update;
  if (select count(*) from finance.commitment_schedules
      where id = any(p_schedule_ids) and user_id = v_uid and status in ('pending','partial')) <> v_ids then
    raise exception 'Some installments are not open (already paid, cancelled, or not found)';
  end if;

  delete from finance.payment_plans where schedule_id = any(p_schedule_ids) and status = 'planned';

  select sum(amount - paid_amount) into v_total
  from finance.commitment_schedules where id = any(p_schedule_ids);

  if p_mode = 'all' then
    v_months := v_months[1:1];
    v_cap    := array[v_total];
    v_n      := 1;
  elsif p_mode = 'equal' then
    v_each := round(v_total / v_n, 2);
    v_cap  := array_fill(v_each, array[v_n]);
    v_cap[v_n] := v_total - v_each * (v_n - 1);
  else
    if exists (select 1 from unnest(v_amts) a where a is null or a <= 0) then
      raise exception 'Every custom amount must be greater than zero';
    end if;
    if (select sum(a) from unnest(v_amts) a) > v_total then
      raise exception 'Custom amounts total % but only % is outstanding', (select sum(a) from unnest(v_amts) a), v_total;
    end if;
    v_cap := v_amts;
  end if;

  for s in
    select cs.id, cs.amount - cs.paid_amount as remaining
    from (select id, min(ord) as ord from unnest(p_schedule_ids) with ordinality u(id, ord) group by id) o
    join finance.commitment_schedules cs on cs.id = o.id
    order by o.ord
  loop
    v_rem := s.remaining;
    while v_rem > 0 and i <= v_n loop
      v_take := least(v_rem, v_cap[i]);
      if v_take > 0 then
        insert into finance.payment_plans (user_id, schedule_id, planned_year, planned_month, planned_amount, status)
        values (v_uid, s.id, extract(year from v_months[i])::int, extract(month from v_months[i])::int, v_take, 'planned');
        v_rem    := v_rem - v_take;
        v_cap[i] := v_cap[i] - v_take;
      end if;
      if v_cap[i] <= 0 then i := i + 1; end if;
    end loop;
  end loop;

  return query
    select * from finance.payment_plans
    where schedule_id = any(p_schedule_ids) and status = 'planned'
    order by planned_year, planned_month, schedule_id;
end $$;

create or replace function finance.clear_payment_plans(p_schedule_ids uuid[])
returns int language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := finance._uid(); v_n int;
begin
  delete from finance.payment_plans
  where user_id = v_uid and schedule_id = any(p_schedule_ids) and status = 'planned';
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- ---------- Installments view (carry-forward source) --------------------
create view reports.vw_installments with (security_invoker = true) as
select cs.id, cs.user_id, cs.commitment_id, c.name as commitment_name,
       c.commitment_type_id, ct.name as commitment_type, c.category_id, c.default_account_id,
       c.frequency, cs.installment_no, cs.due_date, cs.amount, cs.paid_amount,
       cs.amount - cs.paid_amount as remaining_amount, cs.status,
       (cs.status in ('pending','partial') and cs.due_date < finance._today()) as is_overdue,
       case when cs.status in ('pending','partial') and cs.due_date < finance._today()
            then finance._today() - cs.due_date end as days_overdue,
       coalesce(pp.planned_total, 0) as planned_amount,
       case when cs.status in ('pending','partial')
            then greatest(cs.amount - cs.paid_amount - coalesce(pp.planned_total, 0), 0) else 0 end as unplanned_amount,
       pp.plan_months, cs.remarks, cs.created_at, cs.updated_at
from finance.commitment_schedules cs
join finance.commitments c on c.id = cs.commitment_id
left join masters.commitment_types ct on ct.id = c.commitment_type_id
left join lateral (
  select sum(p.planned_amount) as planned_total,
         jsonb_agg(jsonb_build_object('year', p.planned_year, 'month', p.planned_month, 'amount', p.planned_amount)
                   order by p.planned_year, p.planned_month) as plan_months
  from finance.payment_plans p
  where p.schedule_id = cs.id and p.status = 'planned') pp on true
where not c.is_deleted;

-- ---------- Grants ------------------------------------------------------
revoke all on reports.vw_installments from anon;
grant select on reports.vw_installments to authenticated;

revoke execute on all functions in schema finance from public, anon;
revoke execute on function finance._generate_schedules(uuid, date), finance.fn_payment_plans_guard(),
  finance.fn_schedule_status_sync() from authenticated;
grant execute on function finance._today() to authenticated;
grant execute on function
  finance.generate_schedules(uuid, date), finance.generate_all_schedules(date),
  finance.cancel_schedule(uuid, text), finance.restore_schedule(uuid),
  finance.distribute_outstanding(uuid[], date[], text, numeric[]), finance.clear_payment_plans(uuid[])
to authenticated;
