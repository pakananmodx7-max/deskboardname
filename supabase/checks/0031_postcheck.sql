-- KrunameClass — READ-ONLY post-check after migration 0031.
-- Only SELECT. Paste the whole file into the Supabase SQL Editor and Run.
-- ok = true → fine, false → stop and report the row, null → information.

select n, check_name, result, ok
from (
  select 1 as n, 'Q1. Audit trigger installed' as check_name,
         case when exists (select 1 from pg_trigger where tgname = 'log_student_submission_after_excused_trigger'
                             and tgrelid = 'public.assignment_submissions'::regclass)
              then 'log_student_submission_after_excused_trigger' else '(missing)' end as result,
         exists (select 1 from pg_trigger where tgname = 'log_student_submission_after_excused_trigger'
                   and tgrelid = 'public.assignment_submissions'::regclass) as ok

  union all
  select 2, 'Q2. Audit function not callable by clients',
         'authenticated=' || has_function_privilege('authenticated', 'public.log_student_submission_after_excused()', 'execute')::text
           || ', anon=' || has_function_privilege('anon', 'public.log_student_submission_after_excused()', 'execute')::text,
         not has_function_privilege('authenticated', 'public.log_student_submission_after_excused()', 'execute')
           and not has_function_privilege('anon', 'public.log_student_submission_after_excused()', 'execute')

  union all
  select 3, 'Q3. Event type allows student_submitted_after_excused',
         (select pg_get_constraintdef(c.oid) from pg_constraint c
           where c.conrelid = 'public.assignment_submission_events'::regclass
             and c.conname = 'assignment_submission_events_event_type_check'),
         coalesce((select pg_get_constraintdef(c.oid) like '%student_submitted_after_excused%' from pg_constraint c
                    where c.conrelid = 'public.assignment_submission_events'::regclass
                      and c.conname = 'assignment_submission_events_event_type_check'), false)

  -- Without 0029: 0031 must not have created these. With 0029: they must
  -- be the 0031 versions (if 0029 was installed after 0031, re-run 0031).
  union all
  select 4, 'Q4. notify_on_submission_change()',
         case when to_regclass('public.notifications') is null
              then case when to_regprocedure('public.notify_on_submission_change()') is null
                        then 'skipped (0029 absent)' else 'UNEXPECTED: exists without 0029' end
              else coalesce((select case md5(replace(prosrc, E'\r', ''))
                                      when 'db150fd803bab3afcad940364c5805e9' then '0031 version'
                                      when '140eb10e9aded79620b5f431e4c13d74' then '0029 version — re-run 0031'
                                      else 'DIFFERENT' end
                               from pg_proc where oid = to_regprocedure('public.notify_on_submission_change()')), '(missing)') end,
         case when to_regclass('public.notifications') is null
              then to_regprocedure('public.notify_on_submission_change()') is null
              else coalesce((select md5(replace(prosrc, E'\r', '')) = 'db150fd803bab3afcad940364c5805e9'
                               from pg_proc where oid = to_regprocedure('public.notify_on_submission_change()')), false) end

  union all
  select 5, 'Q5. refresh_my_deadline_notifications()',
         case when to_regclass('public.notifications') is null
              then case when to_regprocedure('public.refresh_my_deadline_notifications()') is null
                        then 'skipped (0029 absent)' else 'UNEXPECTED: exists without 0029' end
              else coalesce((select case md5(replace(prosrc, E'\r', ''))
                                      when '1cec379e915c997753885d81ce4ff563' then '0031 version'
                                      when 'c1dd810e2fd4efc39e76afb0b1fee702' then '0029 version — re-run 0031'
                                      else 'DIFFERENT' end
                               from pg_proc where oid = to_regprocedure('public.refresh_my_deadline_notifications()')), '(missing)') end,
         case when to_regclass('public.notifications') is null
              then to_regprocedure('public.refresh_my_deadline_notifications()') is null
              else coalesce((select md5(replace(prosrc, E'\r', '')) = '1cec379e915c997753885d81ce4ff563'
                               from pg_proc where oid = to_regprocedure('public.refresh_my_deadline_notifications()')), false) end

  -- 0030 unchanged by 0031.
  union all
  select 6, 'Q6. 0030 RPCs still callable by signed-in users, not by anon',
         (select count(*) filter (where has_function_privilege('authenticated', f, 'execute')) || '/5 authenticated, '
                 || count(*) filter (where has_function_privilege('anon', f, 'execute')) || '/5 anon'
            from unnest(array['public.record_submission_scan(uuid, text)', 'public.record_submission_manual(uuid, uuid)',
                              'public.correct_submission_status(uuid, uuid, text, text)', 'public.get_classroom_student_qr_codes(uuid)',
                              'public.regenerate_student_qr_code(uuid, uuid)']) as f),
         (select bool_and(has_function_privilege('authenticated', f, 'execute') and not has_function_privilege('anon', f, 'execute'))
            from unnest(array['public.record_submission_scan(uuid, text)', 'public.record_submission_manual(uuid, uuid)',
                              'public.correct_submission_status(uuid, uuid, text, text)', 'public.get_classroom_student_qr_codes(uuid)',
                              'public.regenerate_student_qr_code(uuid, uuid)']) as f)

  union all
  select 7, 'Q7. 0030 triggers still installed',
         (select coalesce(string_agg(t.tgname, ', ' order by t.tgname), '(none)') from pg_trigger t
           where not t.tgisinternal and t.tgname in ('students_issue_qr_identity_trigger', 'enforce_submission_teacher_only_fields_trigger')),
         (select count(*) = 2 from pg_trigger t
           where not t.tgisinternal and t.tgname in ('students_issue_qr_identity_trigger', 'enforce_submission_teacher_only_fields_trigger'))

  union all
  select 8, 'Q8. Every student has exactly one active QR',
         'students=' || (select count(*) from public.students)
           || ', active_qr=' || (select count(*) from public.student_qr_identities where status = 'active'),
         (select count(*) from public.students) = (select count(*) from public.student_qr_identities where status = 'active')

  union all
  select 9, 'Q9. Baseline counts (must equal pre-check F)',
         'students=' || (select count(*) from public.students)
           || ', active_qr=' || (select count(*) from public.student_qr_identities where status = 'active')
           || ', assignments=' || (select count(*) from public.assignments)
           || ', submissions=' || (select count(*) from public.assignment_submissions)
           || ', scored=' || (select count(*) from public.assignment_submissions where score is not null)
           || ', score_sum=' || (select coalesce(sum(score), 0) from public.assignment_submissions)
           || ', excused=' || (select count(*) from public.assignment_submissions where status = 'excused')
           || ', events=' || (select count(*) from public.assignment_submission_events),
         null
) checks
order by n;
