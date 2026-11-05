-- =====================================================================
-- Finance ERP OS · Full database verification (READ-ONLY)
-- Repo path : finance-erp-sql/verification/999_full_verify.sql
-- Run in    : Supabase Dashboard → SQL Editor → New query → paste → Run
-- Expected  : every row shows ok = true
-- =====================================================================
with tbl as (
  select n.nspname, c.relname, c.oid, c.relrowsecurity
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('masters','finance') and c.relkind = 'r'
),
rpc(name) as (values
  ('finance.post_transaction'), ('finance.post_transactions_bulk'), ('finance.update_transaction'),
  ('finance.void_transaction'), ('finance.set_opening_balance'), ('finance.reconcile_balances'),
  ('finance.generate_schedules'), ('finance.generate_all_schedules'), ('finance.cancel_schedule'),
  ('finance.restore_schedule'), ('finance.distribute_outstanding'), ('finance.clear_payment_plans'),
  ('finance.generate_month_plan'), ('finance.pay_plan_item'), ('finance.finalize_month_plan'),
  ('finance.reopen_month_plan'), ('finance.import_transactions'), ('finance.undo_import'),
  ('reports.dashboard_summary')
)
select 'migrations 001-006 applied' as check_name,
       (select count(*) from supabase_migrations.schema_migrations
         where name in ('001_security_foundation','002_posting_engine','003_commitments_engine',
                        '004_planning_engine','005_reports_dashboard','006_fk_covering_indexes')) = 6 as ok,
       null::text as detail
union all
select 'every table has RLS', bool_and(relrowsecurity), count(*)::text from tbl
union all
select 'every table has user_id',
       bool_and(exists (select 1 from pg_attribute a where a.attrelid = tbl.oid and a.attname = 'user_id' and not a.attisdropped)), null
from tbl
union all
select 'every table has an owner SELECT policy',
       bool_and(exists (select 1 from pg_policies p where p.schemaname = tbl.nspname and p.tablename = tbl.relname and p.cmd = 'SELECT')),
       string_agg(relname, ',') filter (where not exists (select 1 from pg_policies p where p.schemaname = tbl.nspname and p.tablename = tbl.relname and p.cmd = 'SELECT'))
from tbl
union all
select 'anon has no table grants', count(*) = 0, count(*)::text
from information_schema.role_table_grants
where table_schema in ('masters','finance','reports','public') and grantee = 'anon'
  and table_name in (select relname from pg_class where relnamespace in ('masters'::regnamespace,'finance'::regnamespace,'reports'::regnamespace) union select 'profiles')
union all
select 'ledger tables are read-only to the apps',
       not has_table_privilege('authenticated', 'finance.transactions', 'INSERT,UPDATE,DELETE')
   and not has_table_privilege('authenticated', 'finance.account_postings', 'INSERT,UPDATE,DELETE')
   and not has_table_privilege('authenticated', 'finance.payment_allocations', 'INSERT,UPDATE,DELETE')
   and not has_table_privilege('authenticated', 'finance.history_logs', 'INSERT,UPDATE,DELETE')
   and not has_column_privilege('authenticated', 'finance.accounts', 'current_balance', 'UPDATE')
   and not has_column_privilege('authenticated', 'finance.commitment_schedules', 'paid_amount', 'UPDATE')
   and not has_column_privilege('authenticated', 'finance.goals', 'current_amount', 'UPDATE'), null
union all
select 'all client RPCs exist and are callable by signed-in users',
       count(*) = (select count(*) from rpc),
       string_agg(rpc.name, ',') filter (where p.oid is null)
from rpc
left join pg_proc p on p.oid = (select min(pp.oid) from pg_proc pp join pg_namespace nn on nn.oid = pp.pronamespace
                                 where nn.nspname || '.' || pp.proname = rpc.name)
                   and has_function_privilege('authenticated', p.oid, 'EXECUTE')
union all
select 'no RPC callable by anon',
       not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname in ('finance','reports') and has_function_privilege('anon', p.oid, 'EXECUTE')), null
union all
select 'all reports views use security_invoker',
       bool_and(coalesce('security_invoker=true' = any(c.reloptions), false)), count(*)::text
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'reports' and c.relkind = 'v'
union all
select 'every foreign key has a covering index', count(*) = 0, string_agg(co.conname, ',')
from pg_constraint co join pg_namespace n on n.oid = co.connamespace
where co.contype = 'f' and n.nspname in ('finance','masters','public')
  and not exists (select 1 from pg_index i where i.indrelid = co.conrelid
                  and array(select unnest((i.indkey::int2[])[0:cardinality(co.conkey) - 1])) = co.conkey)
union all
select 'signup trigger present', exists (select 1 from pg_trigger where tgname = 'trg_seed_user_masters' and tgrelid = 'auth.users'::regclass), null
union all
select 'system master templates kept',
       (select count(*) from masters.payment_modes where is_system) = 4
   and (select count(*) from masters.commitment_types where is_system) = 9
   and (select count(*) from masters.goal_types where is_system) = 2, null
union all
select 'attachments bucket is private', exists (select 1 from storage.buckets where id = 'attachments' and not public), null
union all
select 'stored balances match postings (all users)', count(*) = 0, count(*)::text
from (select a.id from finance.accounts a left join finance.account_postings p on p.account_id = a.id
      group by a.id having a.current_balance <> a.opening_balance + coalesce(sum(p.amount), 0)) drift;
