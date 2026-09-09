-- AI Classroom Management — Student Portal Phase 2: read-only student
-- dashboard/subjects/assignments/attendance/grades.
-- See docs/DATABASE.md for the full schema explanation and RLS rationale.
--
-- Builds on 0001_init.sql, 0002_subjects_topics.sql, 0004_attendance.sql,
-- 0005_subject_attendance.sql, 0006_subject_assignments.sql, and
-- 0008_student_account_links.sql (students.linked_profile_id — the
-- permanent, teacher-approved link this entire migration's identity
-- model is built on). This migration has NOT been applied to a live
-- database yet — do NOT run it automatically. 0001-0010 have already
-- been applied and are NOT modified here: this migration only ADDS new
-- helper functions and new, additive SELECT policies.
--
-- Scope: before this migration, a role='student' profile has ZERO read
-- access to ANY academic data — students, classrooms, subjects,
-- assignments, attendance are all scoped to `teacher_id = auth.uid()`
-- (or transitively to a classroom a teacher owns), and Student Portal
-- Phase 1 (0008) deliberately never granted broader access (only the
-- narrow, purpose-built find_student_for_link_in_classroom RPC). This
-- migration is what actually lets an APPROVED student read their own
-- academic data: their own classroom(s), the subjects taught there, the
-- assignments in those classrooms, their own submissions/scores, the
-- attendance sessions for those classrooms, and their own attendance
-- records. It is still READ-ONLY — no INSERT/UPDATE/DELETE policy is
-- added for role='student' anywhere in this migration (see "Do NOT
-- implement student file upload/submission yet" — that is a later
-- phase). No table is created, altered, or dropped.
--
-- SECURITY MODEL — identity, never trust from the browser:
-- Every new policy below resolves "which student is this?" exclusively
-- through my_student_id(), which is derived ENTIRELY from auth.uid() ->
-- students.linked_profile_id (set only by approve_student_link_request,
-- 0008 — never by the student themselves, never by anything this
-- migration adds). No policy or function here takes a student_id
-- parameter from the client. A pending, rejected, or never-linked
-- account has no students row with linked_profile_id = auth.uid(), so
-- my_student_id() returns null and every policy below (all of which
-- gate on `= my_student_id()` or the is_my_classroom() helper built on
-- it) denies access by construction — no separate "is this student
-- approved" check is needed anywhere, because there is no other way to
-- become "the" linked student for an auth.uid() than approval.
--
-- SECURITY MODEL — why classroom-shared tables (classrooms, subjects,
-- subject_classrooms, assignments, attendance_sessions) get a
-- "classroom membership" policy while classroom_students,
-- assignment_submissions, and attendance_records get a strict
-- "row is mine" policy: the first group holds no per-student data at
-- all (a classroom's name, a subject's name, an assignment's title/
-- due date, a session's date — every classmate in the same classroom
-- legitimately sees the identical row); the second group is exactly
-- the per-student data (who is enrolled, a specific score, a specific
-- attendance status) that Section 8's "must NEVER read another
-- student's ..." requirement is about, so those three are scoped to
-- `student_id = my_student_id()` and nothing else — never classroom-
-- wide, which is what would let a student enumerate classmates' rows.
--
-- SECURITY MODEL — recursion avoidance: every new policy that needs to
-- reach across tables to `classroom_students` does so through the
-- is_my_classroom() SECURITY DEFINER helper below, NEVER a raw
-- cross-table subquery inline in a policy. This is not a style
-- preference — Phase 10 (0008) empirically hit and documented a real
-- Postgres RLS recursion bug from exactly that pattern (a `profiles`
-- policy with a raw subquery into `classroom_students` broke unrelated
-- `classroom_students` statements elsewhere in the app). The fix used
-- there (wrap it in a narrow SECURITY DEFINER function) is applied
-- uniformly here from the start, and is re-verified empirically for
-- this migration's specific new policies (see docs/DATABASE.md).

-- ==================================================
-- my_student_id(): the ONE place "which students row is the caller"
-- is answered, for every policy below.
--
-- SECURITY DEFINER so it can see across the `students` table's existing
-- RLS (students_select_via_classroom, 0001, is teacher-only — a student
-- caller has no ordinary SELECT visibility into `students` at all,
-- including their own row, until a policy elsewhere grants it — see
-- students_select_own_linked below, which itself does not need this
-- function since it compares by auth.uid() indirectly through
-- linked_profile_id, but every OTHER new policy in this migration does).
-- Returns a single uuid or null — never a set, never any other column —
-- so it cannot be used to enumerate anything. STABLE (not VOLATILE): the
-- result cannot change within one statement.
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
-- is_my_classroom(p_classroom_id): "am I (the calling student) currently
-- enrolled in this classroom?" — the shared building block for every
-- "classroom-shared, not per-student" policy below (classrooms,
-- subject_classrooms, subjects, assignments, attendance_sessions).
--
-- SECURITY DEFINER for the same recursion-avoidance reason as
-- teacher_can_view_link_requester (0008): this needs to query
-- `classroom_students` from inside policies declared on OTHER tables,
-- and Postgres's RLS recursion guard has already been empirically shown
-- (0008) to react badly to a raw cross-table subquery reaching into
-- classroom_students from a different table's policy. Wrapping it here
-- is the same proven fix, applied preemptively. Boolean-only return, one
-- specific classroom_id in — no enumeration surface.
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
-- is_my_subject(p_subject_id): "is this subject taught in at least one
-- classroom I'm enrolled in?" — built on is_my_classroom(), same
-- recursion-avoidance reasoning.
--
-- This one is NOT optional the way it might look: subject_classrooms
-- already carries an existing TEACHER policy
-- (subject_classrooms_select_own, 0002) whose own USING clause queries
-- `subjects` directly (`exists (select 1 from subjects s where s.id =
-- subject_classrooms.subject_id and s.teacher_id = auth.uid())`). A
-- first draft of this migration put the equivalent "is this subject
-- linked to one of my classrooms" check as a raw subquery straight into
-- subjects' own policy instead of behind this helper — empirically
-- confirmed (local Postgres) that this created exactly a two-table
-- cycle (subjects -> subject_classrooms -> subjects) and Postgres
-- raised "infinite recursion detected in policy for relation
-- 'subjects'" on ANY query touching subjects OR subject_classrooms,
-- including assignments_insert_own's existing, otherwise-unrelated
-- subject_classrooms check (0006). Routing the check through this
-- SECURITY DEFINER function (which bypasses RLS on both tables it
-- touches internally) breaks the cycle — subjects' own policy no
-- longer contains any reference to subject_classrooms at all.
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
-- RLS: students — a student may read exactly their own row (name, code,
-- number, nickname — never another student's), and only once approved
-- (my_student_id() is null until then). Additive to
-- students_select_via_classroom (0001, teacher-only) — Postgres ORs
-- multiple permissive SELECT policies together.
-- ==================================================

create policy "students_select_own_linked"
  on public.students for select
  using (id = public.my_student_id());

-- ==================================================
-- RLS: classroom_students — a student may read only their OWN
-- membership row(s), never a classroom's full roster (that would be
-- exactly the "enumerate classmates" access Section 8 forbids). This is
-- also how the student side learns "which classroom(s) am I in" at all
-- (its classroom_id column), without seeing who else is in them.
-- ==================================================

create policy "classroom_students_select_own_student"
  on public.classroom_students for select
  using (student_id = public.my_student_id());

-- ==================================================
-- RLS: classrooms — a student may read a classroom row (name, grade
-- level, section, academic year, semester — no per-student data at all)
-- if and only if they currently belong to it. Additive to
-- classrooms_select_own (0001, teacher-only).
-- ==================================================

create policy "classrooms_select_via_membership"
  on public.classrooms for select
  using (public.is_my_classroom(id));

-- ==================================================
-- RLS: subject_classrooms — a student may see a subject-classroom link
-- row if the classroom side of it is one they belong to. This is what
-- lets "which subjects are taught in my classroom(s)" be answered.
-- ==================================================

create policy "subject_classrooms_select_via_membership"
  on public.subject_classrooms for select
  using (public.is_my_classroom(classroom_id));

-- ==================================================
-- RLS: subjects — a student may read a subject row (name, code,
-- description — no per-student data) if it is linked, via
-- subject_classrooms, to at least one classroom they belong to.
-- ==================================================

create policy "subjects_select_via_membership"
  on public.subjects for select
  using (public.is_my_subject(id));

-- ==================================================
-- RLS: assignments — a student may read an assignment (title,
-- description, due date, max score — every student in the classroom
-- sees the identical row, same as the teacher's own view) if it belongs
-- to a classroom they're currently enrolled in. This does NOT reveal
-- who else is in that classroom, nor any other student's submission.
-- ==================================================

create policy "assignments_select_via_membership"
  on public.assignments for select
  using (public.is_my_classroom(classroom_id));

-- ==================================================
-- RLS: assignment_submissions — SECURITY-CRITICAL: a student may read
-- ONLY their own submission rows (status/score/note), never a
-- classroom-wide policy. This is the literal enforcement of "students
-- must never read another student's grades/submissions" — scoped
-- strictly to `student_id = my_student_id()`, with no classroom-level
-- fallback of any kind.
-- ==================================================

create policy "assignment_submissions_select_own_student"
  on public.assignment_submissions for select
  using (student_id = public.my_student_id());

-- ==================================================
-- RLS: attendance_sessions — a student may read a session's metadata
-- (classroom, date, subject, period — no per-student status) if it
-- belongs to a classroom they're currently enrolled in. Symmetric to
-- assignments above; carries no per-student information by itself.
-- ==================================================

create policy "attendance_sessions_select_via_membership"
  on public.attendance_sessions for select
  using (public.is_my_classroom(classroom_id));

-- ==================================================
-- RLS: attendance_records — SECURITY-CRITICAL: a student may read ONLY
-- their own attendance records, never a classroom-wide policy. Same
-- strict-ownership shape as assignment_submissions above — this is the
-- literal enforcement of "students must never read another student's
-- attendance."
-- ==================================================

create policy "attendance_records_select_own_student"
  on public.attendance_records for select
  using (student_id = public.my_student_id());

-- ==================================================
-- No INSERT/UPDATE/DELETE policy is added for role='student' on ANY
-- table in this migration. The Student Portal built on this access is
-- read-only end to end (dashboard, subjects, assignments list,
-- attendance history, grades) — students cannot modify attendance,
-- grades, or assignments, and student file upload/submission is
-- explicitly out of scope for this phase. Every existing teacher-side
-- INSERT/UPDATE policy (0001/0004/0005/0006) is completely untouched.
-- ==================================================

-- ==================================================
-- Future relationship (not implemented yet, documented for reference):
--
--   auth.users --> profiles (role='student')
--                     |
--                     v (already set by approve_student_link_request, 0008)
--   students.linked_profile_id
--          |
--          v (my_student_id() / is_my_classroom(), this migration)
--   classroom_students --> classrooms --> subject_classrooms --> subjects
--          |                                                        |
--          v                                                        v
--   attendance_records (own only)              assignments --> assignment_submissions (own only)
--          |
--          v
--   attendance_sessions (classroom-shared metadata)
--
-- Student-initiated writes (submitting an assignment, uploading a file)
-- are a later phase, not implemented here.
-- ==================================================
