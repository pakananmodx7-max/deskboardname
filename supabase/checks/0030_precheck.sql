-- KrunameClass — READ-ONLY pre-check before applying migration 0030
-- (supabase/migrations/0030_student_qr_submissions.sql).
--
-- Only SELECT. Changes nothing. Paste the whole file into the Supabase SQL
-- Editor and press Run: it returns ONE result table (the SQL Editor only
-- shows the result of the last statement, so every check is in one query).
--
-- Columns: check_name | result | expected | ok
--   ok = true  → fine
--   ok = false → stop, do NOT apply 0030, send the row to the developer
--   ok = null  → information only (write it down: compare after 0030)

select n, check_name, result, expected, ok
from (
  -- A. Postgres version (gen_random_uuid() is built in from 13).
  select 1 as n,
         'A. Postgres version' as check_name,
         current_setting('server_version') as result,
         '>= 13' as expected,
         current_setting('server_version_num')::int >= 130000 as ok

  -- B. Prerequisites from migrations 0001–0029.
  union all
  select 2, 'B1. Required tables',
         (select string_agg(t || '=' || (to_regclass('public.' || t) is not null)::text, ', ')
            from unnest(array['students','classroom_students','classrooms','subjects','assignments','assignment_submissions','profiles']) as t),
         'all true',
         (select bool_and(to_regclass('public.' || t) is not null)
            from unnest(array['students','classroom_students','classrooms','subjects','assignments','assignment_submissions','profiles']) as t)

  union all
  select 3, 'B2. Required functions',
         (select string_agg(f || '=' || exists (select 1 from pg_proc p join pg_namespace s on s.oid = p.pronamespace
                                                 where s.nspname = 'public' and p.proname = f)::text, ', ')
            from unnest(array['my_student_id','set_updated_at','check_submission_score_within_max','enforce_submission_field_ownership']) as f),
         'all true',
         (select bool_and(exists (select 1 from pg_proc p join pg_namespace s on s.oid = p.pronamespace
                                   where s.nspname = 'public' and p.proname = f))
            from unnest(array['my_student_id','set_updated_at','check_submission_score_within_max','enforce_submission_field_ownership']) as f)

  union all
  select 4, 'B3. Columns from 0016',
         (select coalesce(string_agg(table_name || '.' || column_name, ', ' order by column_name), '(none)')
            from information_schema.columns
           where table_schema = 'public' and table_name = 'assignment_submissions' and column_name in ('submitted_at', 'reviewed_at')),
         'assignment_submissions.reviewed_at, assignment_submissions.submitted_at (2)',
         (select count(*) = 2
            from information_schema.columns
           where table_schema = 'public' and table_name = 'assignment_submissions' and column_name in ('submitted_at', 'reviewed_at'))

  -- Optional (0012). 0030 works without it; the scanner then shows initials
  -- instead of a student photo.
  union all
  select 15, 'B4. students.avatar_path (0012, optional)',
         case when exists (select 1 from information_schema.columns
                            where table_schema = 'public' and table_name = 'students' and column_name = 'avatar_path')
              then 'present' else 'absent — scanner shows initials' end,
         'information (not required)',
         null

  -- C. Nothing from 0030 exists yet.
  union all
  select 5, 'C1. 0030 tables not present yet',
         'student_qr_identities=' || (to_regclass('public.student_qr_identities') is not null)::text
           || ', assignment_submission_events=' || (to_regclass('public.assignment_submission_events') is not null)::text,
         'both false',
         to_regclass('public.student_qr_identities') is null and to_regclass('public.assignment_submission_events') is null

  union all
  select 6, 'C2. 0030 columns not present yet',
         (select coalesce(string_agg(table_name || '.' || column_name, ', '), '(none)')
            from information_schema.columns
           where table_schema = 'public'
             and ((table_name = 'assignments' and column_name in ('submission_deadline', 'late_policy', 'accepting_submissions'))
               or (table_name = 'assignment_submissions' and column_name in ('recorded_via', 'recorded_by')))),
         '(none)',
         not exists (select 1 from information_schema.columns
                      where table_schema = 'public'
                        and ((table_name = 'assignments' and column_name in ('submission_deadline', 'late_policy', 'accepting_submissions'))
                          or (table_name = 'assignment_submissions' and column_name in ('recorded_via', 'recorded_by'))))

  union all
  select 7, 'C3. 0030 functions not present yet',
         (select coalesce(string_agg(p.proname, ', '), '(none)')
            from pg_proc p join pg_namespace s on s.oid = p.pronamespace
           where s.nspname = 'public' and p.proname in (
             'generate_student_qr_token','qr_actor_profile_id','issue_student_qr_identity','students_issue_qr_identity',
             'qr_require_teacher','qr_require_assignment','get_classroom_student_qr_codes','regenerate_student_qr_code',
             'assignment_effective_deadline','enforce_submission_teacher_only_fields','qr_student_summary',
             'qr_submission_summary','qr_record_submission','record_submission_scan','record_submission_manual','correct_submission_status')),
         '(none)',
         not exists (select 1 from pg_proc p join pg_namespace s on s.oid = p.pronamespace
                      where s.nspname = 'public' and p.proname in (
                        'generate_student_qr_token','qr_actor_profile_id','issue_student_qr_identity','students_issue_qr_identity',
                        'qr_require_teacher','qr_require_assignment','get_classroom_student_qr_codes','regenerate_student_qr_code',
                        'assignment_effective_deadline','enforce_submission_teacher_only_fields','qr_student_summary',
                        'qr_submission_summary','qr_record_submission','record_submission_scan','record_submission_manual','correct_submission_status'))

  union all
  select 8, 'C4. 0030 triggers / constraints not present yet',
         (select coalesce(string_agg(name, ', '), '(none)') from (
            select t.tgname::text as name from pg_trigger t
             where not t.tgisinternal and t.tgname in ('students_issue_qr_identity_trigger', 'enforce_submission_teacher_only_fields_trigger')
            union all
            select c.conname::text from pg_constraint c
             where c.conname in ('assignments_late_policy_check', 'assignment_submissions_recorded_via_check')) x),
         '(none)',
         not exists (select 1 from pg_trigger t
                      where not t.tgisinternal and t.tgname in ('students_issue_qr_identity_trigger', 'enforce_submission_teacher_only_fields_trigger'))
           and not exists (select 1 from pg_constraint c
                            where c.conname in ('assignments_late_policy_check', 'assignment_submissions_recorded_via_check'))

  -- D. The status CHECK constraint 0030 replaces.
  union all
  select 9, 'D. Current status constraint',
         (select coalesce(string_agg(pg_get_constraintdef(c.oid), ' | '), '(missing)')
            from pg_constraint c
           where c.conrelid = to_regclass('public.assignment_submissions') and c.conname = 'assignment_submissions_status_check'),
         'exactly 1: not_submitted, submitted, late, missing',
         (select count(*) = 1 and bool_and(pg_get_constraintdef(c.oid) not like '%excused%')
            from pg_constraint c
           where c.conrelid = to_regclass('public.assignment_submissions') and c.conname = 'assignment_submissions_status_check')

  -- E. Existing data fits the new constraint.
  union all
  select 10, 'E. Submission statuses in use',
         (select coalesce(string_agg(status || '=' || cnt, ', ' order by status), '(no rows)')
            from (select status, count(*)::text as cnt from public.assignment_submissions group by status) s),
         'only not_submitted / submitted / late / missing',
         not exists (select 1 from public.assignment_submissions
                      where status not in ('not_submitted', 'submitted', 'late', 'missing'))

  -- F. Triggers already on the two tables 0030 adds triggers to.
  union all
  select 11, 'F. Existing triggers (students, assignment_submissions)',
         (select coalesce(string_agg(c.relname || '.' || t.tgname, ', ' order by c.relname, t.tgname), '(none)')
            from pg_trigger t join pg_class c on c.oid = t.tgrelid
           where c.oid in (to_regclass('public.students'), to_regclass('public.assignment_submissions')) and not t.tgisinternal),
         'information',
         null

  -- G. Views that depend on the changed tables.
  union all
  select 12, 'G. Dependent views',
         (select coalesce(string_agg(distinct v.oid::regclass::text, ', '), '(none)')
            from pg_depend d
            join pg_rewrite r on r.oid = d.objid
            join pg_class v on v.oid = r.ev_class
           where d.refobjid in (to_regclass('public.assignments'), to_regclass('public.assignment_submissions'), to_regclass('public.students'))
             and v.oid not in (to_regclass('public.assignments'), to_regclass('public.assignment_submissions'), to_regclass('public.students'))),
         '(none)',
         not exists (select 1
                       from pg_depend d
                       join pg_rewrite r on r.oid = d.objid
                       join pg_class v on v.oid = r.ev_class
                      where d.refobjid in (to_regclass('public.assignments'), to_regclass('public.assignment_submissions'), to_regclass('public.students'))
                        and v.oid not in (to_regclass('public.assignments'), to_regclass('public.assignment_submissions'), to_regclass('public.students')))

  -- H. Baseline counts — write these down; after 0030 they must be identical.
  union all
  select 13, 'H. Baseline counts (write down)',
         'students=' || (select count(*) from public.students)
           || ', assignments=' || (select count(*) from public.assignments)
           || ', submissions=' || (select count(*) from public.assignment_submissions)
           || ', scored=' || (select count(*) from public.assignment_submissions where score is not null)
           || ', score_sum=' || (select coalesce(sum(score), 0) from public.assignment_submissions),
         'information (compare after 0030)',
         null

  -- I. Long-running transactions that could block the migration's locks.
  union all
  select 14, 'I. Transactions open > 1 minute',
         (select coalesce(string_agg(pid::text || ' ' || coalesce(state, '?') || ' ' || date_trunc('second', now() - xact_start)::text, ', '), '(none)')
            from pg_stat_activity
           where datname = current_database() and pid <> pg_backend_pid()
             and xact_start is not null and now() - xact_start > interval '1 minute'),
         '(none)',
         not exists (select 1 from pg_stat_activity
                      where datname = current_database() and pid <> pg_backend_pid()
                        and xact_start is not null and now() - xact_start > interval '1 minute')
) checks
order by n;
