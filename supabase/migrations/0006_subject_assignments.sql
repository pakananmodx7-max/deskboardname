-- AI Classroom Management — Phase 8: Subject + Classroom Assignments
-- Tables: assignments, assignment_submissions
-- See docs/DATABASE.md for the full schema explanation and RLS rationale.
--
-- Builds on 0001_init.sql (profiles, classrooms, students, classroom_students),
-- 0002_subjects_topics.sql (subjects, subject_classrooms, topics), and
-- 0005_subject_attendance.sql (the subject+classroom ownership/link check
-- pattern this migration reuses). This migration has NOT been applied to a
-- live database yet — do NOT run it automatically. It is safe to edit in
-- place if a review finds issues before it is ever run.
--
-- Scope: an assignment always belongs to exactly one subject AND one of
-- that subject's linked classrooms — never a bare subject-wide thing,
-- never classroom-less. "DS taught to ม.5/1 and ม.5/2" gets two
-- completely independent assignment sets, even when a title matches
-- between them (e.g. both have a "Worksheet 1") — there is no shared
-- "subject assignment" row underneath. This mirrors how attendance
-- (0004/0005) is always scoped to a specific classroom, and how a
-- subject's real student roster (subject-service.ts's getSubjectStudents)
-- is always derived per-classroom, never merged into one undifferentiated
-- subject-wide list.
--
-- Ordering note (same rationale as every prior migration): table
-- definitions first, in dependency order (assignments → assignment_submissions),
-- then RLS is enabled and policies are added afterward. No RPC is needed
-- this time — unlike create_student_and_enroll (0001) or
-- save_attendance_session (0004/0005), every write here is a single-row
-- insert/update against one table, so a correctly-written RLS policy
-- alone provides the same safety an RPC would, without the extra
-- indirection.

-- ==================================================
-- assignments
-- One row per assignment, always tied to both subject_id AND
-- classroom_id — see the scope note above for why this is a hard
-- requirement, not an optional narrowing. `topic_id` is optional (an
-- assignment need not be tied to a syllabus topic).
-- ==================================================

create table if not exists public.assignments (
  id uuid primary key default gen_random_uuid(),
  -- `on delete cascade`, matching topics.subject_id (0002): if a subject
  -- is ever hard-deleted (it currently cannot be — subjects has no DELETE
  -- policy — but the constraint states intent regardless), its
  -- assignments disappear with it.
  subject_id uuid not null references public.subjects (id) on delete cascade,
  -- `on delete cascade`, matching classroom_students.classroom_id (0001)
  -- and attendance_sessions.classroom_id (0004): if a classroom is ever
  -- hard-deleted (classrooms_delete_own does allow this), its assignments
  -- for that classroom disappear with it.
  classroom_id uuid not null references public.classrooms (id) on delete cascade,
  -- `on delete set null`: deleting a topic must never take an assignment
  -- down with it — the assignment just becomes topic-less, matching how
  -- deleteTopic already behaves for demo assignments (see
  -- demo-context.tsx's deleteTopic, which sets topicId to null on any
  -- assignment referencing the deleted topic instead of removing it).
  topic_id uuid references public.topics (id) on delete set null,
  title text not null,
  description text,
  max_score numeric not null default 100 check (max_score > 0),
  due_date date,
  -- Archiving (never hard-deleting) mirrors students/subjects/classrooms'
  -- own no-hard-delete stance — see "No delete policy" note below.
  is_archived boolean not null default false,
  -- Audit trail only, NOT the authorization boundary — same role as
  -- attendance_sessions.created_by (0004). `set null` so deleting a
  -- teacher profile is never blocked by, nor cascades into destroying,
  -- the assignments they created.
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists assignments_subject_id_idx on public.assignments (subject_id);
create index if not exists assignments_classroom_id_idx on public.assignments (classroom_id);
create index if not exists assignments_topic_id_idx on public.assignments (topic_id);

create trigger set_assignments_updated_at
  before update on public.assignments
  for each row
  execute function public.set_updated_at();

-- ==================================================
-- assignment_submissions
-- One row per (assignment, student) — exactly one record per student per
-- assignment, enforced by the unique constraint below.
--
-- `student_id` (NOT a classroom_students row id) references students.id
-- directly — the exact same reasoning as attendance_records.student_id
-- (0004): classroom_students rows are ephemeral (deleted/replaced by
-- routine "เอาออกจากห้อง"/"ย้ายห้อง" operations), so referencing that
-- join row instead of the student would silently delete a student's
-- submission/score history the moment their classroom membership
-- changed. "Was this student actually in the assignment's classroom" is
-- instead an application-level check made once, at the moment a
-- submission row is first written (assignment_submissions_insert_own's
-- WITH CHECK below) — not a constraint that would later delete history
-- when membership changes.
-- ==================================================

create table if not exists public.assignment_submissions (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments (id) on delete cascade,
  -- `on delete restrict`: students has no DELETE RLS policy at all (0001
  -- "Orphan student strategy"), so this is currently unreachable in
  -- practice — restrict states the intent (submission/score history must
  -- never be silently destroyed by a student row disappearing) rather
  -- than leaving the FK action unconsidered.
  student_id uuid not null references public.students (id) on delete restrict,
  status text not null default 'not_submitted'
    check (status in ('not_submitted', 'submitted', 'late', 'missing')),
  score numeric check (score is null or score >= 0),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (assignment_id, student_id)
);

create index if not exists assignment_submissions_assignment_id_idx on public.assignment_submissions (assignment_id);
create index if not exists assignment_submissions_student_id_idx on public.assignment_submissions (student_id);

create trigger set_assignment_submissions_updated_at
  before update on public.assignment_submissions
  for each row
  execute function public.set_updated_at();

-- ==================================================
-- RLS: assignments
-- ==================================================

alter table public.assignments enable row level security;

-- Ownership is always derived transitively through classroom_id →
-- classrooms.teacher_id — assignments has no owner column of its own
-- (created_by is an audit trail, not the authorization boundary; see the
-- table comment above). No recursion risk: this references `classrooms`,
-- not `assignments` itself.
create policy "assignments_select_own"
  on public.assignments for select
  using (
    exists (
      select 1 from public.classrooms c
      where c.id = assignments.classroom_id and c.teacher_id = auth.uid()
    )
  );

-- SECURITY: creating an assignment requires ALL of:
--   1. the caller owns the target classroom,
--   2. the caller owns the target subject,
--   3. that subject is actually linked to that classroom via
--      subject_classrooms (closing "attach an assignment to a subject
--      that has nothing to do with this classroom" — without this check,
--      #1+#2 alone would let a teacher create an assignment for ANY
--      (subject, classroom) pair they separately own, even if that
--      subject was never taught to that classroom),
--   4. created_by is honestly the caller (never forged to point at
--      another teacher).
-- Exactly the same four-part shape as attendance_sessions_insert_own in
-- 0005 — this is the established pattern in this schema for "a row that
-- must belong to both a subject AND one of that subject's linked
-- classrooms."
create policy "assignments_insert_own"
  on public.assignments for insert
  with check (
    exists (
      select 1 from public.classrooms c
      where c.id = assignments.classroom_id and c.teacher_id = auth.uid()
    )
    and exists (
      select 1 from public.subjects s
      where s.id = assignments.subject_id and s.teacher_id = auth.uid()
    )
    and exists (
      select 1 from public.subject_classrooms sc
      where sc.subject_id = assignments.subject_id and sc.classroom_id = assignments.classroom_id
    )
    and created_by = auth.uid()
  );

-- Editing (title/description/max_score/due_date/topic_id/is_archived) or
-- archiving an assignment. WITH CHECK re-derives the same four-part
-- ownership+link condition as INSERT, so an UPDATE can never be used to
-- reassign an assignment's subject_id/classroom_id to a pair the caller
-- doesn't own or that isn't actually linked.
create policy "assignments_update_own"
  on public.assignments for update
  using (
    exists (
      select 1 from public.classrooms c
      where c.id = assignments.classroom_id and c.teacher_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.classrooms c
      where c.id = assignments.classroom_id and c.teacher_id = auth.uid()
    )
    and exists (
      select 1 from public.subjects s
      where s.id = assignments.subject_id and s.teacher_id = auth.uid()
    )
    and exists (
      select 1 from public.subject_classrooms sc
      where sc.subject_id = assignments.subject_id and sc.classroom_id = assignments.classroom_id
    )
  );

-- SECURITY: deliberately NO delete policy — matching every other
-- academic-data table in this schema (students, subjects,
-- attendance_sessions/attendance_records). "Archive assignment" in the
-- UI is is_archived = true via UPDATE, never a real DELETE. See
-- docs/DATABASE.md "Assignment delete strategy".

-- ==================================================
-- RLS: assignment_submissions
-- ==================================================

alter table public.assignment_submissions enable row level security;

-- Ownership is derived transitively through assignment_id → assignments
-- → classrooms.teacher_id. Deliberately NOT re-checked against the
-- student's CURRENT classroom membership on read — a student who later
-- moves to a different classroom (or is archived) must not lose
-- visibility into submission/score history that was legitimately
-- recorded while they were there. No recursion risk: this references
-- `assignments`, not `assignment_submissions` itself.
create policy "assignment_submissions_select_own"
  on public.assignment_submissions for select
  using (
    exists (
      select 1
      from public.assignments a
      join public.classrooms c on c.id = a.classroom_id
      where a.id = assignment_submissions.assignment_id
        and c.teacher_id = auth.uid()
    )
  );

-- SECURITY (prevents "submissions for students not belonging to that
-- assignment's classroom"): creating a submission row requires BOTH
--   1. the caller owns the assignment's classroom (same derivation as
--      SELECT above), AND
--   2. the student is CURRENTLY a member of that assignment's
--      classroom_id, via a direct classroom_students lookup.
-- #2 only applies at INSERT time, on purpose — exactly the same
-- reasoning as attendance_records_insert_own/_update_own in 0004:
-- correcting a mistake in an already-recorded submission (status, score,
-- note) for a student who has since left the classroom must not become
-- impossible, so UPDATE below does not repeat this check.
create policy "assignment_submissions_insert_own"
  on public.assignment_submissions for insert
  with check (
    exists (
      select 1
      from public.assignments a
      join public.classrooms c on c.id = a.classroom_id
      where a.id = assignment_submissions.assignment_id
        and c.teacher_id = auth.uid()
    )
    and exists (
      select 1
      from public.assignments a
      join public.classroom_students cs on cs.classroom_id = a.classroom_id
      where a.id = assignment_submissions.assignment_id
        and cs.student_id = assignment_submissions.student_id
    )
  );

create policy "assignment_submissions_update_own"
  on public.assignment_submissions for update
  using (
    exists (
      select 1
      from public.assignments a
      join public.classrooms c on c.id = a.classroom_id
      where a.id = assignment_submissions.assignment_id
        and c.teacher_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.assignments a
      join public.classrooms c on c.id = a.classroom_id
      where a.id = assignment_submissions.assignment_id
        and c.teacher_id = auth.uid()
    )
  );

-- SECURITY: deliberately NO delete policy — matching assignments above,
-- individual submission rows are never hard-deleted through the app
-- either (a status/score/note is corrected via UPDATE, never removed
-- outright).

-- ==================================================
-- Future relationship (not implemented yet, documented for reference):
--
--   subjects  --->  subject_classrooms  <---  classrooms
--      |                                          |
--      v                                          v
--   assignments  <-------------------------------
--      |                \
--      v                 v (optional)
--   assignment_submissions   topics
--      |
--      v
--   students
--
-- Grades — currently demo-only in the application — will most likely be
-- a derived view over assignment_submissions.score (per subject+classroom)
-- rather than a new stored table, matching how a subject's roster is
-- already derived rather than stored. Not implemented here; out of scope
-- for this migration.
-- ==================================================
