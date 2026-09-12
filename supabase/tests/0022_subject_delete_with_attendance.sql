-- Empirical verification for 0022_subject_delete_with_attendance.sql
--
-- DEV-ONLY verification script, never applied to any real database and
-- never run automatically. Run against a disposable local Postgres with
-- every migration through 0022 applied in order, using the auth shim
-- described in supabase/tests/0009_student_link_rpc_permissions.sql.
--
-- Covers, in order:
--   A1  a DIFFERENT teacher cannot delete the subject via the RPC
--       (42501, nothing deleted — attendance, subject, students all intact)
--   A2  an anonymous / unauthenticated caller cannot call it at all
--   A3  the OWNING teacher deletes a subject WITH attendance -> succeeds
--   A4  that subject's attendance_sessions + attendance_records are gone
--   A5  students still exist
--   A6  attendance for OTHER subjects (same classroom and a different
--       classroom) and HOMEROOM attendance (subject_id null) all remain
--   A7  existing lesson / assignment / submission cascade still works
--   A8  the classroom itself, the unrelated subject and the teacher
--       profile are untouched
--   A9  a raw DELETE FROM subjects (not via the RPC) is STILL blocked by
--       attendance_sessions.subject_id ON DELETE RESTRICT — the FK was
--       not changed

\set ON_ERROR_STOP 1

set role authenticated;
select public.set_test_user(null);
reset role;
set role postgres;

insert into auth.users (id, email) values
  ('a1a1a1a1-0000-0000-0000-000000000001', 't-owner@example.com'),
  ('a2a2a2a2-0000-0000-0000-000000000002', 't-other@example.com');
-- handle_new_user (0003) auto-creates a 'teacher' profile for each.

insert into public.classrooms (id, teacher_id, name) values
  ('c1c1c1c1-0000-0000-0000-000000000001', 'a1a1a1a1-0000-0000-0000-000000000001', 'ม.5/1'),
  ('c2c2c2c2-0000-0000-0000-000000000002', 'a1a1a1a1-0000-0000-0000-000000000001', 'ม.5/2');

insert into public.students (id, created_by, first_name, last_name) values
  ('51515151-0000-0000-0000-000000000001', 'a1a1a1a1-0000-0000-0000-000000000001', 'Somchai', 'Test'),
  ('52525252-0000-0000-0000-000000000002', 'a1a1a1a1-0000-0000-0000-000000000001', 'Somsri', 'Test');

insert into public.classroom_students (classroom_id, student_id) values
  ('c1c1c1c1-0000-0000-0000-000000000001', '51515151-0000-0000-0000-000000000001'),
  ('c1c1c1c1-0000-0000-0000-000000000001', '52525252-0000-0000-0000-000000000002'),
  ('c2c2c2c2-0000-0000-0000-000000000002', '52525252-0000-0000-0000-000000000002');

-- Subject X: the one being deleted. Linked to BOTH classrooms, with
-- attendance in both, plus a lesson, an assignment, a submission+score.
insert into public.subjects (id, teacher_id, name) values
  ('d1d1d1d1-0000-0000-0000-000000000001', 'a1a1a1a1-0000-0000-0000-000000000001', 'สังคมศึกษา');
insert into public.subject_classrooms (subject_id, classroom_id) values
  ('d1d1d1d1-0000-0000-0000-000000000001', 'c1c1c1c1-0000-0000-0000-000000000001'),
  ('d1d1d1d1-0000-0000-0000-000000000001', 'c2c2c2c2-0000-0000-0000-000000000002');

insert into public.attendance_sessions (id, classroom_id, subject_id, attendance_date, period_number, created_by) values
  ('e1e1e1e1-0000-0000-0000-000000000001', 'c1c1c1c1-0000-0000-0000-000000000001', 'd1d1d1d1-0000-0000-0000-000000000001', '2026-09-01', null, 'a1a1a1a1-0000-0000-0000-000000000001'),
  ('e1e1e1e1-0000-0000-0000-000000000002', 'c1c1c1c1-0000-0000-0000-000000000001', 'd1d1d1d1-0000-0000-0000-000000000001', '2026-09-02', 3,    'a1a1a1a1-0000-0000-0000-000000000001'),
  ('e1e1e1e1-0000-0000-0000-000000000003', 'c2c2c2c2-0000-0000-0000-000000000002', 'd1d1d1d1-0000-0000-0000-000000000001', '2026-09-01', null, 'a1a1a1a1-0000-0000-0000-000000000001');
insert into public.attendance_records (attendance_session_id, student_id, status) values
  ('e1e1e1e1-0000-0000-0000-000000000001', '51515151-0000-0000-0000-000000000001', 'present'),
  ('e1e1e1e1-0000-0000-0000-000000000001', '52525252-0000-0000-0000-000000000002', 'late'),
  ('e1e1e1e1-0000-0000-0000-000000000002', '51515151-0000-0000-0000-000000000001', 'absent'),
  ('e1e1e1e1-0000-0000-0000-000000000003', '52525252-0000-0000-0000-000000000002', 'present');

insert into public.lessons (id, subject_id, classroom_id, title, created_by) values
  ('f1f1f1f1-0000-0000-0000-000000000001', 'd1d1d1d1-0000-0000-0000-000000000001', 'c1c1c1c1-0000-0000-0000-000000000001', 'บทที่ 1', 'a1a1a1a1-0000-0000-0000-000000000001');
insert into public.lesson_resources (id, lesson_id, resource_type, title, url) values
  ('f2f2f2f2-0000-0000-0000-000000000002', 'f1f1f1f1-0000-0000-0000-000000000001', 'link', 'สไลด์ (Drive)', 'https://drive.google.com/file/d/abc/view');
insert into public.assignments (id, subject_id, classroom_id, title, max_score, created_by) values
  ('f3f3f3f3-0000-0000-0000-000000000003', 'd1d1d1d1-0000-0000-0000-000000000001', 'c1c1c1c1-0000-0000-0000-000000000001', 'งาน 1', 100, 'a1a1a1a1-0000-0000-0000-000000000001');
insert into public.assignment_resources (id, assignment_id, resource_type, title, url) values
  ('f4f4f4f4-0000-0000-0000-000000000004', 'f3f3f3f3-0000-0000-0000-000000000003', 'link', 'ใบงาน', 'https://example.com/worksheet');
insert into public.assignment_submissions (id, assignment_id, student_id, status, score, reviewed_at) values
  ('f5f5f5f5-0000-0000-0000-000000000005', 'f3f3f3f3-0000-0000-0000-000000000003', '51515151-0000-0000-0000-000000000001', 'submitted', 95, now());
insert into public.assignment_submission_resources (id, assignment_submission_id, resource_type, title, external_url) values
  ('f6f6f6f6-0000-0000-0000-000000000006', 'f5f5f5f5-0000-0000-0000-000000000005', 'link', 'งานของฉัน', 'https://example.com/my-work');

-- Subject Y: unrelated, SAME classroom, with its own attendance. Must survive.
insert into public.subjects (id, teacher_id, name) values
  ('d2d2d2d2-0000-0000-0000-000000000002', 'a1a1a1a1-0000-0000-0000-000000000001', 'ภาษาไทย');
insert into public.subject_classrooms (subject_id, classroom_id) values
  ('d2d2d2d2-0000-0000-0000-000000000002', 'c1c1c1c1-0000-0000-0000-000000000001');
insert into public.attendance_sessions (id, classroom_id, subject_id, attendance_date, created_by) values
  ('e2e2e2e2-0000-0000-0000-000000000001', 'c1c1c1c1-0000-0000-0000-000000000001', 'd2d2d2d2-0000-0000-0000-000000000002', '2026-09-01', 'a1a1a1a1-0000-0000-0000-000000000001');
insert into public.attendance_records (attendance_session_id, student_id, status) values
  ('e2e2e2e2-0000-0000-0000-000000000001', '51515151-0000-0000-0000-000000000001', 'present');

-- Homeroom attendance (subject_id null) for the same classroom. Must survive.
insert into public.attendance_sessions (id, classroom_id, subject_id, attendance_date, created_by) values
  ('e3e3e3e3-0000-0000-0000-000000000001', 'c1c1c1c1-0000-0000-0000-000000000001', null, '2026-09-01', 'a1a1a1a1-0000-0000-0000-000000000001');
insert into public.attendance_records (attendance_session_id, student_id, status) values
  ('e3e3e3e3-0000-0000-0000-000000000001', '52525252-0000-0000-0000-000000000002', 'present');

reset role;

\echo '=================================================='
\echo 'A1: a DIFFERENT teacher cannot delete subject X via the RPC (42501, nothing deleted)'
\echo '=================================================='
set role authenticated;
select public.set_test_user('a2a2a2a2-0000-0000-0000-000000000002');
do $$
begin
  begin
    perform public.delete_subject_permanently('d1d1d1d1-0000-0000-0000-000000000001');
    raise exception 'TEST FAILED: non-owner RPC call should have raised 42501';
  exception
    when insufficient_privilege then
      raise notice 'CORRECTLY BLOCKED: insufficient_privilege (42501) for a non-owner';
  end;
end $$;
reset role;
set role postgres;
select 'A1 subject X still exists (expect 1):' as label, count(*) from public.subjects where id = 'd1d1d1d1-0000-0000-0000-000000000001';
select 'A1 subject X attendance_sessions still exist (expect 3):' as label, count(*) from public.attendance_sessions where subject_id = 'd1d1d1d1-0000-0000-0000-000000000001';
select 'A1 subject X attendance_records still exist (expect 4):' as label, count(*) from public.attendance_records r join public.attendance_sessions s on s.id = r.attendance_session_id where s.subject_id = 'd1d1d1d1-0000-0000-0000-000000000001';
reset role;

\echo '=================================================='
\echo 'A2: an unauthenticated caller cannot call the RPC'
\echo '=================================================='
set role authenticated;
select public.set_test_user(null);
do $$
begin
  begin
    perform public.delete_subject_permanently('d1d1d1d1-0000-0000-0000-000000000001');
    raise exception 'TEST FAILED: unauthenticated RPC call should have raised 28000';
  exception
    when invalid_authorization_specification then
      raise notice 'CORRECTLY BLOCKED: invalid_authorization_specification (28000) with no auth.uid()';
  end;
end $$;
reset role;
set role anon;
do $$
begin
  begin
    perform public.delete_subject_permanently('d1d1d1d1-0000-0000-0000-000000000001');
    raise exception 'TEST FAILED: anon should not have EXECUTE on the RPC';
  exception
    when insufficient_privilege then
      raise notice 'CORRECTLY BLOCKED: anon has no EXECUTE privilege (42501)';
  end;
end $$;
reset role;

\echo '=================================================='
\echo 'A9 (checked BEFORE the real delete): a raw DELETE FROM subjects is STILL blocked by ON DELETE RESTRICT'
\echo '=================================================='
set role authenticated;
select public.set_test_user('a1a1a1a1-0000-0000-0000-000000000001');
do $$
begin
  begin
    delete from public.subjects where id = 'd1d1d1d1-0000-0000-0000-000000000001';
    raise exception 'TEST FAILED: raw delete should have raised a foreign_key_violation';
  exception
    when foreign_key_violation then
      raise notice 'CORRECTLY BLOCKED: foreign_key_violation (23503) — attendance_sessions.subject_id is still ON DELETE RESTRICT; only the RPC path removes attendance';
  end;
end $$;
select 'A9 subject X still exists after raw delete attempt (expect 1):' as label, count(*) from public.subjects where id = 'd1d1d1d1-0000-0000-0000-000000000001';
reset role;

\echo '=================================================='
\echo 'A3: the OWNING teacher deletes subject X (with attendance) via the RPC -> succeeds'
\echo '=================================================='
set role authenticated;
select public.set_test_user('a1a1a1a1-0000-0000-0000-000000000001');
select public.delete_subject_permanently('d1d1d1d1-0000-0000-0000-000000000001');
select 'A3 subject X visible to owner afterwards (expect 0):' as label, count(*) from public.subjects where id = 'd1d1d1d1-0000-0000-0000-000000000001';
reset role;

set role postgres;
\echo '--- A4: subject X attendance is gone'
select 'A4 subject X attendance_sessions (expect 0):' as label, count(*) from public.attendance_sessions where subject_id = 'd1d1d1d1-0000-0000-0000-000000000001';
select 'A4 subject X attendance_records (expect 0, by session id):' as label, count(*) from public.attendance_records where attendance_session_id in ('e1e1e1e1-0000-0000-0000-000000000001', 'e1e1e1e1-0000-0000-0000-000000000002', 'e1e1e1e1-0000-0000-0000-000000000003');

\echo '--- A5: students remain'
select 'A5 students (expect 2):' as label, count(*) from public.students where id in ('51515151-0000-0000-0000-000000000001', '52525252-0000-0000-0000-000000000002');
select 'A5 classroom_students memberships (expect 3):' as label, count(*) from public.classroom_students where student_id in ('51515151-0000-0000-0000-000000000001', '52525252-0000-0000-0000-000000000002');

\echo '--- A6: attendance for OTHER subjects and homeroom remains'
select 'A6 subject Y (same classroom) attendance_sessions (expect 1):' as label, count(*) from public.attendance_sessions where id = 'e2e2e2e2-0000-0000-0000-000000000001';
select 'A6 subject Y attendance_records (expect 1):' as label, count(*) from public.attendance_records where attendance_session_id = 'e2e2e2e2-0000-0000-0000-000000000001';
select 'A6 homeroom (subject_id null) attendance_sessions (expect 1):' as label, count(*) from public.attendance_sessions where id = 'e3e3e3e3-0000-0000-0000-000000000001';
select 'A6 homeroom attendance_records (expect 1):' as label, count(*) from public.attendance_records where attendance_session_id = 'e3e3e3e3-0000-0000-0000-000000000001';
select 'A6 total remaining attendance_sessions in the fixture classrooms (expect 2):' as label, count(*) from public.attendance_sessions where classroom_id in ('c1c1c1c1-0000-0000-0000-000000000001', 'c2c2c2c2-0000-0000-0000-000000000002');

\echo '--- A7: existing lesson / assignment / submission cascade still works'
select 'A7 subject X subject_classrooms LINK rows (expect 0):' as label, count(*) from public.subject_classrooms where subject_id = 'd1d1d1d1-0000-0000-0000-000000000001';
select 'A7 subject X lessons (expect 0):' as label, count(*) from public.lessons where id = 'f1f1f1f1-0000-0000-0000-000000000001';
select 'A7 subject X lesson_resources incl. the Drive LINK reference row (expect 0):' as label, count(*) from public.lesson_resources where id = 'f2f2f2f2-0000-0000-0000-000000000002';
select 'A7 subject X assignments (expect 0):' as label, count(*) from public.assignments where id = 'f3f3f3f3-0000-0000-0000-000000000003';
select 'A7 subject X assignment_resources (expect 0):' as label, count(*) from public.assignment_resources where id = 'f4f4f4f4-0000-0000-0000-000000000004';
select 'A7 subject X assignment_submissions (expect 0):' as label, count(*) from public.assignment_submissions where id = 'f5f5f5f5-0000-0000-0000-000000000005';
select 'A7 subject X assignment_submission_resources (expect 0):' as label, count(*) from public.assignment_submission_resources where id = 'f6f6f6f6-0000-0000-0000-000000000006';

\echo '--- A8: classrooms, the unrelated subject, and the teacher profile are untouched'
select 'A8 classrooms (expect 2):' as label, count(*) from public.classrooms where id in ('c1c1c1c1-0000-0000-0000-000000000001', 'c2c2c2c2-0000-0000-0000-000000000002');
select 'A8 subject Y still exists (expect 1):' as label, count(*) from public.subjects where id = 'd2d2d2d2-0000-0000-0000-000000000002';
select 'A8 subject Y link row still exists (expect 1):' as label, count(*) from public.subject_classrooms where subject_id = 'd2d2d2d2-0000-0000-0000-000000000002';
select 'A8 owner teacher profile still exists (expect 1):' as label, count(*) from public.profiles where id = 'a1a1a1a1-0000-0000-0000-000000000001';
reset role;
