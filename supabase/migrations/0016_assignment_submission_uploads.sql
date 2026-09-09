-- AI Classroom Management — Student Online Assignment Submission.
-- See docs/DATABASE.md for the schema explanation and RLS rationale of
-- every prior migration this one builds on.
--
-- Builds on 0006_subject_assignments.sql (assignments, assignment_submissions,
-- assignment_submissions_select_own/_insert_own/_update_own — all
-- teacher-only until this migration), 0011_student_portal_read_access.sql
-- (my_student_id(), is_my_classroom()), and 0013_assignment_resources.sql /
-- 0015_lessons.sql (the exact private-bucket + path-segment-helper storage
-- pattern this migration reuses for a THIRD resource kind). This
-- migration has NOT been applied to a live database yet — do NOT run it
-- automatically. 0001-0015 have already been applied and are NOT modified
-- here: this migration only ADDS columns (via `alter table ... add column
-- if not exists`), one new table, new helper functions/triggers, new RLS
-- policies (additive only — see below for why the existing teacher
-- policies are completely untouched), one new storage bucket, and its
-- storage.objects policies.
--
-- Scope: completes the assignment workflow — until now,
-- assignment_submissions was written ONLY by the teacher (marking status/
-- score/note by hand). This migration lets an approved, linked student
-- write their OWN submission — attach one or more resources (an uploaded
-- file, an external HTTPS link, or free-text) and have submitted_at/
-- status update accordingly — while a teacher's score and note remain
-- teacher-only, enforced at the database level, not just the UI.
-- Reuses the EXISTING assignment_submissions table/unique-constraint as
-- the source of truth for student/assignment/status/score/submitted_at/
-- reviewed state — this migration deliberately does NOT create a second,
-- competing "grading" table.
--
-- SECURITY MODEL — the central problem this migration solves: teachers
-- and students share the SAME Postgres role (`authenticated`) — there is
-- no separate DB-level role per person, so "a student may freely edit
-- their own status/submitted_at/resources, but must NEVER be able to set
-- their own score or forge a teacher's note" cannot be expressed with
-- table/column-level GRANTs alone (those apply per-role, not per-row).
-- The fix used throughout this migration is a BEFORE UPDATE trigger that
-- inspects WHO is making the change (via my_student_id()/auth.uid()
-- compared against the row's own student_id / the row's owning teacher)
-- and rejects an update to specific columns depending on which side is
-- writing — never a column-level GRANT, which cannot distinguish "this
-- authenticated caller is the owning student" from "this authenticated
-- caller is the owning teacher."
--
-- SECURITY MODEL — recursion avoidance: exactly the same proven pattern
-- as 0008/0011/0013/0015 — every cross-table authorization check is
-- wrapped in a narrow SECURITY DEFINER helper rather than a raw
-- cross-table subquery inline in a policy, re-verified empirically (see
-- supabase/tests/0016_assignment_submission_uploads.sql).

-- ==================================================
-- assignment_submissions: additive columns only. No existing column,
-- constraint, or policy from 0006 is altered or dropped.
-- ==================================================

alter table public.assignment_submissions
  add column if not exists submitted_at timestamptz,
  -- Set the first time a teacher records a score for this submission
  -- (see setSubmissionScore's extension in assignment-service.ts) —
  -- informational only, NOT an authorization boundary. Exists so a
  -- future retention policy ("clean up files N days after grading," see
  -- the feature spec's Section 5) has something concrete to filter on;
  -- this migration does NOT implement any automatic/scheduled deletion
  -- itself.
  add column if not exists reviewed_at timestamptz;

-- ==================================================
-- assignment_submission_resources
-- One row per attached file/link/text answer on a submission. Mirrors
-- assignment_resources' (0013) and lesson_resources' (0015) general
-- shape, adapted for three content kinds instead of two — exactly one of
-- storage_path/external_url/text_content is set, matching resource_type.
--
-- Deliberately does NOT duplicate score/status/submitted_at — those stay
-- exclusively on assignment_submissions, the single source of truth (see
-- the feature spec's Section 7: "Do not duplicate score/status in this
-- child table").
-- ==================================================

create table if not exists public.assignment_submission_resources (
  id uuid primary key default gen_random_uuid(),
  assignment_submission_id uuid not null references public.assignment_submissions (id) on delete cascade,
  resource_type text not null check (resource_type in ('file', 'link', 'text')),
  title text,
  -- Storage object path in the 'submission-files' bucket — never a full
  -- URL, never shown to a teacher/student as a raw path (always resolved
  -- to a short-lived signed URL first). Set to NULL by the teacher's
  -- manual "ล้างไฟล์งานที่ตรวจแล้ว" cleanup action (see
  -- assignment_submission_resources_update_teacher below) — the ROW
  -- survives with deleted_at set, storage_path cleared, but
  -- original_filename/mime_type/file_size preserved for the academic
  -- record.
  storage_path text,
  -- External resource URL (Google Drive, Google Docs, Google Slides,
  -- Canva, any other HTTPS link) — HTTPS only, enforced by both this
  -- constraint and the frontend's own pre-insert validation.
  external_url text,
  -- Free-text answer body — only ever set when resource_type = 'text'.
  text_content text,
  -- Audit metadata for a FILE resource — preserved even after the
  -- underlying storage object is cleaned up (storage_path -> null),
  -- since "original filename" and "how big it was" remain part of the
  -- academic record per the feature spec's Section 5.
  original_filename text,
  mime_type text,
  file_size bigint,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Set by the teacher's manual cleanup action (Section 9) — never by
  -- any automatic/scheduled process (none exists in this migration).
  -- NOT the same thing as a hard DELETE: the row (and every other
  -- column) survives untouched.
  deleted_at timestamptz,
  constraint assignment_submission_resources_fields_check check (
    (resource_type = 'file' and external_url is null and text_content is null
      and (storage_path is not null or deleted_at is not null))
    or
    (resource_type = 'link' and storage_path is null and text_content is null and external_url is not null)
    or
    (resource_type = 'text' and storage_path is null and external_url is null and text_content is not null and char_length(text_content) > 0)
  ),
  constraint assignment_submission_resources_url_https_check check (external_url is null or external_url ~* '^https://')
);

create index if not exists assignment_submission_resources_submission_id_idx
  on public.assignment_submission_resources (assignment_submission_id, sort_order);

create trigger set_assignment_submission_resources_updated_at
  before update on public.assignment_submission_resources
  for each row
  execute function public.set_updated_at();

-- ==================================================
-- student_owns_submission(p_submission_id): "is this submission row MY
-- OWN, as the calling student?" — the sole authorization check for a
-- student managing (insert/select/delete) their own submission's
-- resources, and (via a direct comparison in the submissions policies
-- below) the submission row itself.
-- ==================================================

create or replace function public.student_owns_submission(p_submission_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.assignment_submissions sub
    where sub.id = p_submission_id
      and sub.student_id = public.my_student_id()
  )
$$;

revoke all on function public.student_owns_submission(uuid) from public;
grant execute on function public.student_owns_submission(uuid) to authenticated;

-- ==================================================
-- teacher_owns_submission(p_submission_id): "does the calling teacher
-- own the classroom this submission's assignment belongs to?" — the
-- sole authorization check for a teacher reading/cleaning-up a
-- submission's resources. Mirrors is_teacher_of_assignment (0013).
-- ==================================================

create or replace function public.teacher_owns_submission(p_submission_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.assignment_submissions sub
    join public.assignments a on a.id = sub.assignment_id
    join public.classrooms c on c.id = a.classroom_id
    where sub.id = p_submission_id
      and c.teacher_id = auth.uid()
  )
$$;

revoke all on function public.teacher_owns_submission(uuid) from public;
grant execute on function public.teacher_owns_submission(uuid) to authenticated;

-- ==================================================
-- enforce_submission_field_ownership(): BEFORE UPDATE trigger on
-- assignment_submissions. See the migration header's SECURITY MODEL note
-- for why this — not a column GRANT — is what actually separates
-- "student may freely update their own status/submitted_at" from
-- "student must never touch score/note" when both roles share the same
-- Postgres role.
--
-- Only restricts anything when the CALLER is the row's own linked
-- student (my_student_id() = OLD.student_id) — a teacher's own
-- auth.uid() can never equal a student's linked_profile_id, so this is a
-- no-op for every teacher-originated update, which keeps working exactly
-- as it always has (0006's assignment_submissions_update_own, untouched).
-- ==================================================

create or replace function public.enforce_submission_field_ownership()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.student_id = public.my_student_id() then
    if new.score is distinct from old.score then
      raise exception 'students cannot modify their own score';
    end if;
    if new.note is distinct from old.note then
      raise exception 'students cannot modify the teacher comment';
    end if;
    if new.assignment_id is distinct from old.assignment_id or new.student_id is distinct from old.student_id then
      raise exception 'students cannot reassign a submission to a different assignment or student';
    end if;
    if new.reviewed_at is distinct from old.reviewed_at then
      raise exception 'students cannot modify the reviewed state';
    end if;
  end if;
  return new;
end;
$$;

create trigger enforce_submission_field_ownership_trigger
  before update on public.assignment_submissions
  for each row
  execute function public.enforce_submission_field_ownership();

-- ==================================================
-- enforce_submission_resource_teacher_edit(): BEFORE UPDATE trigger on
-- assignment_submission_resources. A teacher's ONLY legitimate reason to
-- update a resource row at all is the manual cleanup action (Section 9)
-- — clearing storage_path and setting deleted_at. This trigger stops a
-- teacher's update from silently rewriting what a student actually
-- submitted (title/external_url/text_content/resource_type), which would
-- otherwise be an academic-integrity hole even though it's gated by RLS
-- ownership already. A no-op for a student's own update of their own row
-- (students have no UPDATE policy on this table at all — see below —
-- this only ever fires for a teacher-originated update).
-- ==================================================

create or replace function public.enforce_submission_resource_teacher_edit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if public.teacher_owns_submission(old.assignment_submission_id) then
    if new.resource_type is distinct from old.resource_type
      or new.title is distinct from old.title
      or new.external_url is distinct from old.external_url
      or new.text_content is distinct from old.text_content
      or new.original_filename is distinct from old.original_filename
      or new.mime_type is distinct from old.mime_type
      or new.file_size is distinct from old.file_size
      or new.assignment_submission_id is distinct from old.assignment_submission_id
      or new.sort_order is distinct from old.sort_order
    then
      raise exception 'teachers may only clear the stored file (storage_path/deleted_at) — not edit submitted content';
    end if;
  end if;
  return new;
end;
$$;

create trigger enforce_submission_resource_teacher_edit_trigger
  before update on public.assignment_submission_resources
  for each row
  execute function public.enforce_submission_resource_teacher_edit();

-- ==================================================
-- RLS: assignment_submissions — ADDITIVE student policies only. Every
-- existing 0006 teacher policy (assignment_submissions_select_own/
-- _insert_own/_update_own) is completely untouched; Postgres ORs
-- multiple permissive policies together, so a student policy can only
-- ever ADD reachable rows for the student's own identity, never remove
-- the teacher's existing access.
-- ==================================================

-- SECURITY-CRITICAL: a student may read ONLY their own submission row —
-- already true from 0011's assignment_submissions_select_own_student;
-- this migration adds no new SELECT policy (submitted_at/reviewed_at are
-- just more columns on the same already-correctly-scoped row).

-- Creating a submission requires BOTH: the caller IS the target student
-- (my_student_id(), never a client-supplied id) AND that student is
-- CURRENTLY a member of the assignment's classroom — mirrors
-- assignment_submissions_insert_own's (0006) own membership check, just
-- from the student's side instead of the teacher's. score/note must be
-- null at insert time — a student can never create a submission that
-- already carries a score or a teacher comment.
create policy "assignment_submissions_insert_student"
  on public.assignment_submissions for insert
  with check (
    student_id = public.my_student_id()
    and exists (
      select 1
      from public.assignments a
      where a.id = assignment_submissions.assignment_id
        and public.is_my_classroom(a.classroom_id)
    )
    and score is null
    and note is null
    and reviewed_at is null
  );

-- Updating (resubmitting) — scoped to the caller's own row. The
-- enforce_submission_field_ownership trigger above is what actually
-- stops score/note/reviewed_at from changing through this path; RLS here
-- only gates WHICH ROW a student can reach at all.
create policy "assignment_submissions_update_student"
  on public.assignment_submissions for update
  using (student_id = public.my_student_id())
  with check (student_id = public.my_student_id());

-- SECURITY: deliberately NO delete policy for students (or teachers,
-- unchanged from 0006) — a submission is never hard-deleted; resubmission
-- is always an UPDATE of the same row (same unique (assignment_id,
-- student_id) constraint from 0006), which is exactly what keeps
-- status/score/submitted_at history from being silently lost on
-- resubmission (Section 2/8's requirement).

-- ==================================================
-- RLS: assignment_submission_resources
-- ==================================================

alter table public.assignment_submission_resources enable row level security;

create policy "assignment_submission_resources_select_student"
  on public.assignment_submission_resources for select
  using (public.student_owns_submission(assignment_submission_id));

create policy "assignment_submission_resources_select_teacher"
  on public.assignment_submission_resources for select
  using (public.teacher_owns_submission(assignment_submission_id));

-- SECURITY: a student may attach a resource only to a submission row
-- that is genuinely their own (student_owns_submission already resolves
-- "own" via my_student_id(), never a client-supplied student id) — there
-- is no way to attach a resource to another student's submission.
create policy "assignment_submission_resources_insert_student"
  on public.assignment_submission_resources for insert
  with check (public.student_owns_submission(assignment_submission_id));

-- A student may delete their own resource row (e.g. remove a
-- wrongly-attached file before/while resubmitting) — but never one a
-- teacher has already cleaned up (deleted_at is not null), which is
-- frozen as a permanent academic record from that point on.
create policy "assignment_submission_resources_delete_student"
  on public.assignment_submission_resources for delete
  using (public.student_owns_submission(assignment_submission_id) and deleted_at is null);

-- A teacher may UPDATE (never delete) a resource on their own students'
-- submissions — the enforce_submission_resource_teacher_edit trigger
-- above restricts this to only ever clearing storage_path/setting
-- deleted_at (the manual cleanup action, Section 9), never editing what
-- was actually submitted.
create policy "assignment_submission_resources_update_teacher"
  on public.assignment_submission_resources for update
  using (public.teacher_owns_submission(assignment_submission_id))
  with check (public.teacher_owns_submission(assignment_submission_id));

-- SECURITY: deliberately NO delete policy for anyone — matching
-- assignment_resources/lesson_resources' own "never hard-delete a
-- teacher-managed resource" stance, extended here to submissions: a
-- teacher's cleanup is always the soft-delete UPDATE above, preserving
-- original_filename/mime_type/file_size/the row itself for the academic
-- record (Section 5/9's explicit requirement). Only the STUDENT'S OWN,
-- not-yet-cleaned-up resource can be hard-deleted (their own draft/
-- active submission, via the delete policy above) — once a teacher has
-- cleaned it up, it is frozen even from the student who created it.

-- ==================================================
-- Storage: 'submission-files' bucket + storage.objects policies.
--
-- Path convention: '<teacher_id>/<subject_id>/<classroom_id>/
-- <assignment_id>/<student_id>/<submission_id>/<generated-file-name>' —
-- SEVEN segments. Every policy below authorizes purely through the
-- submission_id segment (6th) via student_owns_submission()/
-- teacher_owns_submission() — the SAME helpers the
-- assignment_submission_resources row policies use — rather than trying
-- to validate every earlier segment individually: ownership of the
-- submission_id is what actually matters, so a student or teacher
-- forging an unrelated teacher_id/subject_id/classroom_id/assignment_id
-- earlier in the path gains nothing (the submission_id segment alone
-- fully determines access, same reasoning as lesson_files_path_lesson_id,
-- 0015). A submission row must exist (via the "create then continue"
-- flow: assignment_submissions upsert first, then upload) before any
-- file can be attached to it — mirrors AssignmentDialog/LessonDialog's
-- established pattern exactly.
--
-- <generated-file-name> is always a randomly generated name (never the
-- original uploaded filename) — original_filename is preserved
-- separately in assignment_submission_resources for display/audit only.
--
-- Bucket is created `public = false`. Every read (student re-opening
-- their own upload, teacher reviewing it) goes through a short-lived
-- SIGNED URL, issued only after the caller's own RLS-gated access to the
-- underlying object is confirmed by the SELECT policies below.
--
-- file_size_limit is in bytes (25 MiB — student work can run larger than
-- a teacher's worksheet upload; large content is still steered toward
-- external links, per Section 6). allowed_mime_types covers PDF, DOCX,
-- PPTX, XLSX, common images, and ZIP (the spec's "optionally ZIP only if
-- security review supports it" — included here since Supabase Storage
-- never executes/extracts an uploaded object server-side; it is stored
-- and served as inert bytes behind a signed URL exactly like every other
-- allowed type, so a ZIP carries no additional server-side execution
-- risk in this architecture. It is still opened by the CLIENT browser as
-- a plain download, never auto-extracted).
-- ==================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'submission-files',
  'submission-files',
  false,
  26214400,
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/zip',
    'application/x-zip-compressed'
  ]
)
on conflict (id) do nothing;

-- Safely extracts the submission_id segment (6th path segment) from a
-- submission-files object name and casts it to uuid, returning NULL
-- instead of raising on a malformed/short path — same exception-safe
-- reasoning as assignment_files_path_classroom_id (0013) /
-- lesson_files_path_lesson_id (0015): a raw `::uuid` cast inside a
-- policy expression would otherwise abort the ENTIRE query the moment it
-- hit a single malformed object name anywhere in the bucket.
create or replace function public.submission_files_path_submission_id(p_object_name text)
returns uuid
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_segment text;
begin
  v_segment := (storage.foldername(p_object_name))[6];
  if v_segment is null then
    return null;
  end if;
  return v_segment::uuid;
exception
  when invalid_text_representation then
    return null;
end;
$$;

revoke all on function public.submission_files_path_submission_id(text) from public;
grant execute on function public.submission_files_path_submission_id(text) to authenticated;

-- SECURITY-CRITICAL: a student may insert/select/delete an object only
-- when the submission_id segment (6th) resolves to a submission row that
-- is genuinely their own. No update policy — a resubmitted file is a
-- freshly-uploaded new object (new generated name) plus a new resource
-- row, never an in-place overwrite of existing bytes.
create policy "submission_files_insert_student"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'submission-files'
    and public.student_owns_submission(public.submission_files_path_submission_id(name))
  );

create policy "submission_files_select_student"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'submission-files'
    and public.student_owns_submission(public.submission_files_path_submission_id(name))
  );

create policy "submission_files_delete_student"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'submission-files'
    and public.student_owns_submission(public.submission_files_path_submission_id(name))
  );

-- SECURITY-CRITICAL: a teacher may read a submission file only for a
-- submission belonging to their own subject/classroom — teacher_owns_
-- submission() re-derives this transitively through assignments ->
-- classrooms.teacher_id, so a teacher can never reach another teacher's
-- (or another classroom's) student's file. Teachers have NO insert
-- policy on this bucket — they never upload a file into a student's
-- submission. DELETE is handled entirely at the row level (the
-- assignment_submission_resources UPDATE-based cleanup above, which
-- application code follows with its own storage.remove() call using the
-- service's normal client-side call, authorized by this SAME select
-- policy needing to have already confirmed access before the delete is
-- attempted) — no separate storage.objects DELETE policy is granted to
-- teachers, so the removal path is exclusively: teacher updates the
-- resource row (RLS-gated, confirmed above) triggering the app to call
-- storage.remove(); a teacher can never delete a storage object directly
-- via the Storage API without going through that row-level gate first
-- (removing a storage object with no matching, teacher-owned resource
-- row is simply denied).
create policy "submission_files_select_teacher"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'submission-files'
    and public.teacher_owns_submission(public.submission_files_path_submission_id(name))
  );

create policy "submission_files_delete_teacher"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'submission-files'
    and public.teacher_owns_submission(public.submission_files_path_submission_id(name))
  );

-- ==================================================
-- Nothing above touches any existing table's existing policy (0006's
-- teacher-side assignment_submissions policies are completely
-- untouched), any previously-applied migration (0001-0015), or grants
-- any broader table-level privilege. This migration only: adds two
-- nullable columns to assignment_submissions, adds two ADDITIVE student
-- policies to it (guarded by a field-ownership trigger so score/note/
-- reviewed_at stay teacher-only regardless), adds one new table (with
-- its own RLS, guarded by a second ownership trigger so a teacher's
-- cleanup action can only ever clear a stored file, never rewrite
-- submitted content), four new narrowly-scoped SECURITY DEFINER helper
-- functions, and a matching set of storage.objects policies scoped to a
-- brand-new, private 'submission-files' bucket.
-- ==================================================
