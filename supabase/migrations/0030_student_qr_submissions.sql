-- KrunameClass — Student QR identities and QR-scanned assignment submission.
-- See docs/QR_SUBMISSIONS.md for the design, and docs/DATABASE.md for the
-- conventions every earlier migration follows.
--
-- This migration has NOT been applied to a live database — do NOT run it
-- automatically. It must be reviewed and applied manually by the project
-- owner, after 0001–0029 (it only depends on 0001, 0006, 0007, 0011,
-- 0012 and 0016, all of which earlier migrations already require).
--
-- What it adds (additive only — no existing column, row, score or
-- policy is changed or removed):
--
--   1. student_qr_identities — one ACTIVE random QR token per student,
--      stable across semesters/classrooms/assignments, revocable and
--      regenerable. RLS on with NO policies: only the SECURITY DEFINER
--      RPCs below can read or write it.
--   2. Backfill: every existing student gets an active identity; an
--      AFTER INSERT trigger issues one for every new student.
--   3. assignments: optional submission_deadline (exact time),
--      late_policy, accepting_submissions (open/closed).
--   4. assignment_submissions: status may also be 'excused' (teacher
--      only); recorded_via / recorded_by say how a submission was
--      recorded.
--   5. assignment_submission_events — audit trail of recorded scans and
--      every status correction (teacher-readable, RPC-written only).
--   6. RPCs: get_classroom_student_qr_codes, regenerate_student_qr_code,
--      record_submission_scan, record_submission_manual,
--      correct_submission_status.
--
-- SECURITY MODEL
--   * Supabase's default privileges grant EXECUTE on every new public
--     function directly to anon and authenticated, so `revoke ... from
--     public` alone is not enough: every internal helper below revokes
--     from public, anon AND authenticated (a signed-in user must never
--     call qr_record_submission with a forged assignments row), and every
--     RPC revokes from public and anon before granting authenticated.
--   * A QR token is an opaque 64-hex-digit random value (two
--     gen_random_uuid() calls = 244 random bits from the server's strong
--     RNG). It encodes no personal data and no student id.
--   * Possessing a QR grants nothing: every RPC requires an
--     authenticated teacher/admin who owns the assignment's classroom AND
--     subject (or, for QR management, the classroom). A student account
--     calling these RPCs is rejected.
--   * The submission timestamp is the database's now(); the status
--     (on time / late) is computed here from the assignment's deadline.
--     The client never supplies a timestamp or a status for a scan.
--   * A repeated scan never overwrites the original submitted_at; it is
--     reported as a duplicate. Concurrent scans of the same student are
--     serialised by the (assignment_id, student_id) unique constraint
--     plus a row lock.
--   * Scores are never touched by any function in this migration.

-- ==================================================
-- 1. student_qr_identities
-- ==================================================

create table if not exists public.student_qr_identities (
  id uuid primary key default gen_random_uuid(),
  -- cascade: an identity means nothing without its student (students
  -- are never hard-deleted through the app anyway — see 0001).
  student_id uuid not null references public.students (id) on delete cascade,
  token text not null unique check (token ~ '^[0-9a-f]{64}$'),
  status text not null default 'active' check (status in ('active', 'revoked')),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references public.profiles (id) on delete set null,
  constraint student_qr_identities_revoked_consistent check ((status = 'revoked') = (revoked_at is not null))
);

-- At most ONE active identity per student — the database, not the app,
-- prevents duplicates (also under concurrent requests).
create unique index if not exists student_qr_identities_one_active_idx
  on public.student_qr_identities (student_id)
  where status = 'active';
create index if not exists student_qr_identities_student_id_idx on public.student_qr_identities (student_id);

alter table public.student_qr_identities enable row level security;
-- Deliberately no policies: tokens are read/written only through the
-- SECURITY DEFINER functions below, which check ownership themselves.
revoke all on table public.student_qr_identities from anon, authenticated;

-- 244 bits of randomness, 64 lowercase hex digits.
create or replace function public.generate_student_qr_token()
returns text
language sql
volatile
set search_path = public, pg_temp
as $$
  select replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
$$;

revoke all on function public.generate_student_qr_token() from public, anon, authenticated;

-- The caller's profile id, or null when there is no (existing) profile —
-- so created_by/revoked_by/actor_id can never break an insert with a
-- foreign-key error (e.g. a service-role import with no auth.uid()).
create or replace function public.qr_actor_profile_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.id from public.profiles p where p.id = auth.uid()
$$;

revoke all on function public.qr_actor_profile_id() from public, anon, authenticated;

-- Idempotent and concurrency-safe: a second concurrent call for the same
-- student waits on the partial unique index and then does nothing.
create or replace function public.issue_student_qr_identity(p_student_id uuid)
returns void
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  insert into public.student_qr_identities (student_id, token, created_by)
  values (p_student_id, public.generate_student_qr_token(), public.qr_actor_profile_id())
  on conflict (student_id) where status = 'active' do nothing
$$;

revoke all on function public.issue_student_qr_identity(uuid) from public, anon, authenticated;

-- ==================================================
-- 2. Backfill existing students + issue for every new student
-- ==================================================

insert into public.student_qr_identities (student_id, token)
select s.id, public.generate_student_qr_token()
from public.students s
where not exists (
  select 1 from public.student_qr_identities q
  where q.student_id = s.id and q.status = 'active'
)
on conflict (student_id) where status = 'active' do nothing;

create or replace function public.students_issue_qr_identity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.issue_student_qr_identity(new.id);
  return new;
end;
$$;

revoke all on function public.students_issue_qr_identity() from public, anon, authenticated;

drop trigger if exists students_issue_qr_identity_trigger on public.students;
create trigger students_issue_qr_identity_trigger
  after insert on public.students
  for each row
  execute function public.students_issue_qr_identity();

-- ==================================================
-- Shared authorization helpers (internal — not granted to anyone)
-- ==================================================

create or replace function public.qr_require_teacher()
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'กรุณาเข้าสู่ระบบก่อนใช้งาน' using errcode = '28000';
  end if;
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('teacher', 'admin')) then
    raise exception 'เฉพาะครูเท่านั้นที่ใช้งานส่วนนี้ได้' using errcode = '42501';
  end if;
  return auth.uid();
end;
$$;

revoke all on function public.qr_require_teacher() from public, anon, authenticated;

-- The assignment, only if the caller owns BOTH its classroom and its
-- subject. "Not found" and "not yours" are the same error on purpose, so
-- the RPCs cannot be used to probe other teachers' assignment ids.
create or replace function public.qr_require_assignment(p_assignment_id uuid)
returns public.assignments
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := public.qr_require_teacher();
  v_assignment public.assignments;
begin
  select a.* into v_assignment
  from public.assignments a
  join public.classrooms c on c.id = a.classroom_id
  join public.subjects s on s.id = a.subject_id
  where a.id = p_assignment_id
    and c.teacher_id = v_uid
    and s.teacher_id = v_uid;
  if v_assignment.id is null then
    raise exception 'ไม่พบงานนี้ หรือคุณไม่มีสิทธิ์เข้าถึง' using errcode = '42501';
  end if;
  return v_assignment;
end;
$$;

revoke all on function public.qr_require_assignment(uuid) from public, anon, authenticated;

-- ==================================================
-- 3. QR management RPCs
-- ==================================================

-- Active QR codes for every student CURRENTLY in one of the caller's
-- classrooms. Issues a missing identity on the way (e.g. a student
-- created before this migration's trigger existed on some other path) —
-- so the call is idempotent and safe to repeat or run concurrently.
create or replace function public.get_classroom_student_qr_codes(p_classroom_id uuid)
returns table (student_id uuid, token text, created_at timestamptz)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_uid uuid := public.qr_require_teacher();
  v_student uuid;
begin
  if not exists (select 1 from public.classrooms c where c.id = p_classroom_id and c.teacher_id = v_uid) then
    raise exception 'ไม่พบห้องเรียนนี้ หรือคุณไม่มีสิทธิ์เข้าถึง' using errcode = '42501';
  end if;

  for v_student in
    select cs.student_id from public.classroom_students cs
    where cs.classroom_id = p_classroom_id
      and not exists (
        select 1 from public.student_qr_identities q
        where q.student_id = cs.student_id and q.status = 'active'
      )
  loop
    perform public.issue_student_qr_identity(v_student);
  end loop;

  return query
    select q.student_id, q.token, q.created_at
    from public.student_qr_identities q
    join public.classroom_students cs on cs.student_id = q.student_id and cs.classroom_id = p_classroom_id
    where q.status = 'active';
end;
$$;

revoke all on function public.get_classroom_student_qr_codes(uuid) from public, anon;
grant execute on function public.get_classroom_student_qr_codes(uuid) to authenticated;

-- Revoke the student's active QR and issue a new one, atomically. The
-- student row is locked first, so two concurrent regenerations for the
-- same student run one after the other (never two active tokens, never a
-- unique-index error surfacing to the teacher).
create or replace function public.regenerate_student_qr_code(p_classroom_id uuid, p_student_id uuid)
returns table (student_id uuid, token text, created_at timestamptz)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_uid uuid := public.qr_require_teacher();
  v_actor uuid := public.qr_actor_profile_id();
begin
  if not exists (
    select 1 from public.classroom_students cs
    join public.classrooms c on c.id = cs.classroom_id
    where cs.classroom_id = p_classroom_id and cs.student_id = p_student_id and c.teacher_id = v_uid
  ) then
    raise exception 'ไม่พบนักเรียนในห้องเรียนนี้ หรือคุณไม่มีสิทธิ์เข้าถึง' using errcode = '42501';
  end if;

  perform 1 from public.students s where s.id = p_student_id for update;

  update public.student_qr_identities q
     set status = 'revoked', revoked_at = now(), revoked_by = v_actor
   where q.student_id = p_student_id and q.status = 'active';

  insert into public.student_qr_identities (student_id, token, created_by)
  values (p_student_id, public.generate_student_qr_token(), v_actor);

  return query
    select q.student_id, q.token, q.created_at
    from public.student_qr_identities q
    where q.student_id = p_student_id and q.status = 'active';
end;
$$;

revoke all on function public.regenerate_student_qr_code(uuid, uuid) from public, anon;
grant execute on function public.regenerate_student_qr_code(uuid, uuid) to authenticated;

-- ==================================================
-- 4. Assignment submission settings
-- ==================================================

alter table public.assignments
  -- Exact deadline. When null, a due_date (a plain date) still counts as
  -- a deadline of 23:59:59 that day, school time (Asia/Bangkok) — the
  -- same rule student self-submission already uses.
  add column if not exists submission_deadline timestamptz,
  -- After the deadline: 'accept_late' records the submission as late;
  -- 'reject_late' refuses it.
  add column if not exists late_policy text not null default 'accept_late',
  -- Closed = scans are refused regardless of the deadline.
  add column if not exists accepting_submissions boolean not null default true;

do $$
begin
  alter table public.assignments
    add constraint assignments_late_policy_check check (late_policy in ('accept_late', 'reject_late'));
exception when duplicate_object then null;
end $$;

-- The instant after which a submission counts as late; null = no
-- deadline (then nothing is ever labelled late).
create or replace function public.assignment_effective_deadline(p_assignment public.assignments)
returns timestamptz
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(
    p_assignment.submission_deadline,
    case when p_assignment.due_date is not null
      then (p_assignment.due_date::timestamp + interval '23 hours 59 minutes 59 seconds') at time zone 'Asia/Bangkok'
    end
  )
$$;

revoke all on function public.assignment_effective_deadline(public.assignments) from public, anon;
grant execute on function public.assignment_effective_deadline(public.assignments) to authenticated;

-- ==================================================
-- 5. assignment_submissions: 'excused' + how it was recorded
-- ==================================================

alter table public.assignment_submissions drop constraint if exists assignment_submissions_status_check;
alter table public.assignment_submissions
  add constraint assignment_submissions_status_check
  check (status in ('not_submitted', 'submitted', 'late', 'missing', 'excused'));

alter table public.assignment_submissions
  add column if not exists recorded_via text,
  add column if not exists recorded_by uuid references public.profiles (id) on delete set null;

do $$
begin
  alter table public.assignment_submissions
    add constraint assignment_submissions_recorded_via_check
    check (recorded_via is null or recorded_via in ('qr_scan', 'teacher_manual', 'teacher_correction'));
exception when duplicate_object then null;
end $$;

-- Students can update their own submission row (0016). They must never
-- excuse themselves or forge how a submission was recorded.
create or replace function public.enforce_submission_teacher_only_fields()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.student_id = public.my_student_id() then
    if new.status = 'excused' and (tg_op = 'INSERT' or old.status is distinct from 'excused') then
      raise exception 'students cannot excuse their own submission' using errcode = '42501';
    end if;
    if tg_op = 'INSERT' and (new.recorded_via is not null or new.recorded_by is not null) then
      raise exception 'students cannot set how a submission was recorded' using errcode = '42501';
    end if;
    if tg_op = 'UPDATE' and (new.recorded_via is distinct from old.recorded_via or new.recorded_by is distinct from old.recorded_by) then
      raise exception 'students cannot set how a submission was recorded' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_submission_teacher_only_fields() from public, anon, authenticated;

drop trigger if exists enforce_submission_teacher_only_fields_trigger on public.assignment_submissions;
create trigger enforce_submission_teacher_only_fields_trigger
  before insert or update on public.assignment_submissions
  for each row
  execute function public.enforce_submission_teacher_only_fields();

-- ==================================================
-- 6. Audit trail
-- ==================================================

create table if not exists public.assignment_submission_events (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments (id) on delete cascade,
  student_id uuid not null references public.students (id) on delete cascade,
  event_type text not null check (event_type in ('scan_recorded', 'manual_recorded', 'status_corrected')),
  previous_status text,
  new_status text,
  previous_submitted_at timestamptz,
  new_submitted_at timestamptz,
  reason text,
  actor_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists assignment_submission_events_assignment_idx
  on public.assignment_submission_events (assignment_id, created_at desc);
create index if not exists assignment_submission_events_student_idx
  on public.assignment_submission_events (student_id);

alter table public.assignment_submission_events enable row level security;
revoke insert, update, delete on table public.assignment_submission_events from anon, authenticated;

drop policy if exists "assignment_submission_events_select_own" on public.assignment_submission_events;
create policy "assignment_submission_events_select_own"
  on public.assignment_submission_events for select
  using (
    exists (
      select 1
      from public.assignments a
      join public.classrooms c on c.id = a.classroom_id
      where a.id = assignment_submission_events.assignment_id
        and c.teacher_id = auth.uid()
    )
  );

-- ==================================================
-- 7. Recording a submission (shared core) + public RPCs
-- ==================================================

-- Only the fields the scanner screen shows — never email/phone/etc.
-- avatar_path comes from 0012, which may not be applied: it is read
-- through to_jsonb(s) so this function is valid either way (null when
-- the column does not exist; the scanner then shows initials).
create or replace function public.qr_student_summary(p_student_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'id', s.id,
    'first_name', s.first_name,
    'last_name', s.last_name,
    'number', s.number,
    'student_code', s.student_code,
    'avatar_path', to_jsonb(s) -> 'avatar_path'
  )
  from public.students s
  where s.id = p_student_id
$$;

revoke all on function public.qr_student_summary(uuid) from public, anon, authenticated;

create or replace function public.qr_submission_summary(p_submission public.assignment_submissions)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select case when p_submission.id is null then null else jsonb_build_object(
    'id', p_submission.id,
    'status', p_submission.status,
    'submitted_at', p_submission.submitted_at,
    'score', p_submission.score,
    'recorded_via', p_submission.recorded_via
  ) end
$$;

revoke all on function public.qr_submission_summary(public.assignment_submissions) from public, anon, authenticated;

-- Records ONE student's submission for ONE assignment. The caller has
-- already been authorized for the assignment (qr_require_assignment) and
-- the student resolved. Returns { outcome, student, submission,
-- deadline, server_time }.
--   recorded          — written now (new row, or a not_submitted/missing
--                       row promoted); submitted_at = now()
--   duplicate         — already submitted/late; nothing changed, the
--                       original submitted_at is kept
--   excused           — teacher excused this student; nothing changed
--   not_in_roster     — student is not in the assignment's classroom
--   assignment_closed — assignment archived or not accepting submissions
--   deadline_passed   — late and the policy is reject_late
create or replace function public.qr_record_submission(p_assignment public.assignments, p_student_id uuid, p_via text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := now();
  v_deadline timestamptz := public.assignment_effective_deadline(p_assignment);
  v_late boolean;
  v_status text;
  v_sub public.assignment_submissions;
  v_previous public.assignment_submissions;
  v_outcome text;
  v_actor uuid := public.qr_actor_profile_id();
  v_in_roster boolean;
begin
  v_in_roster := exists (
    select 1 from public.classroom_students cs
    where cs.classroom_id = p_assignment.classroom_id and cs.student_id = p_student_id
  );
  if not v_in_roster then
    -- No student details: this student may belong to another teacher.
    return jsonb_build_object('outcome', 'not_in_roster', 'server_time', v_now, 'deadline', v_deadline);
  end if;

  if p_assignment.is_archived or not p_assignment.accepting_submissions then
    return jsonb_build_object('outcome', 'assignment_closed', 'server_time', v_now, 'deadline', v_deadline,
      'student', public.qr_student_summary(p_student_id));
  end if;

  v_late := v_deadline is not null and v_now > v_deadline;
  if v_late and p_assignment.late_policy = 'reject_late' then
    select * into v_sub from public.assignment_submissions
     where assignment_id = p_assignment.id and student_id = p_student_id;
    -- Already submitted before the deadline: report it, never reject it.
    if v_sub.id is not null and v_sub.status in ('submitted', 'late') then
      return jsonb_build_object('outcome', 'duplicate', 'server_time', v_now, 'deadline', v_deadline,
        'student', public.qr_student_summary(p_student_id), 'submission', public.qr_submission_summary(v_sub));
    end if;
    return jsonb_build_object('outcome', 'deadline_passed', 'server_time', v_now, 'deadline', v_deadline,
      'student', public.qr_student_summary(p_student_id), 'submission', public.qr_submission_summary(v_sub));
  end if;

  v_status := case when v_late then 'late' else 'submitted' end;

  insert into public.assignment_submissions (assignment_id, student_id, status, submitted_at, recorded_via, recorded_by)
  values (p_assignment.id, p_student_id, v_status, v_now, p_via, v_actor)
  on conflict (assignment_id, student_id) do nothing
  returning * into v_sub;

  if v_sub.id is not null then
    v_outcome := 'recorded';
  else
    -- A row already exists: lock it so a concurrent scan from another
    -- device waits here and then sees this one's result.
    select * into v_previous from public.assignment_submissions
     where assignment_id = p_assignment.id and student_id = p_student_id
     for update;

    if v_previous.status in ('submitted', 'late') then
      return jsonb_build_object('outcome', 'duplicate', 'server_time', v_now, 'deadline', v_deadline,
        'student', public.qr_student_summary(p_student_id), 'submission', public.qr_submission_summary(v_previous));
    elsif v_previous.status = 'excused' then
      return jsonb_build_object('outcome', 'excused', 'server_time', v_now, 'deadline', v_deadline,
        'student', public.qr_student_summary(p_student_id), 'submission', public.qr_submission_summary(v_previous));
    end if;

    -- not_submitted / missing → record it now. Score and note are kept.
    update public.assignment_submissions
       set status = v_status, submitted_at = v_now, recorded_via = p_via, recorded_by = v_actor
     where id = v_previous.id
    returning * into v_sub;
    v_outcome := 'recorded';
  end if;

  insert into public.assignment_submission_events
    (assignment_id, student_id, event_type, previous_status, new_status, previous_submitted_at, new_submitted_at, actor_id)
  values
    (p_assignment.id, p_student_id,
     case when p_via = 'qr_scan' then 'scan_recorded' else 'manual_recorded' end,
     v_previous.status, v_sub.status, v_previous.submitted_at, v_sub.submitted_at, v_actor);

  return jsonb_build_object('outcome', v_outcome, 'server_time', v_now, 'deadline', v_deadline,
    'student', public.qr_student_summary(p_student_id), 'submission', public.qr_submission_summary(v_sub));
end;
$$;

revoke all on function public.qr_record_submission(public.assignments, uuid, text) from public, anon, authenticated;

-- Scan a student's QR for ONE selected assignment. p_qr_payload is the
-- scanned text: 'kcqr1' + 64 hex digits (or the bare 64 hex digits).
-- Unknown / malformed → invalid_qr; revoked → revoked_qr.
create or replace function public.record_submission_scan(p_assignment_id uuid, p_qr_payload text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_assignment public.assignments := public.qr_require_assignment(p_assignment_id);
  v_payload text := lower(btrim(coalesce(p_qr_payload, '')));
  v_token text;
  v_identity public.student_qr_identities;
begin
  if v_payload ~ '^kcqr1[0-9a-f]{64}$' then
    v_token := substr(v_payload, 6);
  elsif v_payload ~ '^[0-9a-f]{64}$' then
    v_token := v_payload;
  else
    return jsonb_build_object('outcome', 'invalid_qr', 'server_time', now());
  end if;

  select * into v_identity from public.student_qr_identities q where q.token = v_token;
  if v_identity.id is null then
    return jsonb_build_object('outcome', 'invalid_qr', 'server_time', now());
  end if;
  if v_identity.status <> 'active' then
    -- Name only when the student is in this assignment's classroom.
    return jsonb_build_object('outcome', 'revoked_qr', 'server_time', now(),
      'student', case when exists (
        select 1 from public.classroom_students cs
        where cs.classroom_id = v_assignment.classroom_id and cs.student_id = v_identity.student_id
      ) then public.qr_student_summary(v_identity.student_id) end);
  end if;

  return public.qr_record_submission(v_assignment, v_identity.student_id, 'qr_scan');
end;
$$;

revoke all on function public.record_submission_scan(uuid, text) from public, anon;
grant execute on function public.record_submission_scan(uuid, text) to authenticated;

-- Manual fallback (no QR available): the same rules, by student id.
create or replace function public.record_submission_manual(p_assignment_id uuid, p_student_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_assignment public.assignments := public.qr_require_assignment(p_assignment_id);
begin
  return public.qr_record_submission(v_assignment, p_student_id, 'teacher_manual');
end;
$$;

revoke all on function public.record_submission_manual(uuid, uuid) from public, anon;
grant execute on function public.record_submission_manual(uuid, uuid) to authenticated;

-- Explicit, audited correction of a submission status (wrong student
-- scanned, excuse a student, …). The reason is required and stored in
-- assignment_submission_events with the previous values. Never changes
-- the score or note. submitted_at is kept for submitted/late and cleared
-- for not_submitted/missing/excused (the old value stays in the audit
-- row). A student no longer in the classroom can still be corrected if a
-- submission row already exists.
create or replace function public.correct_submission_status(
  p_assignment_id uuid,
  p_student_id uuid,
  p_status text,
  p_reason text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_assignment public.assignments := public.qr_require_assignment(p_assignment_id);
  v_reason text := btrim(coalesce(p_reason, ''));
  v_actor uuid := public.qr_actor_profile_id();
  v_previous public.assignment_submissions;
  v_sub public.assignment_submissions;
  v_submitted_at timestamptz;
begin
  if p_status is null or p_status not in ('not_submitted', 'submitted', 'late', 'missing', 'excused') then
    raise exception 'สถานะไม่ถูกต้อง' using errcode = '22023';
  end if;
  if char_length(v_reason) < 3 then
    raise exception 'กรุณาระบุเหตุผลในการแก้ไข' using errcode = '22023';
  end if;
  if char_length(v_reason) > 500 then
    raise exception 'เหตุผลยาวเกิน 500 ตัวอักษร' using errcode = '22023';
  end if;

  select * into v_previous from public.assignment_submissions
   where assignment_id = v_assignment.id and student_id = p_student_id
   for update;

  if v_previous.id is null then
    if not exists (
      select 1 from public.classroom_students cs
      where cs.classroom_id = v_assignment.classroom_id and cs.student_id = p_student_id
    ) then
      raise exception 'นักเรียนคนนี้ไม่ได้อยู่ในห้องเรียนของงานนี้' using errcode = '42501';
    end if;
  elsif v_previous.status = p_status then
    return jsonb_build_object('outcome', 'unchanged', 'server_time', now(),
      'student', public.qr_student_summary(p_student_id), 'submission', public.qr_submission_summary(v_previous));
  end if;

  v_submitted_at := case when p_status in ('submitted', 'late') then v_previous.submitted_at end;

  if v_previous.id is null then
    insert into public.assignment_submissions (assignment_id, student_id, status, submitted_at, recorded_via, recorded_by)
    values (v_assignment.id, p_student_id, p_status, v_submitted_at, 'teacher_correction', v_actor)
    returning * into v_sub;
  else
    update public.assignment_submissions
       set status = p_status, submitted_at = v_submitted_at, recorded_via = 'teacher_correction', recorded_by = v_actor
     where id = v_previous.id
    returning * into v_sub;
  end if;

  insert into public.assignment_submission_events
    (assignment_id, student_id, event_type, previous_status, new_status, previous_submitted_at, new_submitted_at, reason, actor_id)
  values
    (v_assignment.id, p_student_id, 'status_corrected', v_previous.status, v_sub.status,
     v_previous.submitted_at, v_sub.submitted_at, v_reason, v_actor);

  return jsonb_build_object('outcome', 'corrected', 'server_time', now(),
    'student', public.qr_student_summary(p_student_id), 'submission', public.qr_submission_summary(v_sub));
end;
$$;

revoke all on function public.correct_submission_status(uuid, uuid, text, text) from public, anon;
grant execute on function public.correct_submission_status(uuid, uuid, text, text) to authenticated;
