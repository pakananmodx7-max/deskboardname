-- KrunameClass — READ-ONLY post-check after migration 0030.
-- Only SELECT. Paste the whole file into the Supabase SQL Editor and Run.
-- ok = true → fine, false → stop and report the row, null → information.

select n, check_name, result, ok
from (
  select 1 as n, 'P1. qr_student_summary is the avatar-safe version' as check_name,
         case when position('to_jsonb(s)' in pg_get_functiondef('public.qr_student_summary(uuid)'::regprocedure)) > 0
              then 'to_jsonb(s) -> avatar_path' else 'OLD VERSION (s.avatar_path)' end as result,
         position('to_jsonb(s)' in pg_get_functiondef('public.qr_student_summary(uuid)'::regprocedure)) > 0 as ok

  union all
  select 2, 'P2. 5 RPCs callable by signed-in users',
         (select string_agg(f || '=' || has_function_privilege('authenticated', f, 'execute')::text, ', ')
            from unnest(array['public.record_submission_scan(uuid, text)', 'public.record_submission_manual(uuid, uuid)',
                              'public.correct_submission_status(uuid, uuid, text, text)', 'public.get_classroom_student_qr_codes(uuid)',
                              'public.regenerate_student_qr_code(uuid, uuid)']) as f),
         (select bool_and(has_function_privilege('authenticated', f, 'execute'))
            from unnest(array['public.record_submission_scan(uuid, text)', 'public.record_submission_manual(uuid, uuid)',
                              'public.correct_submission_status(uuid, uuid, text, text)', 'public.get_classroom_student_qr_codes(uuid)',
                              'public.regenerate_student_qr_code(uuid, uuid)']) as f)

  union all
  select 3, 'P3. Nothing callable by anon (logged out)',
         (select coalesce(string_agg(p.oid::regprocedure::text, ', '), '(none)')
            from pg_proc p join pg_namespace s on s.oid = p.pronamespace
           where s.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute') and p.proname in (
             'record_submission_scan','record_submission_manual','correct_submission_status','get_classroom_student_qr_codes',
             'regenerate_student_qr_code','qr_record_submission','issue_student_qr_identity','qr_require_assignment',
             'qr_require_teacher','qr_student_summary','generate_student_qr_token','qr_actor_profile_id')),
         not exists (select 1 from pg_proc p join pg_namespace s on s.oid = p.pronamespace
                      where s.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute') and p.proname in (
                        'record_submission_scan','record_submission_manual','correct_submission_status','get_classroom_student_qr_codes',
                        'regenerate_student_qr_code','qr_record_submission','issue_student_qr_identity','qr_require_assignment',
                        'qr_require_teacher','qr_student_summary','generate_student_qr_token','qr_actor_profile_id'))

  union all
  select 4, 'P4. Internal helpers closed to signed-in users',
         (select coalesce(string_agg(p.oid::regprocedure::text, ', '), '(none)')
            from pg_proc p join pg_namespace s on s.oid = p.pronamespace
           where s.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'execute') and p.proname in (
             'qr_record_submission','issue_student_qr_identity','qr_require_assignment','qr_require_teacher',
             'qr_student_summary','generate_student_qr_token','qr_actor_profile_id')),
         not exists (select 1 from pg_proc p join pg_namespace s on s.oid = p.pronamespace
                      where s.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'execute') and p.proname in (
                        'qr_record_submission','issue_student_qr_identity','qr_require_assignment','qr_require_teacher',
                        'qr_student_summary','generate_student_qr_token','qr_actor_profile_id'))

  union all
  select 5, 'P5. QR tokens not readable directly by clients',
         'authenticated select=' || has_table_privilege('authenticated', 'public.student_qr_identities', 'select')::text
           || ', anon select=' || has_table_privilege('anon', 'public.student_qr_identities', 'select')::text,
         not has_table_privilege('authenticated', 'public.student_qr_identities', 'select')
           and not has_table_privilege('anon', 'public.student_qr_identities', 'select')

  union all
  select 6, 'P6. RLS on + policies (qr: 0, events: 1)',
         (select string_agg(c.relname || ' rls=' || c.relrowsecurity::text || ' policies='
                   || (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname), ', ' order by c.relname)
            from pg_class c join pg_namespace s on s.oid = c.relnamespace
           where s.nspname = 'public' and c.relname in ('student_qr_identities', 'assignment_submission_events')),
         (select bool_and(c.relrowsecurity
                   and (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname)
                       = case c.relname when 'student_qr_identities' then 0 else 1 end)
              and count(*) = 2
            from pg_class c join pg_namespace s on s.oid = c.relnamespace
           where s.nspname = 'public' and c.relname in ('student_qr_identities', 'assignment_submission_events'))

  union all
  select 7, 'P7. Triggers installed',
         (select coalesce(string_agg(t.tgname, ', ' order by t.tgname), '(none)') from pg_trigger t
           where not t.tgisinternal and t.tgname in ('students_issue_qr_identity_trigger', 'enforce_submission_teacher_only_fields_trigger')),
         (select count(*) = 2 from pg_trigger t
           where not t.tgisinternal and t.tgname in ('students_issue_qr_identity_trigger', 'enforce_submission_teacher_only_fields_trigger'))

  union all
  select 8, 'P8. Every student has exactly one active QR',
         'students=' || (select count(*) from public.students)
           || ', active_qr=' || (select count(*) from public.student_qr_identities where status = 'active')
           || ', without_qr=' || (select count(*) from public.students s
                                   where not exists (select 1 from public.student_qr_identities q where q.student_id = s.id and q.status = 'active')),
         (select count(*) from public.students)
           = (select count(*) from public.student_qr_identities where status = 'active')
           and not exists (select 1 from public.students s
                            where not exists (select 1 from public.student_qr_identities q where q.student_id = s.id and q.status = 'active'))

  union all
  select 9, 'P9. Status constraint allows excused',
         (select pg_get_constraintdef(c.oid) from pg_constraint c
           where c.conrelid = 'public.assignment_submissions'::regclass and c.conname = 'assignment_submissions_status_check'),
         (select pg_get_constraintdef(c.oid) like '%excused%' from pg_constraint c
           where c.conrelid = 'public.assignment_submissions'::regclass and c.conname = 'assignment_submissions_status_check')

  union all
  select 10, 'P10. Assignments open, late accepted (defaults)',
         'assignments=' || (select count(*) from public.assignments)
           || ', accepting=' || (select count(*) from public.assignments where accepting_submissions)
           || ', accept_late=' || (select count(*) from public.assignments where late_policy = 'accept_late')
           || ', with_deadline=' || (select count(*) from public.assignments where submission_deadline is not null),
         null

  union all
  select 11, 'P11. Baseline counts (must equal pre-check H)',
         'students=' || (select count(*) from public.students)
           || ', assignments=' || (select count(*) from public.assignments)
           || ', submissions=' || (select count(*) from public.assignment_submissions)
           || ', scored=' || (select count(*) from public.assignment_submissions where score is not null)
           || ', score_sum=' || (select coalesce(sum(score), 0) from public.assignment_submissions),
         null

  union all
  select 12, 'P12. Optional features present',
         'notifications(0029)=' || (to_regclass('public.notifications') is not null)::text
           || ', students.avatar_path(0012)=' || exists (select 1 from information_schema.columns
                                                      where table_schema = 'public' and table_name = 'students' and column_name = 'avatar_path')::text,
         null
) checks
order by n;
