-- AI Classroom Management — Phase 9: SGS Score Workspace
-- Tables: sgs_score_columns, sgs_scores
-- See docs/DATABASE.md for the full schema explanation and RLS rationale.
--
-- Builds on 0001_init.sql (classrooms, students, classroom_students),
-- 0002_subjects_topics.sql (subjects, subject_classrooms), and reuses the
-- exact ownership/link-check RLS shape 0006_subject_assignments.sql
-- established for "a row that must belong to both a subject AND one of
-- that subject's linked classrooms." This migration has NOT been applied
-- to a live database yet — do NOT run it automatically. It is safe to
-- edit in place if a review finds issues before it is ever run.
--
-- Scope: this is a DELIBERATELY SEPARATE grade model from
-- `assignments`/`assignment_submissions` (0006) — a "คะแนน SGS" column
-- (e.g. ช่อง 10 เต็ม 15, matching a real SGS score-entry column found by
-- the SGS Bridge Chrome extension's live diagnostic) is never an
-- assignment, is never shown in ตรวจงานและคะแนน, and writing a value here
-- NEVER touches assignment_submissions.score or vice versa. This is what
-- lets a teacher prepare an SGS Bridge payload without needing an
-- assignment to exist at all, and without any risk of an SGS-column edit
-- silently changing a normal assignment grade.
--
-- Ordering note (same rationale as every prior migration): table
-- definitions first, in dependency order (sgs_score_columns →
-- sgs_scores), then RLS is enabled and policies are added afterward.

-- ==================================================
-- sgs_score_columns
-- One row per teacher-defined SGS score column, always tied to both
-- subject_id AND classroom_id — same hard requirement as assignments
-- (0006): two classrooms linked to the same subject get completely
-- independent SGS column sets, even when a label matches between them
-- (both could have a "ช่อง 10"). The teacher defines these by hand
-- (matching whatever the real SGS page's own column labels/max scores
-- are, as confirmed by the SGS Bridge extension's diagnostic) — there is
-- no live connection to SGS from this app, so nothing here is ever
-- auto-discovered.
-- ==================================================

create table if not exists public.sgs_score_columns (
  id uuid primary key default gen_random_uuid(),
  -- `on delete cascade`, matching assignments.subject_id (0006): if a
  -- subject is ever hard-deleted, its SGS columns (and their scores, via
  -- sgs_scores.column_id below) disappear with it — subjects has no
  -- DELETE RLS policy of its own, but delete_subject_permanently (0022)
  -- deletes rows in FK-restricted tables first and relies on cascade for
  -- everything else, exactly as it already does for assignments/topics.
  subject_id uuid not null references public.subjects (id) on delete cascade,
  -- `on delete cascade`, matching assignments.classroom_id (0006): if a
  -- classroom is ever hard-deleted (classrooms_delete_own allows this),
  -- its SGS columns for that classroom disappear with it.
  classroom_id uuid not null references public.classrooms (id) on delete cascade,
  label text not null,
  max_score numeric not null check (max_score > 0),
  -- Display order in the คะแนน SGS spreadsheet — teacher-controlled,
  -- never inferred from creation time alone (matches topics.position's
  -- role in 0002).
  position integer not null default 1,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A teacher would never intentionally define the same SGS column label
  -- twice for the same subject+classroom — this also protects
  -- buildSgsScoreWorkspacePayload's per-column targeting from ever
  -- matching two DB rows for what the teacher considers "one column."
  unique (subject_id, classroom_id, label)
);

create index if not exists sgs_score_columns_subject_id_idx on public.sgs_score_columns (subject_id);
create index if not exists sgs_score_columns_classroom_id_idx on public.sgs_score_columns (classroom_id);

create trigger set_sgs_score_columns_updated_at
  before update on public.sgs_score_columns
  for each row
  execute function public.set_updated_at();

-- ==================================================
-- sgs_scores
-- One row per (sgs_score_column, student) — exactly one record per
-- student per SGS column, enforced by the unique constraint below. Same
-- `student_id` (not classroom_students row id) referencing pattern as
-- assignment_submissions.student_id (0006), for the identical reason:
-- classroom_students rows are ephemeral, so referencing that join row
-- instead of the student would silently delete SGS score history the
-- moment a student's classroom membership changed.
-- ==================================================

create table if not exists public.sgs_scores (
  id uuid primary key default gen_random_uuid(),
  column_id uuid not null references public.sgs_score_columns (id) on delete cascade,
  student_id uuid not null references public.students (id) on delete restrict,
  -- Nullable: "no score entered yet" is a real, distinct state (never
  -- conflated with an explicit 0) — matches assignment_submissions.score
  -- (0006) and the same rule this whole SGS pipeline already enforces
  -- everywhere else (see sgs-export-service.ts's own doc comments).
  score numeric check (score is null or score >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (column_id, student_id)
);

create index if not exists sgs_scores_column_id_idx on public.sgs_scores (column_id);
create index if not exists sgs_scores_student_id_idx on public.sgs_scores (student_id);

create trigger set_sgs_scores_updated_at
  before update on public.sgs_scores
  for each row
  execute function public.set_updated_at();

-- ==================================================
-- RLS: sgs_score_columns
-- ==================================================

alter table public.sgs_score_columns enable row level security;

create policy "sgs_score_columns_select_own"
  on public.sgs_score_columns for select
  using (
    exists (
      select 1 from public.classrooms c
      where c.id = sgs_score_columns.classroom_id and c.teacher_id = auth.uid()
    )
  );

-- SECURITY: same four-part shape as assignments_insert_own (0006) — the
-- caller must own BOTH the target classroom and the target subject, AND
-- that subject must actually be linked to that classroom, AND
-- created_by must honestly be the caller.
create policy "sgs_score_columns_insert_own"
  on public.sgs_score_columns for insert
  with check (
    exists (
      select 1 from public.classrooms c
      where c.id = sgs_score_columns.classroom_id and c.teacher_id = auth.uid()
    )
    and exists (
      select 1 from public.subjects s
      where s.id = sgs_score_columns.subject_id and s.teacher_id = auth.uid()
    )
    and exists (
      select 1 from public.subject_classrooms sc
      where sc.subject_id = sgs_score_columns.subject_id and sc.classroom_id = sgs_score_columns.classroom_id
    )
    and created_by = auth.uid()
  );

create policy "sgs_score_columns_update_own"
  on public.sgs_score_columns for update
  using (
    exists (
      select 1 from public.classrooms c
      where c.id = sgs_score_columns.classroom_id and c.teacher_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.classrooms c
      where c.id = sgs_score_columns.classroom_id and c.teacher_id = auth.uid()
    )
  );

-- Unlike assignments (deliberately no delete policy — historical academic
-- records), an sgs_score_column is teacher-defined CONFIGURATION mirroring
-- whatever the real SGS page's columns are — a mistakenly-created column
-- (wrong label/max score, added before any score was entered) must be
-- removable. Deleting a column cascades to its sgs_scores rows (this is
-- the one intentional exception to "no hard delete" in this schema,
-- scoped to a config row, not a score value on its own).
create policy "sgs_score_columns_delete_own"
  on public.sgs_score_columns for delete
  using (
    exists (
      select 1 from public.classrooms c
      where c.id = sgs_score_columns.classroom_id and c.teacher_id = auth.uid()
    )
  );

-- ==================================================
-- RLS: sgs_scores
-- ==================================================

alter table public.sgs_scores enable row level security;

-- Ownership is derived transitively through column_id → sgs_score_columns
-- → classrooms.teacher_id. No recursion risk: this references
-- `sgs_score_columns`, not `sgs_scores` itself.
create policy "sgs_scores_select_own"
  on public.sgs_scores for select
  using (
    exists (
      select 1
      from public.sgs_score_columns col
      join public.classrooms c on c.id = col.classroom_id
      where col.id = sgs_scores.column_id
        and c.teacher_id = auth.uid()
    )
  );

-- SECURITY (prevents "a score for a student not belonging to that
-- column's classroom"): creating a score row requires BOTH owning the
-- column's classroom AND the student CURRENTLY being a member of that
-- classroom — same two-part shape as assignment_submissions_insert_own
-- (0006). This check only applies at INSERT time, on purpose: correcting
-- an already-recorded score for a student who has since left the
-- classroom must not become impossible (UPDATE below does not repeat
-- this check).
create policy "sgs_scores_insert_own"
  on public.sgs_scores for insert
  with check (
    exists (
      select 1
      from public.sgs_score_columns col
      join public.classrooms c on c.id = col.classroom_id
      where col.id = sgs_scores.column_id
        and c.teacher_id = auth.uid()
    )
    and exists (
      select 1
      from public.sgs_score_columns col
      join public.classroom_students cs on cs.classroom_id = col.classroom_id
      where col.id = sgs_scores.column_id
        and cs.student_id = sgs_scores.student_id
    )
  );

create policy "sgs_scores_update_own"
  on public.sgs_scores for update
  using (
    exists (
      select 1
      from public.sgs_score_columns col
      join public.classrooms c on c.id = col.classroom_id
      where col.id = sgs_scores.column_id
        and c.teacher_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.sgs_score_columns col
      join public.classrooms c on c.id = col.classroom_id
      where col.id = sgs_scores.column_id
        and c.teacher_id = auth.uid()
    )
  );

-- SECURITY: deliberately NO delete policy for sgs_scores itself (matching
-- assignment_submissions) — a score value is academic-record-shaped even
-- in this separate model; clearing it is an UPDATE to score = null
-- (setSgsScore(columnId, studentId, null)), never a row deletion. The
-- row only ever disappears via the column's own cascading delete above.
