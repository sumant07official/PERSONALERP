-- =====================================================================
-- Finance ERP OS · Migration 006 · Covering indexes for composite FKs
-- Repo path : finance-erp-sql/migrations/006_fk_covering_indexes.sql
-- Replaces single-column FK indexes with (fk_column, user_id) indexes so
-- every owner-safe foreign key has an exact covering index.
-- =====================================================================
drop index if exists finance.transactions_from_idx, finance.transactions_to_idx, finance.transactions_category_idx,
  finance.transactions_mode_idx, finance.transactions_goal_idx, finance.transactions_schedule_idx,
  finance.commitments_type_idx, finance.commitments_category_idx, finance.commitments_account_idx,
  finance.goals_type_idx, finance.goals_account_idx, finance.goal_contributions_goal_idx,
  finance.plan_items_account_idx, finance.plan_items_category_idx, finance.plan_items_plan_idx,
  masters.categories_parent_idx, finance.schedules_commitment_idx, finance.allocations_schedule_idx;

do $$
declare r record; v_cols text; v_name text;
begin
  for r in
    select n.nspname, c.relname, co.conname, co.conrelid, co.conkey
    from pg_constraint co
    join pg_class c on c.oid = co.conrelid
    join pg_namespace n on n.oid = c.relnamespace
    where co.contype = 'f' and n.nspname in ('finance','masters','public')
      and not exists (
        select 1 from pg_index i
        where i.indrelid = co.conrelid
          and array(select unnest((i.indkey::int2[])[0:cardinality(co.conkey) - 1])) = co.conkey)
  loop
    select string_agg(quote_ident(a.attname), ', ' order by k.ord) into v_cols
    from unnest(r.conkey) with ordinality k(attnum, ord)
    join pg_attribute a on a.attrelid = r.conrelid and a.attnum = k.attnum;
    v_name := left(r.conname, 55) || '_idx';
    execute format('create index if not exists %I on %I.%I (%s)', v_name, r.nspname, r.relname, v_cols);
  end loop;
end $$;
