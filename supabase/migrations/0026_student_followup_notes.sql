-- AI Classroom Management — วิเคราะห์นักเรียน (Student Analytics):
-- follow-up notes
-- Table: student_followup_notes
-- See docs/DATABASE.md for the full schema explanation and RLS rationale.
--
-- Builds on 0001_init.sql (students, classrooms, classroom_students),
-- 0002_subjects_topics.sql (subjects, subject_classrooms). This migration
-- has NOT been applied to a live database yet — do NOT run it
-- automatically. It is safe to edit in place if a review finds issues
-- before it is ever run.
--
-- Scope: a small, teacher-only scratchpad for the Student Analytics
-- page's "บันทึกติดตาม" (follow-up notes) section — free-text notes a
-- teacher writes about one student while looking at that student's
-- analytics for one subject+classroom. This is NOT an academic record
-- (not a grade, not attendance, not a score) — it is the teacher's own
-- working notes, so unlike assignments/attendance/scores this table DOES
-- allow a real DELETE (see the RLS section below for why that is a
-- deliberate, narrow exception to this schema's usual "archive, never
-- hard-delete" convention).
--
-- Scoped to (student_id, classroom_id, subject_id) — the same
-- subject+classroom+student triple the Student Analytics page itself is
-- always opened at (see student-analytics-service.ts) — mirroring
-- assignments' "always tied to both subject AND classroom" shape
-- (0006_subject_assignments.sql's scope note) rather than a looser
-- "about this student in general" note with no subject context.
--
-- Ordering note (same rationale as every prior migration): table
-- definition first, then RLS enabled and policies added afterward.

-- ==================================================
-- student_followup_notes
-- ==================================================

create table if not exists public.student_followup_notes (
  id uuid primary key default gen_random_uuid(),
  -- `on delete restrict`: students has no DELETE RLS policy at all (see
  -- 0001's "Orphan student strategy"), so this is currently unreachable
  -- in practice — restrict states the intent (a note must never be
  -- silently destroyed by a student row disappearing) rather than
  -- leaving the FK action unconsidered, matching
  -- assignment_submissions.student_id (0006).
  student_id uuid not null references public.students (id) on delete restrict,
  -- `on delete cascade`, matching assignments.classroom_id (0006): if a
  -- classroom is ever hard-deleted, notes scoped to it disappear with it
  -- — a note about a student in a classroom that no longer exists has
  -- nothing left to be "about."
  classroom_id uuid not null references public.classrooms (id) on delete cascade,
  -- `on delete cascade`, matching assignments.subject_id (0006).
  subject_id uuid not null references public.subjects (id) on delete cascade,
  body text not null check (length(trim(body)) > 0),
  -- Audit trail only, NOT the authorization boundary — same role as
  -- assignments.created_by (0006). `set null` so deleting a teacher
  -- profile is never blocked by, nor cascades into destroying, notes
  -- they wrote.
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists student_followup_notes_student_classroom_subject_idx
  on public.student_followup_notes (student_id, classroom_id, subject_id);

create trigger set_student_followup_notes_updated_at
  before update on public.student_followup_notes
  for each row
  execute function public.set_updated_at();

-- ==================================================
-- RLS: student_followup_notes
-- ==================================================

alter table public.student_followup_notes enable row level security;

-- Ownership is derived transitively through classroom_id ->
-- classrooms.teacher_id — exactly the same four-part shape as
-- assignments_select_own/_insert_own (0006), since a note is always tied
-- to both a subject AND one of that subject's linked classrooms, the
-- same scope assignments themselves use.
create policy "student_followup_notes_select_own"
  on public.student_followup_notes for select
  using (
    exists (
      select 1 from public.classrooms c
      where c.id = student_followup_notes.classroom_id and c.teacher_id = auth.uid()
    )
  );

-- SECURITY: creating a note requires ALL of:
--   1. the caller owns the target classroom,
--   2. the caller owns the target subject,
--   3. that subject is actually linked to that classroom via
--      subject_classrooms (closing "attach a note to a subject that has
--      nothing to do with this classroom"),
--   4. the student is CURRENTLY a member of that classroom (same
--      membership check as assignment_submissions_insert_own, 0006) —
--      a teacher can only write a note about a student they actually
--      teach in that classroom,
--   5. created_by is honestly the caller.
create policy "student_followup_notes_insert_own"
  on public.student_followup_notes for insert
  with check (
    exists (
      select 1 from public.classrooms c
      where c.id = student_followup_notes.classroom_id and c.teacher_id = auth.uid()
    )
    and exists (
      select 1 from public.subjects s
      where s.id = student_followup_notes.subject_id and s.teacher_id = auth.uid()
    )
    and exists (
      select 1 from public.subject_classrooms sc
      where sc.subject_id = student_followup_notes.subject_id
        and sc.classroom_id = student_followup_notes.classroom_id
    )
    and exists (
      select 1 from public.classroom_students cs
      where cs.classroom_id = student_followup_notes.classroom_id
        and cs.student_id = student_followup_notes.student_id
    )
    and created_by = auth.uid()
  );

-- Editing a note's body. Deliberately does NOT re-check current
-- classroom membership (same reasoning as assignment_submissions_update_own,
-- 0006) — correcting a note for a student who has since left the
-- classroom must not become impossible.
create policy "student_followup_notes_update_own"
  on public.student_followup_notes for update
  using (
    exists (
      select 1 from public.classrooms c
      where c.id = student_followup_notes.classroom_id and c.teacher_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.classrooms c
      where c.id = student_followup_notes.classroom_id and c.teacher_id = auth.uid()
    )
  );

-- SECURITY / INTENTIONAL EXCEPTION to this schema's usual "archive, never
-- hard-delete" convention (students/subjects/assignments/attendance all
-- have no DELETE policy): a follow-up note is a teacher's own scratch
-- note, not an academic record — there is no audit/compliance reason to
-- keep a note the teacher wrote by mistake or no longer wants. Deleting a
-- note never touches the student/classroom/subject rows themselves or
-- any other note.
create policy "student_followup_notes_delete_own"
  on public.student_followup_notes for delete
  using (
    exists (
      select 1 from public.classrooms c
      where c.id = student_followup_notes.classroom_id and c.teacher_id = auth.uid()
    )
  );

-- ==================================================
-- Future relationship:
--
--   subjects  --->  subject_classrooms  <---  classrooms
--      |                                          |
--      v                                          v
--   student_followup_notes  <----------------------
--      |
--      v
--   students
--
-- Powers the Student Analytics page's "บันทึกติดตาม" section
-- (student-analytics-service.ts) only — never read or written by any
-- other feature, and never affects SGS Bridge / the SGS Score Calculator
-- (sgs_score_columns/sgs_scores, 0023/0025), which remain completely
-- untouched by this migration.
-- ==================================================
