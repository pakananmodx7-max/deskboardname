-- Empirical verification for 0032_classroom_archive_and_delete.sql
--
-- DEV-ONLY verification script, never applied to any real database and
-- never run automatically. Run against a disposable local Postgres with
-- every migration through 0032 applied in order, using the auth shim
-- described in supabase/tests/0009_student_link_rpc_permissions.sql.
-- Works with or without 0012/0029 installed (production has neither).
-- Every check raises (and, with ON_ERROR_STOP, aborts) on a mismatch.
--
--   B1  archive by the owner: is_active=false, archived_at/by, audit row
--   B2  duplicate archive -> KC005, nothing changes
--   B3  restore, duplicate restore -> KC006
--   B4  another teacher / a student / no session / anon cannot archive,
--       preview or delete (42501 / 28000 / no EXECUTE)
--   B5  a raw DELETE FROM classrooms by the owner deletes nothing
--   B6  permanent delete of an ACTIVE classroom -> KC001
--   B7  empty classroom: wrong typed name -> KC002; correct -> deleted,
--       audit row survives
--   B8  full classroom: preview counts are exact
--   B9  stale confirmation (data added / classroom renamed after the
--       preview) -> KC003, nothing deleted
--   B10 database failure mid-delete -> everything rolled back (no audit
--       row, no queue rows, every record still present)
--   B11 successful delete of the full classroom: classroom-owned records
--       gone; students, QR identities, linked accounts, subjects, the
--       other classroom's data and every file object preserved; file
--       references queued with referenced_elsewhere computed
--   B12 classroom with records under ANOTHER teacher's subject -> blocked
--       (KC004) in preview and delete
--   B13 admin can archive/preview/delete another teacher's classroom;
--       audited as actor_role = 'admin'
--   B14 audit trail + file queue: readable by the owner only, not
--       writable by any client
--   B15 archived_at/archived_by cannot be forged through a direct update
--   B16 (only when 0029 is installed) notifications naming the deleted
--       classroom are removed, others kept

\set ON_ERROR_STOP 1

set role postgres;

create or replace function public.t_assert(p_label text, p_actual bigint, p_expected bigint)
returns void language plpgsql as $$
begin
  if p_actual is distinct from p_expected then
    raise exception 'TEST FAILED: % — expected %, got %', p_label, p_expected, p_actual;
  end if;
  raise notice 'ok  %  (= %)', p_label, p_actual;
end $$;
grant execute on function public.t_assert(text, bigint, bigint) to authenticated, anon;

-- Expects p_sql to raise SQLSTATE p_code; anything else fails the test.
create or replace function public.t_expect_error(p_label text, p_sql text, p_code text)
returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlstate = p_code then
      raise notice 'ok  % blocked with %: %', p_label, sqlstate, sqlerrm;
      return;
    end if;
    raise exception 'TEST FAILED: % — expected SQLSTATE %, got % (%)', p_label, p_code, sqlstate, sqlerrm;
  end;
  raise exception 'TEST FAILED: % — expected SQLSTATE %, but it succeeded', p_label, p_code;
end $$;
grant execute on function public.t_expect_error(text, text, text) to authenticated, anon;

-- ---------------------------------------------------------------------
-- Fixture
--   T1 owner of C1 (full), C2 (other classroom, shares a student), C0 (empty)
--   T2 another teacher (owns subject Y and classroom C9)
--   AD admin, ST student account linked to S1
-- ---------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data) values
  ('10000000-0000-0000-0000-0000000000a1', 't1@example.com', '{}', '{"krunameclass_allow_teacher":"true"}'),
  ('10000000-0000-0000-0000-0000000000a2', 't2@example.com', '{}', '{"krunameclass_allow_teacher":"true"}'),
  ('10000000-0000-0000-0000-0000000000ad', 'admin@example.com', '{}', '{"krunameclass_allow_teacher":"true"}'),
  ('10000000-0000-0000-0000-0000000000b1', 'st@example.com', '{"intended_role":"student"}', '{}');
update public.profiles set role = 'admin' where id = '10000000-0000-0000-0000-0000000000ad';

insert into public.classrooms (id, teacher_id, name) values
  ('20000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-0000000000a1', 'ม.5/1'),
  ('20000000-0000-0000-0000-0000000000c2', '10000000-0000-0000-0000-0000000000a1', 'ม.5/2'),
  ('20000000-0000-0000-0000-0000000000c0', '10000000-0000-0000-0000-0000000000a1', 'ห้องว่าง'),
  ('20000000-0000-0000-0000-0000000000c3', '10000000-0000-0000-0000-0000000000a1', 'ม.6/3'),
  ('20000000-0000-0000-0000-0000000000c9', '10000000-0000-0000-0000-0000000000a2', 'ห้องครูอื่น');

insert into public.students (id, created_by, first_name, last_name, linked_profile_id) values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-0000000000a1', 'สมชาย', 'เฉพาะห้องนี้', '10000000-0000-0000-0000-0000000000b1'),
  ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-0000000000a1', 'สมศรี', 'อยู่สองห้อง', null),
  ('30000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-0000000000a1', 'สมปอง', 'ห้องอื่น', null);
-- students_issue_qr_identity_trigger (0030) gave each student one active QR identity.

insert into public.classroom_students (classroom_id, student_id) values
  ('20000000-0000-0000-0000-0000000000c1', '30000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-0000000000c1', '30000000-0000-0000-0000-000000000002'),
  ('20000000-0000-0000-0000-0000000000c2', '30000000-0000-0000-0000-000000000002'),
  ('20000000-0000-0000-0000-0000000000c2', '30000000-0000-0000-0000-000000000003');

insert into public.subjects (id, teacher_id, name) values
  ('40000000-0000-0000-0000-0000000000d1', '10000000-0000-0000-0000-0000000000a1', 'คณิตศาสตร์'),
  ('40000000-0000-0000-0000-0000000000d2', '10000000-0000-0000-0000-0000000000a2', 'วิชาของครูอื่น');
insert into public.subject_classrooms (subject_id, classroom_id) values
  ('40000000-0000-0000-0000-0000000000d1', '20000000-0000-0000-0000-0000000000c1'),
  ('40000000-0000-0000-0000-0000000000d1', '20000000-0000-0000-0000-0000000000c2');

-- C1: assignment + submissions (one graded) + submission event + resources
insert into public.assignments (id, subject_id, classroom_id, title, max_score, created_by) values
  ('50000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000d1', '20000000-0000-0000-0000-0000000000c1', 'งาน C1', 10, '10000000-0000-0000-0000-0000000000a1'),
  ('50000000-0000-0000-0000-0000000000a2', '40000000-0000-0000-0000-0000000000d1', '20000000-0000-0000-0000-0000000000c2', 'งาน C2', 10, '10000000-0000-0000-0000-0000000000a1'),
  -- C3 holds a record under ANOTHER teacher's subject (inserted as postgres; RLS would refuse it)
  ('50000000-0000-0000-0000-0000000000a3', '40000000-0000-0000-0000-0000000000d2', '20000000-0000-0000-0000-0000000000c3', 'งานวิชาครูอื่น', 10, '10000000-0000-0000-0000-0000000000a2');
insert into public.assignment_submissions (id, assignment_id, student_id, status, score) values
  ('60000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-0000000000a1', '30000000-0000-0000-0000-000000000001', 'submitted', 9),
  ('60000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-0000000000a1', '30000000-0000-0000-0000-000000000002', 'missing', null),
  ('60000000-0000-0000-0000-000000000003', '50000000-0000-0000-0000-0000000000a2', '30000000-0000-0000-0000-000000000002', 'submitted', 7);
insert into public.assignment_submission_events (assignment_id, student_id, event_type, new_status) values
  ('50000000-0000-0000-0000-0000000000a1', '30000000-0000-0000-0000-000000000001', 'scan_recorded', 'submitted');
insert into public.assignment_resources (id, assignment_id, resource_type, title, file_path, url, drive_file_id) values
  ('a0000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-0000000000a1', 'file', 'ใบงาน.pdf', '10000000-0000-0000-0000-0000000000a1/40000000-0000-0000-0000-0000000000d1/20000000-0000-0000-0000-0000000000c1/50000000-0000-0000-0000-0000000000a1/sheet.pdf', null, null),
  ('a0000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-0000000000a1', 'link', 'สไลด์ Drive (ใช้ร่วม)', null, 'https://drive.google.com/file/d/SHARED/view', 'SHARED-DRIVE-ID'),
  ('a0000000-0000-0000-0000-000000000003', '50000000-0000-0000-0000-0000000000a2', 'link', 'สไลด์ Drive (ใช้ร่วม)', null, 'https://drive.google.com/file/d/SHARED/view', 'SHARED-DRIVE-ID');
insert into public.assignment_submission_resources (id, assignment_submission_id, resource_type, title, storage_path, original_filename, mime_type, file_size) values
  ('b0000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001', 'file', 'งานส่ง', 'sub/60000000-0000-0000-0000-000000000001/work.pdf', 'work.pdf', 'application/pdf', 100);

-- Attendance: C1 subject session + C1 homeroom session, and C2 (must survive)
insert into public.attendance_sessions (id, classroom_id, subject_id, attendance_date, created_by) values
  ('70000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-0000000000c1', '40000000-0000-0000-0000-0000000000d1', '2026-09-01', '10000000-0000-0000-0000-0000000000a1'),
  ('70000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-0000000000c1', null, '2026-09-02', '10000000-0000-0000-0000-0000000000a1'),
  ('70000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-0000000000c2', '40000000-0000-0000-0000-0000000000d1', '2026-09-01', '10000000-0000-0000-0000-0000000000a1');
insert into public.attendance_records (attendance_session_id, student_id, status) values
  ('70000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'present'),
  ('70000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', 'late'),
  ('70000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000001', 'absent'),
  ('70000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000002', 'present'),
  ('70000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000003', 'present');

-- Lessons: C1 (file + unique Drive file), C2 (must survive)
insert into public.lessons (id, subject_id, classroom_id, title, created_by) values
  ('80000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-0000000000d1', '20000000-0000-0000-0000-0000000000c1', 'บทเรียน C1', '10000000-0000-0000-0000-0000000000a1'),
  ('80000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-0000000000d1', '20000000-0000-0000-0000-0000000000c2', 'บทเรียน C2', '10000000-0000-0000-0000-0000000000a1');
insert into public.lesson_resources (id, lesson_id, resource_type, title, file_path, url, drive_file_id) values
  ('a0000000-0000-0000-0000-000000000004', '80000000-0000-0000-0000-000000000001', 'video', 'วิดีโอ Drive', null, 'https://drive.google.com/file/d/ONLY-C1/view', 'ONLY-C1-DRIVE-ID'),
  ('a0000000-0000-0000-0000-000000000005', '80000000-0000-0000-0000-000000000001', 'document', 'เอกสาร', '10000000-0000-0000-0000-0000000000a1/40000000-0000-0000-0000-0000000000d1/20000000-0000-0000-0000-0000000000c1/80000000-0000-0000-0000-000000000001/notes.pdf', null, null);

-- SGS: one column with a real score (exercises the 0023/0024 delete guard)
insert into public.sgs_score_columns (id, subject_id, classroom_id, label, max_score, position, created_by) values
  ('90000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-0000000000d1', '20000000-0000-0000-0000-0000000000c1', 'กลางภาค', 20, 1, '10000000-0000-0000-0000-0000000000a1');
insert into public.sgs_scores (column_id, student_id, score) values
  ('90000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 15);

insert into public.student_followup_notes (student_id, classroom_id, subject_id, body, created_by) values
  ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-0000000000c1', '40000000-0000-0000-0000-0000000000d1', 'ติดตามงาน', '10000000-0000-0000-0000-0000000000a1');

-- The actual file objects (must never be touched by the database delete)
insert into storage.buckets (id, name) values ('assignment-files', 'assignment-files'), ('lesson-files', 'lesson-files'), ('submission-files', 'submission-files')
  on conflict (id) do nothing;
insert into storage.objects (bucket_id, name) values
  ('assignment-files', '10000000-0000-0000-0000-0000000000a1/40000000-0000-0000-0000-0000000000d1/20000000-0000-0000-0000-0000000000c1/50000000-0000-0000-0000-0000000000a1/sheet.pdf'),
  ('lesson-files', '10000000-0000-0000-0000-0000000000a1/40000000-0000-0000-0000-0000000000d1/20000000-0000-0000-0000-0000000000c1/80000000-0000-0000-0000-000000000001/notes.pdf'),
  ('submission-files', 'sub/60000000-0000-0000-0000-000000000001/work.pdf');

-- 0029 (optional): one notification naming C1, one naming C2
do $$
begin
  if to_regclass('public.notifications') is not null then
    execute $q$insert into public.notifications (recipient_user_id, notification_type, title, body, entity_type, entity_id, metadata, dedupe_key) values
      ('10000000-0000-0000-0000-0000000000b1', 'assignment_published', 'งานใหม่', 'งาน C1', 'assignment', '50000000-0000-0000-0000-0000000000a1', '{"classroom_id":"20000000-0000-0000-0000-0000000000c1"}', 't32-c1'),
      ('10000000-0000-0000-0000-0000000000b1', 'assignment_published', 'งานใหม่', 'งาน C2', 'assignment', '50000000-0000-0000-0000-0000000000a2', '{"classroom_id":"20000000-0000-0000-0000-0000000000c2"}', 't32-c2')$q$;
  end if;
end $$;

create temporary table baseline as
select
  (select count(*) from public.students) as students,
  (select count(*) from public.student_qr_identities where status = 'active') as qr_active,
  (select count(*) from public.subjects) as subjects,
  (select count(*) from storage.objects) as objects;
grant select on baseline to authenticated;

\echo '== B1-B3 archive / restore'
set role authenticated;
select public.set_test_user('10000000-0000-0000-0000-0000000000a1');
select (public.set_classroom_archived('20000000-0000-0000-0000-0000000000c0', true)->>'is_active') as c0_is_active_after_archive;
select public.t_assert('B1 C0 archived', (select count(*) from public.classrooms where id = '20000000-0000-0000-0000-0000000000c0' and not is_active and archived_at is not null and archived_by = '10000000-0000-0000-0000-0000000000a1'), 1);
select public.t_assert('B1 one archived event', (select count(*) from public.classroom_lifecycle_events where classroom_id = '20000000-0000-0000-0000-0000000000c0' and event_type = 'archived'), 1);
select public.t_expect_error('B2 duplicate archive', $$select public.set_classroom_archived('20000000-0000-0000-0000-0000000000c0', true)$$, 'KC005');
select public.t_assert('B2 still one archived event', (select count(*) from public.classroom_lifecycle_events where classroom_id = '20000000-0000-0000-0000-0000000000c0'), 1);
select public.set_classroom_archived('20000000-0000-0000-0000-0000000000c0', false) is not null as restored;
select public.t_assert('B3 C0 active again, archive fields cleared', (select count(*) from public.classrooms where id = '20000000-0000-0000-0000-0000000000c0' and is_active and archived_at is null and archived_by is null), 1);
select public.t_expect_error('B3 duplicate restore', $$select public.set_classroom_archived('20000000-0000-0000-0000-0000000000c0', false)$$, 'KC006');
select public.t_assert('B3 events archived+restored', (select count(*) from public.classroom_lifecycle_events where classroom_id = '20000000-0000-0000-0000-0000000000c0'), 2);

\echo '== B5 raw DELETE through the old client path deletes nothing'
delete from public.classrooms where id = '20000000-0000-0000-0000-0000000000c0';
select public.t_assert('B5 C0 still exists after raw DELETE', (select count(*) from public.classrooms where id = '20000000-0000-0000-0000-0000000000c0'), 1);

\echo '== B6 permanent delete requires archive first'
select public.t_expect_error('B6 delete active classroom',
  format($$select public.delete_classroom_permanently('20000000-0000-0000-0000-0000000000c0', 'ห้องว่าง', %L)$$,
         public.get_classroom_deletion_preview('20000000-0000-0000-0000-0000000000c0')->>'fingerprint'), 'KC001');
select public.t_assert('B6 preview lists KC001 blocker',
  (select count(*) from jsonb_array_elements(public.get_classroom_deletion_preview('20000000-0000-0000-0000-0000000000c0')->'blockers') b where b->>'code' = 'KC001'), 1);

\echo '== B4 other teacher / student / no session / anon'
select public.set_test_user('10000000-0000-0000-0000-0000000000a2');
select public.t_expect_error('B4 other teacher archive', $$select public.set_classroom_archived('20000000-0000-0000-0000-0000000000c1', true)$$, '42501');
select public.t_expect_error('B4 other teacher preview', $$select public.get_classroom_deletion_preview('20000000-0000-0000-0000-0000000000c1')$$, '42501');
select public.t_expect_error('B4 other teacher delete', $$select public.delete_classroom_permanently('20000000-0000-0000-0000-0000000000c1', 'ม.5/1', 'x')$$, '42501');
select public.t_expect_error('B4 unknown classroom id', $$select public.get_classroom_deletion_preview('20000000-0000-0000-0000-00000000ffff')$$, '42501');
select public.set_test_user('10000000-0000-0000-0000-0000000000b1');
select public.t_expect_error('B4 student archive', $$select public.set_classroom_archived('20000000-0000-0000-0000-0000000000c1', true)$$, '42501');
select public.t_expect_error('B4 student delete', $$select public.delete_classroom_permanently('20000000-0000-0000-0000-0000000000c1', 'ม.5/1', 'x')$$, '42501');
select public.set_test_user(null);
select public.t_expect_error('B4 no session', $$select public.set_classroom_archived('20000000-0000-0000-0000-0000000000c1', true)$$, '28000');
reset role;
set role anon;
select public.t_expect_error('B4 anon has no EXECUTE', $$select public.delete_classroom_permanently('20000000-0000-0000-0000-0000000000c1', 'ม.5/1', 'x')$$, '42501');
select public.t_expect_error('B4 anon cannot call internal counts', $$select public.classroom_deletion_counts('20000000-0000-0000-0000-0000000000c1')$$, '42501');
reset role;
set role authenticated;
select public.set_test_user('10000000-0000-0000-0000-0000000000a1');
select public.t_expect_error('B4 owner cannot call internal counts directly', $$select public.classroom_deletion_counts('20000000-0000-0000-0000-0000000000c1')$$, '42501');
select public.t_assert('B4 C1 untouched', (select count(*) from public.classrooms where id = '20000000-0000-0000-0000-0000000000c1' and is_active), 1);

\echo '== B7 empty classroom'
select public.set_classroom_archived('20000000-0000-0000-0000-0000000000c0', true) is not null as archived;
select public.t_assert('B7 empty preview: all deleted counts zero',
  (select count(*) from jsonb_each_text(public.get_classroom_deletion_preview('20000000-0000-0000-0000-0000000000c0')->'counts') where value <> '0'), 0);
select public.t_expect_error('B7 wrong typed name',
  format($$select public.delete_classroom_permanently('20000000-0000-0000-0000-0000000000c0', 'ห้องว่าง ', %L)$$,
         public.get_classroom_deletion_preview('20000000-0000-0000-0000-0000000000c0')->>'fingerprint'), 'KC002');
select (public.delete_classroom_permanently('20000000-0000-0000-0000-0000000000c0', 'ห้องว่าง',
  public.get_classroom_deletion_preview('20000000-0000-0000-0000-0000000000c0')->>'fingerprint')->>'queued_files') as c0_queued_files;
select public.t_assert('B7 C0 deleted', (select count(*) from public.classrooms where id = '20000000-0000-0000-0000-0000000000c0'), 0);
select public.t_assert('B7 deleted event survives and is readable by owner',
  (select count(*) from public.classroom_lifecycle_events where classroom_id = '20000000-0000-0000-0000-0000000000c0' and event_type = 'deleted' and classroom_snapshot->>'name' = 'ห้องว่าง'), 1);

\echo '== B8 full classroom preview counts'
select public.set_classroom_archived('20000000-0000-0000-0000-0000000000c1', true) is not null as archived;
create temporary table p1 as select public.get_classroom_deletion_preview('20000000-0000-0000-0000-0000000000c1') as p;
select p->'counts' as c1_counts, p->'blockers' as c1_blockers from p1;
select public.t_assert('B8 '||k, (select (p->'counts'->>k)::bigint from p1), v) from (values
  ('enrollments', 2), ('subject_links', 1), ('assignments', 1), ('assignment_resources', 2), ('submissions', 2),
  ('graded_submissions', 1), ('submission_resources', 1), ('submission_events', 1), ('attendance_sessions', 2),
  ('attendance_records', 3), ('lessons', 1), ('lesson_resources', 2), ('sgs_columns', 1), ('sgs_scores', 1),
  ('followup_notes', 1), ('storage_files', 3), ('drive_files', 2), ('files_referenced_elsewhere', 1),
  ('students', 2), ('students_only_in_this_classroom', 1), ('students_in_other_classrooms', 1),
  ('linked_student_accounts', 1), ('qr_identities', 2), ('subjects_linked', 1),
  ('other_classroom_submissions', 1), ('other_classroom_attendance_records', 1), ('foreign_subject_records', 0)
) t(k, v);
select public.t_assert('B8 no blockers once archived', (select jsonb_array_length(p->'blockers') from p1), 0);

\echo '== B9 stale confirmation'
reset role;
set role postgres;
insert into public.attendance_records (attendance_session_id, student_id, status)
  values ('70000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002', 'present');
reset role;
set role authenticated;
select public.set_test_user('10000000-0000-0000-0000-0000000000a1');
select public.t_expect_error('B9 attendance added after preview',
  format($$select public.delete_classroom_permanently('20000000-0000-0000-0000-0000000000c1', 'ม.5/1', %L)$$, (select p->>'fingerprint' from p1)), 'KC003');
update public.classrooms set name = 'ม.5/1 (เดิม)' where id = '20000000-0000-0000-0000-0000000000c1';
select public.t_expect_error('B9 renamed after preview (new name typed)',
  format($$select public.delete_classroom_permanently('20000000-0000-0000-0000-0000000000c1', 'ม.5/1 (เดิม)', %L)$$, (select p->>'fingerprint' from p1)), 'KC003');
update public.classrooms set name = 'ม.5/1' where id = '20000000-0000-0000-0000-0000000000c1';
select public.t_assert('B9 nothing deleted: C1 and its attendance intact',
  (select count(*) from public.attendance_records r join public.attendance_sessions s on s.id = r.attendance_session_id where s.classroom_id = '20000000-0000-0000-0000-0000000000c1'), 4);
select public.t_assert('B9 no deleted event for C1', (select count(*) from public.classroom_lifecycle_events where classroom_id = '20000000-0000-0000-0000-0000000000c1' and event_type = 'deleted'), 0);

\echo '== B10 database failure mid-delete rolls everything back'
reset role;
set role postgres;
create function public.t_fail_submission_delete() returns trigger language plpgsql as $$
begin raise exception 'simulated failure while deleting submissions'; end $$;
create trigger t_fail_submission_delete before delete on public.assignment_submissions
  for each row execute function public.t_fail_submission_delete();
reset role;
set role authenticated;
select public.set_test_user('10000000-0000-0000-0000-0000000000a1');
select public.t_expect_error('B10 simulated failure',
  format($$select public.delete_classroom_permanently('20000000-0000-0000-0000-0000000000c1', 'ม.5/1', %L)$$,
         public.get_classroom_deletion_preview('20000000-0000-0000-0000-0000000000c1')->>'fingerprint'), 'P0001');
reset role;
set role postgres;
drop trigger t_fail_submission_delete on public.assignment_submissions;
drop function public.t_fail_submission_delete();
select public.t_assert('B10 classroom still there', (select count(*) from public.classrooms where id = '20000000-0000-0000-0000-0000000000c1'), 1);
select public.t_assert('B10 no deleted event written', (select count(*) from public.classroom_lifecycle_events where classroom_id = '20000000-0000-0000-0000-0000000000c1' and event_type = 'deleted'), 0);
select public.t_assert('B10 no queue rows written', (select count(*) from public.classroom_file_cleanup_queue where classroom_id = '20000000-0000-0000-0000-0000000000c1'), 0);
select public.t_assert('B10 attendance intact', (select count(*) from public.attendance_sessions where classroom_id = '20000000-0000-0000-0000-0000000000c1'), 2);
select public.t_assert('B10 submissions intact', (select count(*) from public.assignment_submissions where assignment_id = '50000000-0000-0000-0000-0000000000a1'), 2);
select public.t_assert('B10 sgs scores intact', (select count(*) from public.sgs_scores where column_id = '90000000-0000-0000-0000-000000000001'), 1);
select public.t_assert('B10 memberships intact', (select count(*) from public.classroom_students where classroom_id = '20000000-0000-0000-0000-0000000000c1'), 2);

\echo '== B11 successful permanent delete of the full classroom'
reset role;
set role authenticated;
select public.set_test_user('10000000-0000-0000-0000-0000000000a1');
create temporary table r1 as
select public.delete_classroom_permanently('20000000-0000-0000-0000-0000000000c1', 'ม.5/1',
  public.get_classroom_deletion_preview('20000000-0000-0000-0000-0000000000c1')->>'fingerprint') as r;
select r from r1;
reset role;
set role postgres;
select public.t_assert('B11 classroom gone', (select count(*) from public.classrooms where id = '20000000-0000-0000-0000-0000000000c1'), 0);
select public.t_assert('B11 memberships gone', (select count(*) from public.classroom_students where classroom_id = '20000000-0000-0000-0000-0000000000c1'), 0);
select public.t_assert('B11 subject link gone', (select count(*) from public.subject_classrooms where classroom_id = '20000000-0000-0000-0000-0000000000c1'), 0);
select public.t_assert('B11 assignment gone', (select count(*) from public.assignments where id = '50000000-0000-0000-0000-0000000000a1'), 0);
select public.t_assert('B11 submissions gone', (select count(*) from public.assignment_submissions where id in ('60000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000002')), 0);
select public.t_assert('B11 submission events gone', (select count(*) from public.assignment_submission_events where assignment_id = '50000000-0000-0000-0000-0000000000a1'), 0);
select public.t_assert('B11 attendance sessions gone (subject + homeroom)', (select count(*) from public.attendance_sessions where id in ('70000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000002')), 0);
select public.t_assert('B11 lessons gone', (select count(*) from public.lessons where id = '80000000-0000-0000-0000-000000000001'), 0);
select public.t_assert('B11 sgs column + scores gone', (select count(*) from public.sgs_score_columns where id = '90000000-0000-0000-0000-000000000001') + (select count(*) from public.sgs_scores where column_id = '90000000-0000-0000-0000-000000000001'), 0);
select public.t_assert('B11 followup notes gone', (select count(*) from public.student_followup_notes where classroom_id = '20000000-0000-0000-0000-0000000000c1'), 0);
-- preserved
select public.t_assert('B11 all students kept', (select count(*) from public.students), (select students from baseline));
select public.t_assert('B11 all active QR identities kept', (select count(*) from public.student_qr_identities where status = 'active'), (select qr_active from baseline));
select public.t_assert('B11 linked student account kept', (select count(*) from public.students where id = '30000000-0000-0000-0000-000000000001' and linked_profile_id = '10000000-0000-0000-0000-0000000000b1'), 1);
select public.t_assert('B11 subjects kept', (select count(*) from public.subjects), (select subjects from baseline));
select public.t_assert('B11 every file object kept', (select count(*) from storage.objects), (select objects from baseline));
select public.t_assert('B11 C2 classroom + memberships kept', (select count(*) from public.classroom_students where classroom_id = '20000000-0000-0000-0000-0000000000c2'), 2);
select public.t_assert('B11 C2 assignment + shared student submission kept', (select count(*) from public.assignment_submissions where id = '60000000-0000-0000-0000-000000000003' and score = 7), 1);
select public.t_assert('B11 C2 attendance kept', (select count(*) from public.attendance_records where attendance_session_id = '70000000-0000-0000-0000-000000000003'), 2);
select public.t_assert('B11 C2 lesson kept', (select count(*) from public.lessons where id = '80000000-0000-0000-0000-000000000002'), 1);
select public.t_assert('B11 C2 shared Drive reference kept', (select count(*) from public.assignment_resources where id = 'a0000000-0000-0000-0000-000000000003'), 1);
select public.t_assert('B11 subject still linked to C2', (select count(*) from public.subject_classrooms where classroom_id = '20000000-0000-0000-0000-0000000000c2'), 1);
-- audit + queue
select public.t_assert('B11 deleted event with counts', (select count(*) from public.classroom_lifecycle_events where classroom_id = '20000000-0000-0000-0000-0000000000c1' and event_type = 'deleted' and (affected_counts->>'attendance_records')::int = 4 and actor_role = 'owner'), 1);
select public.t_assert('B11 queued file references', (select count(*) from public.classroom_file_cleanup_queue where classroom_id = '20000000-0000-0000-0000-0000000000c1'), 5);
select public.t_assert('B11 queue all pending_review', (select count(*) from public.classroom_file_cleanup_queue where classroom_id = '20000000-0000-0000-0000-0000000000c1' and status <> 'pending_review'), 0);
select public.t_assert('B11 shared Drive file flagged referenced_elsewhere', (select count(*) from public.classroom_file_cleanup_queue where drive_file_id = 'SHARED-DRIVE-ID' and referenced_elsewhere), 1);
select public.t_assert('B11 C1-only Drive file not flagged', (select count(*) from public.classroom_file_cleanup_queue where drive_file_id = 'ONLY-C1-DRIVE-ID' and not referenced_elsewhere), 1);
select public.t_assert('B11 storage objects queued by bucket', (select count(distinct bucket) from public.classroom_file_cleanup_queue where provider = 'supabase_storage' and classroom_id = '20000000-0000-0000-0000-0000000000c1'), 3);
select public.t_assert('B11 result reports queued files', (select (r->>'queued_files')::bigint from r1), 5);

\echo '== B12 records under another teacher''s subject block deletion'
reset role;
set role authenticated;
select public.set_test_user('10000000-0000-0000-0000-0000000000a1');
select public.set_classroom_archived('20000000-0000-0000-0000-0000000000c3', true) is not null as archived;
select public.t_assert('B12 preview shows KC004 blocker',
  (select count(*) from jsonb_array_elements(public.get_classroom_deletion_preview('20000000-0000-0000-0000-0000000000c3')->'blockers') b where b->>'code' = 'KC004'), 1);
select public.t_expect_error('B12 delete blocked',
  format($$select public.delete_classroom_permanently('20000000-0000-0000-0000-0000000000c3', 'ม.6/3', %L)$$,
         public.get_classroom_deletion_preview('20000000-0000-0000-0000-0000000000c3')->>'fingerprint'), 'KC004');
reset role;
set role postgres;
select public.t_assert('B12 C3 and its assignment kept', (select count(*) from public.assignments where id = '50000000-0000-0000-0000-0000000000a3'), 1);

\echo '== B13 admin acting on another teacher''s classroom'
reset role;
set role authenticated;
select public.set_test_user('10000000-0000-0000-0000-0000000000ad');
select public.set_classroom_archived('20000000-0000-0000-0000-0000000000c9', true) is not null as admin_archived;
select (public.delete_classroom_permanently('20000000-0000-0000-0000-0000000000c9', 'ห้องครูอื่น',
  public.get_classroom_deletion_preview('20000000-0000-0000-0000-0000000000c9')->>'fingerprint')->>'event_id') is not null as admin_deleted;
reset role;
set role postgres;
select public.t_assert('B13 admin delete audited as admin', (select count(*) from public.classroom_lifecycle_events where classroom_id = '20000000-0000-0000-0000-0000000000c9' and event_type = 'deleted' and actor_role = 'admin' and classroom_owner_id = '10000000-0000-0000-0000-0000000000a2'), 1);

\echo '== B14 audit + queue visibility and immutability'
reset role;
set role authenticated;
select public.set_test_user('10000000-0000-0000-0000-0000000000a2');
select public.t_assert('B14 other teacher sees none of T1''s events', (select count(*) from public.classroom_lifecycle_events where classroom_owner_id = '10000000-0000-0000-0000-0000000000a1'), 0);
select public.t_assert('B14 other teacher sees none of T1''s queue', (select count(*) from public.classroom_file_cleanup_queue), 0);
select public.t_assert('B14 owner of C9 sees the admin''s delete of their classroom', (select count(*) from public.classroom_lifecycle_events where classroom_id = '20000000-0000-0000-0000-0000000000c9'), 2);
select public.set_test_user('10000000-0000-0000-0000-0000000000a1');
select public.t_assert('B14 owner sees own queue', (select count(*) from public.classroom_file_cleanup_queue), 5);
select public.t_expect_error('B14 client cannot insert events', $$insert into public.classroom_lifecycle_events (classroom_id, event_type, classroom_snapshot) values (gen_random_uuid(), 'deleted', '{}')$$, '42501');
select public.t_expect_error('B14 client cannot delete events', $$delete from public.classroom_lifecycle_events$$, '42501');
select public.t_expect_error('B14 client cannot update queue', $$update public.classroom_file_cleanup_queue set status = 'deleted'$$, '42501');
select public.set_test_user('10000000-0000-0000-0000-0000000000b1');
select public.t_assert('B14 student sees no events', (select count(*) from public.classroom_lifecycle_events), 0);

\echo '== B15 archive metadata cannot be forged'
select public.set_test_user('10000000-0000-0000-0000-0000000000a1');
update public.classrooms set archived_at = '2000-01-01', archived_by = '10000000-0000-0000-0000-0000000000a2' where id = '20000000-0000-0000-0000-0000000000c2';
select public.t_assert('B15 C2 archive fields unchanged by direct update', (select count(*) from public.classrooms where id = '20000000-0000-0000-0000-0000000000c2' and archived_at is null and archived_by is null and is_active), 1);

\echo '== B16 notifications (only when 0029 is installed)'
reset role;
set role postgres;
do $$
declare v_c1 bigint; v_c2 bigint;
begin
  if to_regclass('public.notifications') is null then
    raise notice 'skip B16: notifications (0029) not installed — same as production';
    return;
  end if;
  execute $q$select count(*) from public.notifications where dedupe_key = 't32-c1'$q$ into v_c1;
  execute $q$select count(*) from public.notifications where dedupe_key = 't32-c2'$q$ into v_c2;
  perform public.t_assert('B16 C1 notification removed', v_c1, 0);
  perform public.t_assert('B16 C2 notification kept', v_c2, 1);
end $$;

drop function public.t_assert(text, bigint, bigint);
drop function public.t_expect_error(text, text, text);
\echo 'ALL 0032 CHECKS PASSED'
