-- AI Classroom Management — Subject Lessons / Learning Materials.
-- See docs/DATABASE.md for the schema explanation and RLS rationale of
-- every prior migration this one builds on.
--
-- Builds on 0001_init.sql (classrooms, set_updated_at()),
-- 0002_subjects_topics.sql (subjects, subject_classrooms),
-- 0011_student_portal_read_access.sql (my_student_id(), is_my_classroom()),
-- and 0013_assignment_resources.sql (the exact table/RLS/storage shape
-- this migration mirrors for a second, parallel resource kind). This
-- migration has NOT been applied to a live database yet — do NOT run it
-- automatically. 0001-0014 have already been applied and are NOT
-- modified here: this migration only ADDS two new tables, new helper
-- functions, new RLS policies, one new storage bucket, and its
-- storage.objects policies.
--
-- Scope: a "บทเรียน" (lesson) is teacher-organized learning material —
-- slides, teaching videos, documents, external links — grouped under a
-- subject+classroom, completely separate from the assignment workflow
-- (assignments/assignment_submissions/assignment_resources, 0006/0013).
-- A lesson is never gradable, never has a due date, and a student's view
-- of it is always read-only. Publishing is explicit and binary
-- (is_published) — a lesson starts unpublished (draft) and a teacher
-- must deliberately publish it before any student can see it at all.
--
-- SECURITY MODEL — identity: exactly the same as every migration since
-- 0011/0013 — "which teacher is this" for lesson management is always
-- auth.uid() compared against classrooms.teacher_id transitively through
-- lessons.classroom_id (lessons has no owner column of its own, matching
-- assignments' and assignment_resources' "ownership is always derived
-- transitively" design); "which student is this" is always
-- my_student_id() / is_my_classroom(), never a client-supplied id.
--
-- SECURITY MODEL — publish gating: unlike assignments (which a student
-- can always see once enrolled — there is no draft state), a lesson row
-- and every one of its resources is invisible to a student until BOTH
-- is_published = true AND is_archived = false, checked directly in the
-- lesson SELECT policy and — for resources and storage objects — via the
-- student_can_view_lesson() helper below, which re-checks the SAME two
-- flags on the parent lesson every time. There is no separate "preview
-- as draft" path for a student anywhere.
--
-- SECURITY MODEL — recursion avoidance: exactly the same proven pattern
-- as 0008/0011/0012/0013 — every cross-table authorization check is
-- wrapped in a narrow SECURITY DEFINER helper (is_teacher_of_lesson,
-- student_can_view_lesson below) rather than a raw cross-table subquery
-- inline in a policy. lessons/lesson_resources are brand-new tables with
-- no existing policy anywhere referencing them, so this migration cannot
-- by itself introduce a NEW recursion cycle either way — the helpers are
-- used here purely for consistency with this schema's established,
-- proven-safe pattern, and re-verified empirically regardless (see
-- supabase/tests/0015_lessons.sql).

-- ==================================================
-- lessons
-- One row per lesson, always tied to both subject_id AND classroom_id —
-- the same "never a bare subject-wide thing, never classroom-less" shape
-- as assignments (0006): "ฟิสิกส์ taught to ม.5/1 and ม.5/2" gets two
-- completely independent lesson sets, even when titles match between
-- them.
-- ==================================================

create table if not exists public.lessons (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.subjects (id) on delete cascade,
  classroom_id uuid not null references public.classrooms (id) on delete cascade,
  title text not null check (char_length(title) > 0),
  description text,
  sort_order integer not null default 0,
  is_published boolean not null default false,
  -- Archiving (never hard-deleting) mirrors students/subjects/classrooms/
  -- assignments' own no-hard-delete stance — see "No delete policy" note
  -- below.
  is_archived boolean not null default false,
  -- Audit trail only, NOT the authorization boundary — same role as
  -- assignments.created_by (0006).
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists lessons_subject_classroom_idx
  on public.lessons (subject_id, classroom_id, sort_order);

create trigger set_lessons_updated_at
  before update on public.lessons
  for each row
  execute function public.set_updated_at();

-- ==================================================
-- lesson_resources
-- Exactly one of file_path/url is set, matching the same shape as
-- assignment_resources (0013). resource_type further narrows what's
-- allowed: a VIDEO resource is ALWAYS an external link — this migration
-- deliberately does not support uploading video files to Supabase
-- Storage at all (see Section 4/7 of the feature spec: "Do NOT upload
-- large teaching videos to Supabase Storage" / "Do not attempt to
-- download or proxy large videos through Supabase"), enforced by the
-- check constraint below, not just application code.
-- ==================================================

create table if not exists public.lesson_resources (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references public.lessons (id) on delete cascade,
  resource_type text not null check (resource_type in ('slide', 'video', 'document', 'link')),
  title text not null check (char_length(title) > 0),
  -- Storage object path in the 'lesson-files' bucket (see the storage
  -- section below) — never a full URL, never exposed to a student as a
  -- raw path (the frontend always resolves it to a short-lived signed
  -- URL before ever showing/opening it). Only ever set for
  -- resource_type IN ('slide', 'document') — see the video-no-upload
  -- constraint below.
  file_path text,
  -- External resource URL (YouTube, Google Drive, Google Slides, Canva,
  -- any other HTTPS learning resource) — HTTPS only, enforced by both
  -- this constraint and the frontend's own pre-insert validation
  -- (defense in depth, not either-or).
  url text,
  mime_type text,
  sort_order integer not null default 0,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lesson_resources_fields_check check (
    (file_path is not null and url is null)
    or
    (file_path is null and url is not null)
  ),
  -- SECURITY / STORAGE-STRATEGY: a 'video' resource can never carry an
  -- uploaded file — it must always be an external link (YouTube, Google
  -- Drive, etc.). This is enforced at the database level, not just in
  -- the upload UI, so there is no path (direct PostgREST/Storage API
  -- included) to attach a large video binary to this table.
  constraint lesson_resources_video_no_upload_check check (
    resource_type <> 'video' or file_path is null
  ),
  constraint lesson_resources_url_https_check check (url is null or url ~* '^https://')
);

create index if not exists lesson_resources_lesson_id_idx
  on public.lesson_resources (lesson_id, sort_order);

create trigger set_lesson_resources_updated_at
  before update on public.lesson_resources
  for each row
  execute function public.set_updated_at();

-- ==================================================
-- is_teacher_of_lesson(p_lesson_id): "does the calling teacher own the
-- classroom this lesson belongs to?" — the sole authorization check for
-- managing (insert/update/delete/select) a lesson's resources, and (via
-- the classroom check inline in the lessons policies below) for the
-- lesson row itself. Mirrors is_teacher_of_assignment (0013) exactly.
-- ==================================================

create or replace function public.is_teacher_of_lesson(p_lesson_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.lessons l
    join public.classrooms c on c.id = l.classroom_id
    where l.id = p_lesson_id
      and c.teacher_id = auth.uid()
  )
$$;

revoke all on function public.is_teacher_of_lesson(uuid) from public;
grant execute on function public.is_teacher_of_lesson(uuid) to authenticated;

-- ==================================================
-- student_can_view_lesson(p_lesson_id): "is this lesson published,
-- non-archived, AND in a classroom the calling student currently belongs
-- to?" — built on is_my_classroom() (0011), same recursion-avoidance
-- reasoning as student_can_view_assignment (0013), plus the extra
-- publish/archive gate that assignments never needed.
-- ==================================================

create or replace function public.student_can_view_lesson(p_lesson_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.lessons l
    where l.id = p_lesson_id
      and l.is_published = true
      and l.is_archived = false
      and public.is_my_classroom(l.classroom_id)
  )
$$;

revoke all on function public.student_can_view_lesson(uuid) from public;
grant execute on function public.student_can_view_lesson(uuid) to authenticated;

-- ==================================================
-- RLS: lessons
-- ==================================================

alter table public.lessons enable row level security;

create policy "lessons_select_teacher"
  on public.lessons for select
  using (
    exists (
      select 1 from public.classrooms c
      where c.id = lessons.classroom_id and c.teacher_id = auth.uid()
    )
  );

-- SECURITY-CRITICAL: a student may read a lesson row only when it is
-- published, non-archived, AND in a classroom they currently belong to
-- — never a draft, never another classroom's, regardless of subject.
create policy "lessons_select_student"
  on public.lessons for select
  using (
    lessons.is_published = true
    and lessons.is_archived = false
    and public.is_my_classroom(lessons.classroom_id)
  );

-- SECURITY: creating a lesson requires ALL of:
--   1. the caller owns the target classroom,
--   2. the caller owns the target subject,
--   3. that subject is actually linked to that classroom via
--      subject_classrooms (closing "attach a lesson to a subject that
--      has nothing to do with this classroom"),
--   4. created_by is honestly the caller (never forged to point at
--      another teacher).
-- Exactly the same four-part shape as assignments_insert_own (0006).
create policy "lessons_insert_teacher"
  on public.lessons for insert
  with check (
    exists (
      select 1 from public.classrooms c
      where c.id = lessons.classroom_id and c.teacher_id = auth.uid()
    )
    and exists (
      select 1 from public.subjects s
      where s.id = lessons.subject_id and s.teacher_id = auth.uid()
    )
    and exists (
      select 1 from public.subject_classrooms sc
      where sc.subject_id = lessons.subject_id and sc.classroom_id = lessons.classroom_id
    )
    and created_by = auth.uid()
  );

-- Editing (title/description/sort_order/is_published/is_archived) a
-- lesson. WITH CHECK re-derives the same four-part ownership+link
-- condition as INSERT, so an UPDATE can never reassign a lesson's
-- subject_id/classroom_id to a pair the caller doesn't own or that isn't
-- actually linked.
create policy "lessons_update_teacher"
  on public.lessons for update
  using (
    exists (
      select 1 from public.classrooms c
      where c.id = lessons.classroom_id and c.teacher_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.classrooms c
      where c.id = lessons.classroom_id and c.teacher_id = auth.uid()
    )
    and exists (
      select 1 from public.subjects s
      where s.id = lessons.subject_id and s.teacher_id = auth.uid()
    )
    and exists (
      select 1 from public.subject_classrooms sc
      where sc.subject_id = lessons.subject_id and sc.classroom_id = lessons.classroom_id
    )
  );

-- SECURITY: deliberately NO delete policy — matching assignments/
-- students/subjects. "Archive lesson" in the UI is is_archived = true
-- via UPDATE, never a real DELETE.

-- ==================================================
-- RLS: lesson_resources
-- ==================================================

alter table public.lesson_resources enable row level security;

create policy "lesson_resources_select_teacher"
  on public.lesson_resources for select
  using (public.is_teacher_of_lesson(lesson_id));

-- SECURITY-CRITICAL: a student may read resources only for a lesson that
-- is currently published, non-archived, and in a classroom they belong
-- to — never a draft lesson's resources, never another classroom's.
create policy "lesson_resources_select_student"
  on public.lesson_resources for select
  using (public.student_can_view_lesson(lesson_id));

create policy "lesson_resources_insert_teacher"
  on public.lesson_resources for insert
  with check (public.is_teacher_of_lesson(lesson_id));

create policy "lesson_resources_update_teacher"
  on public.lesson_resources for update
  using (public.is_teacher_of_lesson(lesson_id))
  with check (public.is_teacher_of_lesson(lesson_id));

create policy "lesson_resources_delete_teacher"
  on public.lesson_resources for delete
  using (public.is_teacher_of_lesson(lesson_id));

-- Deliberately NO insert/update/delete policy for students on either
-- table in this migration — RLS enabled + no matching permissive policy
-- = deny by default, so there is no path (direct PostgREST included) for
-- a student to create a lesson, edit one, upload a resource, or delete
-- anything, ever.

-- ==================================================
-- Storage: 'lesson-files' bucket + storage.objects policies.
--
-- Path convention: '<teacher_id>/<subject_id>/<classroom_id>/<lesson_id>/
-- <generated-file-name>' — same shape as 'assignment-files' (0013), with
-- one deliberate difference: the STUDENT select policy below checks the
-- *lesson_id* segment (4th) through student_can_view_lesson() — not just
-- classroom membership — so a storage object for an unpublished or
-- archived lesson stays invisible to a student even if they somehow
-- learned its exact path. <generated-file-name> is always a randomly
-- generated name (never the original uploaded filename), same reasoning
-- as 0013.
--
-- Bucket is created `public = false` — a slide/document is not something
-- every anonymous visitor should be able to fetch given a guessed/leaked
-- URL. Both teacher and student reads go through a short-lived SIGNED
-- URL, issued only after the caller's own RLS-gated access to the
-- underlying object is confirmed by the SELECT policies below.
--
-- file_size_limit is in bytes (20 MiB — slides/documents run larger than
-- a typical worksheet). allowed_mime_types covers PDF, PPTX, DOCX, and
-- common images (for a scanned document page) — it deliberately does NOT
-- include any video mime type, matching the "no uploaded video" stance
-- enforced at the table level above; a teacher who wants to share a
-- video always does so via an external link (YouTube, Google Drive,
-- etc.), never an upload through this bucket.
-- ==================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'lesson-files',
  'lesson-files',
  false,
  20971520,
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'image/jpeg',
    'image/png',
    'image/webp'
  ]
)
on conflict (id) do nothing;

-- Safely extracts the lesson_id segment (4th path segment) from a
-- lesson-files object name and casts it to uuid, returning NULL instead
-- of raising on a malformed/short path — same exception-safe reasoning
-- as assignment_files_path_classroom_id (0013): a raw `::uuid` cast
-- inside a policy expression would otherwise abort the ENTIRE query the
-- moment it hit a single malformed object name anywhere in the bucket.
-- NULL flows harmlessly into student_can_view_lesson(NULL), which is
-- always false (deny), never an error.
create or replace function public.lesson_files_path_lesson_id(p_object_name text)
returns uuid
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_segment text;
begin
  v_segment := (storage.foldername(p_object_name))[4];
  if v_segment is null then
    return null;
  end if;
  return v_segment::uuid;
exception
  when invalid_text_representation then
    return null;
end;
$$;

revoke all on function public.lesson_files_path_lesson_id(text) from public;
grant execute on function public.lesson_files_path_lesson_id(text) to authenticated;

-- Teacher: full control, but only ever under their own uid's top-level
-- folder — same "no other teacher could ever have written a path
-- prefixed with this teacher's own auth.uid()" reasoning as 0013.
create policy "lesson_files_insert_teacher"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'lesson-files'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "lesson_files_select_teacher"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'lesson-files'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "lesson_files_update_teacher"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'lesson-files'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'lesson-files'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "lesson_files_delete_teacher"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'lesson-files'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- SECURITY-CRITICAL: a student may read a file object only when the
-- lesson_id segment (4th) of its path resolves to a lesson that is
-- CURRENTLY published, non-archived, and in a classroom they belong to
-- — checked via the exact same student_can_view_lesson() helper the
-- lesson_resources row policy uses, so a storage object's visibility can
-- never drift from its owning row's. Students have no insert/update/
-- delete policy on this bucket at all (deny by default).
create policy "lesson_files_select_student"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'lesson-files'
    and public.student_can_view_lesson(public.lesson_files_path_lesson_id(name))
  );

-- ==================================================
-- Nothing above touches any existing table's existing policy, any
-- previously-applied migration (0001-0014), or grants any broader
-- table-level privilege — this migration only adds two new tables (with
-- their own additive RLS), three new narrowly-scoped functions, and a
-- matching set of storage.objects policies scoped to a brand-new,
-- private 'lesson-files' bucket. Lessons are entirely independent of the
-- assignment workflow — no foreign key, policy, or function here
-- references assignments/assignment_submissions/assignment_resources at
-- all.
-- ==================================================
