-- AI Classroom Management — Phase 3: Subjects, Subject↔Classroom links, Topics
-- Tables: subjects, subject_classrooms, topics
-- See docs/DATABASE.md for the full schema explanation and RLS rationale.
--
-- Builds on 0001_init.sql (profiles, classrooms, students, classroom_students).
-- Like 0001, this migration has never been applied to a live database as of
-- writing — it is still safe to edit in place if a review finds issues
-- before it is ever run. Do NOT run this migration automatically.
--
-- Scope: this migration intentionally covers ONLY subjects, the
-- subject↔classroom relationship, and topics. Attendance, assignments,
-- submissions, and grades stay demo-only in the application for now and
-- are NOT modeled here — see the "Future relationship" note at the bottom.
--
-- Ordering note (same rationale as 0001): table definitions first, in
-- dependency order (subjects → subject_classrooms, subjects → topics),
-- then RLS is enabled and policies are added afterward, then the atomic
-- creation RPC last (it references the RLS-protected tables directly and
-- relies on their policies already existing).

-- ==================================================
-- subjects
-- A subject (วิชา) taught by one teacher, e.g. "วิทยาศาสตร์ ว32101" for
-- ปีการศึกษา 2569 ภาคเรียนที่ 1. A subject is linked to one or more
-- classrooms via subject_classrooms below — the same subject can be
-- taught to multiple sections (e.g. ม.5/1 and ม.5/2) without duplication.
-- ==================================================

create table if not exists public.subjects (
  id uuid primary key default gen_random_uuid(),
  -- SECURITY: `on delete restrict`, matching classrooms.teacher_id in
  -- 0001 — a teacher's subjects must never silently disappear (or cascade
  -- into deleting topics/links) as a side effect of deleting their
  -- profile. Reassigning or archiving subjects first is an explicit step.
  teacher_id uuid not null references public.profiles (id) on delete restrict,
  name text not null,
  subject_code text,
  description text,
  academic_year text,
  semester text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists subjects_teacher_id_idx on public.subjects (teacher_id);

create trigger set_subjects_updated_at
  before update on public.subjects
  for each row
  execute function public.set_updated_at();

-- ==================================================
-- subject_classrooms
-- Join table linking a subject to the classroom(s) it is taught to. A
-- subject may link to many classrooms; a classroom may host many subjects.
-- ==================================================

create table if not exists public.subject_classrooms (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.subjects (id) on delete cascade,
  -- `on delete cascade`: if a classroom is ever deleted (classrooms_delete_own
  -- in 0001 does allow this), the link row disappears with it — same
  -- pattern as classroom_students.classroom_id in 0001. The subject
  -- itself, and its topics, are unaffected; the subject just loses that
  -- one classroom link (and, transitively, that classroom's students stop
  -- appearing in the subject's derived roster — see docs/DATABASE.md).
  classroom_id uuid not null references public.classrooms (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (subject_id, classroom_id)
);

create index if not exists subject_classrooms_subject_id_idx on public.subject_classrooms (subject_id);
create index if not exists subject_classrooms_classroom_id_idx on public.subject_classrooms (classroom_id);

-- ==================================================
-- topics
-- A syllabus topic/unit within a subject (e.g. "บทที่ 1 แรงและการเคลื่อนที่"),
-- ordered by `position`. Always belongs to exactly one subject.
-- ==================================================

create table if not exists public.topics (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.subjects (id) on delete cascade,
  title text not null,
  description text,
  position integer not null default 1,
  taught_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists topics_subject_id_idx on public.topics (subject_id);

create trigger set_topics_updated_at
  before update on public.topics
  for each row
  execute function public.set_updated_at();

-- ==================================================
-- RLS: subjects
-- ==================================================

alter table public.subjects enable row level security;

-- Teachers only ever see and manage subjects they own. No cross-teacher
-- or admin-wide read policy in this phase (matches classrooms in 0001).
create policy "subjects_select_own"
  on public.subjects for select
  using (teacher_id = auth.uid());

-- SECURITY: same shape as classrooms_insert_own in 0001 — creating a
-- subject requires BOTH naming yourself as the owner AND actually holding
-- a 'teacher' or 'admin' role. Without the role check, a profile with
-- role = 'student' could create subject rows.
create policy "subjects_insert_own"
  on public.subjects for insert
  with check (
    teacher_id = auth.uid()
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('teacher', 'admin')
    )
  );

create policy "subjects_update_own"
  on public.subjects for update
  using (teacher_id = auth.uid())
  with check (teacher_id = auth.uid());

-- SECURITY: deliberately NO delete policy for subjects, matching the
-- `students` table in 0001 (no hard delete there either). A subject is
-- retired via `archiveSubject()` (UPDATE is_active = false through
-- subjects_update_own above), never removed outright through the app —
-- this keeps historical topics/links (and, once migrated, attendance and
-- grades) intact instead of quietly destroying academic records. See
-- docs/DATABASE.md "Subject delete/cascade strategy".

-- ==================================================
-- RLS: subject_classrooms
-- ==================================================

alter table public.subject_classrooms enable row level security;

-- Link rows are only visible to the subject's owner. (Ownership of a link
-- is derived from the subject, not the classroom, matching how
-- classroom_students in 0001 derives visibility from the classroom.)
create policy "subject_classrooms_select_own"
  on public.subject_classrooms for select
  using (
    exists (
      select 1 from public.subjects s
      where s.id = subject_classrooms.subject_id and s.teacher_id = auth.uid()
    )
  );

-- SECURITY (cross-teacher link prevention): creating a link requires BOTH
--   1. you own the subject being linked, AND
--   2. you own the classroom being linked.
-- Neither check alone is sufficient — #1 alone would let a teacher attach
-- another teacher's classroom (and thus that classroom's students) to
-- their own subject; #2 alone would let a teacher attach their classroom
-- to a subject they don't own. No recursion risk here (unlike
-- classroom_students' INSERT policy in 0001, which needed helper
-- functions): subjects and classrooms are both independent parent
-- tables, so a direct EXISTS subquery against each is fine — there is no
-- self-referential dependency on subject_classrooms itself.
create policy "subject_classrooms_insert_own"
  on public.subject_classrooms for insert
  with check (
    exists (
      select 1 from public.subjects s
      where s.id = subject_classrooms.subject_id and s.teacher_id = auth.uid()
    )
    and exists (
      select 1 from public.classrooms c
      where c.id = subject_classrooms.classroom_id and c.teacher_id = auth.uid()
    )
  );

-- Unlinking a classroom from a subject only ever deletes this link row —
-- it never touches the subject, the classroom, or any student/membership
-- data. See docs/DATABASE.md "Unlink vs delete".
create policy "subject_classrooms_delete_own"
  on public.subject_classrooms for delete
  using (
    exists (
      select 1 from public.subjects s
      where s.id = subject_classrooms.subject_id and s.teacher_id = auth.uid()
    )
  );

-- ==================================================
-- RLS: topics
-- ==================================================

alter table public.topics enable row level security;

-- Ownership of a topic is always derived transitively through its
-- subject's teacher_id — a topic has no owner column of its own. No
-- recursion risk: this references `subjects`, not `topics` itself.
create policy "topics_select_own"
  on public.topics for select
  using (
    exists (
      select 1 from public.subjects s
      where s.id = topics.subject_id and s.teacher_id = auth.uid()
    )
  );

create policy "topics_insert_own"
  on public.topics for insert
  with check (
    exists (
      select 1 from public.subjects s
      where s.id = topics.subject_id and s.teacher_id = auth.uid()
    )
  );

create policy "topics_update_own"
  on public.topics for update
  using (
    exists (
      select 1 from public.subjects s
      where s.id = topics.subject_id and s.teacher_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.subjects s
      where s.id = topics.subject_id and s.teacher_id = auth.uid()
    )
  );

create policy "topics_delete_own"
  on public.topics for delete
  using (
    exists (
      select 1 from public.subjects s
      where s.id = topics.subject_id and s.teacher_id = auth.uid()
    )
  );

-- ==================================================
-- create_subject_with_classrooms: atomic "create subject + link
-- classrooms" RPC
--
-- Fixes the half-created-subject risk of doing this as N separate
-- client-side statements (insert into subjects; insert into
-- subject_classrooms for each selected classroom): if any one of the
-- link inserts failed partway through (e.g. the caller passed a
-- classroom_id they don't own, tripping subject_classrooms_insert_own),
-- the subject row itself would already be committed, leaving a subject
-- with zero (or a partial set of) linked classrooms silently visible in
-- the UI. Wrapping every insert in one PL/pgSQL function makes Postgres
-- run them as a single statement-level unit — if anything inside raises,
-- the whole function's effects (the subject insert AND every link
-- insert so far) are rolled back together, so the caller either gets a
-- fully-linked subject back or no subject at all.
--
-- SECURITY DEFINER is deliberately NOT used here, same reasoning as
-- create_student_and_enroll in 0001: the RLS policies above
-- (subjects_insert_own, subject_classrooms_insert_own) already grant a
-- legitimate teacher everything this function does. A plain SECURITY
-- INVOKER function just gives the app one atomic entrypoint instead of
-- N round trips, without taking on any SECURITY DEFINER risk. Every
-- statement inside still goes through RLS exactly as if the client had
-- run it directly — in particular, passing a classroom_id the caller
-- does not own still fails with 42501 via subject_classrooms_insert_own,
-- and that failure rolls back the subject insert too.
--
-- Unlike create_student_and_enroll, there is no RLS-visibility
-- bootstrapping problem to work around here: subjects_select_own only
-- checks subjects.teacher_id = auth.uid(), which is already true the
-- instant the subject is inserted (it does not depend on
-- subject_classrooms existing first the way students_select_via_classroom
-- depends on classroom_students). So the final SELECT below is a plain,
-- ordinary RLS-checked read with no special-casing needed.
-- ==================================================

create or replace function public.create_subject_with_classrooms(
  p_name text,
  p_classroom_ids uuid[],
  p_subject_code text default null,
  p_description text default null,
  p_academic_year text default null,
  p_semester text default null
)
returns public.subjects
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_subject_id uuid := gen_random_uuid();
  v_classroom_id uuid;
  v_subject public.subjects;
begin
  if auth.uid() is null then
    raise exception 'กรุณาเข้าสู่ระบบก่อนใช้งาน' using errcode = '28000';
  end if;

  if coalesce(trim(p_name), '') = '' then
    raise exception 'กรุณากรอกชื่อรายวิชา' using errcode = '22023';
  end if;

  if p_classroom_ids is null or array_length(p_classroom_ids, 1) is null then
    raise exception 'กรุณาเลือกอย่างน้อย 1 ห้องเรียน' using errcode = '22023';
  end if;

  insert into public.subjects (
    id, teacher_id, name, subject_code, description, academic_year, semester
  ) values (
    v_subject_id,
    auth.uid(),
    trim(p_name),
    nullif(trim(p_subject_code), ''),
    nullif(trim(p_description), ''),
    nullif(trim(p_academic_year), ''),
    nullif(trim(p_semester), '')
  );

  foreach v_classroom_id in array p_classroom_ids loop
    -- subject_classrooms_insert_own re-checks classroom ownership on
    -- every iteration; a classroom_id the caller doesn't own raises
    -- 42501 here and unwinds the whole function, including the subjects
    -- insert above — no half-created subject is ever left behind.
    insert into public.subject_classrooms (subject_id, classroom_id)
    values (v_subject_id, v_classroom_id);
  end loop;

  select * into v_subject from public.subjects where id = v_subject_id;

  return v_subject;
end;
$$;

revoke all on function public.create_subject_with_classrooms(text, uuid[], text, text, text, text) from public;
grant execute on function public.create_subject_with_classrooms(text, uuid[], text, text, text, text) to authenticated;

-- ==================================================
-- Future extension (not implemented yet, documented for reference):
-- subject_students — an explicit per-student enrollment override table.
--
-- Right now, "which students are in a subject" is always DERIVED (never
-- stored) via:
--
--   subjects → subject_classrooms → classroom_students → students
--
-- i.e. a student is "in" a subject if and only if they belong to at
-- least one classroom linked to that subject. There is no
-- subject-specific student row anywhere, so a student can never be
-- duplicated or fall out of sync with their classroom roster.
--
-- This stops covering three real scenarios a school will eventually
-- need, which is why subject_students is being designed for (but not
-- built) now:
--
--   1. Elective subjects — a subject taken by a hand-picked subset of
--      students across one or more classrooms, not "everyone in
--      classroom X". Pure classroom-derivation can't express "only these
--      12 students from ม.5/1 and ม.5/2 take this elective."
--   2. Individual removals — a specific student should NOT be counted in
--      a subject even though their classroom is linked (e.g. they opted
--      out, transferred mid-term, or have an approved exemption).
--   3. Special enrollment — a student from a classroom that is NOT
--      linked to the subject at all should still be included (a one-off
--      cross-classroom enrollment, e.g. a student sitting in on another
--      section's subject).
--
-- The intended future shape (sketch only, not created by this
-- migration):
--
--   create table public.subject_students (
--     id uuid primary key default gen_random_uuid(),
--     subject_id uuid not null references public.subjects (id) on delete cascade,
--     student_id uuid not null references public.students (id) on delete cascade,
--     enrollment_type text not null default 'override'
--       check (enrollment_type in ('include', 'exclude')),
--     created_at timestamptz not null default now(),
--     unique (subject_id, student_id)
--   );
--
-- With `enrollment_type = 'exclude'` rows overriding classroom-derived
-- inclusion (case 2) and `enrollment_type = 'include'` rows adding a
-- student regardless of classroom linkage (cases 1 and 3). The student
-- roster query would then become "classroom-derived students, minus any
-- 'exclude' overrides, plus any 'include' overrides" instead of a plain
-- classroom join — still with zero student-row duplication, since
-- subject_students only ever references an existing students.id, never
-- stores student data of its own. RLS on it would follow the same
-- transitive-through-subject pattern as `topics` above.
--
-- Until a real product need (an actual elective, an actual opt-out)
-- shows up, this stays undocumented-in-code and unimplemented — adding
-- it speculatively now would be exactly the kind of premature
-- abstraction this schema has otherwise avoided.
-- ==================================================

-- ==================================================
-- Future relationship (not implemented yet, documented for reference):
--
--   subjects
--      |
--      v
--   topics
--
--   subjects <-> subject_classrooms <-> classrooms
--
-- attendance, assignments, submissions, and grades — currently demo-only
-- in the application — will reference subjects (and, for attendance,
-- classroom_students) once that phase is migrated, so a record always
-- ties back to a specific subject and classroom membership rather than
-- floating free. Not implemented here; see the top-of-file scope note.
-- ==================================================
