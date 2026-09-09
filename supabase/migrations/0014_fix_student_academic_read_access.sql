-- AI Classroom Management — corrective migration for a persistent
-- production defect: an approved, linked student sees
-- "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง" on /student/subjects,
-- /student/attendance, and the dashboard's subjects/assignments/
-- attendance widgets, WHILE /student/dashboard's classroom identity (via
-- getMyClassrooms(), which touches ONLY the `classrooms` table) renders
-- correctly. This migration has NOT been applied to a live database yet
-- — do NOT run it automatically. 0001-0013 have already been applied and
-- are NOT modified here (0011 in particular is frozen — see below for
-- why this is a NEW migration rather than an edit to it).
--
-- ==================================================
-- WHY THIS MIGRATION EXISTS AT ALL
-- ==================================================
--
-- Every query the student portal's subjects/assignments/attendance code
-- performs (getMySubjects, getMyAssignments, getMyAttendance — see
-- student-portal-service.ts) was re-traced against a LOCAL Postgres
-- instance that applies 0001_init.sql through 0011_student_portal_read_access.sql
-- and 0013_assignment_resources.sql VERBATIM, in order — i.e. exactly
-- what this repository's own migration files say 0011 contains,
-- including its recursion-avoidance helpers (my_student_id(),
-- is_my_classroom(), is_my_subject()). Under that local reproduction —
-- tested BOTH as a superuser-owned function chain and, more realistically,
-- as a genuine NOSUPERUSER/NOBYPASSRLS role applying every migration
-- (mirroring a non-superuser Supabase `postgres` role) — every one of
-- these queries succeeds cleanly: no recursion, no permission error, no
-- missing column/table. See supabase/tests/student_dashboard_without_0012.sql
-- for that full, passing regression suite.
--
-- Despite that, the production symptom persists identically after two
-- rounds of application-code fixes (avatar_path fallback, independent
-- per-widget loading). The one architectural fact that distinguishes
-- what's REPORTED WORKING (classroom identity — touches ONLY
-- `classrooms`, via `classrooms_select_via_membership` ->
-- `is_my_classroom()`) from what's REPORTED STILL BROKEN (subjects,
-- assignments, attendance — every one of these ALSO queries `subjects`
-- directly, via `subjects_select_via_membership` -> `is_my_subject()`)
-- is exactly the one additional hop through `is_my_subject()` and the
-- `subjects` table's own policy. Since this repository's own committed
-- 0011 file, verbatim, does NOT reproduce a failure for that exact path
-- locally, the most defensible remaining explanation — without direct
-- access to the live database to inspect it, and without editing the
-- already-applied 0011 (which must stay untouched and immutable) — is
-- that whatever is ACTUALLY live in production for these specific
-- objects may have drifted from what 0011's file says (e.g. applied from
-- an earlier draft, a partial apply, or a manual edit through the SQL
-- editor at some point). This migration cannot detect or diagnose that
-- drift by itself; what it CAN safely do is idempotently RE-ASSERT the
-- exact, empirically-verified-correct definitions from 0011 for every
-- function and policy in the subjects/classrooms/subject_classrooms
-- read-access chain, so that regardless of what is currently live, this
-- migration's own definitions win going forward.
--
-- ==================================================
-- WHY THIS IS SAFE TO APPLY
-- ==================================================
--
-- Every statement below is idempotent and additive-only:
--   - `create or replace function` on the exact same three helper
--     functions 0011 already defines, byte-for-byte the same bodies —
--     a no-op if production already matches 0011's file (the common
--     case), and a genuine fix if it had drifted.
--   - `drop policy if exists` + `create policy` on the exact same
--     additive SELECT policies 0011 already defines, same reasoning.
--     Postgres has no `create or replace policy`, so the drop-then-
--     recreate pair is how a policy is safely re-asserted; each pair
--     only ever removes and immediately restores the SAME named policy,
--     never leaves RLS disabled or the table policy-less in between
--     (both statements run inside this migration's implicit
--     transaction).
--   - No table is created, altered, or dropped. No grant is widened. No
--     new capability is added beyond what 0011 already granted. If
--     production already exactly matches 0011, applying this migration
--     changes nothing observable at all.
--
-- Re-verified empirically the same way as every other migration this
-- project has shipped — see supabase/tests/0014_fix_student_academic_read_access.sql.

-- ==================================================
-- my_student_id() — re-asserted verbatim from 0011.
-- ==================================================

create or replace function public.my_student_id()
returns uuid
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select s.id
  from public.students s
  where s.linked_profile_id = auth.uid()
  limit 1
$$;

revoke all on function public.my_student_id() from public;
grant execute on function public.my_student_id() to authenticated;

-- ==================================================
-- is_my_classroom(p_classroom_id) — re-asserted verbatim from 0011.
-- ==================================================

create or replace function public.is_my_classroom(p_classroom_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.classroom_students cs
    where cs.classroom_id = p_classroom_id
      and cs.student_id = public.my_student_id()
  )
$$;

revoke all on function public.is_my_classroom(uuid) from public;
grant execute on function public.is_my_classroom(uuid) to authenticated;

-- ==================================================
-- is_my_subject(p_subject_id) — re-asserted verbatim from 0011. This is
-- the specific function the production symptom points at: every query
-- reported still failing touches `subjects` directly, and this is the
-- ONLY thing standing between `subjects`' own RLS policy and
-- `subject_classrooms`/`classroom_students`.
-- ==================================================

create or replace function public.is_my_subject(p_subject_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.subject_classrooms sc
    where sc.subject_id = p_subject_id
      and public.is_my_classroom(sc.classroom_id)
  )
$$;

revoke all on function public.is_my_subject(uuid) from public;
grant execute on function public.is_my_subject(uuid) to authenticated;

-- ==================================================
-- RLS policies — each dropped and re-created with the exact same name
-- and USING clause 0011 already defines. Dropping and recreating a
-- policy that already matches is a pure no-op; the pair is atomic within
-- this migration's transaction, so RLS is never left without this policy
-- in place. Every one of these is purely ADDITIVE to the existing
-- teacher-only policies from 0001/0002/0004/0005/0006, which are
-- completely untouched — Postgres ORs multiple permissive SELECT
-- policies together, so re-asserting the student one here can only ever
-- restore access, never take any away.
-- ==================================================

drop policy if exists "students_select_own_linked" on public.students;
create policy "students_select_own_linked"
  on public.students for select
  using (id = public.my_student_id());

drop policy if exists "classroom_students_select_own_student" on public.classroom_students;
create policy "classroom_students_select_own_student"
  on public.classroom_students for select
  using (student_id = public.my_student_id());

drop policy if exists "classrooms_select_via_membership" on public.classrooms;
create policy "classrooms_select_via_membership"
  on public.classrooms for select
  using (public.is_my_classroom(id));

drop policy if exists "subject_classrooms_select_via_membership" on public.subject_classrooms;
create policy "subject_classrooms_select_via_membership"
  on public.subject_classrooms for select
  using (public.is_my_classroom(classroom_id));

drop policy if exists "subjects_select_via_membership" on public.subjects;
create policy "subjects_select_via_membership"
  on public.subjects for select
  using (public.is_my_subject(id));

drop policy if exists "assignments_select_via_membership" on public.assignments;
create policy "assignments_select_via_membership"
  on public.assignments for select
  using (public.is_my_classroom(classroom_id));

drop policy if exists "assignment_submissions_select_own_student" on public.assignment_submissions;
create policy "assignment_submissions_select_own_student"
  on public.assignment_submissions for select
  using (student_id = public.my_student_id());

drop policy if exists "attendance_sessions_select_via_membership" on public.attendance_sessions;
create policy "attendance_sessions_select_via_membership"
  on public.attendance_sessions for select
  using (public.is_my_classroom(classroom_id));

drop policy if exists "attendance_records_select_own_student" on public.attendance_records;
create policy "attendance_records_select_own_student"
  on public.attendance_records for select
  using (student_id = public.my_student_id());

-- ==================================================
-- Nothing above creates, alters, or drops a table, widens any grant
-- beyond what 0011 already granted, or touches any teacher-side policy.
-- Every statement re-asserts an existing function/policy definition
-- idempotently — a no-op wherever production already matches 0011, and a
-- targeted fix wherever it had drifted. 0011 itself is not edited.
-- ==================================================
