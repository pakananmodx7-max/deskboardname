-- KrunameClass — Classroom lifecycle: safe archive / restore, and an
-- audited, all-or-nothing permanent delete.
--
-- Builds on 0001-0031 as they exist in PRODUCTION (0012 and 0029 are NOT
-- installed there; everything below works with or without them). Nothing
-- in 0001-0031 is edited. No FK's ON DELETE action is changed and no
-- ON DELETE CASCADE is added anywhere.
--
-- ==================================================
-- DEPENDENCY GRAPH (audited before writing this migration — every FK that
-- can be reached from public.classrooms, as created by 0001-0031)
--
--   classrooms
--   ├─ classroom_students.classroom_id      CASCADE   (membership only)
--   │    students themselves are NEVER reached: classroom_students.student_id
--   │    points the other way (students -> classroom_students CASCADE).
--   ├─ subject_classrooms.classroom_id      CASCADE   (link only; subjects stay)
--   ├─ attendance_sessions.classroom_id     CASCADE
--   │    └─ attendance_records.attendance_session_id CASCADE
--   ├─ assignments.classroom_id             CASCADE
--   │    ├─ assignment_resources            CASCADE   (file_path / drive_file_id refs)
--   │    ├─ assignment_submissions          CASCADE   (status + score = grades)
--   │    │    └─ assignment_submission_resources CASCADE (storage_path refs)
--   │    └─ assignment_submission_events    CASCADE   (0030 QR/status audit)
--   ├─ lessons.classroom_id                 CASCADE
--   │    └─ lesson_resources                CASCADE   (file_path / drive_file_id refs)
--   ├─ sgs_score_columns.classroom_id       CASCADE
--   │    └─ sgs_scores                      CASCADE   (SGS grades)
--   └─ student_followup_notes.classroom_id  CASCADE
--
--   NOT reachable from a classroom (always preserved):
--     students, student_qr_identities (per STUDENT, reused across every
--     classroom/semester the student is in), profiles / linked student
--     accounts, student_account_link_requests, subjects, topics,
--     google_oauth_connections, teacher_student_notifications (0012),
--     student_calendar_entries (0012).
--   0029 notifications (not in production) have no FK at all — they only
--     carry metadata->>'classroom_id'; handled explicitly below when the
--     table exists.
--   Files are never covered by an FK: Supabase Storage objects
--     (assignment-files, lesson-files, submission-files) and Google Drive
--     files referenced by drive_file_id.
--
--   Triggers on the cascade path: prevent_sgs_score_columns_delete_with_scores
--   (0023/0024) only guards DIRECT deletes (pg_trigger_depth() <= 1); a
--   cascaded delete from classrooms runs at depth 2 and is allowed, which
--   is exactly the explicit, confirmed path this migration adds.
--
-- ==================================================
-- WHAT WAS UNSAFE BEFORE THIS MIGRATION
--
--   classrooms_delete_own (0001) lets the owning teacher run a raw
--   `DELETE FROM classrooms` through the REST API. That single statement
--   silently cascades through every table above — attendance, grades,
--   submissions, SGS scores — with no preview, no confirmation, no audit
--   row, and it orphans every Storage/Drive file. The app never used it
--   (classroom-service.ts only archives), so it is dropped here; the only
--   remaining delete path is delete_classroom_permanently() below.
--
-- ==================================================
-- RETENTION / DELETION POLICY (reviewed; enforced by the functions below)
--
--   ARCHIVE (เก็บถาวร): nothing is deleted. classrooms.is_active = false,
--     archived_at/archived_by recorded, one classroom_lifecycle_events row.
--     Fully reversible with restore (กู้คืนห้องเรียน).
--
--   PERMANENT DELETE (ลบห้องเรียนถาวร) — allowed only when ALL hold:
--     1. caller is the classroom owner, or a profile with role = 'admin';
--     2. the classroom is already archived (two separate, deliberate steps);
--     3. the caller typed the exact classroom name;
--     4. the preview the caller confirmed still matches (fingerprint) —
--        any concurrent change aborts with KC003 and nothing is deleted;
--     5. ownership is unambiguous: every classroom-scoped record belongs to
--        a subject owned by the classroom owner (else KC004, blocked).
--
--     DELETED (classroom-owned educational records): the classroom row,
--       its memberships, subject LINKS, attendance sessions + records,
--       assignments + their resources, submissions (grades), submission
--       resources and submission events, lessons + resources, SGS columns
--       + scores, follow-up notes, and (only if 0029 is installed) the
--       notifications whose metadata names this classroom.
--
--     PRESERVED: students, their QR identities, linked student accounts,
--       link requests, subjects/topics, every record of every OTHER
--       classroom (including the same students' attendance/submissions
--       elsewhere), and ALL files.
--
--     FILES: never deleted here. Every Storage object path and Google
--       Drive file id referenced by the deleted rows is copied into
--       classroom_file_cleanup_queue (status 'pending_review', with
--       referenced_elsewhere computed) in the same transaction. Removing
--       the files is a separate, explicitly approved, audited operator
--       step (docs/CLASSROOM_LIFECYCLE.md) — never part of this
--       transaction, never automatic, never touching Google Drive
--       silently.
--
--     AUDIT: classroom_lifecycle_events has no FK to classrooms, so the
--       'deleted' row (snapshot + counts + who + when) survives the
--       deletion. Clients can read their own rows; nobody can write them
--       except these functions.
--
--   Atomicity: each function is one statement => one transaction. Any
--   error (permission, stale preview, trigger, FK, anything) rolls back
--   the audit row, the queue rows and every delete together.
--
--   Concurrency: the classroom row and every direct child row (assignments,
--   attendance_sessions, lessons, sgs_score_columns) are locked FOR UPDATE
--   before counting, so no new submission/score/attendance record can be
--   attached while the counts are compared and the delete runs. A second
--   concurrent delete/archive waits on the row lock and then sees the
--   committed state (classroom gone -> 42501 "not found").
--
-- Error codes returned to the client (stable, mapped in classroom-lifecycle-service.ts):
--   28000 not signed in · 42501 not found / no permission
--   KC001 must archive first · KC002 typed name does not match
--   KC003 data changed since preview · KC004 blocked (ownership unclear)
--   KC005 already archived · KC006 already active
-- ==================================================

-- --------------------------------------------------
-- 1. Archive metadata on classrooms (nullable; existing rows untouched)
-- --------------------------------------------------
alter table public.classrooms
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references public.profiles(id) on delete set null;

-- Keeps archived_at/archived_by consistent with is_active on EVERY update
-- path (the archive RPC below and the existing classrooms_update_own
-- policy), and stops a client from writing either column directly.
create or replace function public.classrooms_track_archive_state()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.is_active is distinct from old.is_active then
    if new.is_active then
      new.archived_at := null;
      new.archived_by := null;
    else
      new.archived_at := now();
      new.archived_by := auth.uid();
    end if;
  else
    new.archived_at := old.archived_at;
    new.archived_by := old.archived_by;
  end if;
  return new;
end;
$$;

drop trigger if exists classrooms_track_archive_state on public.classrooms;
create trigger classrooms_track_archive_state
  before update on public.classrooms
  for each row execute function public.classrooms_track_archive_state();

-- --------------------------------------------------
-- 2. Lifecycle audit trail (survives classroom deletion: no FK to classrooms)
-- --------------------------------------------------
create table if not exists public.classroom_lifecycle_events (
  id uuid primary key default gen_random_uuid(),
  classroom_id uuid not null,
  classroom_owner_id uuid,
  event_type text not null check (event_type in ('archived', 'restored', 'deleted')),
  actor_id uuid references public.profiles(id) on delete set null,
  actor_role text,
  classroom_snapshot jsonb not null,
  affected_counts jsonb,
  preview_fingerprint text,
  created_at timestamptz not null default now()
);

create index if not exists classroom_lifecycle_events_classroom_idx on public.classroom_lifecycle_events (classroom_id, created_at desc);
create index if not exists classroom_lifecycle_events_owner_idx on public.classroom_lifecycle_events (classroom_owner_id, created_at desc);

alter table public.classroom_lifecycle_events enable row level security;

revoke all on table public.classroom_lifecycle_events from anon, authenticated;
grant select on table public.classroom_lifecycle_events to authenticated;

drop policy if exists classroom_lifecycle_events_select on public.classroom_lifecycle_events;
create policy classroom_lifecycle_events_select
  on public.classroom_lifecycle_events for select
  using (
    classroom_owner_id = auth.uid()
    or actor_id = auth.uid()
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

-- --------------------------------------------------
-- 3. File cleanup queue (files are NEVER deleted by the database)
-- --------------------------------------------------
create table if not exists public.classroom_file_cleanup_queue (
  id uuid primary key default gen_random_uuid(),
  lifecycle_event_id uuid not null references public.classroom_lifecycle_events(id) on delete restrict,
  classroom_id uuid not null,
  classroom_owner_id uuid,
  source_table text not null check (source_table in ('assignment_resources', 'lesson_resources', 'assignment_submission_resources')),
  source_id uuid not null,
  provider text not null check (provider in ('supabase_storage', 'google_drive')),
  bucket text,
  object_path text,
  drive_file_id text,
  url text,
  title text,
  referenced_elsewhere boolean not null,
  status text not null default 'pending_review' check (status in ('pending_review', 'approved', 'deleted', 'kept', 'failed')),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  completed_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  check ((provider = 'supabase_storage' and bucket is not null and object_path is not null)
      or (provider = 'google_drive' and drive_file_id is not null))
);

create index if not exists classroom_file_cleanup_queue_event_idx on public.classroom_file_cleanup_queue (lifecycle_event_id);
create index if not exists classroom_file_cleanup_queue_status_idx on public.classroom_file_cleanup_queue (status, created_at);

alter table public.classroom_file_cleanup_queue enable row level security;

revoke all on table public.classroom_file_cleanup_queue from anon, authenticated;
grant select on table public.classroom_file_cleanup_queue to authenticated;

drop policy if exists classroom_file_cleanup_queue_select on public.classroom_file_cleanup_queue;
create policy classroom_file_cleanup_queue_select
  on public.classroom_file_cleanup_queue for select
  using (
    classroom_owner_id = auth.uid()
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

-- --------------------------------------------------
-- 4. Helpers (internal: no client EXECUTE)
-- --------------------------------------------------

-- Owner or admin, else 42501 (also for unknown ids, so existence never leaks).
-- Returns the caller's role for the audit row.
create or replace function public.classroom_lifecycle_authorize(p_classroom public.classrooms)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text;
begin
  select p.role into v_role from public.profiles p where p.id = auth.uid();
  if p_classroom.id is null or v_role is null
     or (p_classroom.teacher_id <> auth.uid() and v_role <> 'admin') then
    raise exception 'ไม่พบห้องเรียนนี้ หรือคุณไม่มีสิทธิ์จัดการห้องเรียนนี้' using errcode = '42501';
  end if;
  return case when p_classroom.teacher_id = auth.uid() then 'owner' else v_role end;
end;
$$;

-- Every count shown in the deletion preview, computed from the live data.
create or replace function public.classroom_deletion_counts(p_classroom_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner uuid;
  v_counts jsonb;
  v_notifications bigint := 0;
begin
  select teacher_id into v_owner from public.classrooms where id = p_classroom_id;

  if to_regclass('public.notifications') is not null then
    execute 'select count(*) from public.notifications where metadata->>''classroom_id'' = $1::text'
      into v_notifications using p_classroom_id;
  end if;

  with
  enrolled as (select cs.student_id from public.classroom_students cs where cs.classroom_id = p_classroom_id),
  a as (select id, subject_id from public.assignments where classroom_id = p_classroom_id),
  l as (select id, subject_id from public.lessons where classroom_id = p_classroom_id),
  sess as (select id, subject_id from public.attendance_sessions where classroom_id = p_classroom_id),
  sgc as (select id, subject_id from public.sgs_score_columns where classroom_id = p_classroom_id),
  notes as (select id, subject_id from public.student_followup_notes where classroom_id = p_classroom_id),
  subm as (select s.* from public.assignment_submissions s where s.assignment_id in (select id from a)),
  ar as (select r.* from public.assignment_resources r where r.assignment_id in (select id from a)),
  lr as (select r.* from public.lesson_resources r where r.lesson_id in (select id from l)),
  sr as (select r.* from public.assignment_submission_resources r where r.assignment_submission_id in (select id from subm)),
  drive_ids as (
    select drive_file_id from ar where drive_file_id is not null
    union select drive_file_id from lr where drive_file_id is not null
  ),
  drive_elsewhere as (
    select d.drive_file_id from drive_ids d
    where exists (select 1 from public.assignment_resources x join public.assignments xa on xa.id = x.assignment_id
                  where x.drive_file_id = d.drive_file_id and xa.classroom_id <> p_classroom_id)
       or exists (select 1 from public.lesson_resources x join public.lessons xl on xl.id = x.lesson_id
                  where x.drive_file_id = d.drive_file_id and xl.classroom_id <> p_classroom_id)
  ),
  storage_paths as (
    select 'assignment-files'::text as bucket, file_path as path from ar where file_path is not null
    union all select 'lesson-files', file_path from lr where file_path is not null
    union all select 'submission-files', storage_path from sr where storage_path is not null
  ),
  storage_elsewhere as (
    select p.path from storage_paths p
    where exists (select 1 from public.assignment_resources x join public.assignments xa on xa.id = x.assignment_id
                  where x.file_path = p.path and xa.classroom_id <> p_classroom_id)
       or exists (select 1 from public.lesson_resources x join public.lessons xl on xl.id = x.lesson_id
                  where x.file_path = p.path and xl.classroom_id <> p_classroom_id)
       or exists (select 1 from public.assignment_submission_resources x
                  join public.assignment_submissions xs on xs.id = x.assignment_submission_id
                  join public.assignments xa on xa.id = xs.assignment_id
                  where x.storage_path = p.path and xa.classroom_id <> p_classroom_id)
  ),
  foreign_subject as (
    select subject_id from a union all select subject_id from l
    union all select subject_id from sess where subject_id is not null
    union all select subject_id from sgc union all select subject_id from notes
  )
  select jsonb_build_object(
    -- deleted with the classroom
    'enrollments', (select count(*) from enrolled),
    'subject_links', (select count(*) from public.subject_classrooms where classroom_id = p_classroom_id),
    'assignments', (select count(*) from a),
    'assignment_resources', (select count(*) from ar),
    'submissions', (select count(*) from subm),
    'graded_submissions', (select count(*) from subm where score is not null),
    'submission_resources', (select count(*) from sr),
    'submission_events', (select count(*) from public.assignment_submission_events e where e.assignment_id in (select id from a)),
    'attendance_sessions', (select count(*) from sess),
    'attendance_records', (select count(*) from public.attendance_records r where r.attendance_session_id in (select id from sess)),
    'lessons', (select count(*) from l),
    'lesson_resources', (select count(*) from lr),
    'sgs_columns', (select count(*) from sgc),
    'sgs_scores', (select count(*) from public.sgs_scores s where s.column_id in (select id from sgc)
                     and (s.score is not null or s.override_score is not null or s.calculated_score is not null)),
    'followup_notes', (select count(*) from notes),
    'notifications', v_notifications,
    -- files: references are removed, the files themselves are only queued
    'storage_files', (select count(*) from storage_paths),
    'drive_files', (select count(*) from drive_ids),
    'files_referenced_elsewhere', (select count(*) from storage_elsewhere) + (select count(*) from drive_elsewhere),
    -- preserved
    'students', (select count(*) from enrolled),
    'students_only_in_this_classroom', (select count(*) from enrolled e
        where not exists (select 1 from public.classroom_students o where o.student_id = e.student_id and o.classroom_id <> p_classroom_id)),
    'students_in_other_classrooms', (select count(*) from enrolled e
        where exists (select 1 from public.classroom_students o where o.student_id = e.student_id and o.classroom_id <> p_classroom_id)),
    'linked_student_accounts', (select count(*) from public.students s where s.id in (select student_id from enrolled) and s.linked_profile_id is not null),
    'qr_identities', (select count(*) from public.student_qr_identities q where q.student_id in (select student_id from enrolled) and q.status = 'active'),
    'subjects_linked', (select count(distinct subject_id) from public.subject_classrooms where classroom_id = p_classroom_id),
    'other_classroom_submissions', (select count(*) from public.assignment_submissions s join public.assignments x on x.id = s.assignment_id
        where s.student_id in (select student_id from enrolled) and x.classroom_id <> p_classroom_id),
    'other_classroom_attendance_records', (select count(*) from public.attendance_records r join public.attendance_sessions x on x.id = r.attendance_session_id
        where r.student_id in (select student_id from enrolled) and x.classroom_id <> p_classroom_id),
    -- ownership check
    'foreign_subject_records', (select count(*) from foreign_subject f
        where not exists (select 1 from public.subjects s where s.id = f.subject_id and s.teacher_id = v_owner))
  ) into v_counts;

  return v_counts;
end;
$$;

create or replace function public.classroom_deletion_fingerprint(p_classroom public.classrooms, p_counts jsonb)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select md5(jsonb_build_object(
    'id', p_classroom.id, 'name', p_classroom.name, 'teacher_id', p_classroom.teacher_id,
    'is_active', p_classroom.is_active, 'counts', p_counts)::text)
$$;

create or replace function public.classroom_deletion_blockers(p_classroom public.classrooms, p_counts jsonb)
returns jsonb
language sql
immutable
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(b), '[]'::jsonb) from (
    select jsonb_build_object('code', 'KC001', 'message',
      'ต้องเก็บถาวรห้องเรียนก่อน จึงจะลบถาวรได้') as b
    where p_classroom.is_active
    union all
    select jsonb_build_object('code', 'KC004', 'message',
      'ห้องเรียนนี้มีข้อมูล ' || (p_counts->>'foreign_subject_records') ||
      ' รายการที่อยู่ในรายวิชาของครูคนอื่น จึงยืนยันความเป็นเจ้าของข้อมูลทั้งหมดไม่ได้ — ลบถาวรไม่ได้ กรุณาติดต่อผู้ดูแลระบบ')
    where (p_counts->>'foreign_subject_records')::bigint > 0
  ) x
$$;

revoke all on function public.classroom_lifecycle_authorize(public.classrooms) from public, anon, authenticated;
revoke all on function public.classroom_deletion_counts(uuid) from public, anon, authenticated;
revoke all on function public.classroom_deletion_fingerprint(public.classrooms, jsonb) from public, anon, authenticated;
revoke all on function public.classroom_deletion_blockers(public.classrooms, jsonb) from public, anon, authenticated;

-- --------------------------------------------------
-- 5. Archive / restore
-- --------------------------------------------------
create or replace function public.set_classroom_archived(p_classroom_id uuid, p_archived boolean)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_classroom public.classrooms;
  v_role text;
begin
  if auth.uid() is null then
    raise exception 'กรุณาเข้าสู่ระบบก่อนใช้งาน' using errcode = '28000';
  end if;
  if p_classroom_id is null or p_archived is null then
    raise exception 'ข้อมูลไม่ครบ' using errcode = '22023';
  end if;

  select * into v_classroom from public.classrooms where id = p_classroom_id for update;
  v_role := public.classroom_lifecycle_authorize(v_classroom);

  if p_archived and not v_classroom.is_active then
    raise exception 'ห้องเรียนนี้ถูกเก็บถาวรอยู่แล้ว' using errcode = 'KC005';
  end if;
  if not p_archived and v_classroom.is_active then
    raise exception 'ห้องเรียนนี้ใช้งานอยู่แล้ว' using errcode = 'KC006';
  end if;

  update public.classrooms set is_active = not p_archived where id = p_classroom_id
  returning * into v_classroom;

  insert into public.classroom_lifecycle_events (classroom_id, classroom_owner_id, event_type, actor_id, actor_role, classroom_snapshot)
  values (v_classroom.id, v_classroom.teacher_id, case when p_archived then 'archived' else 'restored' end, auth.uid(), v_role,
          jsonb_build_object('name', v_classroom.name, 'grade_level', v_classroom.grade_level, 'section', v_classroom.section,
                             'academic_year', v_classroom.academic_year, 'semester', v_classroom.semester));

  return to_jsonb(v_classroom);
end;
$$;

-- --------------------------------------------------
-- 6. Deletion preview (read-only)
-- --------------------------------------------------
create or replace function public.get_classroom_deletion_preview(p_classroom_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_classroom public.classrooms;
  v_counts jsonb;
begin
  if auth.uid() is null then
    raise exception 'กรุณาเข้าสู่ระบบก่อนใช้งาน' using errcode = '28000';
  end if;

  select * into v_classroom from public.classrooms where id = p_classroom_id;
  perform public.classroom_lifecycle_authorize(v_classroom);

  v_counts := public.classroom_deletion_counts(p_classroom_id);
  return jsonb_build_object(
    'classroom', to_jsonb(v_classroom),
    'counts', v_counts,
    'blockers', public.classroom_deletion_blockers(v_classroom, v_counts),
    'fingerprint', public.classroom_deletion_fingerprint(v_classroom, v_counts));
end;
$$;

-- --------------------------------------------------
-- 7. Permanent delete (one transaction)
-- --------------------------------------------------
create or replace function public.delete_classroom_permanently(
  p_classroom_id uuid,
  p_confirmation_name text,
  p_expected_fingerprint text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_classroom public.classrooms;
  v_role text;
  v_counts jsonb;
  v_blockers jsonb;
  v_event_id uuid;
  v_deleted integer;
  v_queued integer;
begin
  if auth.uid() is null then
    raise exception 'กรุณาเข้าสู่ระบบก่อนใช้งาน' using errcode = '28000';
  end if;
  if p_classroom_id is null or p_expected_fingerprint is null then
    raise exception 'ข้อมูลไม่ครบ' using errcode = '22023';
  end if;

  -- Lock first: a concurrent archive/restore/delete of the same classroom
  -- waits here, and re-checks against the committed state.
  select * into v_classroom from public.classrooms where id = p_classroom_id for update;
  v_role := public.classroom_lifecycle_authorize(v_classroom);

  if v_classroom.is_active then
    raise exception 'ต้องเก็บถาวรห้องเรียนก่อน จึงจะลบถาวรได้' using errcode = 'KC001';
  end if;
  if p_confirmation_name is distinct from v_classroom.name then
    raise exception 'ชื่อห้องเรียนที่พิมพ์ไม่ตรงกับชื่อห้องเรียน' using errcode = 'KC002';
  end if;

  -- Freeze the classroom's direct children so nothing new can be attached
  -- (a new submission/score/attendance record needs a key-share lock on
  -- these rows) between the recount and the delete.
  perform 1 from public.assignments where classroom_id = p_classroom_id for update;
  perform 1 from public.attendance_sessions where classroom_id = p_classroom_id for update;
  perform 1 from public.lessons where classroom_id = p_classroom_id for update;
  perform 1 from public.sgs_score_columns where classroom_id = p_classroom_id for update;

  v_counts := public.classroom_deletion_counts(p_classroom_id);
  if public.classroom_deletion_fingerprint(v_classroom, v_counts) is distinct from p_expected_fingerprint then
    raise exception 'ข้อมูลของห้องเรียนนี้เปลี่ยนไปหลังจากที่คุณเปิดหน้ายืนยัน กรุณาตรวจสอบรายการที่จะถูกลบอีกครั้ง' using errcode = 'KC003';
  end if;

  v_blockers := public.classroom_deletion_blockers(v_classroom, v_counts);
  if jsonb_array_length(v_blockers) > 0 then
    raise exception '%', v_blockers->0->>'message' using errcode = 'KC004';
  end if;

  insert into public.classroom_lifecycle_events
    (classroom_id, classroom_owner_id, event_type, actor_id, actor_role, classroom_snapshot, affected_counts, preview_fingerprint)
  values (v_classroom.id, v_classroom.teacher_id, 'deleted', auth.uid(), v_role,
          jsonb_build_object('name', v_classroom.name, 'grade_level', v_classroom.grade_level, 'section', v_classroom.section,
                             'academic_year', v_classroom.academic_year, 'semester', v_classroom.semester,
                             'created_at', v_classroom.created_at, 'archived_at', v_classroom.archived_at),
          v_counts, p_expected_fingerprint)
  returning id into v_event_id;

  -- File references -> review queue (the files themselves are untouched).
  insert into public.classroom_file_cleanup_queue
    (lifecycle_event_id, classroom_id, classroom_owner_id, source_table, source_id, provider, bucket, object_path, drive_file_id, url, title, referenced_elsewhere)
  select v_event_id, p_classroom_id, v_classroom.teacher_id, f.source_table, f.source_id, f.provider, f.bucket, f.object_path, f.drive_file_id, f.url, f.title,
    exists (select 1 from public.assignment_resources x join public.assignments xa on xa.id = x.assignment_id
            where xa.classroom_id <> p_classroom_id
              and ((f.object_path is not null and x.file_path = f.object_path) or (f.drive_file_id is not null and x.drive_file_id = f.drive_file_id)))
    or exists (select 1 from public.lesson_resources x join public.lessons xl on xl.id = x.lesson_id
            where xl.classroom_id <> p_classroom_id
              and ((f.object_path is not null and x.file_path = f.object_path) or (f.drive_file_id is not null and x.drive_file_id = f.drive_file_id)))
    or exists (select 1 from public.assignment_submission_resources x
            join public.assignment_submissions xs on xs.id = x.assignment_submission_id
            join public.assignments xa on xa.id = xs.assignment_id
            where xa.classroom_id <> p_classroom_id and f.object_path is not null and x.storage_path = f.object_path)
  from (
    select 'assignment_resources'::text as source_table, r.id as source_id, 'supabase_storage'::text as provider,
           'assignment-files'::text as bucket, r.file_path as object_path, null::text as drive_file_id, r.url, r.title
    from public.assignment_resources r join public.assignments a on a.id = r.assignment_id
    where a.classroom_id = p_classroom_id and r.file_path is not null
    union all
    select 'assignment_resources', r.id, 'google_drive', null, null, r.drive_file_id, r.url, r.title
    from public.assignment_resources r join public.assignments a on a.id = r.assignment_id
    where a.classroom_id = p_classroom_id and r.drive_file_id is not null
    union all
    select 'lesson_resources', r.id, 'supabase_storage', 'lesson-files', r.file_path, null, r.url, r.title
    from public.lesson_resources r join public.lessons l on l.id = r.lesson_id
    where l.classroom_id = p_classroom_id and r.file_path is not null
    union all
    select 'lesson_resources', r.id, 'google_drive', null, null, r.drive_file_id, r.url, r.title
    from public.lesson_resources r join public.lessons l on l.id = r.lesson_id
    where l.classroom_id = p_classroom_id and r.drive_file_id is not null
    union all
    select 'assignment_submission_resources', r.id, 'supabase_storage', 'submission-files', r.storage_path, null, r.external_url, coalesce(r.title, r.original_filename)
    from public.assignment_submission_resources r
    join public.assignment_submissions s on s.id = r.assignment_submission_id
    join public.assignments a on a.id = s.assignment_id
    where a.classroom_id = p_classroom_id and r.storage_path is not null
  ) f;
  get diagnostics v_queued = row_count;

  if to_regclass('public.notifications') is not null then
    execute 'delete from public.notifications where metadata->>''classroom_id'' = $1::text' using p_classroom_id;
  end if;

  -- The classroom row: every classroom-owned table goes with it through
  -- the existing FKs (graph above). Students, QR identities and other
  -- classrooms are not reachable from here.
  delete from public.classrooms where id = p_classroom_id;
  get diagnostics v_deleted = row_count;
  if v_deleted <> 1 then
    raise exception 'ลบห้องเรียนไม่สำเร็จ' using errcode = 'P0001';
  end if;

  return jsonb_build_object('event_id', v_event_id, 'counts', v_counts, 'queued_files', v_queued);
end;
$$;

revoke all on function public.set_classroom_archived(uuid, boolean) from public, anon;
revoke all on function public.get_classroom_deletion_preview(uuid) from public, anon;
revoke all on function public.delete_classroom_permanently(uuid, text, text) from public, anon;
grant execute on function public.set_classroom_archived(uuid, boolean) to authenticated;
grant execute on function public.get_classroom_deletion_preview(uuid) to authenticated;
grant execute on function public.delete_classroom_permanently(uuid, text, text) to authenticated;

-- --------------------------------------------------
-- 8. Close the raw cascade path (see "WHAT WAS UNSAFE" above)
-- --------------------------------------------------
drop policy if exists classrooms_delete_own on public.classrooms;
