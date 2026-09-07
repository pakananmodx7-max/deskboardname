-- AI Classroom Management — initial schema
-- Tables: profiles, classrooms, students, classroom_students
-- See docs/DATABASE.md for the full schema explanation and RLS rationale.
--
-- This migration has never been applied to a live database. It was
-- revised in place (rather than patched with a follow-up migration)
-- after a security review found gaps in cross-teacher student access,
-- profile role escalation, and student-creation atomicity — all fixed
-- below before this is ever run.
--
-- Ordering note: table DEFINITIONS are grouped together in dependency
-- order first (profiles → classrooms → students → classroom_students),
-- then RLS is enabled and policies are added afterward. This is
-- deliberate, not cosmetic: students' RLS policies reference
-- classroom_students, and classroom_students' INSERT policy references
-- the is_student_creator() helper — `create policy` resolves every
-- relation/function in its expression immediately, so all of those must
-- already exist before any policy that mentions them is created. Tables
-- first, then the auth helper function, then every policy last.

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

-- ==================================================
-- classrooms
-- A classroom (section) taught by one teacher for a given academic
-- year/semester, e.g. "ม.5/1" for ปีการศึกษา 2569 ภาคเรียนที่ 1.
-- ==================================================

create table if not exists public.classrooms (
  id uuid primary key default gen_random_uuid(),
  -- SECURITY (was `on delete cascade`): a teacher's classrooms — and
  -- everything that will eventually hang off them (attendance, grades) —
  -- must never disappear as a side effect of deleting their profile.
  -- `restrict` forces an explicit step (reassign or archive classrooms
  -- first) before a teacher account can be removed. See docs/DATABASE.md
  -- "Foreign key cascade policy".
  teacher_id uuid not null references public.profiles (id) on delete restrict,
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

-- ==================================================
-- students
-- A student is a standalone record identified by student_code (a stable
-- external id, e.g. the school's official student number) — NOT by name,
-- and NOT owned by a single classroom. Classroom membership is modeled
-- separately in classroom_students so the same student can move across
-- classrooms/semesters/academic years without duplication.
--
-- `created_by` records which teacher originally created the record. It
-- is NOT a broad ownership flag (a student is still visible to any
-- teacher who legitimately teaches them via classroom_students) — it
-- exists solely as the authorization anchor that lets classroom_students
-- INSERT tell "a teacher enrolling a student they created/already teach"
-- apart from "a teacher trying to claim an arbitrary student_id they
-- merely know the UUID of". See classroom_students below and
-- docs/DATABASE.md "Cross-teacher student hijacking prevention".
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
  -- SECURITY (was missing): the authorization anchor for classroom_students
  -- INSERT — see table comment above. `set null` (not cascade, not
  -- restrict) on the creator's profile being deleted: the student record
  -- must survive regardless (never auto-deleted just because its creator
  -- is gone — see docs/DATABASE.md "Orphan student strategy"), and a
  -- profile delete must never be blocked by how many students it created.
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Indexed for duplicate lookup during import, but intentionally NOT a
-- unique constraint — see docs/DATABASE.md "student_code duplicate
-- strategy" for why uniqueness is enforced at the service layer, scoped
-- to what the requesting teacher can already see, rather than globally.
create index if not exists students_student_code_idx on public.students (student_code);
create index if not exists students_created_by_idx on public.students (created_by);

create trigger set_students_updated_at
  before update on public.students
  for each row
  execute function public.set_updated_at();

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

-- ==================================================
-- Authorization helper: is_student_creator
--
-- Why this needs SECURITY DEFINER (the only function in this migration
-- that does): the classroom_students INSERT policy below needs to check
-- "did the calling teacher create this student row" as part of deciding
-- whether to allow a brand-new enrollment. But `students_select_via_classroom`
-- only grants visibility into a student AFTER a classroom_students link
-- exists — which is exactly the row we're in the middle of creating. A
-- plain (SECURITY INVOKER) subquery against `students` from inside the
-- classroom_students policy would be silently filtered by that same
-- select policy and always see zero rows, permanently blocking anyone
-- from ever enrolling a student they just created. This tiny, narrowly-
-- scoped SECURITY DEFINER function is the standard escape from that
-- bootstrapping problem: it looks up exactly one boolean fact (did
-- *auth.uid()* create *this* student) bypassing the caller's own SELECT
-- visibility, and nothing else.
--
-- Safety checklist:
--  - search_path is pinned so it can't be redirected by the caller.
--  - it only ever compares against auth.uid() internally — it takes no
--    "which user" parameter, so it cannot be used to probe whether some
--    OTHER teacher created a given student (no information leak).
--  - it returns a boolean only, never row data.
--  - EXECUTE is revoked from PUBLIC and granted only to `authenticated`.
-- ==================================================

create or replace function public.is_student_creator(p_student_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.students s
    where s.id = p_student_id and s.created_by = auth.uid()
  );
$$;

revoke all on function public.is_student_creator(uuid) from public;
grant execute on function public.is_student_creator(uuid) to authenticated;

-- ==================================================
-- Authorization helper: has_existing_classroom_link
--
-- A second, related helper — needed for a different reason. The
-- classroom_students INSERT policy's "custody via an existing
-- enrollment" branch needs to check "is this student already linked to
-- some OTHER classroom I own", which means querying classroom_students
-- itself. Postgres flatly disallows a policy on a table from containing
-- a raw subquery against that SAME table ("infinite recursion detected
-- in policy for relation ..."), regardless of whether the inner query
-- would actually terminate. Wrapping the check in a function sidesteps
-- that restriction the same way a view or CTE couldn't. Same safety
-- properties as is_student_creator above: no "which user" parameter,
-- boolean-only return, EXECUTE restricted to `authenticated`.
-- ==================================================

create or replace function public.has_existing_classroom_link(p_student_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.classroom_students cs
    join public.classrooms c on c.id = cs.classroom_id
    where cs.student_id = p_student_id
      and c.teacher_id = auth.uid()
  );
$$;

revoke all on function public.has_existing_classroom_link(uuid) from public;
grant execute on function public.has_existing_classroom_link(uuid) to authenticated;

-- ==================================================
-- RLS: profiles
-- ==================================================

-- SECURITY: prevents a normal signed-in user from granting themselves
-- (or anyone else) a more privileged role via a direct UPDATE, since the
-- profiles_update_own policy below only checks row *ownership*, not
-- which columns are being changed. `role` is the one authorization-
-- sensitive field on this table; everything else (display_name, email)
-- stays freely self-editable.
--
-- The guard only applies when the request is running as the ordinary
-- Postgres `authenticated` role (i.e. a normal client using the
-- anon/publishable key + a user JWT). It intentionally does NOT apply to
-- `service_role` or a superuser SQL-editor session, since promoting a
-- user to admin is expected to happen through a trusted backend/operator
-- action outside RLS, not through this client app.
create or replace function public.protect_profile_privileged_fields()
returns trigger
language plpgsql
as $$
begin
  if current_setting('role', true) = 'authenticated' and new.role is distinct from old.role then
    raise exception 'ไม่สามารถเปลี่ยนสิทธิ์ (role) ของบัญชีได้ด้วยตนเอง' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger protect_profiles_privileged_fields
  before update on public.profiles
  for each row
  execute function public.protect_profile_privileged_fields();

alter table public.profiles enable row level security;

-- A user may read and edit only their own profile row. There is no
-- "admin can see everyone" policy yet — out of scope for this phase.
create policy "profiles_select_own"
  on public.profiles for select
  using (id = auth.uid());

-- SECURITY: self-service profile creation is locked to role = 'teacher'
-- (the only role this app's UI actually provisions). This closes the
-- insert-time half of the role-escalation gap — a user can't insert
-- their own profile as 'admin' any more than they could update into it
-- (see protect_profile_privileged_fields above for the update-time
-- half). Provisioning an 'admin' or 'student' profile is a trusted
-- backend/operator action (service_role), not a client-side insert.
create policy "profiles_insert_own"
  on public.profiles for insert
  with check (id = auth.uid() and role = 'teacher');

create policy "profiles_update_own"
  on public.profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

-- ==================================================
-- RLS: classrooms
-- ==================================================

alter table public.classrooms enable row level security;

-- Teachers only ever see and manage classrooms they own. There is
-- intentionally no "shared classroom" or admin-wide policy in this phase.
create policy "classrooms_select_own"
  on public.classrooms for select
  using (teacher_id = auth.uid());

-- SECURITY: creating a classroom requires BOTH that the caller names
-- themselves as the owner (teacher_id = auth.uid() — you can never
-- create a classroom "owned" by someone else) AND that their profile
-- role is actually 'teacher' or 'admin'. Previously this only checked
-- ownership, so a profile with role = 'student' could still create
-- classrooms.
create policy "classrooms_insert_own"
  on public.classrooms for insert
  with check (
    teacher_id = auth.uid()
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('teacher', 'admin')
    )
  );

create policy "classrooms_update_own"
  on public.classrooms for update
  using (teacher_id = auth.uid())
  with check (teacher_id = auth.uid());

create policy "classrooms_delete_own"
  on public.classrooms for delete
  using (teacher_id = auth.uid());

-- ==================================================
-- RLS: students
-- ==================================================

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

-- SECURITY: a brand new student is not linked to any classroom yet at
-- the moment it's inserted, so the select-via-classroom check can't
-- apply here. Any authenticated teacher/admin may create a student
-- record, but `created_by` must be honestly set to the caller
-- themselves (not forged to point at another teacher) — this is what
-- classroom_students' custody check below relies on. The student only
-- becomes visible to anyone once linked via classroom_students.
create policy "students_insert_authorized"
  on public.students for insert
  with check (
    created_by = auth.uid()
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('teacher', 'admin')
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
-- RLS: classroom_students
-- ==================================================

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

-- SECURITY (fixes cross-teacher student hijacking): linking a student
-- into one of your own classrooms now requires BOTH:
--   1. you own the target classroom (teacher_id = auth.uid()), AND
--   2. you have "custody" of the student — either you created that
--      student record yourself (is_student_creator), or the student is
--      already linked to some OTHER classroom you own (you legitimately
--      already teach them, e.g. re-enrolling them next semester).
--
-- Without #2, a teacher who merely learns or guesses another teacher's
-- student UUID could previously link that student into their own
-- classroom and immediately gain read/update access to it via
-- students_select_via_classroom. That path is now closed: you cannot
-- create a fresh custody relationship to a student you have no existing
-- relationship with, no matter what classroom you own.
create policy "classroom_students_insert_own"
  on public.classroom_students for insert
  with check (
    exists (
      select 1 from public.classrooms c
      where c.id = classroom_students.classroom_id
        and c.teacher_id = auth.uid()
    )
    and (
      public.is_student_creator(classroom_students.student_id)
      or public.has_existing_classroom_link(classroom_students.student_id)
    )
  );

-- Explicit, separate authorization path for legitimate cross-teacher
-- enrollment (e.g. transferring a student between teachers, or a
-- school admin setting up shared/co-taught sections): an 'admin' role
-- may link ANY student into ANY classroom, independent of ownership or
-- custody. This is deliberately its own policy (Postgres OR's multiple
-- permissive policies together) rather than a condition baked into the
-- per-teacher rule above, so the "normal teacher" path stays strictly
-- ownership+custody scoped while still leaving a real, auditable route
-- for the multi-teacher scenarios this schema will need later — instead
-- of quietly loosening the teacher policy itself.
create policy "classroom_students_insert_admin"
  on public.classroom_students for insert
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

-- Removing a membership row only ever deletes THIS classroom_students
-- row — it never touches the underlying students row. See
-- docs/DATABASE.md "Orphan student strategy".
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
-- create_student_and_enroll: atomic "create + enroll" RPC
--
-- Fixes the orphan-row risk of doing this as two separate client-side
-- statements (insert into students; insert into classroom_students):
-- if the second insert ever failed, the first would already be
-- committed, leaving an unreachable student row with no membership.
-- Wrapping both inserts in one PL/pgSQL function means Postgres runs
-- them as a single statement-level unit — if anything inside raises,
-- the whole function's effects (both inserts) are rolled back together.
--
-- SECURITY DEFINER is deliberately NOT used here. The RLS policies
-- above (students_insert_authorized, classroom_students_insert_own)
-- already grant a legitimate teacher everything this function does; a
-- plain SECURITY INVOKER function just gives the app one atomic
-- entrypoint instead of two round trips, without taking on any of the
-- risks (search_path hijacking, accidental privilege bypass) that come
-- with running as the function owner. Every statement inside still goes
-- through RLS exactly as if the client had run it directly.
--
-- Implementation note — same bootstrapping problem as is_student_creator,
-- solved differently here: `insert into students ... returning * into
-- v_student` would fail, because reading the row back via RETURNING is
-- subject to students_select_via_classroom, which doesn't grant
-- visibility until a classroom_students link exists — which doesn't
-- exist yet at that point. So the id is generated up front, the first
-- insert has no RETURNING at all, and the row is only read back (via a
-- plain, RLS-checked SELECT) as the last step, after the
-- classroom_students link has been created and visibility genuinely
-- holds. No SECURITY DEFINER needed for this function as a result.
-- ==================================================

create or replace function public.create_student_and_enroll(
  p_classroom_id uuid,
  p_first_name text,
  p_last_name text,
  p_student_code text default null,
  p_number integer default null,
  p_nickname text default null,
  p_email text default null,
  p_phone text default null
)
returns public.students
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_student_id uuid := gen_random_uuid();
  v_student public.students;
begin
  if auth.uid() is null then
    raise exception 'กรุณาเข้าสู่ระบบก่อนใช้งาน' using errcode = '28000';
  end if;

  if coalesce(trim(p_first_name), '') = '' or coalesce(trim(p_last_name), '') = '' then
    raise exception 'กรุณากรอกชื่อและนามสกุล' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.classrooms c
    where c.id = p_classroom_id and c.teacher_id = auth.uid()
  ) then
    raise exception 'ไม่พบห้องเรียนนี้ หรือคุณไม่มีสิทธิ์เข้าถึง' using errcode = '42501';
  end if;

  insert into public.students (
    id, student_code, number, first_name, last_name, nickname, email, phone, created_by
  ) values (
    v_student_id,
    nullif(trim(p_student_code), ''),
    p_number,
    trim(p_first_name),
    trim(p_last_name),
    nullif(trim(p_nickname), ''),
    nullif(trim(p_email), ''),
    nullif(trim(p_phone), ''),
    auth.uid()
  );

  insert into public.classroom_students (classroom_id, student_id)
  values (p_classroom_id, v_student_id);

  select * into v_student from public.students where id = v_student_id;

  return v_student;
end;
$$;

revoke all on function public.create_student_and_enroll(uuid, text, text, text, integer, text, text, text) from public;
grant execute on function public.create_student_and_enroll(uuid, text, text, text, integer, text, text, text) to authenticated;

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
