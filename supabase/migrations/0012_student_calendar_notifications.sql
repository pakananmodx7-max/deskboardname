-- AI Classroom Management — Student Portal Phase 3: personal calendar,
-- teacher->student in-app notifications, and student avatar.
-- See docs/DATABASE.md for the full schema explanation and RLS rationale.
--
-- Builds on 0001_init.sql (profiles/classrooms/students/classroom_students,
-- set_updated_at()), 0008_student_account_links.sql (students.linked_profile_id),
-- and 0011_student_portal_read_access.sql (my_student_id(), is_my_classroom()).
-- This migration has NOT been applied to a live database yet — do NOT run
-- it automatically. 0001-0011 have already been applied and are NOT
-- modified here: this migration only ADDS two new tables, one new column,
-- new helper functions, new RPCs, and new, additive RLS policies.
--
-- Scope:
--   1. student_calendar_entries — private, student-owned calendar notes/
--      reminders. Full CRUD for the owning student, ZERO access for
--      teachers (no teacher policy is added on this table at all).
--      Assignment due dates are NOT stored here — the frontend merges
--      them in from the existing assignments/my_student_id() read path
--      (0011) at render time; this table only ever holds entries the
--      student themselves created.
--   2. teacher_student_notifications — individual teacher -> student
--      messages. A teacher may INSERT only to a student enrolled in one
--      of their own classrooms (is_teacher_of_student() below). A student
--      may SELECT only their own notifications, and may change ONLY the
--      read state, exclusively through the two narrow RPCs at the bottom
--      (mark_notification_read / mark_all_notifications_read) — there is
--      deliberately NO general UPDATE policy on this table, so there is
--      no path (RLS or otherwise) for a student to alter recipient,
--      sender, title, or message. Recipient/sender are always
--      students.id / profiles.id (stable UUIDs) — never student_code.
--   3. students.avatar_path — a nullable text column storing the
--      student's own Supabase Storage object path (never the student's
--      choice of *another* student's path — see update_my_avatar_path()
--      below, which is the ONLY way this column is ever written and
--      validates the path is the caller's own). See the storage section
--      at the end of this file for the matching storage.objects policies.
--
-- SECURITY MODEL — identity: exactly as 0011 — every new policy/function
-- below resolves "which student is this" exclusively through
-- my_student_id() (auth.uid() -> students.linked_profile_id). No policy,
-- RPC, or default accepts a student_id supplied by the client for the
-- purpose of establishing identity/authorization; student_id parameters
-- that DO appear (e.g. a teacher's notification INSERT) name the
-- recipient, not the caller, and are independently checked against
-- classroom ownership below.
--
-- SECURITY MODEL — recursion avoidance: the one new cross-table
-- authorization check this migration needs (teacher_student_notifications'
-- INSERT: "does this teacher actually teach this student?") is wrapped in
-- a narrow SECURITY DEFINER helper (is_teacher_of_student, below), the
-- same fix pattern 0008 and 0011 both had to apply after empirically
-- hitting Postgres RLS recursion from a raw cross-table subquery inline
-- in a policy. teacher_student_notifications is a brand-new table with no
-- existing policy anywhere referencing it, so this migration cannot by
-- itself introduce a NEW recursion cycle either way — the helper is used
-- here purely for consistency with the rest of this schema's established,
-- proven-safe pattern, and re-verified empirically regardless (see
-- supabase/tests/0012_student_calendar_notifications.sql).
--
-- SECURITY MODEL — why RPCs instead of a raw UPDATE policy for "mark
-- read" and "set my avatar": both students and teachers are subsumed
-- under the single Postgres `authenticated` role in this schema, so a
-- Postgres column-level GRANT (the obvious way to say "may only touch
-- this one column") cannot be scoped to "students only" without ALSO
-- narrowing what teachers can update on the very same table — for
-- students.avatar_path in particular, that would collide with the
-- existing, unrelated students_update_via_classroom teacher policy
-- (0001) and risk silently breaking the already-shipped "teacher edits a
-- student's name/code/etc." flow. A tiny SECURITY DEFINER RPC that
-- touches exactly one column, on exactly the caller's own row, sidesteps
-- that entirely and needs no grant changes to the students or
-- teacher_student_notifications tables at all.

-- ==================================================
-- student_calendar_entries
-- ==================================================

create table if not exists public.student_calendar_entries (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students (id) on delete cascade,
  title text not null,
  note text,
  event_date date not null,
  event_time time,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists student_calendar_entries_student_id_idx
  on public.student_calendar_entries (student_id, event_date);

create trigger set_student_calendar_entries_updated_at
  before update on public.student_calendar_entries
  for each row
  execute function public.set_updated_at();

alter table public.student_calendar_entries enable row level security;

-- Strictly own-row CRUD, nothing else. No teacher policy exists on this
-- table anywhere in this schema — teachers get zero access (RLS enabled
-- + no matching permissive policy = deny by default), satisfying "the
-- calendar's personal notes are never visible to a teacher."

create policy "student_calendar_entries_select_own"
  on public.student_calendar_entries for select
  using (student_id = public.my_student_id());

create policy "student_calendar_entries_insert_own"
  on public.student_calendar_entries for insert
  with check (student_id = public.my_student_id());

create policy "student_calendar_entries_update_own"
  on public.student_calendar_entries for update
  using (student_id = public.my_student_id())
  with check (student_id = public.my_student_id());

create policy "student_calendar_entries_delete_own"
  on public.student_calendar_entries for delete
  using (student_id = public.my_student_id());

-- ==================================================
-- is_teacher_of_student(p_student_id): "does the calling teacher own a
-- classroom this student currently belongs to?" — the sole authorization
-- check for sending a notification. SECURITY DEFINER for the same
-- recursion-avoidance reasoning as is_my_classroom()/is_my_subject()
-- (0011) — see the migration header above. Boolean-only return, one
-- specific student_id in, no enumeration surface.
-- ==================================================

create or replace function public.is_teacher_of_student(p_student_id uuid)
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
  )
$$;

revoke all on function public.is_teacher_of_student(uuid) from public;
grant execute on function public.is_teacher_of_student(uuid) to authenticated;

-- ==================================================
-- teacher_student_notifications
-- ==================================================

create table if not exists public.teacher_student_notifications (
  id uuid primary key default gen_random_uuid(),
  -- Recipient. Always students.id (a stable uuid) — never student_code.
  student_id uuid not null references public.students (id) on delete cascade,
  -- Sender. Always the sending teacher's own profiles.id (= auth.uid()
  -- at insert time, enforced by the WITH CHECK below) — never client-
  -- editable after the fact (no UPDATE policy touches this column).
  teacher_id uuid not null references public.profiles (id) on delete cascade,
  title text,
  message text not null check (char_length(message) > 0),
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists teacher_student_notifications_student_id_idx
  on public.teacher_student_notifications (student_id, created_at desc);
create index if not exists teacher_student_notifications_teacher_id_idx
  on public.teacher_student_notifications (teacher_id, created_at desc);

alter table public.teacher_student_notifications enable row level security;

-- Teacher may send only to a student they actually teach (own-classroom
-- membership, checked via is_teacher_of_student above) — this is the
-- literal enforcement of "teacher cannot notify another teacher's
-- student." teacher_id must be the caller themselves — no sending "as"
-- another teacher.
create policy "teacher_student_notifications_insert_own_student"
  on public.teacher_student_notifications for insert
  with check (
    teacher_id = auth.uid()
    and public.is_teacher_of_student(student_id)
  );

-- Teacher may read notifications they themselves sent (e.g. an outbox
-- view), never another teacher's.
create policy "teacher_student_notifications_select_sent"
  on public.teacher_student_notifications for select
  using (teacher_id = auth.uid());

-- SECURITY-CRITICAL: a student may read ONLY notifications addressed to
-- themselves, never a classmate's — same strict-ownership shape as
-- assignment_submissions/attendance_records (0011).
create policy "teacher_student_notifications_select_own_student"
  on public.teacher_student_notifications for select
  using (student_id = public.my_student_id());

-- Deliberately NO update/delete policy on this table for anyone. The
-- only way read_at ever changes is through the two SECURITY DEFINER RPCs
-- below, each of which touches exactly that one column on exactly the
-- caller's own notification(s) — there is no RLS-level UPDATE path at
-- all, so there is no way (direct PostgREST PATCH included) for a
-- student to change message/title/student_id/teacher_id, and no way for
-- anyone to delete a notification.

-- ==================================================
-- RLS: profiles — a student may additionally read the profile row (id,
-- display_name — used as the notification "sender" label; email/role
-- also become visible, same as any classmate-shared row elsewhere in
-- this schema, and neither is sensitive here) of a teacher who owns at
-- least one classroom the student currently belongs to. Additive to
-- profiles_select_own (0001, unchanged) — a student still can never read
-- an unrelated teacher's profile. Uses is_my_classroom() (0011) rather
-- than a raw subquery, same recursion-avoidance reasoning as everywhere
-- else in this migration; safe to add here specifically because neither
-- classrooms_select_own/via_membership nor is_my_classroom() itself ever
-- queries `profiles`, so this is a one-directional reference
-- (profiles -> classrooms), not a cycle.
-- ==================================================

create policy "profiles_select_my_teachers"
  on public.profiles for select
  using (
    exists (
      select 1
      from public.classrooms c
      where c.teacher_id = profiles.id
        and public.is_my_classroom(c.id)
    )
  );

-- Realtime: lets the student portal receive new notifications live via
-- postgres_changes without re-polling. The DB row inserted above (via
-- the INSERT policy) is already the source of truth before this ever
-- fires — this only adds a live push notice on top; see
-- src/hooks/use-student-notifications.ts for the reconnect-safe,
-- DB-reconciling client side of this. Wrapped for idempotency: this
-- migration must be safely re-runnable in a fresh apply, and Postgres
-- raises duplicate_object if the table is already in the publication.
do $$
begin
  alter publication supabase_realtime add table public.teacher_student_notifications;
exception
  when duplicate_object then null;
  when undefined_object then null; -- supabase_realtime publication not present in this environment
end $$;

-- ==================================================
-- mark_notification_read(p_notification_id): the ONLY way a student can
-- change a notification's read_at. Scoped to a specific notification AND
-- the caller's own student_id — a student passing another student's
-- notification id here simply matches zero rows (silent no-op), never an
-- error that would leak whether that id exists.
-- ==================================================

create or replace function public.mark_notification_read(p_notification_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_student_id uuid;
begin
  v_student_id := public.my_student_id();
  if v_student_id is null then
    raise exception 'คุณไม่มีสิทธิ์ดำเนินการนี้' using errcode = '42501';
  end if;

  update public.teacher_student_notifications
  set read_at = now()
  where id = p_notification_id
    and student_id = v_student_id
    and read_at is null;
end;
$$;

revoke all on function public.mark_notification_read(uuid) from public;
grant execute on function public.mark_notification_read(uuid) to authenticated;

-- ==================================================
-- mark_all_notifications_read(): marks every currently-unread
-- notification addressed to the caller as read. Same own-student scoping
-- as above.
-- ==================================================

create or replace function public.mark_all_notifications_read()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_student_id uuid;
begin
  v_student_id := public.my_student_id();
  if v_student_id is null then
    raise exception 'คุณไม่มีสิทธิ์ดำเนินการนี้' using errcode = '42501';
  end if;

  update public.teacher_student_notifications
  set read_at = now()
  where student_id = v_student_id
    and read_at is null;
end;
$$;

revoke all on function public.mark_all_notifications_read() from public;
grant execute on function public.mark_all_notifications_read() to authenticated;

-- ==================================================
-- students.avatar_path — nullable Storage object path, e.g.
-- '<student_id>/avatar.jpg'. Never written directly (no UPDATE policy is
-- added on the students table by this migration) — see
-- update_my_avatar_path() below, the sole write path. Readable by
-- whichever existing SELECT policy already applies to a given row
-- (students_select_own_linked for the student themselves,
-- students_select_via_classroom for their teacher(s) — both 0001/0011,
-- unchanged), so this is exposed nowhere beyond where the rest of that
-- student's row already is.
-- ==================================================

alter table public.students add column if not exists avatar_path text;

-- ==================================================
-- update_my_avatar_path(p_avatar_path): the ONLY way avatar_path is ever
-- written. Always scoped to the caller's own row (id = my_student_id()),
-- and — critically — validates that a non-null path actually starts with
-- the caller's own student id as its first path segment, so a student
-- cannot point their avatar_path at some OTHER student's uploaded object
-- even though the column itself has no format constraint. Pass null to
-- clear (revert to fallback initials).
-- ==================================================

create or replace function public.update_my_avatar_path(p_avatar_path text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_student_id uuid;
begin
  v_student_id := public.my_student_id();
  if v_student_id is null then
    raise exception 'คุณไม่มีสิทธิ์ดำเนินการนี้' using errcode = '42501';
  end if;

  if p_avatar_path is not null and p_avatar_path !~ ('^' || v_student_id::text || '/') then
    raise exception 'พาธรูปโปรไฟล์ไม่ถูกต้อง' using errcode = '22023';
  end if;

  update public.students
  set avatar_path = p_avatar_path
  where id = v_student_id;
end;
$$;

revoke all on function public.update_my_avatar_path(text) from public;
grant execute on function public.update_my_avatar_path(text) to authenticated;

-- ==================================================
-- Storage: 'avatars' bucket + storage.objects policies.
--
-- Path convention: '<student_id>/avatar.<ext>' — the first path segment
-- is always the uploading student's OWN students.id (never a
-- client-chosen name), enforced by every policy below via
-- (storage.foldername(name))[1] = my_student_id()::text — the identical
-- "never trust the client, derive from auth.uid()" rule used everywhere
-- else in this migration.
--
-- Bucket is created `public = true`: avatar photos are treated the same
-- as any conventional profile-picture feature (not sensitive data), so
-- reads are served directly via the public object URL without needing
-- signed URLs — this is a deliberate, documented choice (see the
-- migration's accompanying report), not an oversight; the SELECT policy
-- below still applies to authenticated API access (list/download calls),
-- it just does not gate the public URL route, which is what `public`
-- means in Supabase Storage. If this project prefers avatars to be
-- strictly private, change `public` to `false` below and switch the
-- frontend to fetching a signed URL instead of the public URL — nothing
-- else in this migration needs to change either way.
--
-- file_size_limit is in bytes (2 MiB). allowed_mime_types is enforced by
-- Storage itself on every upload, independent of and in addition to the
-- client-side validation in the upload UI.
-- ==================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "avatar_insert_own"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = public.my_student_id()::text
  );

create policy "avatar_update_own"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = public.my_student_id()::text
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = public.my_student_id()::text
  );

create policy "avatar_delete_own"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = public.my_student_id()::text
  );

create policy "avatar_select_own"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = public.my_student_id()::text
  );

-- ==================================================
-- Nothing above touches any existing table's existing policy, any
-- previously-applied migration (0001-0011), or grants any broader table-
-- level privilege — this migration only adds two new tables (each
-- gated by their own additive RLS), one new nullable column, four new
-- narrowly-scoped SECURITY DEFINER functions, and a matching set of
-- storage.objects policies scoped to a brand-new 'avatars' bucket.
-- ==================================================
