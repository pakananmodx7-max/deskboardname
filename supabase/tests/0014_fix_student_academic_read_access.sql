-- Regression test for 0014_fix_student_academic_read_access.sql —
-- confirms the migration is safely idempotent (applying it twice changes
-- nothing observable) and that the full student academic read chain
-- (auth.uid() -> profiles -> students.linked_profile_id -> students.id
-- -> classroom_students -> classrooms -> subject_classrooms -> subjects
-- -> assignments -> assignment_submissions / attendance_sessions ->
-- attendance_records) works end to end afterward, in the exact reported
-- production configuration (0011 applied, 0012 absent, 0013 applied).
--
-- NOT applied automatically and NOT part of the application schema — a
-- dev-only verification script, run against a throwaway local Postgres
-- instance with 0001-0011, 0013, and this migration already applied (in
-- that order, 0012 skipped).

\set ON_ERROR_STOP 1

do $$
begin
  alter table auth.users disable trigger on_auth_user_created;
exception when undefined_object then null;
end $$;

-- ==================================================
-- TEST 1: applying 0014 a second time is a genuine no-op — every
-- statement in it is idempotent DDL (create or replace function; drop
-- policy if exists + create policy), so re-running the whole file here
-- must succeed with no error, and everything queried below must still
-- behave identically afterward.
-- ==================================================
\i 0014_fix_student_academic_read_access.sql
\echo '0014 re-applied a second time with no error — confirmed idempotent'

-- ==================================================
-- Fixtures — one teacher, one classroom, one subject linked to it, one
-- approved+linked student, one assignment, one attendance session/record.
-- ==================================================

delete from public.assignment_submissions where assignment_id in (
  select id from public.assignments where title like 'TEST0014:%'
);
delete from public.assignments where title like 'TEST0014:%';
delete from public.attendance_records where attendance_session_id in (
  select id from public.attendance_sessions where classroom_id = '00000000-0014-0001-0000-000000000001'
);
delete from public.attendance_sessions where classroom_id = '00000000-0014-0001-0000-000000000001';
delete from public.subject_classrooms where subject_id = '00000000-0014-0003-0000-000000000001';
delete from public.subjects where name like 'TEST0014:%';
delete from public.classroom_students where classroom_id = '00000000-0014-0001-0000-000000000001';
delete from public.students where first_name like 'TEST0014:%';
delete from public.classrooms where name like 'TEST0014:%';
delete from public.profiles where display_name like 'TEST0014:%';
delete from auth.users where email like 'test0014_%';

insert into auth.users (id, email) values
  ('00000000-0014-0000-0000-000000000001', 'test0014_teacher@example.com'),
  ('00000000-0014-0000-0000-000000000002', 'test0014_student@example.com');

insert into public.profiles (id, display_name, email, role) values
  ('00000000-0014-0000-0000-000000000001', 'TEST0014: Teacher', 'test0014_teacher@example.com', 'teacher'),
  ('00000000-0014-0000-0000-000000000002', 'TEST0014: Student Profile', 'test0014_student@example.com', 'student');

insert into public.classrooms (id, teacher_id, name) values
  ('00000000-0014-0001-0000-000000000001', '00000000-0014-0000-0000-000000000001', 'TEST0014: Classroom');

insert into public.students (id, first_name, last_name, student_code, linked_profile_id) values
  ('00000000-0014-0002-0000-000000000001', 'TEST0014: Student', 'One', 'T14-001', '00000000-0014-0000-0000-000000000002');

insert into public.classroom_students (classroom_id, student_id) values
  ('00000000-0014-0001-0000-000000000001', '00000000-0014-0002-0000-000000000001');

insert into public.subjects (id, teacher_id, name) values
  ('00000000-0014-0003-0000-000000000001', '00000000-0014-0000-0000-000000000001', 'TEST0014: Subject');
insert into public.subject_classrooms (subject_id, classroom_id) values
  ('00000000-0014-0003-0000-000000000001', '00000000-0014-0001-0000-000000000001');

insert into public.assignments (id, subject_id, classroom_id, title, created_by) values
  ('00000000-0014-0004-0000-000000000001', '00000000-0014-0003-0000-000000000001', '00000000-0014-0001-0000-000000000001', 'TEST0014: Assignment', '00000000-0014-0000-0000-000000000001');

insert into public.assignment_submissions (assignment_id, student_id, status, score) values
  ('00000000-0014-0004-0000-000000000001', '00000000-0014-0002-0000-000000000001', 'submitted', 90);

insert into public.attendance_sessions (id, classroom_id, subject_id, attendance_date, created_by) values
  ('00000000-0014-0005-0000-000000000001', '00000000-0014-0001-0000-000000000001', '00000000-0014-0003-0000-000000000001', current_date, '00000000-0014-0000-0000-000000000001');
insert into public.attendance_records (attendance_session_id, student_id, status) values
  ('00000000-0014-0005-0000-000000000001', '00000000-0014-0002-0000-000000000001', 'present');

-- ==================================================
-- TEST 2: the full read chain, end to end, as the approved linked
-- student — every hop from auth.uid() to attendance_records.
-- ==================================================
set role authenticated;
select set_test_user('00000000-0014-0000-0000-000000000002');

do $$
declare
  v_count int;
begin
  -- auth.uid() -> students.linked_profile_id -> students.id
  select count(*) into v_count from public.students where id = '00000000-0014-0002-0000-000000000001';
  if v_count <> 1 then raise exception 'TEST 2a FAILED: student cannot read own students row'; end if;

  -- students.id -> classroom_students
  select count(*) into v_count from public.classroom_students where student_id = '00000000-0014-0002-0000-000000000001';
  if v_count <> 1 then raise exception 'TEST 2b FAILED: student cannot read own classroom_students row'; end if;

  -- classroom_students -> classrooms
  select count(*) into v_count from public.classrooms where id = '00000000-0014-0001-0000-000000000001';
  if v_count <> 1 then raise exception 'TEST 2c FAILED: student cannot read own classroom'; end if;

  -- classrooms -> subject_classrooms
  select count(*) into v_count from public.subject_classrooms where classroom_id = '00000000-0014-0001-0000-000000000001';
  if v_count <> 1 then raise exception 'TEST 2d FAILED: student cannot read subject_classrooms link'; end if;

  -- subject_classrooms -> subjects (the specific hop the production
  -- symptom pointed at)
  select count(*) into v_count from public.subjects where id = '00000000-0014-0003-0000-000000000001';
  if v_count <> 1 then raise exception 'TEST 2e FAILED: student cannot read linked subject'; end if;

  -- classrooms -> assignments
  select count(*) into v_count from public.assignments where classroom_id = '00000000-0014-0001-0000-000000000001';
  if v_count <> 1 then raise exception 'TEST 2f FAILED: student cannot read assignment'; end if;

  -- own assignment_submissions (grades)
  select count(*) into v_count from public.assignment_submissions where student_id = '00000000-0014-0002-0000-000000000001';
  if v_count <> 1 then raise exception 'TEST 2g FAILED: student cannot read own submission/grade'; end if;

  -- classrooms -> attendance_sessions
  select count(*) into v_count from public.attendance_sessions where classroom_id = '00000000-0014-0001-0000-000000000001';
  if v_count <> 1 then raise exception 'TEST 2h FAILED: student cannot read attendance session'; end if;

  -- own attendance_records
  select count(*) into v_count from public.attendance_records where student_id = '00000000-0014-0002-0000-000000000001';
  if v_count <> 1 then raise exception 'TEST 2i FAILED: student cannot read own attendance record'; end if;

  raise notice 'TEST 2 passed: the full auth.uid() -> ... -> attendance_records chain works end to end after 0014';
end $$;

reset role;

-- ==================================================
-- Cleanup
-- ==================================================

delete from public.assignment_submissions where assignment_id in (
  select id from public.assignments where title like 'TEST0014:%'
);
delete from public.assignments where title like 'TEST0014:%';
delete from public.attendance_records where attendance_session_id in (
  select id from public.attendance_sessions where classroom_id = '00000000-0014-0001-0000-000000000001'
);
delete from public.attendance_sessions where classroom_id = '00000000-0014-0001-0000-000000000001';
delete from public.subject_classrooms where subject_id = '00000000-0014-0003-0000-000000000001';
delete from public.subjects where name like 'TEST0014:%';
delete from public.classroom_students where classroom_id = '00000000-0014-0001-0000-000000000001';
delete from public.students where first_name like 'TEST0014:%';
delete from public.classrooms where name like 'TEST0014:%';
delete from public.profiles where display_name like 'TEST0014:%';
delete from auth.users where email like 'test0014_%';

do $$
begin
  alter table auth.users enable trigger on_auth_user_created;
exception when undefined_object then null;
end $$;

\echo '0014_fix_student_academic_read_access.sql: ALL TESTS PASSED'
