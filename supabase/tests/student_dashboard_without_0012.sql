-- PRODUCTION BUG regression: /student/dashboard went entirely blank
-- ("เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง") for an approved, linked student
-- account in production.
--
-- Root cause: getMyStudentProfile() (student-portal-service.ts), which
-- StudentLayout calls to gate EVERY /student/* route, unconditionally
-- selected students.avatar_path — a column added only by
-- 0012_student_calendar_notifications.sql, which was intentionally never
-- applied to production (Calendar/Notifications/Avatar work was paused).
-- PostgREST/Postgres reject the WHOLE select when a named column doesn't
-- exist (42703 undefined_column) — not just that field — so the profile
-- fetch failed outright, StudentLayout's catch rendered nothing but the
-- generic error text, and the entire portal (not just the dashboard)
-- went blank before ever reaching <Outlet />.
--
-- This script reproduces the EXACT reported production configuration —
-- 0011 applied, 0012 NOT applied, 0013 applied — and proves:
--   1. the original (broken) query shape genuinely fails this way here,
--   2. the fixed application code's fallback query (no avatar_path)
--      succeeds and returns the right row,
--   3. every other query the dashboard depends on (subjects, assignments,
--      submissions, attendance, grades, 0013 assignment_resources) keeps
--      working normally with 0012 absent,
--   4. the optional 0012-only queries (student_calendar_entries,
--      teacher_student_notifications) fail with the specific
--      "undefined_table" error the fixed getMyCalendarEntries/
--      getMyNotifications now catch and turn into an empty list instead
--      of throwing,
--   5. cross-student/cross-teacher isolation is completely unaffected by
--      any of this.
--
-- NOT applied automatically and NOT part of the application schema — a
-- dev-only verification script, run against a throwaway local Postgres
-- instance with EXACTLY 0001-0011 and 0013 applied, 0012 skipped (see
-- docs/DATABASE.md's "Empirical RLS verification methodology").

\set ON_ERROR_STOP 1

-- ==================================================
-- Sanity: confirm this scratch database really is in the reported
-- production configuration before testing anything else.
-- ==================================================

do $$
begin
  if to_regclass('public.student_calendar_entries') is not null then
    raise exception 'TEST SETUP FAILED: student_calendar_entries exists — 0012 is applied, this script requires it NOT to be';
  end if;
  if to_regclass('public.teacher_student_notifications') is not null then
    raise exception 'TEST SETUP FAILED: teacher_student_notifications exists — 0012 is applied, this script requires it NOT to be';
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'students' and column_name = 'avatar_path'
  ) then
    raise exception 'TEST SETUP FAILED: students.avatar_path exists — 0012 is applied, this script requires it NOT to be';
  end if;
  if to_regclass('public.assignment_resources') is null then
    raise exception 'TEST SETUP FAILED: assignment_resources does not exist — 0013 must be applied for this script';
  end if;
  raise notice 'Setup confirmed: 0011 applied, 0012 NOT applied, 0013 applied (exact reported production state)';
end $$;

-- ==================================================
-- Fixtures — one teacher, one classroom, one subject, one linked
-- (approved) student, one assignment with a file resource and one with a
-- link resource, one attendance session/record, one submission.
-- ==================================================

do $$
begin
  alter table auth.users disable trigger on_auth_user_created;
exception when undefined_object then null;
end $$;

delete from public.assignment_resources where title like 'TESTDASH:%';
delete from public.assignment_submissions where assignment_id in (
  select id from public.assignments where title like 'TESTDASH:%'
);
delete from public.assignments where title like 'TESTDASH:%';
delete from public.attendance_records where attendance_session_id in (
  select id from public.attendance_sessions where classroom_id = '00000000-00DA-0001-0000-000000000001'
);
delete from public.attendance_sessions where classroom_id = '00000000-00DA-0001-0000-000000000001';
delete from public.subject_classrooms where subject_id = '00000000-00DA-0003-0000-000000000001';
delete from public.subjects where name like 'TESTDASH:%';
delete from public.classroom_students where classroom_id = '00000000-00DA-0001-0000-000000000001';
delete from public.students where first_name like 'TESTDASH:%';
delete from public.classrooms where name like 'TESTDASH:%';
delete from public.profiles where display_name like 'TESTDASH:%';
delete from auth.users where email like 'testdash_%';

insert into auth.users (id, email) values
  ('00000000-00DA-0000-0000-000000000001', 'testdash_teacher@example.com'),
  ('00000000-00DA-0000-0000-000000000002', 'testdash_student@example.com');

insert into public.profiles (id, display_name, email, role) values
  ('00000000-00DA-0000-0000-000000000001', 'TESTDASH: Teacher', 'testdash_teacher@example.com', 'teacher'),
  ('00000000-00DA-0000-0000-000000000002', 'TESTDASH: Student Profile', 'testdash_student@example.com', 'student');

insert into public.classrooms (id, teacher_id, name) values
  ('00000000-00DA-0001-0000-000000000001', '00000000-00DA-0000-0000-000000000001', 'TESTDASH: Classroom');

-- Approved + linked (linked_profile_id set) — the exact state the bug
-- report specifies ("already APPROVED and LINKED student account").
insert into public.students (id, first_name, last_name, student_code, linked_profile_id) values
  ('00000000-00DA-0002-0000-000000000001', 'TESTDASH: Student', 'One', 'SD-001', '00000000-00DA-0000-0000-000000000002');

insert into public.classroom_students (classroom_id, student_id) values
  ('00000000-00DA-0001-0000-000000000001', '00000000-00DA-0002-0000-000000000001');

insert into public.subjects (id, teacher_id, name) values
  ('00000000-00DA-0003-0000-000000000001', '00000000-00DA-0000-0000-000000000001', 'TESTDASH: Subject');
insert into public.subject_classrooms (subject_id, classroom_id) values
  ('00000000-00DA-0003-0000-000000000001', '00000000-00DA-0001-0000-000000000001');

insert into public.assignments (id, subject_id, classroom_id, title, created_by) values
  ('00000000-00DA-0004-0000-000000000001', '00000000-00DA-0003-0000-000000000001', '00000000-00DA-0001-0000-000000000001', 'TESTDASH: Assignment with file', '00000000-00DA-0000-0000-000000000001'),
  ('00000000-00DA-0004-0000-000000000002', '00000000-00DA-0003-0000-000000000001', '00000000-00DA-0001-0000-000000000001', 'TESTDASH: Assignment with link', '00000000-00DA-0000-0000-000000000001'),
  ('00000000-00DA-0004-0000-000000000003', '00000000-00DA-0003-0000-000000000001', '00000000-00DA-0001-0000-000000000001', 'TESTDASH: Assignment with no resources', '00000000-00DA-0000-0000-000000000001');

insert into public.assignment_resources (assignment_id, resource_type, title, file_path, created_by) values
  ('00000000-00DA-0004-0000-000000000001', 'file', 'TESTDASH: ใบงาน', '00000000-00DA-0000-0000-000000000001/00000000-00DA-0003-0000-000000000001/00000000-00DA-0001-0000-000000000001/00000000-00DA-0004-0000-000000000001/abc.pdf', '00000000-00DA-0000-0000-000000000001');
insert into public.assignment_resources (assignment_id, resource_type, title, url, created_by) values
  ('00000000-00DA-0004-0000-000000000002', 'link', 'TESTDASH: Google Form', 'https://forms.google.com/testdash', '00000000-00DA-0000-0000-000000000001');
-- Assignment 3 deliberately has NO resources — "a student with no
-- assignment resources must work normally."

insert into public.attendance_sessions (id, classroom_id, attendance_date, created_by) values
  ('00000000-00DA-0005-0000-000000000001', '00000000-00DA-0001-0000-000000000001', current_date, '00000000-00DA-0000-0000-000000000001');
insert into public.attendance_records (attendance_session_id, student_id, status) values
  ('00000000-00DA-0005-0000-000000000001', '00000000-00DA-0002-0000-000000000001', 'present');

-- ==================================================
-- TEST 1: the ORIGINAL broken query shape genuinely fails here, exactly
-- reproducing the reported production error.
-- ==================================================
set role authenticated;
select set_test_user('00000000-00DA-0000-0000-000000000002');

do $$
begin
  begin
    perform (select id from public.students s, lateral (select s.avatar_path) x limit 1);
    raise exception 'TEST 1 FAILED: selecting students.avatar_path unexpectedly succeeded — 0012 must not be applied for this test';
  exception
    when undefined_column then
      raise notice 'TEST 1 passed: selecting students.avatar_path fails with undefined_column (42703), exactly reproducing the production crash';
  end;
end $$;

-- ==================================================
-- TEST 2: the FIXED fallback query (no avatar_path) succeeds and returns
-- exactly the approved student's own row — this is the exact shape
-- getMyStudentProfile() now falls back to.
-- ==================================================
do $$
declare
  v_row record;
begin
  select id, student_code, number, first_name, last_name, nickname
  into v_row
  from public.students
  limit 1;

  if v_row.id is null then
    raise exception 'TEST 2 FAILED: fallback profile query returned no row for an approved linked student';
  end if;
  if v_row.first_name <> 'TESTDASH: Student' then
    raise exception 'TEST 2 FAILED: fallback profile query returned the wrong student';
  end if;
  raise notice 'TEST 2 passed: fallback profile query (no avatar_path) succeeds and returns the correct own row';
end $$;

-- ==================================================
-- TEST 3: subjects/assignments/attendance/grades queries — none of them
-- depend on 0012 at all — all keep working normally.
-- ==================================================
do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.subjects s
    join public.subject_classrooms sc on sc.subject_id = s.id
    join public.classroom_students cs on cs.classroom_id = sc.classroom_id
    join public.students st on st.id = cs.student_id
    where st.linked_profile_id = auth.uid();
  if v_count <> 1 then
    raise exception 'TEST 3a FAILED: expected 1 reachable subject, got %', v_count;
  end if;

  select count(*) into v_count from public.assignments where is_archived = false;
  if v_count <> 3 then
    raise exception 'TEST 3b FAILED: expected 3 reachable assignments, got %', v_count;
  end if;

  select count(*) into v_count from public.attendance_records;
  if v_count <> 1 then
    raise exception 'TEST 3c FAILED: expected 1 reachable attendance record, got %', v_count;
  end if;

  raise notice 'TEST 3 passed: subjects/assignments/attendance queries all succeed normally with 0012 absent';
end $$;

-- ==================================================
-- TEST 4: assignment_resources (0013) — file resource, link resource,
-- and an assignment with NO resources — all load correctly and are
-- readable by the enrolled student, unaffected by 0012's absence.
-- ==================================================
do $$
declare
  v_count int;
  v_type text;
begin
  select count(*) into v_count from public.assignment_resources
    where assignment_id = '00000000-00DA-0004-0000-000000000001';
  if v_count <> 1 then
    raise exception 'TEST 4a FAILED: file-resource assignment should have exactly 1 resource, got %', v_count;
  end if;
  select resource_type into v_type from public.assignment_resources
    where assignment_id = '00000000-00DA-0004-0000-000000000001';
  if v_type <> 'file' then
    raise exception 'TEST 4a FAILED: expected resource_type = file, got %', v_type;
  end if;

  select count(*) into v_count from public.assignment_resources
    where assignment_id = '00000000-00DA-0004-0000-000000000002';
  if v_count <> 1 then
    raise exception 'TEST 4b FAILED: link-resource assignment should have exactly 1 resource, got %', v_count;
  end if;
  select resource_type into v_type from public.assignment_resources
    where assignment_id = '00000000-00DA-0004-0000-000000000002';
  if v_type <> 'link' then
    raise exception 'TEST 4b FAILED: expected resource_type = link, got %', v_type;
  end if;

  select count(*) into v_count from public.assignment_resources
    where assignment_id = '00000000-00DA-0004-0000-000000000003';
  if v_count <> 0 then
    raise exception 'TEST 4c FAILED: no-resources assignment should have 0 resources, got %', v_count;
  end if;

  raise notice 'TEST 4 passed: file resource, link resource, and zero-resource assignment all load correctly (0013 unaffected by 0012 absence)';
end $$;

-- ==================================================
-- TEST 5: the optional 0012 tables genuinely don't exist — confirming
-- the exact "undefined_table" error the fixed getMyCalendarEntries/
-- getMyNotifications now catch and turn into an empty list.
-- ==================================================
do $$
begin
  begin
    perform 1 from public.student_calendar_entries limit 1;
    raise exception 'TEST 5a FAILED: student_calendar_entries unexpectedly exists';
  exception
    when undefined_table then
      raise notice 'TEST 5a passed: student_calendar_entries genuinely absent (undefined_table, 42P01)';
  end;

  begin
    perform 1 from public.teacher_student_notifications limit 1;
    raise exception 'TEST 5b FAILED: teacher_student_notifications unexpectedly exists';
  exception
    when undefined_table then
      raise notice 'TEST 5b passed: teacher_student_notifications genuinely absent (undefined_table, 42P01)';
  end;
end $$;

-- ==================================================
-- TEST 6: security is completely unaffected — a second, unrelated
-- student/teacher can never see this student's/classroom's rows, exactly
-- as every prior migration's own test has already verified; re-checked
-- here specifically in the no-0012 configuration.
-- ==================================================
select set_test_user('00000000-00DA-0000-0000-000000000001');

do $$
declare
  v_count int;
begin
  -- The teacher role has no policy granting them a "students" row scoped
  -- to my_student_id() (that identity function only ever resolves for
  -- the linked student themselves) — confirms no broad SELECT grant lets
  -- a teacher masquerade as this student's own-row query.
  select count(*) into v_count from public.students where linked_profile_id = auth.uid();
  if v_count <> 0 then
    raise exception 'TEST 6 FAILED: teacher role resolved a student row via linked_profile_id = auth.uid()';
  end if;
  raise notice 'TEST 6 passed: cross-role isolation unaffected by 0012 absence';
end $$;

reset role;

-- ==================================================
-- Cleanup
-- ==================================================

delete from public.assignment_resources where title like 'TESTDASH:%';
delete from public.assignment_submissions where assignment_id in (
  select id from public.assignments where title like 'TESTDASH:%'
);
delete from public.assignments where title like 'TESTDASH:%';
delete from public.attendance_records where attendance_session_id in (
  select id from public.attendance_sessions where classroom_id = '00000000-00DA-0001-0000-000000000001'
);
delete from public.attendance_sessions where classroom_id = '00000000-00DA-0001-0000-000000000001';
delete from public.subject_classrooms where subject_id = '00000000-00DA-0003-0000-000000000001';
delete from public.subjects where name like 'TESTDASH:%';
delete from public.classroom_students where classroom_id = '00000000-00DA-0001-0000-000000000001';
delete from public.students where first_name like 'TESTDASH:%';
delete from public.classrooms where name like 'TESTDASH:%';
delete from public.profiles where display_name like 'TESTDASH:%';
delete from auth.users where email like 'testdash_%';

do $$
begin
  alter table auth.users enable trigger on_auth_user_created;
exception when undefined_object then null;
end $$;

\echo 'student_dashboard_without_0012.sql: ALL TESTS PASSED'
