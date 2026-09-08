-- AI Classroom Management — Phase 6: Subject Attendance
-- Extends: attendance_sessions, attendance_records RLS, save_attendance_session
-- See docs/DATABASE.md for the full schema explanation and RLS rationale.
--
-- Builds on 0001_init.sql, 0002_subjects_topics.sql, and 0004_attendance.sql,
-- all of which must already be applied. This migration has NOT been applied
-- to a live database yet — do NOT run it automatically. It is safe to edit
-- in place if a review finds issues before it is ever run.
--
-- Scope: wires up the subject_id column that 0004_attendance.sql already
-- reserved (see that migration's "subject_id is nullable ON PURPOSE"
-- comment) so a subject's own เช็คชื่อ tab can record attendance for one of
-- its linked classrooms, on a given date, optionally scoped to a คาบ
-- (period). This is the smallest safe extension of 0004's design — no
-- table is dropped or recreated, no existing column changes type or
-- nullability, and the existing classroom-only (subject_id is null)
-- attendance flow is untouched end to end (same rows, same indexes, same
-- RPC call shape still works with zero code changes on that path).

-- ==================================================
-- attendance_sessions.period_number
--
-- Optional "คาบ" (period) number, so the SAME subject+classroom+date can
-- have more than one session — e.g. a subject taught twice on the same
-- day to the same classroom (คาบ 1 and คาบ 5). Nullable because:
--   - Classroom-level homeroom attendance (0004) never has periods —
--     those rows keep subject_id AND period_number both null, and are
--     completely unaffected by this column's existence.
--   - A subject taught only once a day to a given classroom has no
--     meaningful period number either; forcing one would misrepresent
--     the data the same way a forced subject_id would have in 0004.
-- ==================================================

alter table public.attendance_sessions
  add column if not exists period_number integer;

alter table public.attendance_sessions
  add constraint attendance_sessions_period_number_check
  check (period_number is null or period_number > 0);

-- Superseded by the two period-aware indexes below — 0004 only ever wrote
-- subject_id as null, so this index never actually had a row exercise it;
-- dropping and replacing it is safe.
drop index if exists public.attendance_sessions_classroom_subject_date_uidx;

-- One subject-period-less session per classroom+subject per day (a subject
-- taught once a day with no period tracking).
create unique index if not exists attendance_sessions_subject_date_no_period_uidx
  on public.attendance_sessions (classroom_id, subject_id, attendance_date)
  where subject_id is not null and period_number is null;

-- One session per classroom+subject+date+period (a subject taught more
-- than once a day, e.g. คาบ 1 and คาบ 5, to the same classroom).
create unique index if not exists attendance_sessions_subject_date_period_uidx
  on public.attendance_sessions (classroom_id, subject_id, attendance_date, period_number)
  where subject_id is not null and period_number is not null;

-- ==================================================
-- RLS: attendance_sessions — extend INSERT/UPDATE to cover subject-scoped
-- rows
--
-- 0004's insert/update policies already required owning the target
-- classroom; that alone is not enough once subject_id can be non-null,
-- because it would let a teacher attach ANY subject_id they merely know
-- the UUID of (including another teacher's subject) to a session inside
-- their own classroom. The added clause below requires BOTH:
--   1. subject_id is null (the existing classroom-only path, unchanged), OR
--   2. the caller owns that subject AND that subject is actually linked
--      to the target classroom via subject_classrooms — closing both the
--      "spoof someone else's subject_id" and the "attach a real, owned
--      subject to a classroom it was never linked to" gaps.
-- This mirrors subject_classrooms_insert_own's (0002) own "you must own
-- both sides of the link" shape.
-- ==================================================

drop policy if exists "attendance_sessions_insert_own" on public.attendance_sessions;

create policy "attendance_sessions_insert_own"
  on public.attendance_sessions for insert
  with check (
    exists (
      select 1 from public.classrooms c
      where c.id = attendance_sessions.classroom_id and c.teacher_id = auth.uid()
    )
    and created_by = auth.uid()
    and (
      attendance_sessions.subject_id is null
      or (
        exists (
          select 1 from public.subjects s
          where s.id = attendance_sessions.subject_id and s.teacher_id = auth.uid()
        )
        and exists (
          select 1 from public.subject_classrooms sc
          where sc.subject_id = attendance_sessions.subject_id
            and sc.classroom_id = attendance_sessions.classroom_id
        )
      )
    )
  );

drop policy if exists "attendance_sessions_update_own" on public.attendance_sessions;

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
    and (
      attendance_sessions.subject_id is null
      or (
        exists (
          select 1 from public.subjects s
          where s.id = attendance_sessions.subject_id and s.teacher_id = auth.uid()
        )
        and exists (
          select 1 from public.subject_classrooms sc
          where sc.subject_id = attendance_sessions.subject_id
            and sc.classroom_id = attendance_sessions.classroom_id
        )
      )
    )
  );

-- attendance_records policies (0004) are untouched: they derive ownership
-- from attendance_session_id -> attendance_sessions -> classrooms, and
-- attendance_records_insert_own already requires the student to be a
-- CURRENT member of the session's classroom_id via classroom_students —
-- exactly the right check regardless of whether that session is
-- homeroom or subject-scoped, so nothing here needs to change.

-- ==================================================
-- save_attendance_session — extend with optional p_subject_id/
-- p_period_number
--
-- IMPORTANT — this is NOT a `create or replace` of 0004's function.
-- Postgres identifies a function by name AND its declared argument
-- *types*, so appending two new parameters (even with defaults) changes
-- the signature and `create or replace` would create a SECOND, separate
-- overload sitting alongside the original 3-argument one — it does NOT
-- swap it out. Empirically verified while writing this migration: after
-- doing exactly that, every existing 3-argument call (`select
-- save_attendance_session($1, $2, $3)`, exactly what
-- attendance-service.ts's standalone classroom Attendance page sends)
-- started failing with `function ... is not unique`, because Postgres
-- could no longer tell whether the caller meant the old 3-arg function or
-- the new 5-arg one called with its last two defaults omitted. The
-- explicit DROP below removes the old 3-arg overload first, so only the
-- new 5-arg signature exists afterward and that ambiguity cannot occur —
-- every existing 3-argument call resolves to it unambiguously, with
-- p_subject_id/p_period_number both defaulting to null (exactly what
-- those calls already did implicitly in 0004). Same privileges apply
-- once re-granted below; this is otherwise the same function in every
-- practical sense, just correctly replacing the old one instead of
-- shadowing it.
--
-- New validation added at the top of the function body: when
-- p_subject_id is provided, it must be owned by the caller AND linked to
-- p_classroom_id via subject_classrooms — the same two checks the RLS
-- policy above enforces, checked early here so a bad p_subject_id fails
-- with a clear Thai message before any write is attempted, rather than
-- surfacing as a bare RLS-violation from the INSERT further down.
--
-- The session upsert itself now branches into three mutually exclusive
-- ON CONFLICT targets (homeroom / subject+no-period / subject+period),
-- matching the three partial unique indexes exactly one of which can
-- apply to a given (subject_id, period_number) combination. A single
-- INSERT can only name one ON CONFLICT target, so this has to be an
-- if/elsif rather than one statement — everything else about the
-- function (record validation loop, atomicity, SECURITY INVOKER) is
-- unchanged from 0004.
-- ==================================================

drop function if exists public.save_attendance_session(uuid, date, jsonb);

create or replace function public.save_attendance_session(
  p_classroom_id uuid,
  p_attendance_date date,
  p_records jsonb,
  p_subject_id uuid default null,
  p_period_number integer default null
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

  if p_period_number is not null and p_period_number <= 0 then
    raise exception 'คาบเรียนไม่ถูกต้อง' using errcode = '22023';
  end if;

  if p_subject_id is not null then
    if not exists (
      select 1 from public.subjects s
      where s.id = p_subject_id and s.teacher_id = auth.uid()
    ) then
      raise exception 'ไม่พบรายวิชานี้ หรือคุณไม่มีสิทธิ์เข้าถึง' using errcode = '42501';
    end if;

    if not exists (
      select 1 from public.subject_classrooms sc
      where sc.subject_id = p_subject_id and sc.classroom_id = p_classroom_id
    ) then
      raise exception 'ห้องเรียนนี้ไม่ได้เชื่อมกับรายวิชานี้' using errcode = '42501';
    end if;
  end if;

  if p_subject_id is null then
    insert into public.attendance_sessions (classroom_id, subject_id, period_number, attendance_date, created_by)
    values (p_classroom_id, null, null, p_attendance_date, auth.uid())
    on conflict (classroom_id, attendance_date) where subject_id is null
    do update set updated_at = now()
    returning id into v_session_id;
  elsif p_period_number is null then
    insert into public.attendance_sessions (classroom_id, subject_id, period_number, attendance_date, created_by)
    values (p_classroom_id, p_subject_id, null, p_attendance_date, auth.uid())
    on conflict (classroom_id, subject_id, attendance_date) where subject_id is not null and period_number is null
    do update set updated_at = now()
    returning id into v_session_id;
  else
    insert into public.attendance_sessions (classroom_id, subject_id, period_number, attendance_date, created_by)
    values (p_classroom_id, p_subject_id, p_period_number, p_attendance_date, auth.uid())
    on conflict (classroom_id, subject_id, attendance_date, period_number)
      where subject_id is not null and period_number is not null
    do update set updated_at = now()
    returning id into v_session_id;
  end if;

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

    -- Membership is always checked against p_classroom_id (the session's
    -- actual classroom), regardless of whether this is a homeroom or
    -- subject-scoped session — a subject's roster is exactly its linked
    -- classrooms' rosters, so this one check already covers "student
    -- belongs to the selected classroom" for both cases without needing
    -- to reference subject_classrooms again here.
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

revoke all on function public.save_attendance_session(uuid, date, jsonb, uuid, integer) from public;
grant execute on function public.save_attendance_session(uuid, date, jsonb, uuid, integer) to authenticated;

-- ==================================================
-- Future relationship (updated from 0004):
--
--   subjects  --->  subject_classrooms  <---  classrooms
--      |                                          |
--      v (subject_id, now wired up)                |
--   attendance_sessions  <--------------------------
--      |
--      v
--   attendance_records  --->  students
--
-- assignments, submissions, and grades — still demo-only in the
-- application — remain out of scope for this migration.
-- ==================================================
