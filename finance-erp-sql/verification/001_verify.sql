-- =====================================================================
-- Finance ERP OS · Verify migration 001 (READ-ONLY)
-- Repo path : finance-erp-sql/verification/001_verify.sql
-- Run in    : Supabase Dashboard → SQL Editor → New query → paste → Run
-- Expected  : every row shows ok = true
-- =====================================================================
with tbl as (
  select n.nspname, c.relname, c.oid, c.relrowsecurity
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('masters','finance') and c.relkind = 'r'
)
select 'every table has RLS' as check_name,
       bool_and(relrowsecurity) as ok, count(*)::text as detail
from tbl
union all
select 'every table has user_id',
       bool_and(exists (select 1 from pg_attribute a where a.attrelid = tbl.oid and a.attname = 'user_id' and not a.attisdropped)),
       string_agg(relname, ',') filter (where not exists (select 1 from pg_attribute a where a.attrelid = tbl.oid and a.attname = 'user_id'))
from tbl
union all
select 'every table has a SELECT policy',
       bool_and(exists (select 1 from pg_policies p where p.schemaname = tbl.nspname and p.tablename = tbl.relname and p.cmd = 'SELECT')),
       null
from tbl
union all
select 'policy count = 58', count(*) = 58, count(*)::text
from pg_policies where schemaname in ('masters','finance')
union all
select 'anon has no table grants', count(*) = 0, count(*)::text
from information_schema.role_table_grants
where table_schema in ('masters','finance','reports') and grantee = 'anon'
union all
select 'clients cannot write transactions', not has_table_privilege('authenticated', 'finance.transactions', 'INSERT,UPDATE,DELETE'), null
union all
select 'clients cannot write current_balance', not has_column_privilege('authenticated', 'finance.accounts', 'current_balance', 'UPDATE'), null
union all
select 'clients cannot write paid_amount', not has_column_privilege('authenticated', 'finance.commitment_schedules', 'paid_amount', 'UPDATE'), null
union all
select 'clients cannot change schedule due_date', not has_column_privilege('authenticated', 'finance.commitment_schedules', 'due_date', 'UPDATE'), null
union all
select 'history_logs is read-only', not has_table_privilege('authenticated', 'finance.history_logs', 'INSERT,UPDATE,DELETE'), null
union all
select 'reports views use security_invoker',
       bool_and(coalesce('security_invoker=true' = any(c.reloptions), false)), string_agg(c.relname, ',')
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'reports' and c.relkind = 'v'
union all
select 'updated_at column exists wherever its trigger does',
       count(*) = 0, string_agg(c.relname, ',')
from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
where n.nspname in ('masters','finance') and t.tgname like '%updated_at'
  and not exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'updated_at')
union all
select 'signup seeding trigger on auth.users',
       exists (select 1 from pg_trigger where tgname = 'trg_seed_user_masters' and tgrelid = 'auth.users'::regclass), null
union all
select 'system master templates kept',
       (select count(*) from masters.payment_modes where is_system) = 4
   and (select count(*) from masters.commitment_types where is_system) = 9
   and (select count(*) from masters.goal_types where is_system) = 2,
       null
union all
select 'finance.comments exists', to_regclass('finance.comments') is not null, null
union all
select 'transaction shape check exists',
       exists (select 1 from pg_constraint where conname = 'transactions_shape_ck'), null;
