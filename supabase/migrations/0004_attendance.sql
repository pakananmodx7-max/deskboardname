-- AI Classroom Management — Phase 5: Attendance
-- Tables: attendance_sessions, attendance_records
-- See docs/DATABASE.md for the full schema explanation and RLS rationale.
--
-- Builds on 0001_init.sql (profiles, classrooms, students, classroom_students)
-- and 0002_subjects_topics.sql (subjects). This migration has NOT been
-- applied to a live database yet — do NOT run it automatically. It is safe
-- to edit in place if a review finds issues before it is ever run.
--
-- Scope: this migration covers ONLY classroom-level (homeroom) attendance —
-- "select classroom → select date → mark each student → save". It is
-- deliberately designed so that a later, separate phase can add
-- subject-period attendance (subject → classroom → attendance session)
-- without a destructive redesign — see the subject_id note below. That
-- later phase is NOT implemented here; every write in the current app
-- always leaves subject_id null.
--
-- Ordering note (same rationale as 0001/0002): table definitions first, in
-- dependency order (attendance_sessions → attendance_records), then RLS is
-- enabled and policies are added afterward, then the atomic save RPC last.

-- ==================================================
-- attendance_sessions
-- One row per (classroom, date[, subject]) — "the roll call for ม.5/1 on
-- 8 ก.ย. 2569". Never deleted through the app (see "No delete policy"
-- note near the bottom) — the same no-hard-delete stance already taken
-- for students, subjects, and classrooms' own data.
--
-- `subject_id` is nullable ON PURPOSE, not a placeholder that will need to
-- be back-filled or migrated later:
--   - Today, every session the app creates is classroom-level homeroom
--     attendance, which is not "about" any one subject — it has no
--     natural subject_id to set, so NOT NULL would force a fake value.
--   - Later, subject-period attendance ("history class attendance for
--     ม.5/1 on 8 ก.ย.") will set subject_id to a real subjects.id on the
--     SAME table and the SAME attendance_records child rows — no new
--     table, no data migration, no destructive redesign. The two partial
--     unique indexes below already make room for that: one enforces "at
--     most one homeroom session per classroom per day" (subject_id is
--     null), the other will enforce "at most one session per
--     classroom+subject per day" the moment subject-period attendance
--     starts writing non-null subject_id rows.
-- ==================================================

create table if not exists public.attendance_sessions (
  id uuid primary key default gen_random_uuid(),
  -- `on delete cascade`, matching classroom_students.classroom_id in
  -- 0001: if a classroom is ever hard-deleted (classrooms_delete_own does
  -- allow this), its attendance sessions/records disappear with it —
  -- same cascade boundary already drawn for classroom membership.
  classroom_id uuid not null references public.classrooms (id) on delete cascade,
  -- `on delete restrict`: a subject must never be hard-deleted out from
  -- under attendance history. In practice this is currently unreachable —
  -- subjects has no DELETE RLS policy at all (0002) — but the constraint
  -- states the intent explicitly rather than relying on that being true
  -- forever by accident.
  subject_id uuid references public.subjects (id) on delete restrict,
  attendance_date date not null,
  -- SECURITY: NOT the authorization boundary (ownership is always derived
  -- from classroom_id → classrooms.teacher_id, exactly like every other
  -- table in this schema) — this is an audit trail of who took the roll,
  -- matching students.created_by's role in 0001. `set null` so deleting a
  -- teacher profile is never blocked by, nor cascades into destroying, the
  -- attendance history they recorded.
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists attendance_sessions_classroom_id_idx on public.attendance_sessions (classroom_id);
create index if not exists attendance_sessions_subject_id_idx on public.attendance_sessions (subject_id);

-- One homeroom (no-subject) session per classroom per day.
create unique index if not exists attendance_sessions_classroom_date_no_subject_uidx
  on public.attendance_sessions (classroom_id, attendance_date)
  where subject_id is null;

-- One subject-period session per classroom+subject per day. Not exercised
-- by any code path today (subject_id is always null on insert), but
-- created now so subject-period attendance can rely on it later without a
-- schema change.
create unique index if not exists attendance_sessions_classroom_subject_date_uidx
  on public.attendance_sessions (classroom_id, subject_id, attendance_date)
  where subject_id is not null;

create trigger set_attendance_sessions_updated_at
  before update on public.attendance_sessions
  for each row
  execute function public.set_updated_at();

-- ==================================================
-- attendance_records
-- One row per (session, student) — "สมชาย was 'present' in that roll
-- call". Exactly one record per student per session is enforced by the
-- unique constraint below.
--
-- `student_id` (NOT `classroom_student_id`) is the deliberate choice here.
-- classroom_students rows are ephemeral by design — "เอาออกจากห้อง" and
-- "ย้ายห้อง" (see student-service.ts) both delete/replace them as normal,
-- everyday operations, not edge cases. If this table referenced
-- classroom_students.id with `on delete cascade` (the natural-looking
-- choice), removing a student from a classroom — or moving them to
-- another one — would silently wipe every attendance record ever taken
-- for them in that classroom the instant the membership row disappeared.
-- That is exactly the "never silently delete academic history" failure
-- mode this phase is required to avoid. Referencing `students.id`
-- directly means attendance history survives a membership change
-- untouched; "was this student actually in that classroom on that date"
-- is instead checked as an application-level rule (by
-- save_attendance_session below and by attendance_records_insert_own's
-- WITH CHECK) at the moment a record is first WRITTEN, not wired in as a
-- constraint that would later delete history when membership changes.
create table if not exists public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  attendance_session_id uuid not null references public.attendance_sessions (id) on delete cascade,
  -- `on delete restrict`: students has no DELETE RLS policy at all (0001
  -- "Orphan student strategy"), so this is currently unreachable in
  -- practice — restrict states the intent (attendance history must never
  -- be silently destroyed by a student row disappearing) rather than
  -- leaving the FK action unconsidered.
  student_id uuid not null references public.students (id) on delete restrict,
  status text not null check (status in ('present', 'late', 'leave', 'absent')),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (attendance_session_id, student_id)
);

create index if not exists attendance_records_session_id_idx on public.attendance_records (attendance_session_id);
create index if not exists attendance_records_student_id_idx on public.attendance_records (student_id);

create trigger set_attendance_records_updated_at
  before update on public.attendance_records
  for each row
  execute function public.set_updated_at();

-- ==================================================
-- RLS: attendance_sessions
-- ==================================================

alter table public.attendance_sessions enable row level security;

-- Ownership is always derived transitively through classroom_id →
-- classrooms.teacher_id — attendance_sessions has no owner column of its
-- own (created_by is an audit trail, not the authorization boundary; see
-- the table comment above). No recursion risk: this references
-- `classrooms`, not `attendance_sessions` itself.
create policy "attendance_sessions_select_own"
  on public.attendance_sessions for select
  using (
    exists (
      select 1 from public.classrooms c
      where c.id = attendance_sessions.classroom_id and c.teacher_id = auth.uid()
    )
  );

-- SECURITY: creating a session requires BOTH that the caller owns the
-- target classroom AND that they honestly name themselves as created_by
-- (never forged to point at another teacher) — same shape as
-- students_insert_authorized (0001) requiring created_by = auth.uid().
create policy "attendance_sessions_insert_own"
  on public.attendance_sessions for insert
  with check (
    exists (
      select 1 from public.classrooms c
      where c.id = attendance_sessions.classroom_id and c.teacher_id = auth.uid()
    )
    and created_by = auth.uid()
  );

-- Needed so `save_attendance_session`'s upsert (insert ... on conflict ...
-- do update) can bump `updated_at` on an already-existing session — an
-- ON CONFLICT DO UPDATE is checked against the UPDATE policy, not INSERT.
create policy "attendance_sessions_update_own"
  on public.attendance_sessions for update
  using (
    exists (
      select 1 from public.classrooms c
      where c.id = attendance_sessions.classroom_id and c.teacher_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.classrooms c
      where c.id = attendance_sessions.classroom_id and c.teacher_id = auth.uid()
    )
  );

-- SECURITY: deliberately NO delete policy — matching students/subjects
-- (0001/0002), attendance is never hard-deleted through the app. See
-- docs/DATABASE.md "Attendance delete strategy".

-- ==================================================
-- RLS: attendance_records
-- ==================================================

alter table public.attendance_records enable row level security;

-- Ownership is derived transitively through attendance_session_id →
-- attendance_sessions → classrooms.teacher_id. Deliberately NOT re-checked
-- against the student's CURRENT classroom membership: a student who later
-- moves to a different classroom (or is removed) must not lose visibility
-- into attendance history that was legitimately recorded while they were
-- there. No recursion risk: this references `attendance_sessions`, not
-- `attendance_records` itself.
create policy "attendance_records_select_own"
  on public.attendance_records for select
  using (
    exists (
      select 1
      from public.attendance_sessions s
      join public.classrooms c on c.id = s.classroom_id
      where s.id = attendance_records.attendance_session_id
        and c.teacher_id = auth.uid()
    )
  );

-- SECURITY (prevents "attendance records for students not belonging to
-- that classroom"): creating a record requires BOTH
--   1. the caller owns the session's classroom (same derivation as
--      SELECT above), AND
--   2. the student is CURRENTLY a member of that session's classroom, via
--      a direct classroom_students lookup.
-- #2 only applies at INSERT time, on purpose — see attendance_records_update_own
-- below for why UPDATE does not re-check it (correcting a mistake in an
-- already-saved record for a student who has since left the classroom
-- must not become impossible).
create policy "attendance_records_insert_own"
  on public.attendance_records for insert
  with check (
    exists (
      select 1
      from public.attendance_sessions s
      join public.classrooms c on c.id = s.classroom_id
      where s.id = attendance_records.attendance_session_id
        and c.teacher_id = auth.uid()
    )
    and exists (
      select 1
      from public.attendance_sessions s
      join public.classroom_students cs on cs.classroom_id = s.classroom_id
      where s.id = attendance_records.attendance_session_id
        and cs.student_id = attendance_records.student_id
    )
  );

-- Editing an existing record (e.g. correcting มา → สาย, or adding a note)
-- only re-checks session ownership, not current classroom membership —
-- see the INSERT policy comment above for why. This still cannot be used
-- to attach a record to a DIFFERENT session or student the caller doesn't
-- own, because both USING and WITH CHECK re-derive ownership from
-- attendance_session_id on every call, for the row as it stands before
-- and after the update respectively.
create policy "attendance_records_update_own"
  on public.attendance_records for update
  using (
    exists (
      select 1
      from public.attendance_sessions s
      join public.classrooms c on c.id = s.classroom_id
      where s.id = attendance_records.attendance_session_id
        and c.teacher_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.attendance_sessions s
      join public.classrooms c on c.id = s.classroom_id
      where s.id = attendance_records.attendance_session_id
        and c.teacher_id = auth.uid()
    )
  );

-- SECURITY: deliberately NO delete policy — matching attendance_sessions
-- above, individual attendance records are never hard-deleted through the
-- app either (a status is corrected via UPDATE, never removed outright).

-- ==================================================
-- save_attendance_session: atomic "upsert session + upsert every record"
-- RPC
--
-- Fixes the partial-save risk of doing this as N+1 separate client-side
-- statements (upsert the session, then upsert each of 30+ records): if
-- any single record write failed partway through (a student the caller
-- no longer teaches, a bad status value, a network blip), everything
-- written before that point would already be committed, leaving a session
-- with some students saved and others silently missing — exactly the
-- "partial save" this RPC exists to prevent. Wrapping the whole batch in
-- one PL/pgSQL function makes Postgres run it as a single statement-level
-- unit: if anything inside raises, the session upsert AND every record
-- upsert so far are rolled back together, so the caller either gets a
-- fully-saved roll call back or no change at all.
--
-- SECURITY DEFINER is deliberately NOT used here, same reasoning as
-- create_student_and_enroll (0001) and create_subject_with_classrooms
-- (0002): the RLS policies above (attendance_sessions_insert_own/
-- _update_own, attendance_records_insert_own/_update_own) already grant a
-- legitimate teacher everything this function does. A plain SECURITY
-- INVOKER function just gives the app one atomic entrypoint instead of
-- many round trips, without taking on any SECURITY DEFINER risk — a
-- p_classroom_id the caller doesn't own, or a p_records entry naming a
-- student not currently in that classroom, still fails with 42501 via the
-- same RLS policies a direct client call would hit, and that failure
-- unwinds the whole function.
--
-- p_records is a JSONB array of `{"student_id": uuid, "status": text,
-- "note": text | null}` objects — one entry per student the caller wants
-- to save a status for. Sending the full current roster's statuses is the
-- expected/correct usage (this app always does, see
-- attendance-service.ts); the RPC does not require that, but also never
-- deletes a record just because it was omitted from p_records — see the
-- no-delete-policy note above.
-- ==================================================

create or replace function public.save_attendance_session(
  p_classroom_id uuid,
  p_attendance_date date,
  p_records jsonb
)
returns public.attendance_sessions
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_session_id uuid;
  v_session public.attendance_sessions;
  v_record jsonb;
  v_student_id uuid;
  v_status text;
begin
  if auth.uid() is null then
    raise exception 'กรุณาเข้าสู่ระบบก่อนใช้งาน' using errcode = '28000';
  end if;

  if not exists (
    select 1 from public.classrooms c
    where c.id = p_classroom_id and c.teacher_id = auth.uid()
  ) then
    raise exception 'ไม่พบห้องเรียนนี้ หรือคุณไม่มีสิทธิ์เข้าถึง' using errcode = '42501';
  end if;

  if p_attendance_date is null then
    raise exception 'กรุณาระบุวันที่' using errcode = '22023';
  end if;

  -- Upsert the homeroom (subject_id is null) session for this
  -- classroom+date. The ON CONFLICT target names the exact partial unique
  -- index declared above — Postgres requires the WHERE clause to match it
  -- verbatim to resolve which index is meant.
  insert into public.attendance_sessions (classroom_id, subject_id, attendance_date, created_by)
  values (p_classroom_id, null, p_attendance_date, auth.uid())
  on conflict (classroom_id, attendance_date) where subject_id is null
  do update set updated_at = now()
  returning id into v_session_id;

  for v_record in select * from jsonb_array_elements(coalesce(p_records, '[]'::jsonb))
  loop
    v_student_id := (v_record ->> 'student_id')::uuid;
    v_status := v_record ->> 'status';

    if v_student_id is null then
      raise exception 'ข้อมูลนักเรียนไม่ถูกต้อง' using errcode = '22023';
    end if;

    if v_status not in ('present', 'late', 'leave', 'absent') then
      raise exception 'สถานะการเข้าเรียนไม่ถูกต้อง' using errcode = '22023';
    end if;

    if not exists (
      select 1 from public.classroom_students cs
      where cs.classroom_id = p_classroom_id and cs.student_id = v_student_id
    ) then
      raise exception 'นักเรียนไม่ได้อยู่ในห้องเรียนนี้' using errcode = '42501';
    end if;

    insert into public.attendance_records (attendance_session_id, student_id, status, note)
    values (
      v_session_id,
      v_student_id,
      v_status,
      nullif(trim(v_record ->> 'note'), '')
    )
    on conflict (attendance_session_id, student_id)
    do update set status = excluded.status, note = excluded.note, updated_at = now();
  end loop;

  select * into v_session from public.attendance_sessions where id = v_session_id;

  return v_session;
end;
$$;

revoke all on function public.save_attendance_session(uuid, date, jsonb) from public;
grant execute on function public.save_attendance_session(uuid, date, jsonb) to authenticated;

-- ==================================================
-- Future relationship (not implemented yet, documented for reference):
--
--   subjects
--      |
--      v (nullable subject_id, once subject-period attendance ships)
--   attendance_sessions  <---  classrooms
--      |
--      v
--   attendance_records  --->  students
--
-- assignments, submissions, and grades — still demo-only in the
-- application — will follow a similar shape (tied to classroom_students
-- or classroom_id + student_id, per the note in 0001) once those phases
-- are migrated. Not implemented here.
-- ==================================================
