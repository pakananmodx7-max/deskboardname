-- AI Classroom Management — initial schema
-- Tables: profiles, classrooms, students, classroom_students
-- See docs/DATABASE.md for the full schema explanation and RLS rationale.

create extension if not exists pgcrypto;

-- ==================================================
-- Reusable updated_at trigger
-- ==================================================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ==================================================
-- profiles
-- One row per authenticated user (teacher/admin/student).
-- Mirrors auth.users so the rest of the schema can reference a stable,
-- application-level user id without depending on the auth schema directly.
-- ==================================================

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  email text,
  role text not null default 'teacher' check (role in ('teacher', 'admin', 'student')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_profiles_updated_at
  before update on public.profiles
  for each row
  execute function public.set_updated_at();

alter table public.profiles enable row level security;

-- A user may read and edit only their own profile row. There is no
-- "admin can see everyone" policy yet — out of scope for this phase.
create policy "profiles_select_own"
  on public.profiles for select
  using (id = auth.uid());

create policy "profiles_insert_own"
  on public.profiles for insert
  with check (id = auth.uid());

create policy "profiles_update_own"
  on public.profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

-- ==================================================
-- classrooms
-- A classroom (section) taught by one teacher for a given academic
-- year/semester, e.g. "ม.5/1" for ปีการศึกษา 2569 ภาคเรียนที่ 1.
-- ==================================================

create table if not exists public.classrooms (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.profiles (id) on delete cascade,
  name text not null,
  grade_level text,
  section text,
  academic_year text,
  semester text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists classrooms_teacher_id_idx on public.classrooms (teacher_id);

create trigger set_classrooms_updated_at
  before update on public.classrooms
  for each row
  execute function public.set_updated_at();

alter table public.classrooms enable row level security;

-- Teachers only ever see and manage classrooms they own. There is
-- intentionally no "shared classroom" or admin-wide policy in this phase.
create policy "classrooms_select_own"
  on public.classrooms for select
  using (teacher_id = auth.uid());

create policy "classrooms_insert_own"
  on public.classrooms for insert
  with check (teacher_id = auth.uid());

create policy "classrooms_update_own"
  on public.classrooms for update
  using (teacher_id = auth.uid())
  with check (teacher_id = auth.uid());

create policy "classrooms_delete_own"
  on public.classrooms for delete
  using (teacher_id = auth.uid());

-- ==================================================
-- students
-- A student is a standalone record identified by student_code (a stable
-- external id, e.g. the school's official student number) — NOT by name,
-- and NOT owned by a single classroom or teacher. Classroom membership is
-- modeled separately in classroom_students so the same student can move
-- across classrooms/semesters/academic years without duplication.
-- ==================================================

create table if not exists public.students (
  id uuid primary key default gen_random_uuid(),
  student_code text,
  number integer,
  first_name text not null,
  last_name text not null,
  nickname text,
  email text,
  phone text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Indexed for duplicate lookup during import, but intentionally NOT a
-- unique constraint — see docs/DATABASE.md "student_code duplicate
-- strategy" for why uniqueness is enforced at the service layer, scoped
-- to what the requesting teacher can already see, rather than globally.
create index if not exists students_student_code_idx on public.students (student_code);

create trigger set_students_updated_at
  before update on public.students
  for each row
  execute function public.set_updated_at();

alter table public.students enable row level security;

-- Teachers can only see students who belong to at least one classroom
-- they own. Students never get broad read access in this phase.
create policy "students_select_via_classroom"
  on public.students for select
  using (
    exists (
      select 1
      from public.classroom_students cs
      join public.classrooms c on c.id = cs.classroom_id
      where cs.student_id = students.id
        and c.teacher_id = auth.uid()
    )
  );

-- A brand new student is not linked to any classroom yet at the moment
-- it's inserted, so the select-via-classroom check can't apply here.
-- Any authenticated teacher may create a student record; it becomes
-- visible to them only once linked via classroom_students below.
create policy "students_insert_by_teacher"
  on public.students for insert
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'teacher'
    )
  );

create policy "students_update_via_classroom"
  on public.students for update
  using (
    exists (
      select 1
      from public.classroom_students cs
      join public.classrooms c on c.id = cs.classroom_id
      where cs.student_id = students.id
        and c.teacher_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.classroom_students cs
      join public.classrooms c on c.id = cs.classroom_id
      where cs.student_id = students.id
        and c.teacher_id = auth.uid()
    )
  );

-- ==================================================
-- classroom_students
-- Classroom membership join table. A student may appear in many rows
-- here (different classrooms, different academic years/semesters).
-- ==================================================

create table if not exists public.classroom_students (
  id uuid primary key default gen_random_uuid(),
  classroom_id uuid not null references public.classrooms (id) on delete cascade,
  student_id uuid not null references public.students (id) on delete cascade,
  joined_at timestamptz not null default now(),
  unique (classroom_id, student_id)
);

create index if not exists classroom_students_classroom_id_idx on public.classroom_students (classroom_id);
create index if not exists classroom_students_student_id_idx on public.classroom_students (student_id);

alter table public.classroom_students enable row level security;

-- Membership rows are only visible/manageable by the classroom's owner.
create policy "classroom_students_select_own"
  on public.classroom_students for select
  using (
    exists (
      select 1 from public.classrooms c
      where c.id = classroom_students.classroom_id
        and c.teacher_id = auth.uid()
    )
  );

create policy "classroom_students_insert_own"
  on public.classroom_students for insert
  with check (
    exists (
      select 1 from public.classrooms c
      where c.id = classroom_students.classroom_id
        and c.teacher_id = auth.uid()
    )
  );

create policy "classroom_students_delete_own"
  on public.classroom_students for delete
  using (
    exists (
      select 1 from public.classrooms c
      where c.id = classroom_students.classroom_id
        and c.teacher_id = auth.uid()
    )
  );

-- ==================================================
-- Future relationship (not implemented yet, documented for reference):
--
--   profiles
--      |
--      v
--   classrooms
--      |
--      v
--   classroom_students
--      |
--      v
--   students
--      |
--      v
--   attendance / grades / submissions
--
-- attendance, assignments, submissions, and grades tables will reference
-- classroom_students (or classroom_id + student_id) once implemented, so
-- a record always ties back to a specific classroom membership rather
-- than the student in isolation.
-- ==================================================
