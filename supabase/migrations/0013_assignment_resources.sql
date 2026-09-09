-- AI Classroom Management — Assignment Resources / Worksheet Attachments.
-- See docs/DATABASE.md for the full schema explanation and RLS rationale.
--
-- Builds on 0001_init.sql (classrooms, students, set_updated_at()),
-- 0006_subject_assignments.sql (assignments, assignments_select_own),
-- and 0011_student_portal_read_access.sql (my_student_id(),
-- is_my_classroom()). This migration has NOT been applied to a live
-- database yet — do NOT run it automatically. 0001-0012 have already
-- been applied and are NOT modified here: this migration only ADDS one
-- new table, new helper functions, new RLS policies, one new storage
-- bucket, and its storage.objects policies.
--
-- Scope: a teacher may attach any number of FILE or LINK resources
-- ("สื่อและใบงาน") to an assignment they own — a worksheet PDF, a Google
-- Form link, etc. Students enrolled in the assignment's classroom may
-- read/download these, never modify them. Student SUBMISSION uploads are
-- explicitly out of scope for this migration (see the feature's own
-- task scope) — this table only ever holds teacher-attached resources.
--
-- SECURITY MODEL — identity: exactly as every migration since 0011 —
-- "which student is this" is always my_student_id() (auth.uid() ->
-- students.linked_profile_id), "which classroom(s) can they read" is
-- always is_my_classroom() built on that. "Which teacher is this" for
-- resource management is always auth.uid() compared against
-- classrooms.teacher_id transitively through assignments.classroom_id —
-- assignment_resources has no owner column of its own, matching
-- assignments' own "ownership is always derived transitively" design
-- (0006).
--
-- SECURITY MODEL — recursion avoidance: the two cross-table checks this
-- migration needs (teacher: "do I own this resource's assignment?";
-- student: "can I read this resource's assignment?") are each wrapped in
-- a narrow SECURITY DEFINER helper (is_teacher_of_assignment,
-- student_can_view_assignment below), the same fix pattern 0008/0011/0012
-- all had to apply after empirically hitting Postgres RLS recursion from
-- a raw cross-table subquery inline in a policy. assignment_resources is
-- a brand-new table with no existing policy anywhere referencing it, so
-- this migration cannot by itself introduce a NEW recursion cycle either
-- way — the helpers are used here purely for consistency with this
-- schema's established, proven-safe pattern, and re-verified empirically
-- regardless (see supabase/tests/0013_assignment_resources.sql).

-- ==================================================
-- assignment_resources
-- Exactly one of file_path/url is set, matching resource_type — enforced
-- by the check constraint below, not just application code.
-- ==================================================

create table if not exists public.assignment_resources (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments (id) on delete cascade,
  resource_type text not null check (resource_type in ('file', 'link')),
  title text not null check (char_length(title) > 0),
  -- Storage object path in the 'assignment-files' bucket (see the
  -- storage section below) — never a full URL, never exposed to a
  -- student as a raw path (the frontend always resolves it to a
  -- short-lived signed URL before ever showing/opening it).
  file_path text,
  -- External resource URL (Google Forms, Canva, Quizizz, etc.) — HTTPS
  -- only, enforced by both this constraint and the frontend's own
  -- pre-insert validation (defense in depth, not either-or).
  url text,
  mime_type text,
  sort_order integer not null default 0,
  -- Audit trail only, NOT the authorization boundary — same role as
  -- assignments.created_by (0006). `set null` so deleting a teacher
  -- profile never blocks on, nor cascades into destroying, resources
  -- they attached.
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint assignment_resources_type_fields_check check (
    (resource_type = 'file' and file_path is not null and url is null)
    or
    (resource_type = 'link' and url is not null and file_path is null)
  ),
  constraint assignment_resources_url_https_check check (url is null or url ~* '^https://')
);

create index if not exists assignment_resources_assignment_id_idx
  on public.assignment_resources (assignment_id, sort_order);

create trigger set_assignment_resources_updated_at
  before update on public.assignment_resources
  for each row
  execute function public.set_updated_at();

-- ==================================================
-- is_teacher_of_assignment(p_assignment_id): "does the calling teacher
-- own the classroom this assignment belongs to?" — the sole
-- authorization check for managing (insert/update/delete/select) a
-- resource, mirroring assignments_select_own's own ownership shape
-- (0006) through a SECURITY DEFINER wrapper. Boolean-only return, one
-- specific assignment_id in, no enumeration surface.
-- ==================================================

create or replace function public.is_teacher_of_assignment(p_assignment_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.assignments a
    join public.classrooms c on c.id = a.classroom_id
    where a.id = p_assignment_id
      and c.teacher_id = auth.uid()
  )
$$;

revoke all on function public.is_teacher_of_assignment(uuid) from public;
grant execute on function public.is_teacher_of_assignment(uuid) to authenticated;

-- ==================================================
-- student_can_view_assignment(p_assignment_id): "is this assignment in a
-- classroom the calling student currently belongs to?" — built on
-- is_my_classroom() (0011), same recursion-avoidance reasoning.
-- ==================================================

create or replace function public.student_can_view_assignment(p_assignment_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.assignments a
    where a.id = p_assignment_id
      and public.is_my_classroom(a.classroom_id)
  )
$$;

revoke all on function public.student_can_view_assignment(uuid) from public;
grant execute on function public.student_can_view_assignment(uuid) to authenticated;

-- ==================================================
-- RLS: assignment_resources
-- ==================================================

alter table public.assignment_resources enable row level security;

create policy "assignment_resources_select_teacher"
  on public.assignment_resources for select
  using (public.is_teacher_of_assignment(assignment_id));

-- SECURITY-CRITICAL: a student may read resources only for an
-- assignment in a classroom they currently belong to — never another
-- classroom's, never another teacher's.
create policy "assignment_resources_select_student"
  on public.assignment_resources for select
  using (public.student_can_view_assignment(assignment_id));

create policy "assignment_resources_insert_teacher"
  on public.assignment_resources for insert
  with check (public.is_teacher_of_assignment(assignment_id));

create policy "assignment_resources_update_teacher"
  on public.assignment_resources for update
  using (public.is_teacher_of_assignment(assignment_id))
  with check (public.is_teacher_of_assignment(assignment_id));

create policy "assignment_resources_delete_teacher"
  on public.assignment_resources for delete
  using (public.is_teacher_of_assignment(assignment_id));

-- Deliberately NO insert/update/delete policy for students on this
-- table at all — RLS enabled + no matching permissive policy = deny by
-- default, so there is no path (direct PostgREST included) for a
-- student to create, edit, or delete a resource, ever.

-- ==================================================
-- Storage: 'assignment-files' bucket + storage.objects policies.
--
-- Path convention: '<teacher_id>/<subject_id>/<classroom_id>/
-- <assignment_id>/<generated-file-name>' — the teacher_id segment is
-- always the uploading teacher's own auth.uid() (enforced by every
-- teacher policy below), never a client-chosen value; the
-- classroom_id segment (3rd) is what the student SELECT policy checks
-- against is_my_classroom(), so a student can only ever reach objects
-- under a classroom they currently belong to. <generated-file-name> is
-- always a randomly generated name (never the original uploaded
-- filename) — see assignment-resource-service.ts's buildResourcePath —
-- so a filename can never collide across teachers/assignments and never
-- leaks anything about the original file.
--
-- Bucket is created `public = false`, unlike the student-portal avatars
-- bucket (0012) — a worksheet is not something every anonymous visitor
-- should be able to fetch given a guessed/leaked URL. Both teacher and
-- student reads go through a short-lived SIGNED URL
-- (supabase.storage.from('assignment-files').createSignedUrl(...)),
-- which itself is only ever issued after the caller's own RLS-gated
-- access to the underlying object is confirmed by the SELECT policies
-- below — there is no public, unrestricted read path to this bucket.
--
-- file_size_limit is in bytes (10 MiB). allowed_mime_types is enforced
-- by Storage itself on every upload, independent of and in addition to
-- the client-side validation in the upload UI.
-- ==================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'assignment-files',
  'assignment-files',
  false,
  10485760,
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'image/jpeg',
    'image/png',
    'image/webp'
  ]
)
on conflict (id) do nothing;

-- Safely extracts the classroom_id segment (3rd path segment) from an
-- assignment-files object name and casts it to uuid, returning NULL
-- instead of raising on a malformed/short path — a raw `::uuid` cast
-- inside a policy expression would otherwise abort the ENTIRE query
-- (not just deny that one row) the moment it hit a single malformed
-- object name anywhere in the bucket. NULL flows harmlessly into
-- is_my_classroom(NULL), which is always false (deny), never an error.
create or replace function public.assignment_files_path_classroom_id(p_object_name text)
returns uuid
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_segment text;
begin
  v_segment := (storage.foldername(p_object_name))[3];
  if v_segment is null then
    return null;
  end if;
  return v_segment::uuid;
exception
  when invalid_text_representation then
    return null;
end;
$$;

revoke all on function public.assignment_files_path_classroom_id(text) from public;
grant execute on function public.assignment_files_path_classroom_id(text) to authenticated;

-- Teacher: full control, but only ever under their own uid's top-level
-- folder — no other teacher could ever have written a path prefixed
-- with this teacher's own auth.uid(), so checking just that first
-- segment is sufficient to reconstruct "do I own this file" for
-- select/update/delete too, not just insert.
create policy "assignment_files_insert_teacher"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'assignment-files'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "assignment_files_select_teacher"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'assignment-files'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "assignment_files_update_teacher"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'assignment-files'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'assignment-files'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "assignment_files_delete_teacher"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'assignment-files'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- SECURITY-CRITICAL: a student may read a file object only when its
-- path's classroom_id segment (3rd) is a classroom they currently
-- belong to — never another classroom's, regardless of which teacher
-- uploaded it. Students have no insert/update/delete policy on this
-- bucket at all (deny by default) — they can never upload, replace, or
-- delete an assignment file.
create policy "assignment_files_select_student"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'assignment-files'
    and public.is_my_classroom(public.assignment_files_path_classroom_id(name))
  );

-- ==================================================
-- Nothing above touches any existing table's existing policy, any
-- previously-applied migration (0001-0012), or grants any broader
-- table-level privilege — this migration only adds one new table (with
-- its own additive RLS), three new narrowly-scoped functions, and a
-- matching set of storage.objects policies scoped to a brand-new,
-- private 'assignment-files' bucket.
-- ==================================================
