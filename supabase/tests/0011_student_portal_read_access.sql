-- Regression test: Student Portal Phase 2 read access (0011).
--
-- This is a DEV-ONLY verification script, not a migration — it is never
-- applied to any real database and is not run automatically by anything.
-- See supabase/tests/0009_student_link_rpc_permissions.sql for the local
-- Postgres + auth-shim setup this assumes (apply every migration through
-- 0011 in order, then run this).

\set ON_ERROR_STOP 1

-- ==================================================
-- Fixtures (idempotent — safe to re-run against the same database)
-- ==================================================

delete from public.attendance_records where attendance_session_id in (
  select id from public.attendance_sessions where classroom_id in (
    '11111112-0000-0000-0000-000000000001', '11111112-0000-0000-0000-000000000009'
  )
);
delete from public.attendance_sessions where classroom_id in (
  '11111112-0000-0000-0000-000000000001', '11111112-0000-0000-0000-000000000009'
);
delete from public.assignment_submissions where assignment_id in (
  select id from public.assignments where classroom_id in (
    '11111112-0000-0000-0000-000000000001', '11111112-0000-0000-0000-000000000009'
  )
);
delete from public.assignments where classroom_id in (
  '11111112-0000-0000-0000-000000000001', '11111112-0000-0000-0000-000000000009'
);
delete from public.student_account_link_requests where requested_by in (
  '11111113-0000-0000-0000-000000000001', '11111113-0000-0000-0000-000000000002',
  '11111113-0000-0000-0000-000000000003', '11111113-0000-0000-0000-000000000004'
);
delete from public.classroom_students where classroom_id in (
  '11111112-0000-0000-0000-000000000001', '11111112-0000-0000-0000-000000000009'
);
delete from public.subject_classrooms where classroom_id in (
  '11111112-0000-0000-0000-000000000001', '11111112-0000-0000-0000-000000000009'
);
delete from public.students where created_by in (
  '11111111-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000002'
);
delete from public.subjects where teacher_id in (
  '11111111-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000002'
);
delete from public.classrooms where id in (
  '11111112-0000-0000-0000-000000000001', '11111112-0000-0000-0000-000000000009'
);
delete from public.profiles where id in (
  '11111111-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000002',
  '11111113-0000-0000-0000-000000000001', '11111113-0000-0000-0000-000000000002',
  '11111113-0000-0000-0000-000000000003', '11111113-0000-0000-0000-000000000004'
);
delete from auth.users where id in (
  '11111111-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000002',
  '11111113-0000-0000-0000-000000000001', '11111113-0000-0000-0000-000000000002',
  '11111113-0000-0000-0000-000000000003', '11111113-0000-0000-0000-000000000004'
);

-- Teacher A: classroom 5/1, subject คณิตศาสตร์, students Alice + Bob.
insert into auth.users (id, email) values ('11111111-0000-0000-0000-000000000001', 'sp11-teacher-a@example.com');
insert into public.profiles (id, email, display_name, role) values
  ('11111111-0000-0000-0000-000000000001', 'sp11-teacher-a@example.com', 'SP11 Teacher A', 'teacher');
insert into public.classrooms (id, teacher_id, name) values
  ('11111112-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'SP11 5/1');
insert into public.subjects (id, teacher_id, name) values
  ('11111114-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'SP11 คณิตศาสตร์');
insert into public.subject_classrooms (subject_id, classroom_id) values
  ('11111114-0000-0000-0000-000000000001', '11111112-0000-0000-0000-000000000001');
insert into public.students (id, student_code, number, first_name, last_name, status, created_by) values
  ('11111115-0000-0000-0000-000000000001', 'sp11-01', 1, 'SP11Alice', 'Test', 'active', '11111111-0000-0000-0000-000000000001'),
  ('11111115-0000-0000-0000-000000000002', 'sp11-02', 2, 'SP11Bob', 'Test', 'active', '11111111-0000-0000-0000-000000000001');
insert into public.classroom_students (classroom_id, student_id) values
  ('11111112-0000-0000-0000-000000000001', '11111115-0000-0000-0000-000000000001'),
  ('11111112-0000-0000-0000-000000000001', '11111115-0000-0000-0000-000000000002');
insert into public.assignments (id, subject_id, classroom_id, title, max_score, created_by) values
  ('11111116-0000-0000-0000-000000000001', '11111114-0000-0000-0000-000000000001', '11111112-0000-0000-0000-000000000001', 'SP11 Assignment', 100, '11111111-0000-0000-0000-000000000001');
insert into public.assignment_submissions (assignment_id, student_id, status, score) values
  ('11111116-0000-0000-0000-000000000001', '11111115-0000-0000-0000-000000000001', 'submitted', 88),
  ('11111116-0000-0000-0000-000000000001', '11111115-0000-0000-0000-000000000002', 'submitted', 55);
insert into public.attendance_sessions (id, classroom_id, subject_id, period_number, attendance_date, created_by) values
  ('11111117-0000-0000-0000-000000000001', '11111112-0000-0000-0000-000000000001', null, null, current_date, '11111111-0000-0000-0000-000000000001');
insert into public.attendance_records (attendance_session_id, student_id, status) values
  ('11111117-0000-0000-0000-000000000001', '11111115-0000-0000-0000-000000000001', 'present'),
  ('11111117-0000-0000-0000-000000000001', '11111115-0000-0000-0000-000000000002', 'absent');

-- Teacher B: a completely unrelated classroom/subject/student.
insert into auth.users (id, email) values ('11111111-0000-0000-0000-000000000002', 'sp11-teacher-b@example.com');
insert into public.profiles (id, email, display_name, role) values
  ('11111111-0000-0000-0000-000000000002', 'sp11-teacher-b@example.com', 'SP11 Teacher B', 'teacher');
insert into public.classrooms (id, teacher_id, name) values
  ('11111112-0000-0000-0000-000000000009', '11111111-0000-0000-0000-000000000002', 'SP11 5/9');
insert into public.subjects (id, teacher_id, name) values
  ('11111114-0000-0000-0000-000000000009', '11111111-0000-0000-0000-000000000002', 'SP11 English');
insert into public.subject_classrooms (subject_id, classroom_id) values
  ('11111114-0000-0000-0000-000000000009', '11111112-0000-0000-0000-000000000009');

-- Student portal accounts: Alice (approved), Bob (approved), pending,
-- rejected, never-linked.
insert into auth.users (id, email) values
  ('11111113-0000-0000-0000-000000000001', 'sp11-alice-portal@example.com'),
  ('11111113-0000-0000-0000-000000000002', 'sp11-bob-portal@example.com'),
  ('11111113-0000-0000-0000-000000000003', 'sp11-pending-portal@example.com'),
  ('11111113-0000-0000-0000-000000000004', 'sp11-unlinked-portal@example.com');
insert into public.profiles (id, email, display_name, role) values
  ('11111113-0000-0000-0000-000000000001', 'sp11-alice-portal@example.com', 'SP11 Alice Portal', 'student'),
  ('11111113-0000-0000-0000-000000000002', 'sp11-bob-portal@example.com', 'SP11 Bob Portal', 'student'),
  ('11111113-0000-0000-0000-000000000003', 'sp11-pending-portal@example.com', 'SP11 Pending Portal', 'student'),
  ('11111113-0000-0000-0000-000000000004', 'sp11-unlinked-portal@example.com', 'SP11 Unlinked Portal', 'student');
update public.students set linked_profile_id = '11111113-0000-0000-0000-000000000001' where id = '11111115-0000-0000-0000-000000000001';
update public.students set linked_profile_id = '11111113-0000-0000-0000-000000000002' where id = '11111115-0000-0000-0000-000000000002';

insert into public.students (id, student_code, number, first_name, last_name, status, created_by) values
  ('11111115-0000-0000-0000-000000000003', 'sp11-03', 3, 'SP11Pending', 'Test', 'active', '11111111-0000-0000-0000-000000000001');
insert into public.classroom_students (classroom_id, student_id) values
  ('11111112-0000-0000-0000-000000000001', '11111115-0000-0000-0000-000000000003');
insert into public.student_account_link_requests (student_id, requested_by, status) values
  ('11111115-0000-0000-0000-000000000003', '11111113-0000-0000-0000-000000000003', 'pending');

-- ==================================================
-- Assertions
-- ==================================================

do $$
declare
  v_count integer;
  v_rows integer;
  v_status text;
  v_score numeric;
  v_new_student_id uuid;
begin

  ---------------------------------------------------------------------
  -- 1. Approved student sees own dashboard data.
  ---------------------------------------------------------------------
  set role authenticated;
  perform set_test_user('11111113-0000-0000-0000-000000000001');

  if my_student_id() <> '11111115-0000-0000-0000-000000000001' then
    raise exception 'REGRESSION: my_student_id() did not resolve to Alice';
  end if;
  select count(*) into v_count from classrooms; if v_count <> 1 then raise exception 'REGRESSION: expected 1 classroom, got %', v_count; end if;
  select count(*) into v_count from subjects; if v_count <> 1 then raise exception 'REGRESSION: expected 1 subject, got %', v_count; end if;
  select count(*) into v_count from assignments; if v_count <> 1 then raise exception 'REGRESSION: expected 1 assignment, got %', v_count; end if;
  select count(*) into v_count from assignment_submissions; if v_count <> 1 then raise exception 'REGRESSION: expected 1 own submission, got %', v_count; end if;
  select count(*) into v_count from attendance_records; if v_count <> 1 then raise exception 'REGRESSION: expected 1 own attendance record, got %', v_count; end if;
  raise notice 'PASS 1: approved student sees own dashboard data (classroom, subject, assignment, submission, attendance)';

  reset role;

  ---------------------------------------------------------------------
  -- 2. Pending student blocked.
  ---------------------------------------------------------------------
  set role authenticated;
  perform set_test_user('11111113-0000-0000-0000-000000000003');
  if my_student_id() is not null then raise exception 'REGRESSION: pending student resolved a my_student_id()'; end if;
  select count(*) into v_count from students; if v_count <> 0 then raise exception 'REGRESSION: pending student sees % students rows', v_count; end if;
  select count(*) into v_count from classrooms; if v_count <> 0 then raise exception 'REGRESSION: pending student sees % classrooms', v_count; end if;
  raise notice 'PASS 2: pending student blocked from all new read access';
  reset role;

  ---------------------------------------------------------------------
  -- 3. Never-linked (unlinked) student blocked.
  ---------------------------------------------------------------------
  set role authenticated;
  perform set_test_user('11111113-0000-0000-0000-000000000004');
  if my_student_id() is not null then raise exception 'REGRESSION: unlinked student resolved a my_student_id()'; end if;
  select count(*) into v_count from classrooms; if v_count <> 0 then raise exception 'REGRESSION: unlinked student sees % classrooms', v_count; end if;
  select count(*) into v_count from subjects; if v_count <> 0 then raise exception 'REGRESSION: unlinked student sees % subjects', v_count; end if;
  raise notice 'PASS 3: never-linked student blocked from all new read access';
  reset role;

  ---------------------------------------------------------------------
  -- 4. Student A (Alice) cannot read student B (Bob)'s grades/submissions.
  ---------------------------------------------------------------------
  set role authenticated;
  perform set_test_user('11111113-0000-0000-0000-000000000001');
  select count(*) into v_count from assignment_submissions where student_id = '11111115-0000-0000-0000-000000000002';
  if v_count <> 0 then raise exception 'REGRESSION: Alice can see Bob''s submission row(s)'; end if;
  raise notice 'PASS 4: Alice cannot read Bob''s grades/submissions';
  reset role;

  ---------------------------------------------------------------------
  -- 5. Student A (Alice) cannot read student B (Bob)'s attendance.
  ---------------------------------------------------------------------
  set role authenticated;
  perform set_test_user('11111113-0000-0000-0000-000000000001');
  select count(*) into v_count from attendance_records where student_id = '11111115-0000-0000-0000-000000000002';
  if v_count <> 0 then raise exception 'REGRESSION: Alice can see Bob''s attendance row(s)'; end if;
  raise notice 'PASS 5: Alice cannot read Bob''s attendance';
  reset role;

  ---------------------------------------------------------------------
  -- 6. Student cannot enumerate the classroom roster (classroom_students
  --    or students beyond their own single row).
  ---------------------------------------------------------------------
  set role authenticated;
  perform set_test_user('11111113-0000-0000-0000-000000000001');
  select count(*) into v_count from classroom_students; if v_count <> 1 then raise exception 'REGRESSION: Alice sees % classroom_students rows (roster enumeration)', v_count; end if;
  select count(*) into v_count from students; if v_count <> 1 then raise exception 'REGRESSION: Alice sees % students rows (roster enumeration)', v_count; end if;
  raise notice 'PASS 6: student cannot enumerate classmates via classroom_students or students';
  reset role;

  ---------------------------------------------------------------------
  -- 7. Subject/classroom isolation — Alice cannot see Teacher B's
  --    classroom or subject at all.
  ---------------------------------------------------------------------
  set role authenticated;
  perform set_test_user('11111113-0000-0000-0000-000000000001');
  select count(*) into v_count from classrooms where id = '11111112-0000-0000-0000-000000000009';
  if v_count <> 0 then raise exception 'REGRESSION: Alice can see an unrelated classroom'; end if;
  select count(*) into v_count from subjects where id = '11111114-0000-0000-0000-000000000009';
  if v_count <> 0 then raise exception 'REGRESSION: Alice can see an unrelated subject'; end if;
  raise notice 'PASS 7: subject/classroom isolation holds for an unrelated teacher''s data';
  reset role;

  ---------------------------------------------------------------------
  -- 8. Student cannot modify attendance, grades, or assignments — a raw
  --    student_id supplied in the WHERE clause changes nothing (RLS
  --    resolves identity server-side via my_student_id(), never the
  --    client-supplied filter).
  ---------------------------------------------------------------------
  set role authenticated;
  perform set_test_user('11111113-0000-0000-0000-000000000001');

  update attendance_records set status = 'absent' where student_id = '11111115-0000-0000-0000-000000000001';
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then raise exception 'REGRESSION: student updated % attendance_records row(s)', v_rows; end if;

  update assignment_submissions set score = 100 where student_id = '11111115-0000-0000-0000-000000000001';
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then raise exception 'REGRESSION: student updated % assignment_submissions row(s)', v_rows; end if;

  update assignments set title = 'hacked' where id = '11111116-0000-0000-0000-000000000001';
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then raise exception 'REGRESSION: student updated % assignments row(s)', v_rows; end if;

  begin
    insert into assignments (subject_id, classroom_id, title, max_score, created_by)
    values ('11111114-0000-0000-0000-000000000001', '11111112-0000-0000-0000-000000000001', 'fake', 10, my_student_id());
    raise exception 'REGRESSION: student inserted into assignments';
  exception
    when insufficient_privilege then null; -- expected
  end;

  raise notice 'PASS 8: student cannot modify attendance, grades, or assignments (0 rows affected / INSERT blocked)';
  reset role;

  -- Confirm nothing actually changed, as superuser.
  select status into v_status from attendance_records where attendance_session_id = '11111117-0000-0000-0000-000000000001' and student_id = '11111115-0000-0000-0000-000000000001';
  if v_status <> 'present' then raise exception 'REGRESSION: attendance status was actually mutated to %', v_status; end if;
  select score into v_score from assignment_submissions where assignment_id = '11111116-0000-0000-0000-000000000001' and student_id = '11111115-0000-0000-0000-000000000001';
  if v_score <> 88 then raise exception 'REGRESSION: submission score was actually mutated to %', v_score; end if;

  ---------------------------------------------------------------------
  -- 9. student_code change does not break an already-approved link.
  ---------------------------------------------------------------------
  update public.students set student_code = 'sp11-changed' where id = '11111115-0000-0000-0000-000000000001';

  set role authenticated;
  perform set_test_user('11111113-0000-0000-0000-000000000001');
  if my_student_id() <> '11111115-0000-0000-0000-000000000001' then
    raise exception 'REGRESSION: my_student_id() broke after a student_code change';
  end if;
  select count(*) into v_count from assignment_submissions; if v_count <> 1 then raise exception 'REGRESSION: lost own-data access after a student_code change'; end if;
  raise notice 'PASS 9: student_code change does not break the approved link';
  reset role;

  ---------------------------------------------------------------------
  -- 10. Existing teacher flow unaffected: create_student_and_enroll
  --     (which inserts into classroom_students) still works for the
  --     owning teacher — the regression class Phase 10 documented.
  ---------------------------------------------------------------------
  set role authenticated;
  perform set_test_user('11111111-0000-0000-0000-000000000001');
  select (create_student_and_enroll('11111112-0000-0000-0000-000000000001', 'SP11New', 'Test', 'sp11-99')).id into v_new_student_id;
  if v_new_student_id is null then raise exception 'REGRESSION: create_student_and_enroll failed for the owning teacher'; end if;
  raise notice 'PASS 10: create_student_and_enroll (classroom_students insert path) still works for the owning teacher';
  reset role;

  raise notice '=== ALL REGRESSION CHECKS PASSED ===';
end;
$$;

-- ==================================================
-- Cleanup
-- ==================================================

delete from public.attendance_records where attendance_session_id in (
  select id from public.attendance_sessions where classroom_id in (
    '11111112-0000-0000-0000-000000000001', '11111112-0000-0000-0000-000000000009'
  )
);
delete from public.attendance_sessions where classroom_id in (
  '11111112-0000-0000-0000-000000000001', '11111112-0000-0000-0000-000000000009'
);
delete from public.assignment_submissions where assignment_id in (
  select id from public.assignments where classroom_id in (
    '11111112-0000-0000-0000-000000000001', '11111112-0000-0000-0000-000000000009'
  )
);
delete from public.assignments where classroom_id in (
  '11111112-0000-0000-0000-000000000001', '11111112-0000-0000-0000-000000000009'
);
delete from public.student_account_link_requests where requested_by in (
  '11111113-0000-0000-0000-000000000001', '11111113-0000-0000-0000-000000000002',
  '11111113-0000-0000-0000-000000000003', '11111113-0000-0000-0000-000000000004'
);
delete from public.classroom_students where classroom_id in (
  '11111112-0000-0000-0000-000000000001', '11111112-0000-0000-0000-000000000009'
);
delete from public.subject_classrooms where classroom_id in (
  '11111112-0000-0000-0000-000000000001', '11111112-0000-0000-0000-000000000009'
);
delete from public.students where created_by in (
  '11111111-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000002'
);
delete from public.subjects where teacher_id in (
  '11111111-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000002'
);
delete from public.classrooms where id in (
  '11111112-0000-0000-0000-000000000001', '11111112-0000-0000-0000-000000000009'
);
delete from public.profiles where id in (
  '11111111-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000002',
  '11111113-0000-0000-0000-000000000001', '11111113-0000-0000-0000-000000000002',
  '11111113-0000-0000-0000-000000000003', '11111113-0000-0000-0000-000000000004'
);
delete from auth.users where id in (
  '11111111-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000002',
  '11111113-0000-0000-0000-000000000001', '11111113-0000-0000-0000-000000000002',
  '11111113-0000-0000-0000-000000000003', '11111113-0000-0000-0000-000000000004'
);
