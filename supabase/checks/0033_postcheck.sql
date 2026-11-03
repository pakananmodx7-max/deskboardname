-- KrunameClass — READ-ONLY post-check after applying migration 0033
-- (พื้นที่ทำงาน). Only SELECT. Every row P1–P9 must be ok = true.

with t(name) as (values ('workspace_notes'), ('workspace_links'), ('workspace_tasks'))
select 'P1' as n, 'three tables exist with RLS enabled' as check_name,
  (select count(*) from pg_class c join pg_namespace s on s.oid = c.relnamespace and s.nspname = 'public' join t on t.name = c.relname where c.relrowsecurity) = 3 as ok,
  null::text as detail
union all
select 'P2', 'four own-row policies per table (12)',
  (select count(*) from pg_policies where schemaname = 'public' and tablename in ('workspace_notes', 'workspace_links', 'workspace_tasks')) = 12,
  (select string_agg(tablename || ':' || cmd, ', ' order by tablename, cmd) from pg_policies where schemaname = 'public' and tablename like 'workspace\_%')
union all
select 'P3', 'every policy requires owner_id = auth.uid() and workspace_is_teacher()',
  not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename like 'workspace\_%'
      and not (coalesce(qual, with_check) like '%owner_id = auth.uid()%' and coalesce(qual, with_check) like '%workspace_is_teacher()%')
  ), null
union all
select 'P4', 'anon has no privileges on the tables',
  not exists (select 1 from information_schema.role_table_grants where table_schema = 'public' and table_name like 'workspace\_%' and grantee = 'anon'), null
union all
select 'P5', 'authenticated has select/insert/update/delete on each table',
  (select count(*) from information_schema.role_table_grants where table_schema = 'public' and table_name in ('workspace_notes', 'workspace_links', 'workspace_tasks') and grantee = 'authenticated' and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')) = 12, null
union all
select 'P6', 'owner guard + updated_at triggers on each table, revision + completed_at triggers',
  (select count(*) from pg_trigger g join pg_class c on c.oid = g.tgrelid where not g.tgisinternal and c.relname like 'workspace\_%') = 8,
  (select string_agg(g.tgname, ', ' order by g.tgname) from pg_trigger g join pg_class c on c.oid = g.tgrelid where not g.tgisinternal and c.relname like 'workspace\_%')
union all
select 'P7', 'workspace_is_teacher is SECURITY DEFINER; workspace_link_opened is SECURITY INVOKER',
  (select prosecdef from pg_proc where proname = 'workspace_is_teacher') and not (select prosecdef from pg_proc where proname = 'workspace_link_opened'), null
union all
select 'P8', 'anon cannot execute workspace_link_opened',
  not has_function_privilege('anon', 'public.workspace_link_opened(uuid)', 'execute'), null
union all
select 'P9', 'links only accept http(s) URLs (check constraint present)',
  exists (select 1 from pg_constraint where conname = 'workspace_links_url_check' and pg_get_constraintdef(oid) like '%https?%'), null
union all
select 'P10', 'info: rows (notes / links / tasks)', null,
  (select count(*) from public.workspace_notes)::text || ' / ' || (select count(*) from public.workspace_links)::text || ' / ' || (select count(*) from public.workspace_tasks)::text
order by n;
