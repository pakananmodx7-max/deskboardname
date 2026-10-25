-- KrunameClass — READ-ONLY check: why might the teacher bell not update live?
-- Paste into the Supabase SQL Editor and Run. Only SELECTs; changes nothing.
-- ok = true → fine; false → see the "fix" column (needs the owner's approval).

select n, check_name, result, ok, fix
from (
  select 1 as n, 'notifications table (0029) installed' as check_name,
         coalesce(to_regclass('public.notifications')::text, '(missing)') as result,
         to_regclass('public.notifications') is not null as ok,
         'Run supabase/migrations/0029_notifications.sql (see docs/NOTIFICATIONS.md)' as fix
  union all
  select 2, 'notifications is in the supabase_realtime publication',
         (select string_agg(schemaname || '.' || tablename, ', ') from pg_publication_tables
           where pubname = 'supabase_realtime' and tablename = 'notifications'),
         exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'),
         'alter publication supabase_realtime add table public.notifications;  (or Database → Publications → supabase_realtime)'
  union all
  select 3, 'link-request trigger present',
         (select string_agg(tgname, ', ') from pg_trigger where tgname = 'notify_on_link_request_change' and not tgisinternal),
         exists (select 1 from pg_trigger where tgname = 'notify_on_link_request_change' and not tgisinternal),
         'Re-run supabase/migrations/0029_notifications.sql'
  union all
  select 4, 'own-rows SELECT policy (Realtime uses it to authorise events)',
         (select string_agg(policyname, ', ') from pg_policies where schemaname = 'public' and tablename = 'notifications'),
         exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'notifications' and policyname = 'notifications_select_own'),
         'Re-run supabase/migrations/0029_notifications.sql'
  union all
  select 5, 'RLS enabled on notifications',
         (select relrowsecurity::text from pg_class where oid = to_regclass('public.notifications')),
         coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.notifications')), false),
         'Re-run supabase/migrations/0029_notifications.sql'
  union all
  select 6, 'authenticated can SELECT notifications',
         case when to_regclass('public.notifications') is null then '(no table)'
              else has_table_privilege('authenticated', 'public.notifications', 'SELECT')::text end,
         to_regclass('public.notifications') is not null and has_table_privilege('authenticated', 'public.notifications', 'SELECT'),
         'grant select on public.notifications to authenticated;'
  union all
  select 7, 'pending link requests vs. their teacher notifications (information)',
         case when to_regclass('public.notifications') is null then '(no table)' else
           (select count(*) from public.student_account_link_requests where status = 'pending')::text || ' pending requests, '
           -- evaluated dynamically so the query still runs where 0029 is missing
           || (xpath('/row/c/text()', query_to_xml('select count(*) as c from public.notifications where notification_type = ''link_request''', false, true, '')))[1]::text
           || ' link_request notifications' end,
         null, 'If requests exist but no notifications: the trigger is missing or failing'
) checks
order by n;
