-- KrunameClass — READ-ONLY post-check after applying migration 0032
-- (supabase/migrations/0032_classroom_archive_and_delete.sql).
--
-- Only SELECT. Paste the whole file into the Supabase SQL Editor and Run.
-- ok = true → fine, false → investigate (see 0032_rollback.sql), null → information.
-- P10 must be identical to 0032_precheck row N: the migration changes no data.

select n, check_name, result, ok
from (
  select 1 as n, 'P1. classrooms.archived_at / archived_by added' as check_name,
         (select string_agg(column_name || ':' || data_type, ', ' order by column_name) from information_schema.columns
           where table_schema = 'public' and table_name = 'classrooms' and column_name in ('archived_at', 'archived_by')) as result,
         (select count(*) from information_schema.columns
           where table_schema = 'public' and table_name = 'classrooms' and column_name in ('archived_at', 'archived_by')) = 2 as ok

  union all
  select 2, 'P2. Archive-state trigger installed',
         coalesce((select tgname from pg_trigger where tgrelid = 'public.classrooms'::regclass and tgname = 'classrooms_track_archive_state'), '(missing)'),
         exists (select 1 from pg_trigger where tgrelid = 'public.classrooms'::regclass and tgname = 'classrooms_track_archive_state')

  union all
  select 3, 'P3. Audit + file-queue tables exist with RLS enabled',
         'lifecycle_events rls=' || coalesce((select relrowsecurity::text from pg_class where oid = to_regclass('public.classroom_lifecycle_events')), 'missing')
           || ', file_cleanup_queue rls=' || coalesce((select relrowsecurity::text from pg_class where oid = to_regclass('public.classroom_file_cleanup_queue')), 'missing'),
         coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.classroom_lifecycle_events')), false)
           and coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.classroom_file_cleanup_queue')), false)

  union all
  select 4, 'P4. Clients can only SELECT the audit tables',
         coalesce((select string_agg(grantee || ':' || privilege_type, ', ' order by grantee, privilege_type)
                    from information_schema.role_table_grants
                   where table_schema = 'public' and table_name in ('classroom_lifecycle_events', 'classroom_file_cleanup_queue')
                     and grantee in ('anon', 'authenticated')), '(none)'),
         not exists (select 1 from information_schema.role_table_grants
                      where table_schema = 'public' and table_name in ('classroom_lifecycle_events', 'classroom_file_cleanup_queue')
                        and grantee in ('anon', 'authenticated') and privilege_type <> 'SELECT')
           and not exists (select 1 from information_schema.role_table_grants
                      where table_schema = 'public' and table_name in ('classroom_lifecycle_events', 'classroom_file_cleanup_queue')
                        and grantee = 'anon')

  union all
  select 5, 'P5. Public RPCs: SECURITY DEFINER, authenticated yes, anon no',
         (select string_agg(f || ' definer=' || coalesce((select prosecdef::text from pg_proc where oid = to_regprocedure(f)), 'missing')
                  || ' auth=' || coalesce(has_function_privilege('authenticated', to_regprocedure(f), 'execute')::text, '-')
                  || ' anon=' || coalesce(has_function_privilege('anon', to_regprocedure(f), 'execute')::text, '-'), '; ')
            from unnest(array['public.set_classroom_archived(uuid, boolean)', 'public.get_classroom_deletion_preview(uuid)',
                              'public.delete_classroom_permanently(uuid, text, text)']) as f),
         (select bool_and(to_regprocedure(f) is not null
                          and (select prosecdef from pg_proc where oid = to_regprocedure(f))
                          and has_function_privilege('authenticated', to_regprocedure(f), 'execute')
                          and not has_function_privilege('anon', to_regprocedure(f), 'execute'))
            from unnest(array['public.set_classroom_archived(uuid, boolean)', 'public.get_classroom_deletion_preview(uuid)',
                              'public.delete_classroom_permanently(uuid, text, text)']) as f)

  union all
  select 6, 'P6. Internal helpers not callable by clients',
         (select string_agg(f || ' auth=' || coalesce(has_function_privilege('authenticated', to_regprocedure(f), 'execute')::text, 'missing'), '; ')
            from unnest(array['public.classroom_lifecycle_authorize(public.classrooms)', 'public.classroom_deletion_counts(uuid)',
                              'public.classroom_deletion_fingerprint(public.classrooms, jsonb)',
                              'public.classroom_deletion_blockers(public.classrooms, jsonb)']) as f),
         (select bool_and(to_regprocedure(f) is not null
                          and not has_function_privilege('authenticated', to_regprocedure(f), 'execute')
                          and not has_function_privilege('anon', to_regprocedure(f), 'execute'))
            from unnest(array['public.classroom_lifecycle_authorize(public.classrooms)', 'public.classroom_deletion_counts(uuid)',
                              'public.classroom_deletion_fingerprint(public.classrooms, jsonb)',
                              'public.classroom_deletion_blockers(public.classrooms, jsonb)']) as f)

  union all
  select 7, 'P7. Raw delete policy classrooms_delete_own removed',
         coalesce((select string_agg(policyname, ', ') from pg_policies where tablename = 'classrooms' and cmd = 'DELETE'), '(no DELETE policy)'),
         not exists (select 1 from pg_policies where tablename = 'classrooms' and cmd = 'DELETE')

  union all
  select 8, 'P8. Other classroom policies unchanged (select/insert/update)',
         (select string_agg(policyname, ', ' order by policyname) from pg_policies where tablename = 'classrooms'),
         (select count(*) from pg_policies where tablename = 'classrooms'
           and policyname in ('classrooms_select_own', 'classrooms_select_via_membership', 'classrooms_insert_own', 'classrooms_update_own')) = 4

  union all
  select 9, 'P9. First application only: no lifecycle events / queue rows (the migration archives and deletes nothing)',
         'events=' || (select count(*) from public.classroom_lifecycle_events)
           || ', queue=' || (select count(*) from public.classroom_file_cleanup_queue)
           || ', archived_at set=' || (select count(*) from public.classrooms where archived_at is not null),
         (select count(*) from public.classroom_lifecycle_events) = 0
           and (select count(*) from public.classroom_file_cleanup_queue) = 0
           and (select count(*) from public.classrooms where archived_at is not null) = 0

  union all
  select 10, 'P10. Baseline counts (must equal 0032_precheck N)',
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
