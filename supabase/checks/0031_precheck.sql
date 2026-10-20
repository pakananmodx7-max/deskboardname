-- KrunameClass — READ-ONLY pre-check before applying migration 0031
-- (supabase/migrations/0031_qr_submission_followups.sql).
--
-- Only SELECT. Paste the whole file into the Supabase SQL Editor and Run.
-- ok = true → fine, false → stop (do NOT apply 0031), null → information.

select n, check_name, result, ok
from (
  select 1 as n, 'A. 0029 notifications installed' as check_name,
         'notifications=' || (to_regclass('public.notifications') is not null)::text as result,
         to_regclass('public.notifications') is not null as ok

  union all
  select 2, 'B. 0030 QR submissions installed',
         'events=' || (to_regclass('public.assignment_submission_events') is not null)::text
           || ', record_submission_scan=' || (to_regprocedure('public.record_submission_scan(uuid, text)') is not null)::text,
         to_regclass('public.assignment_submission_events') is not null
           and to_regprocedure('public.record_submission_scan(uuid, text)') is not null

  -- 0031 replaces these two 0029 functions with copies + small edits. The
  -- installed source must be exactly the 0029 version (no local hotfix
  -- that 0031 would overwrite).
  union all
  select 3, 'C1. notify_on_submission_change() is the 0029 version',
         coalesce((select md5(replace(prosrc, E'\r', '')) from pg_proc where oid = to_regprocedure('public.notify_on_submission_change()')), '(missing)'),
         (select md5(replace(prosrc, E'\r', '')) from pg_proc where oid = to_regprocedure('public.notify_on_submission_change()')) is not distinct from '140eb10e9aded79620b5f431e4c13d74'

  union all
  select 4, 'C2. refresh_my_deadline_notifications() is the 0029 version',
         coalesce((select md5(replace(prosrc, E'\r', '')) from pg_proc where oid = to_regprocedure('public.refresh_my_deadline_notifications()')), '(missing)'),
         (select md5(replace(prosrc, E'\r', '')) from pg_proc where oid = to_regprocedure('public.refresh_my_deadline_notifications()')) is not distinct from 'c1dd810e2fd4efc39e76afb0b1fee702'

  union all
  select 5, 'D. Event type constraint (replaced by 0031)',
         coalesce((select pg_get_constraintdef(c.oid) from pg_constraint c
                    where c.conrelid = to_regclass('public.assignment_submission_events')
                      and c.conname = 'assignment_submission_events_event_type_check'), '(missing)'),
         exists (select 1 from pg_constraint c
                  where c.conrelid = to_regclass('public.assignment_submission_events')
                    and c.conname = 'assignment_submission_events_event_type_check')

  union all
  select 6, 'E. 0031 not applied yet',
         'trigger=' || exists (select 1 from pg_trigger where tgname = 'log_student_submission_after_excused_trigger')::text
           || ', function=' || (to_regprocedure('public.log_student_submission_after_excused()') is not null)::text,
         not exists (select 1 from pg_trigger where tgname = 'log_student_submission_after_excused_trigger')
           and to_regprocedure('public.log_student_submission_after_excused()') is null

  union all
  select 7, 'F. Baseline counts (write down; unchanged after 0031)',
         'students=' || (select count(*) from public.students)
           || ', active_qr=' || (select count(*) from public.student_qr_identities where status = 'active')
           || ', assignments=' || (select count(*) from public.assignments)
           || ', submissions=' || (select count(*) from public.assignment_submissions)
           || ', scored=' || (select count(*) from public.assignment_submissions where score is not null)
           || ', score_sum=' || (select coalesce(sum(score), 0) from public.assignment_submissions)
           || ', excused=' || (select count(*) from public.assignment_submissions where status = 'excused')
           || ', events=' || (select count(*) from public.assignment_submission_events),
         null

  union all
  select 8, 'G. Transactions open > 1 minute',
         (select coalesce(string_agg(pid::text || ' ' || coalesce(state, '?'), ', '), '(none)')
            from pg_stat_activity
           where datname = current_database() and pid <> pg_backend_pid()
             and xact_start is not null and now() - xact_start > interval '1 minute'),
         not exists (select 1 from pg_stat_activity
                      where datname = current_database() and pid <> pg_backend_pid()
                        and xact_start is not null and now() - xact_start > interval '1 minute')
) checks
order by n;
