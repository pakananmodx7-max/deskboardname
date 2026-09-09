-- Regression test: classroom Attendance roster/session behavior + RLS.
--
-- This is a DEV-ONLY verification script, not a migration — it is never
-- applied to any real database and is not run automatically by anything.
-- It exists to catch the exact class of production incident documented
-- in docs/DATABASE.md ("Phase 13"): a classroom with a real roster (31
-- students) showed "ยังไม่มีนักเรียนในห้องเรียนนี้" (0 students) on
-- /teacher/attendance because the roster load and the attendance-session
-- load were combined via Promise.all, so a failure/anomaly in the
-- session lookup wiped out the already-successful roster load too. The
-- fix is primarily a frontend one (see attendance-service.ts's
-- buildRecordsForRoster and attendance-page-real.tsx) — this script
-- verifies the DATABASE side of the story: that the roster query and the
-- session lookup both behave correctly and cannot silently return more
-- than the schema's own unique indexes allow, and that RLS still
-- correctly scopes everything to the owning teacher.
--
-- How to run (against a disposable local Postgres 16+ instance — NEVER
-- against Supabase/production): see supabase/tests/0009_student_link_rpc_permissions.sql
-- for the full local-Postgres + auth-shim setup this assumes (apply
-- every migration through the latest one first, in order).

\set ON_ERROR_STOP 1

-- ==================================================
-- Fixtures (idempotent — safe to re-run against the same database)
-- ==================================================

delete from public.attendance_records where attendance_session_id in (
  select id from public.attendance_sessions where classroom_id = '99999992-0000-0000-0000-000000000010'
);
delete from public.attendance_sessions where classroom_id = '99999992-0000-0000-0000-000000000010';
delete from public.classroom_students where classroom_id = '99999992-0000-0000-0000-000000000010';
delete from public.students where created_by = '99999991-0000-0000-0000-000000000013';
delete from public.classrooms where id = '99999992-0000-0000-0000-000000000010';
delete from public.profiles where id in (
  '99999991-0000-0000-0000-000000000013', -- teacher A, owns the classroom
  '99999991-0000-0000-0000-000000000014'  -- teacher B, owns nothing here
);
delete from auth.users where id in (
  '99999991-0000-0000-0000-000000000013',
  '99999991-0000-0000-0000-000000000014'
);

insert into auth.users (id, email) values
  ('99999991-0000-0000-0000-000000000013', 'rpctest-att-teacher-a@example.com'),
  ('99999991-0000-0000-0000-000000000014', 'rpctest-att-teacher-b@example.com');
insert into public.profiles (id, email, display_name, role) values
  ('99999991-0000-0000-0000-000000000013', 'rpctest-att-teacher-a@example.com', 'Attendance Test Teacher A', 'teacher'),
  ('99999991-0000-0000-0000-000000000014', 'rpctest-att-teacher-b@example.com', 'Attendance Test Teacher B', 'teacher');

insert into public.classrooms (id, teacher_id, name) values
  ('99999992-0000-0000-0000-000000000010', '99999991-0000-0000-0000-000000000013', 'rpctest-vfdzsvz');

do $$
declare
  i integer;
  v_student_id uuid;
begin
  for i in 1..31 loop
    v_student_id := ('99999993-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid;
    insert into public.students (id, student_code, number, first_name, last_name, status, created_by)
    values (v_student_id, lpad(i::text, 5, '0'), i, 'นักเรียนทดสอบ', i::text, 'active', '99999991-0000-0000-0000-000000000013');
    insert into public.classroom_students (classroom_id, student_id)
    values ('99999992-0000-0000-0000-000000000010', v_student_id);
  end loop;
end
$$;

-- ==================================================
-- Assertions
-- ==================================================

do $$
declare
  v_count integer;
  v_session_id uuid;
  v_records jsonb;
begin

  ---------------------------------------------------------------------
  -- 1. Owning teacher: roster query returns all 31 active students.
  ---------------------------------------------------------------------
  set role authenticated;
  perform set_test_user('99999991-0000-0000-0000-000000000013');

  select count(*) into v_count
  from public.classroom_students cs
  join public.students s on s.id = cs.student_id
  where cs.classroom_id = '99999992-0000-0000-0000-000000000010' and s.status = 'active';

  if v_count <> 31 then
    raise exception 'REGRESSION: expected 31 active students in the roster, got %', v_count;
  end if;
  raise notice 'PASS 1: owning teacher sees all 31 active students';

  ---------------------------------------------------------------------
  -- 2. No attendance session yet for today -> 0 rows, NO ERROR (this is
  --    the exact query getAttendance() runs; it must never throw just
  --    because nothing has been saved yet).
  ---------------------------------------------------------------------
  select count(*) into v_count
  from public.attendance_sessions
  where classroom_id = '99999992-0000-0000-0000-000000000010'
    and attendance_date = current_date
    and subject_id is null
    and period_number is null;

  if v_count <> 0 then
    raise exception 'REGRESSION: expected 0 sessions before any save, got %', v_count;
  end if;
  raise notice 'PASS 2: no-session-yet lookup returns 0 rows without error';

  ---------------------------------------------------------------------
  -- 3. save_attendance_session for all 31 students defaulting to "มา"
  --    succeeds as a single atomic call.
  ---------------------------------------------------------------------
  select jsonb_agg(jsonb_build_object('student_id', cs.student_id, 'status', 'present', 'note', null))
  into v_records
  from public.classroom_students cs
  where cs.classroom_id = '99999992-0000-0000-0000-000000000010';

  perform public.save_attendance_session('99999992-0000-0000-0000-000000000010'::uuid, current_date, v_records);
  raise notice 'PASS 3: save_attendance_session succeeded for all 31 students';

  ---------------------------------------------------------------------
  -- 4. Re-fetch: exactly 1 session, 31 records — the unique index
  --    (attendance_sessions_classroom_date_no_subject_uidx) holds and
  --    the RPC's ON CONFLICT correctly upserts rather than duplicating.
  ---------------------------------------------------------------------
  select id into v_session_id
  from public.attendance_sessions
  where classroom_id = '99999992-0000-0000-0000-000000000010'
    and attendance_date = current_date and subject_id is null;

  select count(*) into v_count
  from public.attendance_sessions
  where classroom_id = '99999992-0000-0000-0000-000000000010' and attendance_date = current_date and subject_id is null;
  if v_count <> 1 then
    raise exception 'REGRESSION: expected exactly 1 homeroom session row, got %', v_count;
  end if;

  select count(*) into v_count from public.attendance_records where attendance_session_id = v_session_id;
  if v_count <> 31 then
    raise exception 'REGRESSION: expected exactly 31 attendance_records, got %', v_count;
  end if;
  raise notice 'PASS 4: exactly 1 session row and 31 records after save (no duplication)';

  ---------------------------------------------------------------------
  -- 5. A direct duplicate INSERT (bypassing the RPC entirely) for the
  --    SAME classroom+date+null-subject+null-period is rejected by the
  --    unique index — proving true duplicates cannot occur via any
  --    normal write path, RPC or otherwise.
  ---------------------------------------------------------------------
  begin
    insert into public.attendance_sessions (classroom_id, subject_id, period_number, attendance_date, created_by)
    values ('99999992-0000-0000-0000-000000000010', null, null, current_date, '99999991-0000-0000-0000-000000000013');
    raise exception 'REGRESSION: a duplicate homeroom session was NOT rejected by the unique index';
  exception
    when unique_violation then
      raise notice 'PASS 5: duplicate homeroom session correctly rejected by attendance_sessions_classroom_date_no_subject_uidx';
  end;

  reset role;

  ---------------------------------------------------------------------
  -- 6. Unauthorized access: Teacher B (does not own this classroom)
  --    sees NOTHING — roster, session, or records.
  ---------------------------------------------------------------------
  set role authenticated;
  perform set_test_user('99999991-0000-0000-0000-000000000014');

  select count(*) into v_count
  from public.classroom_students cs
  join public.students s on s.id = cs.student_id
  where cs.classroom_id = '99999992-0000-0000-0000-000000000010';
  if v_count <> 0 then
    raise exception 'REGRESSION: teacher B can see classroom-A roster rows (%)', v_count;
  end if;

  select count(*) into v_count
  from public.attendance_sessions where classroom_id = '99999992-0000-0000-0000-000000000010';
  if v_count <> 0 then
    raise exception 'REGRESSION: teacher B can see classroom-A attendance_sessions rows (%)', v_count;
  end if;

  select count(*) into v_count
  from public.attendance_records ar
  join public.attendance_sessions s on s.id = ar.attendance_session_id
  where s.classroom_id = '99999992-0000-0000-0000-000000000010';
  if v_count <> 0 then
    raise exception 'REGRESSION: teacher B can see classroom-A attendance_records rows (%)', v_count;
  end if;

  raise notice 'PASS 6: unauthorized teacher sees zero rows across roster/sessions/records';

  reset role;

  raise notice '=== ALL REGRESSION CHECKS PASSED ===';
end;
$$;

-- ==================================================
-- Cleanup
-- ==================================================

delete from public.attendance_records where attendance_session_id in (
  select id from public.attendance_sessions where classroom_id = '99999992-0000-0000-0000-000000000010'
);
delete from public.attendance_sessions where classroom_id = '99999992-0000-0000-0000-000000000010';
delete from public.classroom_students where classroom_id = '99999992-0000-0000-0000-000000000010';
delete from public.students where created_by = '99999991-0000-0000-0000-000000000013';
delete from public.classrooms where id = '99999992-0000-0000-0000-000000000010';
delete from public.profiles where id in (
  '99999991-0000-0000-0000-000000000013',
  '99999991-0000-0000-0000-000000000014'
);
delete from auth.users where id in (
  '99999991-0000-0000-0000-000000000013',
  '99999991-0000-0000-0000-000000000014'
);
