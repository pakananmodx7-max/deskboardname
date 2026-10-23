-- KrunameClass — READ-ONLY pre-check before applying migration 0032
-- (supabase/migrations/0032_classroom_archive_and_delete.sql).
--
-- Only SELECT. Paste the whole file into the Supabase SQL Editor and Run.
-- ok = true → fine, false → stop (do NOT apply 0032), null → information.
-- Works with or without 0012/0029 (production has neither).
-- Keep the output: row N (baseline) must be identical in 0032_postcheck.sql.

with expected_fk(child, col, parent, deltype) as (
  values
    -- every FK that points at classrooms (all must cascade, none other may exist)
    ('classroom_students', 'classroom_id', 'classrooms', 'c'),
    ('subject_classrooms', 'classroom_id', 'classrooms', 'c'),
    ('attendance_sessions', 'classroom_id', 'classrooms', 'c'),
    ('assignments', 'classroom_id', 'classrooms', 'c'),
    ('lessons', 'classroom_id', 'classrooms', 'c'),
    ('sgs_score_columns', 'classroom_id', 'classrooms', 'c'),
    ('student_followup_notes', 'classroom_id', 'classrooms', 'c'),
    -- second level of the cascade
    ('attendance_records', 'attendance_session_id', 'attendance_sessions', 'c'),
    ('assignment_resources', 'assignment_id', 'assignments', 'c'),
    ('assignment_submissions', 'assignment_id', 'assignments', 'c'),
    ('assignment_submission_events', 'assignment_id', 'assignments', 'c'),
    ('assignment_submission_resources', 'assignment_submission_id', 'assignment_submissions', 'c'),
    ('lesson_resources', 'lesson_id', 'lessons', 'c'),
    ('sgs_scores', 'column_id', 'sgs_score_columns', 'c'),
    -- students are protected: records referencing them RESTRICT, so a
    -- cascade can never reach a student row
    ('attendance_records', 'student_id', 'students', 'r'),
    ('assignment_submissions', 'student_id', 'students', 'r'),
    ('sgs_scores', 'student_id', 'students', 'r'),
    ('student_followup_notes', 'student_id', 'students', 'r')
),
actual_fk as (
  select cl.relname as child, a.attname as col, pl.relname as parent, c.confdeltype::text as deltype
  from pg_constraint c
  join pg_class cl on cl.oid = c.conrelid
  join pg_namespace n on n.oid = cl.relnamespace and n.nspname = 'public'
  join pg_class pl on pl.oid = c.confrelid
  join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
  where c.contype = 'f'
)
select n, check_name, result, ok
from (
  select 1 as n, 'A. 0030 QR identities + submission events installed' as check_name,
         'student_qr_identities=' || (to_regclass('public.student_qr_identities') is not null)::text
           || ', assignment_submission_events=' || (to_regclass('public.assignment_submission_events') is not null)::text as result,
         to_regclass('public.student_qr_identities') is not null and to_regclass('public.assignment_submission_events') is not null as ok

  union all
  select 2, 'B. Optional migrations (information)',
         '0012 teacher_student_notifications=' || (to_regclass('public.teacher_student_notifications') is not null)::text
           || ', 0029 notifications=' || (to_regclass('public.notifications') is not null)::text
           || ', 0031 excused audit trigger=' || exists (select 1 from pg_trigger where tgname = 'log_student_submission_after_excused_trigger')::text,
         null

  union all
  select 3, 'C. Expected cascade/restrict FKs present (18)',
         (select count(*) from expected_fk e join actual_fk a using (child, col, parent, deltype))::text || ' of 18 match'
           || coalesce(' — missing/different: ' || (select string_agg(e.child || '.' || e.col, ', ') from expected_fk e
                where not exists (select 1 from actual_fk a where a.child = e.child and a.col = e.col and a.parent = e.parent and a.deltype = e.deltype)), ''),
         (select count(*) from expected_fk e join actual_fk a using (child, col, parent, deltype)) = 18

  union all
  select 4, 'D. No OTHER table references classrooms (nothing unexpected would be deleted)',
         coalesce((select string_agg(a.child || '.' || a.col || ' (' || a.deltype || ')', ', ') from actual_fk a
                    where a.parent = 'classrooms' and (a.child, a.col) not in (select child, col from expected_fk)), '(none)'),
         not exists (select 1 from actual_fk a where a.parent = 'classrooms' and (a.child, a.col) not in (select child, col from expected_fk))

  union all
  select 5, 'E. students / QR identities do not reference classrooms',
         coalesce((select string_agg(a.child || '.' || a.col, ', ') from actual_fk a
                    where a.child in ('students', 'student_qr_identities') and a.parent = 'classrooms'), '(none)'),
         not exists (select 1 from actual_fk a where a.child in ('students', 'student_qr_identities') and a.parent = 'classrooms')

  union all
  select 6, 'F. SGS delete guard allows cascades (pg_trigger_depth)',
         coalesce((select case when prosrc like '%pg_trigger_depth() <= 1%' then 'depth guard present' else 'DIFFERENT' end
                   from pg_proc where oid = to_regprocedure('public.prevent_nonempty_sgs_score_column_delete()')), '(missing)'),
         coalesce((select prosrc like '%pg_trigger_depth() <= 1%' from pg_proc where oid = to_regprocedure('public.prevent_nonempty_sgs_score_column_delete()')), false)

  union all
  select 7, 'G. profiles.role cannot be self-changed (admin check relies on it)',
         coalesce((select tgname from pg_trigger where tgname = 'protect_profiles_privileged_fields' and tgrelid = 'public.profiles'::regclass), '(missing)'),
         exists (select 1 from pg_trigger where tgname = 'protect_profiles_privileged_fields' and tgrelid = 'public.profiles'::regclass)

  union all
  select 8, 'H. Raw delete policy classrooms_delete_own (0032 drops it)',
         case when exists (select 1 from pg_policies where tablename = 'classrooms' and policyname = 'classrooms_delete_own')
              then 'present — will be dropped' else 'absent (0032 already applied?)' end,
         null

  union all
  select 9, 'I. Name conflicts (0 = clean; also fine if 0032 already applied)',
         'columns=' || (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'classrooms' and column_name in ('archived_at', 'archived_by'))
           || ', tables=' || ((to_regclass('public.classroom_lifecycle_events') is not null)::int + (to_regclass('public.classroom_file_cleanup_queue') is not null)::int)
           || ', functions=' || (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace and s.nspname = 'public'
                                  where p.proname in ('set_classroom_archived', 'get_classroom_deletion_preview', 'delete_classroom_permanently',
                                                      'classroom_lifecycle_authorize', 'classroom_deletion_counts', 'classroom_deletion_fingerprint',
                                                      'classroom_deletion_blockers', 'classrooms_track_archive_state')),
         -- either nothing exists yet, or everything does (re-run)
         (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'classrooms' and column_name in ('archived_at', 'archived_by')) in (0, 2)

  union all
  select 10, 'J. Trigger name free on classrooms',
         coalesce((select string_agg(tgname, ', ') from pg_trigger where tgrelid = 'public.classrooms'::regclass and not tgisinternal), '(none)'),
         not exists (select 1 from pg_trigger where tgrelid = 'public.classrooms'::regclass and not tgisinternal
                      and tgname not in ('set_classrooms_updated_at', 'classrooms_track_archive_state'))

  union all
  select 11, 'K. Classrooms (information)',
         'total=' || (select count(*) from public.classrooms)
           || ', active=' || (select count(*) from public.classrooms where is_active)
           || ', archived=' || (select count(*) from public.classrooms where not is_active),
         null

  union all
  select 12, 'L. Classrooms whose permanent delete would be BLOCKED (records under another teacher''s subject)',
         (select count(distinct c.id) from public.classrooms c
           where exists (select 1 from public.assignments x join public.subjects s on s.id = x.subject_id where x.classroom_id = c.id and s.teacher_id <> c.teacher_id)
              or exists (select 1 from public.lessons x join public.subjects s on s.id = x.subject_id where x.classroom_id = c.id and s.teacher_id <> c.teacher_id)
              or exists (select 1 from public.attendance_sessions x join public.subjects s on s.id = x.subject_id where x.classroom_id = c.id and s.teacher_id <> c.teacher_id)
              or exists (select 1 from public.sgs_score_columns x join public.subjects s on s.id = x.subject_id where x.classroom_id = c.id and s.teacher_id <> c.teacher_id)
              or exists (select 1 from public.student_followup_notes x join public.subjects s on s.id = x.subject_id where x.classroom_id = c.id and s.teacher_id <> c.teacher_id))::text,
         null

  union all
  select 13, 'M. Admin profiles (can archive/delete any classroom after 0032)',
         (select count(*) from public.profiles where role = 'admin')::text,
         null

  union all
  select 14, 'N. Baseline counts (must equal 0032_postcheck P10)',
         'classrooms=' || (select count(*) from public.classrooms)
           || ', archived=' || (select count(*) from public.classrooms where not is_active)
           || ', memberships=' || (select count(*) from public.classroom_students)
           || ', students=' || (select count(*) from public.students)
           || ', active_qr=' || (select count(*) from public.student_qr_identities where status = 'active')
           || ', assignments=' || (select count(*) from public.assignments)
           || ', submissions=' || (select count(*) from public.assignment_submissions)
           || ', scored=' || (select count(*) from public.assignment_submissions where score is not null)
           || ', score_sum=' || (select coalesce(sum(score), 0) from public.assignment_submissions)
           || ', att_sessions=' || (select count(*) from public.attendance_sessions)
           || ', att_records=' || (select count(*) from public.attendance_records)
           || ', sgs_scores=' || (select count(*) from public.sgs_scores),
         null
) checks
order by n;
