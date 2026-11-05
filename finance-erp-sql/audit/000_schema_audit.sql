-- =====================================================================
-- Finance ERP OS · Phase 1 · Schema audit (READ-ONLY — changes nothing)
-- Repo path : finance-erp-sql/audit/000_schema_audit.sql
-- Run in    : Supabase Dashboard → SQL Editor → New query → paste → Run
-- Output    : one row, one column "audit" (JSON). Copy the whole cell
--             and paste it back to Claude.
-- =====================================================================
with sch(nsp) as (values ('public'), ('masters'), ('finance'), ('reports'))
select jsonb_pretty(jsonb_build_object(
  'generated_at', now(),
  'pg_version', current_setting('server_version'),

  'extensions', (
    select jsonb_agg(extname || ' ' || extversion order by extname)
    from pg_extension),

  'schema_usage', (
    select jsonb_agg(format('%s: anon=%s authenticated=%s', nsp,
             has_schema_privilege('anon', nsp, 'USAGE'),
             has_schema_privilege('authenticated', nsp, 'USAGE')))
    from sch),

  'relations', (
    select jsonb_agg(jsonb_build_object(
      'name',       n.nspname || '.' || c.relname,
      'kind',       case c.relkind when 'r' then 'table' when 'v' then 'view'
                                   when 'm' then 'matview' when 'p' then 'partitioned' end,
      'rls',        c.relrowsecurity,
      'force_rls',  c.relforcerowsecurity,
      'options',    c.reloptions,
      'live_rows',  st.n_live_tup,
      'columns', (
        select jsonb_agg(format('%s %s%s%s', a.attname,
                 format_type(a.atttypid, a.atttypmod),
                 case when a.attnotnull then ' NOT NULL' else '' end,
                 coalesce(' DEFAULT ' || pg_get_expr(d.adbin, d.adrelid), ''))
               order by a.attnum)
        from pg_attribute a
        left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
        where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped)
    ) order by n.nspname, c.relname)
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    left join pg_stat_user_tables st on st.relid = c.oid
    where n.nspname in (select nsp from sch)
      and c.relkind in ('r', 'v', 'm', 'p')),

  'constraints', (
    select jsonb_agg(format('%s.%s | %s | %s', n.nspname, cl.relname, co.conname,
             pg_get_constraintdef(co.oid))
           order by n.nspname, cl.relname, co.contype, co.conname)
    from pg_constraint co
    join pg_class cl on cl.oid = co.conrelid
    join pg_namespace n on n.oid = cl.relnamespace
    where n.nspname in (select nsp from sch)),

  'indexes', (
    select jsonb_agg(indexdef order by schemaname, tablename, indexname)
    from pg_indexes
    where schemaname in (select nsp from sch)),

  'triggers', (
    select jsonb_agg(pg_get_triggerdef(t.oid) order by n.nspname, c.relname, t.tgname)
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where not t.tgisinternal
      and n.nspname in (select nsp from sch)),

  'auth_users_triggers', (
    select jsonb_agg(pg_get_triggerdef(t.oid) order by t.tgname)
    from pg_trigger t
    where t.tgrelid = 'auth.users'::regclass and not t.tgisinternal),

  'functions', (
    select jsonb_agg(jsonb_build_object(
      'name',             n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
      'returns',          pg_get_function_result(p.oid),
      'security_definer', p.prosecdef,
      'config',           p.proconfig,
      'definition',       pg_get_functiondef(p.oid)
    ) order by n.nspname, p.proname)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in (select nsp from sch)
      and p.prokind in ('f', 'p')
      and not exists (select 1 from pg_depend dep
                      where dep.objid = p.oid and dep.deptype = 'e')),

  'policies', (
    select jsonb_agg(jsonb_build_object(
      'table',      schemaname || '.' || tablename,
      'policy',     policyname,
      'cmd',        cmd,
      'roles',      roles,
      'permissive', permissive,
      'using',      qual,
      'check',      with_check
    ) order by schemaname, tablename, policyname)
    from pg_policies
    where schemaname in (select nsp from sch)),

  'grants', (
    select jsonb_agg(format('%s.%s → %s: %s', table_schema, table_name, grantee, privs)
           order by table_schema, table_name, grantee)
    from (
      select table_schema, table_name, grantee,
             string_agg(privilege_type, ',' order by privilege_type) as privs
      from information_schema.role_table_grants
      where table_schema in (select nsp from sch)
        and grantee in ('anon', 'authenticated')
      group by table_schema, table_name, grantee) g),

  'views', (
    select jsonb_agg(jsonb_build_object(
      'view', schemaname || '.' || viewname,
      'definition', definition
    ) order by schemaname, viewname)
    from pg_views
    where schemaname in (select nsp from sch))
)) as audit;
