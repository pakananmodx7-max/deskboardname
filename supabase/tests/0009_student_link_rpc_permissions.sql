-- Regression test: /student/link-account RPC permissions
-- (list_classrooms_for_student_code, find_student_for_link_in_classroom,
-- and the retirement of the old find_student_for_link).
--
-- This is a DEV-ONLY verification script, not a migration — it is never
-- applied to any real database and is not run automatically by anything.
-- It exists to catch the exact class of production incident documented
-- in docs/DATABASE.md ("Phase 12"): a GRANT/REVOKE regression that made
-- a correctly-provisioned student account get a generic permission
-- error instead of a successful lookup.
--
-- How to run (against a disposable local Postgres 16+ instance — NEVER
-- against Supabase/production):
--
--   createdb classroom_rpc_test
--   psql -d classroom_rpc_test -f supabase/tests/00_shim.sql        (see note below)
--   psql -d classroom_rpc_test -f supabase/migrations/0001_init.sql
--   ... apply every migration in order through the latest one ...
--   psql -v ON_ERROR_STOP=1 -d classroom_rpc_test -f supabase/tests/0009_student_link_rpc_permissions.sql
--   dropdb classroom_rpc_test
--
-- There is no committed 00_shim.sql in this repo (Supabase's `auth`
-- schema — auth.users, auth.uid() — only exists on a real Supabase
-- project, never in a bare local Postgres) — see docs/DATABASE.md's
-- "Empirical RLS/RPC verification" methodology for the minimal shim
-- (auth.users table, auth.uid() reading a GUC, set_test_user()/
-- clear_test_user() helpers, authenticated/anon roles) every phase of
-- this project has used to test RLS/RPC behavior locally. This script
-- assumes that shim (or an equivalent) plus every migration through the
-- one it is named after are already applied, and creates its own
-- fixtures fresh each run.

\set ON_ERROR_STOP 1

-- ==================================================
-- Fixtures (idempotent — safe to re-run against the same database)
-- ==================================================

delete from public.student_account_link_requests where requested_by in (
  '99999991-0000-0000-0000-000000000001', '99999991-0000-0000-0000-000000000002'
);
delete from public.classroom_students where classroom_id = '99999992-0000-0000-0000-000000000001';
delete from public.students where id = '99999993-0000-0000-0000-000000000001';
delete from public.classrooms where id = '99999992-0000-0000-0000-000000000001';
delete from public.profiles where id in (
  '99999991-0000-0000-0000-000000000001', -- student, correctly provisioned
  '99999991-0000-0000-0000-000000000002', -- teacher (wrong-role caller)
  '99999991-0000-0000-0000-000000000003', -- teacher who owns the classroom
  '99999991-0000-0000-0000-000000000004'  -- auth user with NO profile row
);
delete from auth.users where id in (
  '99999991-0000-0000-0000-000000000001',
  '99999991-0000-0000-0000-000000000002',
  '99999991-0000-0000-0000-000000000003',
  '99999991-0000-0000-0000-000000000004'
);

insert into auth.users (id, email) values
  ('99999991-0000-0000-0000-000000000003', 'rpctest-teacher@example.com');
insert into public.profiles (id, email, display_name, role) values
  ('99999991-0000-0000-0000-000000000003', 'rpctest-teacher@example.com', 'RPC Test Teacher', 'teacher');

insert into public.classrooms (id, teacher_id, name) values
  ('99999992-0000-0000-0000-000000000001', '99999991-0000-0000-0000-000000000003', 'ม.5/1 (rpc test)');

insert into public.students (id, student_code, first_name, last_name, created_by) values
  ('99999993-0000-0000-0000-000000000001', '04102', 'ทดสอบ', 'ระบบ', '99999991-0000-0000-0000-000000000003');

insert into public.classroom_students (classroom_id, student_id) values
  ('99999992-0000-0000-0000-000000000001', '99999993-0000-0000-0000-000000000001');

insert into auth.users (id, email) values
  ('99999991-0000-0000-0000-000000000001', 'rpctest-student@example.com'),
  ('99999991-0000-0000-0000-000000000002', 'rpctest-teacher-caller@example.com'),
  ('99999991-0000-0000-0000-000000000004', 'rpctest-no-profile@example.com');
insert into public.profiles (id, email, display_name, role) values
  ('99999991-0000-0000-0000-000000000001', 'rpctest-student@example.com', 'RPC Test Student', 'student'),
  ('99999991-0000-0000-0000-000000000002', 'rpctest-teacher-caller@example.com', 'RPC Test Teacher Caller', 'teacher');
-- deliberately no profiles row for 99999991-...-000000000004

-- ==================================================
-- Assertions
-- ==================================================

do $$
declare
  v_count integer;
  v_classroom_id uuid;
  v_classroom_name text;
begin

  ---------------------------------------------------------------------
  -- 1. authenticated student (role='student') -> list_classrooms_for_student_code
  --    ('04102') succeeds and returns ONLY the one classroom containing
  --    that code, with minimal columns.
  ---------------------------------------------------------------------
  set role authenticated;
  perform set_test_user('99999991-0000-0000-0000-000000000001');

  select count(*) into v_count from list_classrooms_for_student_code('04102');
  if v_count <> 1 then
    raise exception 'REGRESSION: expected exactly 1 classroom for code 04102, got %', v_count;
  end if;

  select classroom_id, classroom_name into v_classroom_id, v_classroom_name
  from list_classrooms_for_student_code('04102');
  if v_classroom_id <> '99999992-0000-0000-0000-000000000001' or v_classroom_name <> 'ม.5/1 (rpc test)' then
    raise exception 'REGRESSION: list_classrooms_for_student_code returned unexpected data: % / %', v_classroom_id, v_classroom_name;
  end if;

  raise notice 'PASS 1: authenticated student -> list_classrooms_for_student_code succeeds, minimal data only';

  ---------------------------------------------------------------------
  -- 1b. Same student -> find_student_for_link_in_classroom succeeds too
  ---------------------------------------------------------------------
  select count(*) into v_count
  from find_student_for_link_in_classroom('04102', '99999992-0000-0000-0000-000000000001');
  if v_count <> 1 then
    raise exception 'REGRESSION: find_student_for_link_in_classroom expected 1 match, got %', v_count;
  end if;
  raise notice 'PASS 1b: authenticated student -> find_student_for_link_in_classroom succeeds';

  reset role;

  ---------------------------------------------------------------------
  -- 2. teacher (role='teacher') calling list_classrooms_for_student_code
  --    -> must be REJECTED with OUR OWN Thai role-guard message, NOT a
  --    raw Postgres permission-denied (i.e. EXECUTE must stay granted;
  --    the ROLE CHECK inside the function is what blocks a teacher).
  ---------------------------------------------------------------------
  set role authenticated;
  perform set_test_user('99999991-0000-0000-0000-000000000002');

  begin
    perform * from list_classrooms_for_student_code('04102');
    raise exception 'REGRESSION: a teacher-role caller was NOT rejected';
  exception
    when sqlstate '42501' then
      if sqlerrm !~ '[ก-๙]' then
        raise exception 'REGRESSION: teacher caller got a non-Thai (raw Postgres) permission error instead of our role-guard message: %', sqlerrm;
      end if;
      raise notice 'PASS 2: teacher caller rejected with our own role-guard message (%.)', sqlerrm;
  end;

  reset role;

  ---------------------------------------------------------------------
  -- 3. no session at all (auth.uid() is null) -> REJECTED with our own
  --    "please sign in" message.
  ---------------------------------------------------------------------
  set role authenticated;
  perform clear_test_user();

  begin
    perform * from list_classrooms_for_student_code('04102');
    raise exception 'REGRESSION: an anonymous (no-session) caller was NOT rejected';
  exception
    when sqlstate '28000' then
      raise notice 'PASS 3: no-session caller rejected (%.)', sqlerrm;
  end;

  reset role;

  ---------------------------------------------------------------------
  -- 4. authenticated session but NO profiles row at all ("invalid
  --    caller") -> treated the same as a non-student, REJECTED.
  ---------------------------------------------------------------------
  set role authenticated;
  perform set_test_user('99999991-0000-0000-0000-000000000004');

  begin
    perform * from list_classrooms_for_student_code('04102');
    raise exception 'REGRESSION: a caller with no profiles row was NOT rejected';
  exception
    when sqlstate '42501' then
      raise notice 'PASS 4: caller with no profile row rejected (%.)', sqlerrm;
  end;

  reset role;

  ---------------------------------------------------------------------
  -- 5. the literal Postgres `anon` role must never have EXECUTE at all.
  ---------------------------------------------------------------------
  if has_function_privilege('anon', 'public.list_classrooms_for_student_code(text)', 'EXECUTE') then
    raise exception 'REGRESSION: anon role has EXECUTE on list_classrooms_for_student_code';
  end if;
  if has_function_privilege('anon', 'public.find_student_for_link_in_classroom(text, uuid)', 'EXECUTE') then
    raise exception 'REGRESSION: anon role has EXECUTE on find_student_for_link_in_classroom';
  end if;
  raise notice 'PASS 5: anon role has no EXECUTE on either RPC';

  ---------------------------------------------------------------------
  -- 6. authenticated MUST have EXECUTE on both new RPCs, and must NOT
  --    have EXECUTE on the old, retired find_student_for_link(text).
  ---------------------------------------------------------------------
  if not has_function_privilege('authenticated', 'public.list_classrooms_for_student_code(text)', 'EXECUTE') then
    raise exception 'REGRESSION: authenticated is missing EXECUTE on list_classrooms_for_student_code — this is exactly the production incident';
  end if;
  if not has_function_privilege('authenticated', 'public.find_student_for_link_in_classroom(text, uuid)', 'EXECUTE') then
    raise exception 'REGRESSION: authenticated is missing EXECUTE on find_student_for_link_in_classroom — this is exactly the production incident';
  end if;
  if has_function_privilege('authenticated', 'public.find_student_for_link(text)', 'EXECUTE') then
    raise exception 'REGRESSION: authenticated still has EXECUTE on the retired find_student_for_link(text)';
  end if;
  raise notice 'PASS 6: authenticated grant state is exactly as intended';

  raise notice '=== ALL REGRESSION CHECKS PASSED ===';
end;
$$;

-- ==================================================
-- Cleanup
-- ==================================================

delete from public.classroom_students where classroom_id = '99999992-0000-0000-0000-000000000001';
delete from public.students where id = '99999993-0000-0000-0000-000000000001';
delete from public.classrooms where id = '99999992-0000-0000-0000-000000000001';
delete from public.profiles where id in (
  '99999991-0000-0000-0000-000000000001',
  '99999991-0000-0000-0000-000000000002',
  '99999991-0000-0000-0000-000000000003',
  '99999991-0000-0000-0000-000000000004'
);
delete from auth.users where id in (
  '99999991-0000-0000-0000-000000000001',
  '99999991-0000-0000-0000-000000000002',
  '99999991-0000-0000-0000-000000000003',
  '99999991-0000-0000-0000-000000000004'
);
