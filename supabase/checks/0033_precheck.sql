-- KrunameClass — READ-ONLY pre-check before applying migration 0033
-- (supabase/migrations/0033_teacher_workspace.sql — พื้นที่ทำงาน).
--
-- Only SELECT. Paste the whole file into the Supabase SQL Editor and Run.
-- ok = true → fine, false → stop (do NOT apply 0033), null → information.
-- Works with or without 0012/0029.

select 1 as n, 'profiles table with role teacher/admin/student' as check_name,
  exists (
    select 1 from pg_constraint c
    join pg_class t on t.oid = c.conrelid and t.relname = 'profiles'
    join pg_namespace s on s.oid = t.relnamespace and s.nspname = 'public'
    where c.contype = 'c' and pg_get_constraintdef(c.oid) like '%teacher%' and pg_get_constraintdef(c.oid) like '%admin%'
  ) as ok, null::text as detail
union all
select 2, 'public.set_updated_at() exists (0001)',
  exists (select 1 from pg_proc p join pg_namespace s on s.oid = p.pronamespace and s.nspname = 'public' where p.proname = 'set_updated_at'), null
union all
select 3, 'auth.uid() exists',
  exists (select 1 from pg_proc p join pg_namespace s on s.oid = p.pronamespace and s.nspname = 'auth' where p.proname = 'uid'), null
union all
select 4, 'gen_random_uuid() available',
  exists (select 1 from pg_proc where proname = 'gen_random_uuid'), null
union all
select 5, 'no workspace_* table exists yet (0033 not applied)',
  not exists (select 1 from pg_tables where schemaname = 'public' and tablename in ('workspace_notes', 'workspace_links', 'workspace_tasks')),
  (select string_agg(tablename, ', ') from pg_tables where schemaname = 'public' and tablename like 'workspace\_%')
union all
select 6, 'no workspace_* function exists yet',
  not exists (select 1 from pg_proc p join pg_namespace s on s.oid = p.pronamespace and s.nspname = 'public' where p.proname like 'workspace\_%'),
  (select string_agg(p.proname, ', ') from pg_proc p join pg_namespace s on s.oid = p.pronamespace and s.nspname = 'public' where p.proname like 'workspace\_%')
union all
select 7, 'latest migration present: 0032 (classroom_lifecycle_events)',
  exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'classroom_lifecycle_events'), null
union all
select 8, 'info: teacher/admin accounts', null,
  (select count(*)::text from public.profiles where role in ('teacher', 'admin'))
order by n;
