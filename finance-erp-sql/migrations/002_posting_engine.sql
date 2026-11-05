-- =====================================================================
-- Finance ERP OS · Migration 002 · Posting engine
-- Repo path : finance-erp-sql/migrations/002_posting_engine.sql
--
-- One posting model for every transaction type:
--   income              → to   +amount
--   expense             → from −amount   (from = credit card ⇒ outstanding rises)
--   transfer            → from −amount, to +amount
--   credit_card_payment → bank −amount,  card +amount (not an expense: no double count)
--   goal_contribution   → from −amount (+ to goal account if given) + goal progress
--   commitment_payment  → from −amount (+ to loan account if given) + allocations
--   adjustment          → exactly one account, ±amount
--
-- Client API (SECURITY DEFINER RPCs, owner-checked):
--   finance.post_transaction(p jsonb)              idempotent via client_request_id
--   finance.post_transactions_bulk(p_items jsonb)  quick daily spending entry
--   finance.update_transaction(p_id uuid, p jsonb) reverse old effects + apply new, atomically
--   finance.void_transaction(p_id uuid, p_reason)  soft delete + full reversal
--   finance.set_opening_balance(p_account_id, p_amount)
--   finance.reconcile_balances()                   drift check (should return 0 rows)
-- =====================================================================

-- ---------- Tables ------------------------------------------------------
create table finance.account_postings (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  transaction_id uuid not null,
  account_id     uuid not null,
  amount         numeric(14,2) not null check (amount <> 0),
  posting_date   date not null,
  created_at     timestamptz not null default now(),
  constraint postings_txn_fk foreign key (transaction_id, user_id)
    references finance.transactions (id, user_id) on delete cascade,
  constraint postings_account_fk foreign key (account_id, user_id)
    references finance.accounts (id, user_id),
  constraint postings_txn_account_uk unique (transaction_id, account_id)
);
create index postings_account_date_idx on finance.account_postings (account_id, posting_date, created_at);
create index postings_user_idx on finance.account_postings (user_id);
comment on table finance.account_postings is 'One row per account touched by a posted transaction. Written only by the posting engine.';

create table finance.payment_allocations (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  transaction_id uuid not null,
  schedule_id    uuid not null,
  amount         numeric(14,2) not null check (amount > 0),
  created_at     timestamptz not null default now(),
  constraint allocations_txn_fk foreign key (transaction_id, user_id)
    references finance.transactions (id, user_id) on delete cascade,
  constraint allocations_schedule_fk foreign key (schedule_id, user_id)
    references finance.commitment_schedules (id, user_id),
  constraint allocations_txn_schedule_uk unique (transaction_id, schedule_id)
);
create index allocations_schedule_idx on finance.payment_allocations (schedule_id);
create index allocations_user_idx on finance.payment_allocations (user_id);
comment on table finance.payment_allocations is 'Links a payment to the original installment(s) it settles. Schedules are never overwritten.';

alter table finance.account_postings    enable row level security;
alter table finance.payment_allocations enable row level security;
create policy owner_select on finance.account_postings    for select to authenticated using ((select auth.uid()) = user_id);
create policy owner_select on finance.payment_allocations for select to authenticated using ((select auth.uid()) = user_id);

-- ---------- Helpers -----------------------------------------------------
create or replace function finance._uid()
returns uuid language plpgsql stable set search_path = '' as $$
declare v uuid := auth.uid();
begin
  if v is null then raise exception 'Not authenticated' using errcode = '28000'; end if;
  return v;
end $$;

create or replace function finance._today()
returns date language sql stable set search_path = '' as $$
  select (now() at time zone 'Asia/Kolkata')::date
$$;

-- Recompute paid_amount/status of one installment from its allocations.
create or replace function finance._refresh_schedule(p_schedule_id uuid)
returns void language plpgsql set search_path = '' as $$
declare v_amt numeric(14,2); v_status text; v_paid numeric(14,2);
begin
  select amount, status into v_amt, v_status
  from finance.commitment_schedules where id = p_schedule_id for update;
  if not found then raise exception 'Installment % not found', p_schedule_id; end if;

  select coalesce(sum(amount), 0) into v_paid
  from finance.payment_allocations where schedule_id = p_schedule_id;

  if v_paid > v_amt then
    raise exception 'Overpayment: installment due % but % would be allocated', v_amt, v_paid
      using errcode = 'P0001', hint = 'Reduce the amount or allocate the excess to another installment.';
  end if;

  update finance.commitment_schedules
     set paid_amount = v_paid,
         status = case when v_status = 'cancelled' then 'cancelled'
                       when v_paid = 0     then 'pending'
                       when v_paid < v_amt then 'partial'
                       else 'paid' end
   where id = p_schedule_id;
end $$;

-- Apply all accounting effects of one posted transaction.
create or replace function finance._apply_transaction(p_id uuid, p_allocations jsonb default null)
returns void language plpgsql set search_path = '' as $$
declare
  t      finance.transactions%rowtype;
  v_from finance.accounts%rowtype;
  v_to   finance.accounts%rowtype;
  v_goal finance.goals%rowtype;
  v_alloc jsonb;
  v_sum  numeric(14,2) := 0;
  r      record;
begin
  select * into t from finance.transactions where id = p_id;
  if t.status <> 'posted' then return; end if;

  -- lock touched accounts in a fixed order (prevents deadlocks)
  perform 1 from finance.accounts
   where id in (t.from_account_id, t.to_account_id) order by id for update;

  if t.from_account_id is not null then
    select * into v_from from finance.accounts where id = t.from_account_id;
    if not v_from.active or v_from.is_deleted then
      raise exception 'Account "%" is inactive or deleted', v_from.name;
    end if;
  end if;
  if t.to_account_id is not null then
    select * into v_to from finance.accounts where id = t.to_account_id;
    if not v_to.active or v_to.is_deleted then
      raise exception 'Account "%" is inactive or deleted', v_to.name;
    end if;
  end if;

  if t.transaction_type = 'credit_card_payment' then
    if v_to.account_type not in ('credit_card','loan') then
      raise exception 'A credit card payment must be paid TO a credit card or loan account';
    end if;
    if v_from.account_type = 'credit_card' then
      raise exception 'A credit card bill cannot be paid FROM a credit card';
    end if;
  end if;

  -- postings + stored balances
  if t.from_account_id is not null then
    insert into finance.account_postings (user_id, transaction_id, account_id, amount, posting_date)
    values (t.user_id, t.id, t.from_account_id, -t.amount, t.transaction_date);
    update finance.accounts set current_balance = current_balance - t.amount where id = t.from_account_id;
  end if;
  if t.to_account_id is not null then
    insert into finance.account_postings (user_id, transaction_id, account_id, amount, posting_date)
    values (t.user_id, t.id, t.to_account_id, t.amount, t.transaction_date);
    update finance.accounts set current_balance = current_balance + t.amount where id = t.to_account_id;
  end if;

  -- goals
  if t.transaction_type = 'goal_contribution' then
    select * into v_goal from finance.goals where id = t.goal_id for update;
    if v_goal.is_deleted or v_goal.status = 'cancelled' then
      raise exception 'Goal "%" is cancelled or deleted', v_goal.name;
    end if;
    insert into finance.goal_contributions (user_id, goal_id, contribution_date, amount, transaction_id, remarks)
    values (t.user_id, t.goal_id, t.transaction_date, t.amount, t.id, t.remarks);
    update finance.goals
       set current_amount = current_amount + t.amount,
           status = case when status = 'active' and target_amount > 0
                          and current_amount + t.amount >= target_amount then 'achieved' else status end
     where id = t.goal_id;
  end if;

  -- installment allocations
  v_alloc := case
    when p_allocations is not null and jsonb_typeof(p_allocations) = 'array' and jsonb_array_length(p_allocations) > 0
      then p_allocations
    when t.commitment_schedule_id is not null
      then jsonb_build_array(jsonb_build_object('schedule_id', t.commitment_schedule_id, 'amount', t.amount))
  end;

  if t.transaction_type = 'commitment_payment' and v_alloc is null then
    raise exception 'A commitment payment must be allocated to at least one installment';
  end if;

  if v_alloc is not null then
    if t.transaction_type not in ('commitment_payment','expense','credit_card_payment') then
      raise exception 'Installment allocations are not allowed on % transactions', t.transaction_type;
    end if;
    for r in
      select (e->>'schedule_id')::uuid as sid, (e->>'amount')::numeric(14,2) as amt
      from jsonb_array_elements(v_alloc) e
      order by 1
    loop
      if r.sid is null or r.amt is null or r.amt <= 0 then
        raise exception 'Each allocation needs a schedule_id and a positive amount';
      end if;
      if not exists (select 1 from finance.commitment_schedules
                     where id = r.sid and user_id = t.user_id and status <> 'cancelled') then
        raise exception 'Installment % not found or cancelled', r.sid;
      end if;
      insert into finance.payment_allocations (user_id, transaction_id, schedule_id, amount)
      values (t.user_id, t.id, r.sid, r.amt);
      v_sum := v_sum + r.amt;
      perform finance._refresh_schedule(r.sid);
    end loop;

    if t.transaction_type = 'commitment_payment' and v_sum <> t.amount then
      raise exception 'Allocated total % must equal the payment amount %', v_sum, t.amount;
    elsif v_sum > t.amount then
      raise exception 'Allocated total % exceeds the transaction amount %', v_sum, t.amount;
    end if;
  end if;
end $$;

-- Reverse all accounting effects; returns the allocations it removed.
create or replace function finance._reverse_transaction(p_id uuid)
returns jsonb language plpgsql set search_path = '' as $$
declare v_allocs jsonb; r record;
begin
  select jsonb_agg(jsonb_build_object('schedule_id', schedule_id, 'amount', amount) order by schedule_id)
    into v_allocs
  from finance.payment_allocations where transaction_id = p_id;

  perform 1 from finance.accounts
   where id in (select account_id from finance.account_postings where transaction_id = p_id)
   order by id for update;
  update finance.accounts a
     set current_balance = a.current_balance - p.amount
    from finance.account_postings p
   where p.transaction_id = p_id and p.account_id = a.id;
  delete from finance.account_postings where transaction_id = p_id;

  for r in delete from finance.payment_allocations where transaction_id = p_id returning schedule_id loop
    perform finance._refresh_schedule(r.schedule_id);
  end loop;

  for r in delete from finance.goal_contributions where transaction_id = p_id returning goal_id, amount loop
    update finance.goals
       set current_amount = current_amount - r.amount,
           status = case when status = 'achieved' and current_amount - r.amount < target_amount
                         then 'active' else status end
     where id = r.goal_id;
  end loop;

  return v_allocs;
end $$;

-- ---------- Public RPCs -------------------------------------------------
create or replace function finance.post_transaction(p jsonb)
returns finance.transactions language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := finance._uid();
  v_req uuid := nullif(p->>'client_request_id', '')::uuid;
  v_id  uuid;
  t     finance.transactions%rowtype;
begin
  if v_req is not null then
    select * into t from finance.transactions where user_id = v_uid and client_request_id = v_req;
    if found then return t; end if;   -- already posted: never post twice
  end if;

  insert into finance.transactions (
    user_id, transaction_date, transaction_type, amount, from_account_id, to_account_id,
    category_id, payment_mode_id, goal_id, commitment_schedule_id, remarks,
    reference_type, reference_id, reference_no, attachment_path, client_request_id, status)
  values (
    v_uid,
    coalesce(nullif(p->>'transaction_date', '')::date, finance._today()),
    p->>'transaction_type',
    (p->>'amount')::numeric(14,2),
    nullif(p->>'from_account_id', '')::uuid,
    nullif(p->>'to_account_id', '')::uuid,
    nullif(p->>'category_id', '')::uuid,
    nullif(p->>'payment_mode_id', '')::uuid,
    nullif(p->>'goal_id', '')::uuid,
    nullif(p->>'commitment_schedule_id', '')::uuid,
    nullif(btrim(p->>'remarks'), ''),
    nullif(p->>'reference_type', ''),
    nullif(p->>'reference_id', '')::uuid,
    nullif(btrim(p->>'reference_no'), ''),
    nullif(p->>'attachment_path', ''),
    v_req,
    'posted')
  on conflict (user_id, client_request_id) do nothing
  returning id into v_id;

  if v_id is null then   -- lost a race with an identical request
    select * into t from finance.transactions where user_id = v_uid and client_request_id = v_req;
    return t;
  end if;

  perform finance._apply_transaction(v_id, p->'allocations');
  select * into t from finance.transactions where id = v_id;

  insert into finance.history_logs (user_id, entity_type, entity_id, action, new_value, created_by)
  values (v_uid, 'finance.transactions', v_id, 'post',
          to_jsonb(t) || jsonb_build_object('allocations',
            (select jsonb_agg(jsonb_build_object('schedule_id', schedule_id, 'amount', amount))
               from finance.payment_allocations where transaction_id = v_id)),
          v_uid);
  return t;
end $$;

create or replace function finance.post_transactions_bulk(p_items jsonb)
returns setof finance.transactions language plpgsql security definer set search_path = '' as $$
declare e jsonb;
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Provide a non-empty array of transactions';
  end if;
  for e in select value from jsonb_array_elements(p_items) loop
    return next finance.post_transaction(e);
  end loop;
end $$;

create or replace function finance.update_transaction(p_id uuid, p jsonb)
returns finance.transactions language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := finance._uid();
  v_old finance.transactions%rowtype;
  v_new finance.transactions%rowtype;
  v_old_allocs jsonb;
  v_allocs jsonb;
begin
  select * into v_old from finance.transactions where id = p_id and user_id = v_uid for update;
  if not found then raise exception 'Transaction not found'; end if;
  if v_old.status = 'void' then raise exception 'A deleted transaction cannot be edited'; end if;

  v_old_allocs := finance._reverse_transaction(p_id);

  update finance.transactions set
    transaction_date       = coalesce(nullif(p->>'transaction_date', '')::date, transaction_date),
    transaction_type       = coalesce(nullif(p->>'transaction_type', ''), transaction_type),
    amount                 = coalesce((p->>'amount')::numeric(14,2), amount),
    from_account_id        = case when p ? 'from_account_id'        then nullif(p->>'from_account_id', '')::uuid        else from_account_id end,
    to_account_id          = case when p ? 'to_account_id'          then nullif(p->>'to_account_id', '')::uuid          else to_account_id end,
    category_id            = case when p ? 'category_id'            then nullif(p->>'category_id', '')::uuid            else category_id end,
    payment_mode_id        = case when p ? 'payment_mode_id'        then nullif(p->>'payment_mode_id', '')::uuid        else payment_mode_id end,
    goal_id                = case when p ? 'goal_id'                then nullif(p->>'goal_id', '')::uuid                else goal_id end,
    commitment_schedule_id = case when p ? 'commitment_schedule_id' then nullif(p->>'commitment_schedule_id', '')::uuid else commitment_schedule_id end,
    remarks                = case when p ? 'remarks'                then nullif(btrim(p->>'remarks'), '')               else remarks end,
    reference_type         = case when p ? 'reference_type'         then nullif(p->>'reference_type', '')               else reference_type end,
    reference_id           = case when p ? 'reference_id'           then nullif(p->>'reference_id', '')::uuid           else reference_id end,
    reference_no           = case when p ? 'reference_no'           then nullif(btrim(p->>'reference_no'), '')          else reference_no end,
    attachment_path        = case when p ? 'attachment_path'        then nullif(p->>'attachment_path', '')              else attachment_path end
  where id = p_id
  returning * into v_new;

  -- keep previous allocations when nothing that affects them changed
  v_allocs := case
    when p ? 'allocations' then p->'allocations'
    when v_new.amount = v_old.amount
     and v_new.transaction_type = v_old.transaction_type
     and v_new.commitment_schedule_id is not distinct from v_old.commitment_schedule_id
      then v_old_allocs
  end;

  perform finance._apply_transaction(p_id, v_allocs);
  select * into v_new from finance.transactions where id = p_id;

  insert into finance.history_logs (user_id, entity_type, entity_id, action, old_value, new_value, created_by)
  values (v_uid, 'finance.transactions', p_id, 'update',
          to_jsonb(v_old) || jsonb_build_object('allocations', v_old_allocs),
          to_jsonb(v_new) || jsonb_build_object('allocations',
            (select jsonb_agg(jsonb_build_object('schedule_id', schedule_id, 'amount', amount))
               from finance.payment_allocations where transaction_id = p_id)),
          v_uid);
  return v_new;
end $$;

create or replace function finance.void_transaction(p_id uuid, p_reason text default null)
returns finance.transactions language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := finance._uid();
  v_old finance.transactions%rowtype;
  v_new finance.transactions%rowtype;
  v_allocs jsonb;
begin
  select * into v_old from finance.transactions where id = p_id and user_id = v_uid for update;
  if not found then raise exception 'Transaction not found'; end if;
  if v_old.status = 'void' then return v_old; end if;   -- deleting twice is a no-op

  v_allocs := finance._reverse_transaction(p_id);

  update finance.transactions
     set status = 'void', voided_at = now(), void_reason = nullif(btrim(p_reason), ''), is_deleted = true
   where id = p_id
  returning * into v_new;

  insert into finance.history_logs (user_id, entity_type, entity_id, action, old_value, new_value, remarks, created_by)
  values (v_uid, 'finance.transactions', p_id, 'void',
          to_jsonb(v_old) || jsonb_build_object('allocations', v_allocs), to_jsonb(v_new), p_reason, v_uid);
  return v_new;
end $$;

create or replace function finance.set_opening_balance(p_account_id uuid, p_amount numeric)
returns finance.accounts language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := finance._uid(); a finance.accounts%rowtype;
begin
  select * into a from finance.accounts where id = p_account_id and user_id = v_uid for update;
  if not found then raise exception 'Account not found'; end if;
  update finance.accounts
     set current_balance = current_balance + (p_amount::numeric(14,2) - opening_balance),
         opening_balance = p_amount::numeric(14,2)
   where id = p_account_id
  returning * into a;
  return a;
end $$;

create or replace function finance.reconcile_balances()
returns table (account_id uuid, account_name text, stored_balance numeric, computed_balance numeric, difference numeric)
language sql stable set search_path = '' as $$
  select a.id, a.name, a.current_balance,
         a.opening_balance + coalesce(sum(p.amount), 0),
         a.current_balance - (a.opening_balance + coalesce(sum(p.amount), 0))
  from finance.accounts a
  left join finance.account_postings p on p.account_id = a.id
  where a.user_id = (select auth.uid())
  group by a.id
  having a.current_balance <> a.opening_balance + coalesce(sum(p.amount), 0)
$$;

-- ---------- Account guard -----------------------------------------------
create or replace function finance.fn_accounts_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.account_type <> old.account_type
     and exists (select 1 from finance.account_postings where account_id = old.id) then
    raise exception 'Account type cannot change after transactions are posted to it';
  end if;
  if new.is_deleted and not old.is_deleted and new.current_balance <> 0 then
    raise exception 'Account "%" still has a balance of %. Bring it to zero before deleting.', old.name, old.current_balance;
  end if;
  return new;
end $$;
create trigger trg_accounts_guard before update on finance.accounts
  for each row execute function finance.fn_accounts_guard();

-- ---------- Append-only audit trail for master records ------------------
-- TG_ARGV = columns whose changes alone are not worth logging (engine-maintained).
create or replace function finance.fn_audit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_old jsonb; v_new jsonb; v_row jsonb; v_ignore text[] := coalesce(tg_argv, '{}');
begin
  if tg_op in ('UPDATE','DELETE') then v_old := to_jsonb(old); end if;
  if tg_op in ('INSERT','UPDATE') then v_new := to_jsonb(new); end if;
  if tg_op = 'UPDATE' and (v_old - v_ignore - 'updated_at') = (v_new - v_ignore - 'updated_at') then
    return new;
  end if;
  v_row := coalesce(v_new, v_old);
  -- skip rows removed because their owner was deleted
  if tg_op = 'DELETE' and not exists (select 1 from auth.users where id = (v_row->>'user_id')::uuid) then
    return old;
  end if;
  insert into finance.history_logs (user_id, entity_type, entity_id, action, old_value, new_value, created_by)
  values ((v_row->>'user_id')::uuid, tg_table_schema || '.' || tg_table_name, (v_row->>'id')::uuid,
          lower(tg_op), v_old, v_new, auth.uid());
  return coalesce(new, old);
end $$;

create trigger trg_audit after insert or update or delete on finance.accounts
  for each row execute function finance.fn_audit('current_balance');
create trigger trg_audit after insert or update or delete on finance.commitments
  for each row execute function finance.fn_audit();
create trigger trg_audit after insert or update or delete on finance.commitment_schedules
  for each row execute function finance.fn_audit('paid_amount','status');
create trigger trg_audit after insert or update or delete on finance.payment_plans
  for each row execute function finance.fn_audit();
create trigger trg_audit after insert or update or delete on finance.goals
  for each row execute function finance.fn_audit('current_amount','status');
create trigger trg_audit after insert or update or delete on finance.monthly_plans
  for each row execute function finance.fn_audit();
create trigger trg_audit after insert or update or delete on finance.plan_items
  for each row execute function finance.fn_audit();
create trigger trg_audit after insert or update or delete on finance.assets
  for each row execute function finance.fn_audit();
create trigger trg_audit after insert or update or delete on finance.tasks
  for each row execute function finance.fn_audit();

-- ---------- Reports -----------------------------------------------------
create view reports.vw_account_ledger with (security_invoker = true) as
select p.id as posting_id, p.user_id, p.account_id, a.name as account_name, a.account_type,
       p.transaction_id, t.transaction_date, t.transaction_type, t.category_id, t.remarks, t.reference_no,
       greatest(p.amount, 0)  as money_in,
       greatest(-p.amount, 0) as money_out,
       p.amount,
       a.opening_balance + sum(p.amount) over (
         partition by p.account_id
         order by t.transaction_date, t.created_at, p.id
         rows between unbounded preceding and current row) as running_balance,
       t.created_at
from finance.account_postings p
join finance.transactions t on t.id = p.transaction_id
join finance.accounts a     on a.id = p.account_id;

create view reports.vw_transactions with (security_invoker = true) as
select t.id, t.user_id, t.transaction_date, t.transaction_type, t.amount, t.status, t.is_deleted,
       t.from_account_id, fa.name as from_account_name, fa.account_type as from_account_type,
       t.to_account_id,   ta.name as to_account_name,   ta.account_type as to_account_type,
       t.category_id, c.name as category_name, c.category_group,
       t.payment_mode_id, pm.name as payment_mode_name,
       t.goal_id, g.name as goal_name,
       t.commitment_schedule_id,
       t.remarks, t.reference_type, t.reference_id, t.reference_no, t.attachment_path,
       t.client_request_id, t.voided_at, t.void_reason, t.created_at, t.updated_at
from finance.transactions t
left join finance.accounts fa      on fa.id = t.from_account_id
left join finance.accounts ta      on ta.id = t.to_account_id
left join masters.categories c     on c.id  = t.category_id
left join masters.payment_modes pm on pm.id = t.payment_mode_id
left join finance.goals g          on g.id  = t.goal_id;

-- ---------- Grants ------------------------------------------------------
revoke all on finance.account_postings, finance.payment_allocations from anon, authenticated;
grant select on finance.account_postings, finance.payment_allocations to authenticated;
grant all on finance.account_postings, finance.payment_allocations to service_role;
grant select on reports.vw_account_ledger, reports.vw_transactions to authenticated;
revoke all on reports.vw_account_ledger, reports.vw_transactions from anon;

revoke execute on all functions in schema finance from public, anon;
revoke execute on function
  finance._apply_transaction(uuid, jsonb), finance._reverse_transaction(uuid), finance._refresh_schedule(uuid),
  finance.fn_audit(), finance.fn_accounts_guard()
from authenticated;
grant execute on function
  finance.post_transaction(jsonb), finance.post_transactions_bulk(jsonb),
  finance.update_transaction(uuid, jsonb), finance.void_transaction(uuid, text),
  finance.set_opening_balance(uuid, numeric), finance.reconcile_balances()
to authenticated;
