-- KrunameClass — READ-ONLY pre-check before applying migration 0031
-- (supabase/migrations/0031_qr_submission_followups.sql).
--
-- Only SELECT. Paste the whole file into the Supabase SQL Editor and Run.
-- ok = true → fine, false → stop (do NOT apply 0031), null → information.
-- 0031 works with or without 0029 (notifications): without it, rows C1/C2
-- are not applicable and the notification fixes are skipped.

select n, check_name, result, ok
from (
  select 1 as n, 'A. 0029 notifications installed (optional)' as check_name,
         case when to_regclass('public.notifications') is null
              then 'absent — 0031 applies the audit part only; notification fixes skipped'
              else 'present — 0031 also applies the notification fixes' end as result,
         null::boolean as ok

  union all
  select 2, 'B. 0030 QR submissions installed',
         'events=' || (to_regclass('public.assignment_submission_events') is not null)::text
           || ', qr_record_submission=' || (to_regprocedure('public.qr_record_submission(public.assignments, uuid, text)') is not null)::text,
         to_regclass('public.assignment_submission_events') is not null
           and to_regprocedure('public.qr_record_submission(public.assignments, uuid, text)') is not null

  -- With 0029: 0031 replaces these two functions only if they are exactly
  -- the 0029 version (or already the 0031 version on a re-run).
  union all
  select 3, 'C1. notify_on_submission_change() (0029 only)',
         case when to_regclass('public.notifications') is null then 'not applicable (0029 absent)'
              else coalesce((select case md5(replace(prosrc, E'\r', ''))
                                      when '140eb10e9aded79620b5f431e4c13d74' then '0029 version'
                                      when 'db150fd803bab3afcad940364c5805e9' then '0031 version (re-run)'
                                      else 'DIFFERENT: ' || md5(replace(prosrc, E'\r', '')) end
                               from pg_proc where oid = to_regprocedure('public.notify_on_submission_change()')), '(missing)') end,
         case when to_regclass('public.notifications') is null then null
              else coalesce((select md5(replace(prosrc, E'\r', '')) in ('140eb10e9aded79620b5f431e4c13d74', 'db150fd803bab3afcad940364c5805e9')
                               from pg_proc where oid = to_regprocedure('public.notify_on_submission_change()')), false) end

  union all
  select 4, 'C2. refresh_my_deadline_notifications() (0029 only)',
         case when to_regclass('public.notifications') is null then 'not applicable (0029 absent)'
              else coalesce((select case md5(replace(prosrc, E'\r', ''))
                                      when 'c1dd810e2fd4efc39e76afb0b1fee702' then '0029 version'
                                      when '1cec379e915c997753885d81ce4ff563' then '0031 version (re-run)'
                                      else 'DIFFERENT: ' || md5(replace(prosrc, E'\r', '')) end
                               from pg_proc where oid = to_regprocedure('public.refresh_my_deadline_notifications()')), '(missing)') end,
         case when to_regclass('public.notifications') is null then null
              else coalesce((select md5(replace(prosrc, E'\r', '')) in ('c1dd810e2fd4efc39e76afb0b1fee702', '1cec379e915c997753885d81ce4ff563')
                               from pg_proc where oid = to_regprocedure('public.refresh_my_deadline_notifications()')), false) end

  union all
  select 5, 'D. Event type constraint (replaced by 0031)',
         coalesce((select pg_get_constraintdef(c.oid) from pg_constraint c
                    where c.conrelid = to_regclass('public.assignment_submission_events')
                      and c.conname = 'assignment_submission_events_event_type_check'), '(missing)'),
         exists (select 1 from pg_constraint c
                  where c.conrelid = to_regclass('public.assignment_submission_events')
                    and c.conname = 'assignment_submission_events_event_type_check')

  union all
  select 6, 'E. 0031 already applied? (re-running is safe)',
         case when exists (select 1 from pg_trigger where tgname = 'log_student_submission_after_excused_trigger')
              then 'yes — this would be a re-run' else 'no — first run' end,
         null

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
