-- AI Classroom Management — Student Portal Phase 1: account linking +
-- teacher approval.
-- See docs/DATABASE.md for the full schema explanation and RLS rationale.
--
-- Builds on 0001_init.sql (profiles, classrooms, students, classroom_students)
-- and 0003_auth_profile.sql (handle_new_user, the auth signup trigger).
-- This migration has NOT been applied to a live database yet — do NOT run
-- it automatically. It is safe to edit in place if a review finds issues
-- before it is ever run.
--
-- Scope: a student gets their own Supabase Auth account (separate from
-- their teacher-created `students` row) and REQUESTS to be linked to
-- their existing `students` record by entering their student_code. That
-- request sits pending until a teacher who actually teaches that student
-- (owns a classroom the student currently belongs to) approves or
-- rejects it. Only approval — never the request itself — establishes the
-- permanent link (`students.linked_profile_id`). There is no auto-link
-- by student_code anywhere in this migration.
--
-- Ordering: the `students.linked_profile_id` column and its protection
-- trigger come first (a small, self-contained ALTER), then the new
-- request table + its own helper function + RLS, then the `profiles`
-- policy addition, then `handle_new_user`'s update, then the lookup/
-- approve/reject RPCs last (they reference everything above).

-- ==================================================
-- students.linked_profile_id — the permanent link
--
-- Nullable: most students never sign up at all in this phase, or haven't
-- been approved yet. `on delete set null` (not cascade): if a student's
-- linked auth account is ever deleted, the underlying student academic
-- record must survive untouched — same "never lose the student record"
-- philosophy as students.created_by (0001).
-- ==================================================

alter table public.students
  add column if not exists linked_profile_id uuid references public.profiles (id) on delete set null;

-- SECURITY: "one auth account = maximum one approved student." A partial
-- unique index (not a plain column-level UNIQUE) so that the common case
-- — thousands of students with linked_profile_id still null — never
-- collide with each other; only actual (non-null) links are constrained
-- to be 1:1. "One student = maximum one approved account" is already
-- structurally true: linked_profile_id is a single column on a single
-- students row, so it can only ever hold one value at a time.
create unique index if not exists students_linked_profile_id_unique_idx
  on public.students (linked_profile_id)
  where linked_profile_id is not null;

-- SECURITY: protects linked_profile_id from being changed by anything
-- except approve_student_link_request below. Without this, a teacher's
-- existing students_update_via_classroom policy (0001) — which
-- authorizes editing ANY column of a student they teach, not scoped to
-- specific columns — would let a teacher directly `UPDATE students SET
-- linked_profile_id = <any profile id>` for any of their own students,
-- completely bypassing the request/approval workflow this migration
-- exists to enforce (no requested_by consent trail, no
-- classroom-ownership re-check at the moment of linking, and no
-- "already claimed elsewhere" race check).
--
-- Uses `current_user = 'authenticated'`, NOT
-- `current_setting('role', true) = 'authenticated'` the way
-- protect_profile_privileged_fields (0003) guards profiles.role. This is
-- a deliberate, empirically-verified difference, not an inconsistency:
-- protect_profile_privileged_fields only ever needs to distinguish a
-- normal PostgREST client session (role = 'authenticated') from a
-- service_role/superuser session — it is never called from inside a
-- SECURITY DEFINER function anywhere in this schema (handle_new_user, the
-- only function that would need to bypass it, does a plain INSERT, which
-- a BEFORE UPDATE trigger never even fires for). This trigger's bypass
-- case is different: approve_student_link_request below IS a SECURITY
-- DEFINER function that needs to perform exactly the UPDATE this trigger
-- would otherwise block. Verified locally against Postgres 16 that
-- `current_setting('role', true)` stays 'authenticated' for the entire
-- duration of a SECURITY DEFINER call (SECURITY DEFINER does not do a
-- `SET ROLE`-equivalent change to the `role` GUC) — so that check would
-- have also blocked our own trusted RPC's UPDATE, silently breaking
-- approval entirely. `current_user`, by contrast, DOES change to the
-- function's owner for the duration of a SECURITY DEFINER call (this is
-- exactly what SECURITY DEFINER means), which is what PostgREST's own
-- `SET ROLE authenticated` (done once per request, before any function
-- call) relies on for privilege checks in the first place — so
-- `current_user = 'authenticated'` correctly reads as "true for a normal
-- client request, false for anything running inside a SECURITY DEFINER
-- function owned by a different role."
create or replace function public.protect_students_linked_profile_id()
returns trigger
language plpgsql
as $$
begin
  if current_user = 'authenticated' and new.linked_profile_id is distinct from old.linked_profile_id then
    raise exception 'ไม่สามารถแก้ไขการเชื่อมบัญชีนักเรียนได้โดยตรง ต้องผ่านขั้นตอนการอนุมัติ' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_students_linked_profile_id on public.students;

create trigger protect_students_linked_profile_id
  before update on public.students
  for each row
  execute function public.protect_students_linked_profile_id();

-- ==================================================
-- student_account_link_requests
-- One row per link request a student's auth account submits for a
-- specific students.id. NOT one row per student — a student may have a
-- history of requests (e.g. one rejected, then a corrected retry), all
-- kept for audit (no hard delete, matching every other table in this
-- schema — a rejected request stays as review_note history, not erased).
--
-- Deliberately does NOT store classroom_id: which teacher(s) may see and
-- act on a request is derived dynamically, at query/RPC time, from the
-- student's CURRENT classroom_students membership (same "recompute from
-- the live relationship, don't snapshot it" choice as
-- students_select_via_classroom in 0001). Known consequence, accepted for
-- this phase: if a student is removed from every classroom after
-- submitting a request, that request becomes invisible/unapprovable
-- until they're re-enrolled somewhere — an edge case, not a security
-- issue (nobody gains access; the request just stalls).
-- ==================================================

create table if not exists public.student_account_link_requests (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students (id) on delete cascade,
  requested_by uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  -- Audit trail only, same role as assignments.created_by (0006) — never
  -- the authorization boundary. `set null` so deleting a teacher profile
  -- is never blocked by, nor destroys, the history of what they reviewed.
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists student_account_link_requests_student_id_idx
  on public.student_account_link_requests (student_id);
create index if not exists student_account_link_requests_requested_by_idx
  on public.student_account_link_requests (requested_by);
create index if not exists student_account_link_requests_status_idx
  on public.student_account_link_requests (status);

-- SECURITY: at most ONE pending request per requesting account. Without
-- this, a student account could spray pending requests at many different
-- student_ids simultaneously, hoping an inattentive teacher approves the
-- wrong one; with it, they must wait for their current request to be
-- resolved (approved/rejected) before submitting another.
create unique index if not exists student_account_link_requests_one_pending_per_requester_idx
  on public.student_account_link_requests (requested_by)
  where status = 'pending';

-- SECURITY: at most ONE pending request per target student, from ANYONE.
-- Without this, two different accounts (e.g. two students, or someone
-- who obtained/guessed another student's code) could both have live
-- pending requests claiming the same students.id at once, leaving the
-- reviewing teacher with an ambiguous queue and no signal that something
-- is wrong. The first pending request for a given student must be
-- resolved before a second can be submitted for that same student.
create unique index if not exists student_account_link_requests_one_pending_per_student_idx
  on public.student_account_link_requests (student_id)
  where status = 'pending';

create trigger set_student_account_link_requests_updated_at
  before update on public.student_account_link_requests
  for each row
  execute function public.set_updated_at();

-- ==================================================
-- Authorization helper: student_link_target_valid
--
-- Same bootstrapping problem, same fix, as is_student_creator (0001):
-- the student_account_link_requests INSERT policy below needs to check
-- "does this students.id exist and is it not already linked to someone,"
-- but the calling account (role = 'student') has NO SELECT visibility
-- into `students` at all under this schema's RLS (students_select_via_classroom
-- only ever grants visibility to teachers) — a plain subquery from
-- inside the policy would always see zero rows and block every request,
-- valid or not. This narrowly-scoped SECURITY DEFINER function answers
-- exactly one boolean question and returns nothing else: no row data, no
-- "which student" enumeration surface (it takes the id as a parameter,
-- it doesn't search).
-- ==================================================

create or replace function public.student_link_target_valid(p_student_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.students s
    where s.id = p_student_id and s.linked_profile_id is null
  );
$$;

revoke all on function public.student_link_target_valid(uuid) from public;
grant execute on function public.student_link_target_valid(uuid) to authenticated;

-- ==================================================
-- RLS: student_account_link_requests
-- ==================================================

alter table public.student_account_link_requests enable row level security;

-- A student sees their own request history. A teacher sees requests for
-- students CURRENTLY in one of their own classrooms (derived, not
-- stored — see table comment above), regardless of that request's
-- status, so a teacher can also see what they've already approved/
-- rejected, not only the pending queue.
create policy "student_account_link_requests_select_own_or_teacher"
  on public.student_account_link_requests for select
  using (
    requested_by = auth.uid()
    or exists (
      select 1
      from public.classroom_students cs
      join public.classrooms c on c.id = cs.classroom_id
      where cs.student_id = student_account_link_requests.student_id
        and c.teacher_id = auth.uid()
    )
  );

-- Mirrors classroom_students_insert_admin (0001): approve_student_link_request
-- and reject_student_link_request already let an admin act on ANY
-- request regardless of classroom ownership, but that RPC-level override
-- alone would leave an admin with no way to SEE which requests exist to
-- act on in the first place (their own SELECT queries would be
-- RLS-filtered down to nothing, same as any other role) — this policy
-- closes that gap for consistency, as its own separate, explicit,
-- auditable policy rather than folding it into the rule above.
create policy "student_account_link_requests_select_admin"
  on public.student_account_link_requests for select
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

-- SECURITY: creating a request requires ALL of:
--   1. requested_by is honestly the caller (never forged to submit a
--      request "as" another account),
--   2. the caller's own profile is actually role = 'student' — a
--      teacher/admin account has no legitimate reason to submit a link
--      request, and this closes that off entirely rather than relying on
--      the UI to simply not offer the button,
--   3. status is 'pending' and reviewed_by/reviewed_at are both null —
--      SECURITY-CRITICAL: without this, a client could INSERT a row with
--      status='approved' and reviewed_by=auth.uid() directly, achieving
--      instant self-approval by construction, completely bypassing the
--      entire point of this table. This is the literal enforcement of
--      "students must never be able to approve themselves" at the
--      database level (independent of, and in addition to, the fact that
--      there is no UPDATE policy on this table at all — see below),
--   4. student_link_target_valid(student_id) — the target actually
--      exists and isn't already claimed by someone else.
-- The "at most one pending request" invariants are enforced by the two
-- partial unique indexes above, not by this policy.
create policy "student_account_link_requests_insert_own"
  on public.student_account_link_requests for insert
  with check (
    requested_by = auth.uid()
    and status = 'pending'
    and reviewed_by is null
    and reviewed_at is null
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'student'
    )
    and public.student_link_target_valid(student_id)
  );

-- SECURITY: deliberately NO update policy and NO delete policy on this
-- table, for ANY role — not students, not teachers. This is a stronger
-- guarantee than an RLS UPDATE policy could give: it means there is
-- categorically no client-reachable path (direct or forged) that can
-- ever transition a request's status, for anyone. The only two ways a
-- request's status can change are the two SECURITY DEFINER functions
-- below (approve_student_link_request, reject_student_link_request),
-- each of which independently re-verifies the caller is a teacher who
-- actually owns a classroom containing the target student (or an admin)
-- before touching anything. "Students must never be able to approve
-- themselves" holds even if every other check in this migration had a
-- bug, purely because students (or anyone) have no UPDATE grant path to
-- this table at all.

-- ==================================================
-- Authorization helper: teacher_can_view_link_requester
--
-- Same bootstrapping/recursion problem as is_student_creator and
-- has_existing_classroom_link (0001), confirmed empirically rather than
-- assumed: a `profiles` SELECT policy containing a raw subquery that
-- touches `classroom_students` causes Postgres to raise "infinite
-- recursion detected in policy for relation classroom_students" the
-- moment ANY insert into classroom_students happens elsewhere in the
-- app (verified locally against Postgres 16 — classroom_students_insert_own's
-- WITH CHECK calls has_existing_classroom_link/is_student_creator, and
-- having a SEPARATE, otherwise-unrelated policy on `profiles` that also
-- reaches into classroom_students is enough to trip Postgres's RLS
-- recursion guard for that unrelated statement, even though nothing in
-- classroom_students_insert_own's own policy text mentions `profiles`).
-- Wrapping the check in this narrowly-scoped SECURITY DEFINER function —
-- exactly the same fix already used twice in 0001 for this exact class of
-- problem — resolves it. No row data leak: boolean only, one specific
-- profile id in, no search/enumeration surface.
-- ==================================================

create or replace function public.teacher_can_view_link_requester(p_profile_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.student_account_link_requests r
    join public.classroom_students cs on cs.student_id = r.student_id
    join public.classrooms c on c.id = cs.classroom_id
    where r.requested_by = p_profile_id
      and c.teacher_id = auth.uid()
  );
$$;

revoke all on function public.teacher_can_view_link_requester(uuid) from public;
grant execute on function public.teacher_can_view_link_requester(uuid) to authenticated;

-- ==================================================
-- RLS: profiles — narrow additional visibility for reviewing a request
--
-- A teacher approving/rejecting a request needs to see basic identity
-- info (display name, email) for the REQUESTING account (profiles row
-- keyed by requested_by) to sanity-check "is this plausibly my student
-- signing up." Under 0001's profiles_select_own alone, a teacher has
-- ZERO visibility into any other account's profile row — this adds one
-- narrow, additive policy (Postgres OR's multiple permissive SELECT
-- policies together; profiles_select_own is untouched) granting exactly
-- that: a teacher may see a profile row P only if P has ever submitted a
-- student_account_link_request for a student currently in one of the
-- teacher's own classrooms. No broader "teachers can browse all
-- profiles" access is introduced.
-- ==================================================

create policy "profiles_select_via_link_request"
  on public.profiles for select
  using (public.teacher_can_view_link_requester(profiles.id));

-- ==================================================
-- handle_new_user (0003) — opt-in role = 'student' at signup
--
-- THREAT MODEL for trusting new.raw_user_meta_data ->> 'intended_role'
-- here, given 0003's header comment explicitly warns that `role` must
-- NEVER be read from client-supplied signup data: that warning is about
-- PRIVILEGE ESCALATION (a client asking for 'admin' or 'teacher' when it
-- shouldn't get either). This code path is narrower and categorically
-- safe from that same class of attack:
--   - The ONLY string this ever honors is the literal 'student' — there
--     is no third branch, no dynamic lookup, no way for ANY other value
--     (missing, 'admin', 'teacher', arbitrary garbage) to produce
--     anything other than the original unconditional 'teacher' default.
--     This is a hard allowlist of exactly one value, not a general
--     trust of client input.
--   - 'student' is STRICTLY LOWER-privileged than 'teacher' in every RLS
--     policy in this entire schema — a 'student' profile cannot create
--     classrooms, cannot see any classroom/student/attendance/
--     assignment/grade data, and can only ever (a) read/edit its own
--     profile row and (b) insert its own student_account_link_requests
--     row (itself further gated by role = 'student' in that table's own
--     INSERT policy above). A client "escalating" itself from the
--     default 'teacher' down to 'student' gains nothing — if anything it
--     loses the ability to create classrooms it would otherwise have had.
--   - This only ever runs at the moment of a brand-new auth.users INSERT
--     (signup). It cannot be used to change an EXISTING account's role —
--     signing in again never re-fires this trigger.
-- Net effect: this is a safe, narrow self-service "I am a student, not a
-- teacher" signal, not a reopening of the escalation gap 0003 closed.
-- ==================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text;
begin
  if new.raw_user_meta_data ->> 'intended_role' = 'student' then
    v_role := 'student';
  else
    v_role := 'teacher';
  end if;

  insert into public.profiles (id, email, display_name, role)
  values (
    new.id,
    new.email,
    nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
    v_role
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

-- ==================================================
-- find_student_for_link: secure minimal lookup RPC
--
-- SECURITY: this is the ONLY way a student account can ever query
-- anything about the students table — it is not a general search (no
-- name/partial-match lookup, exact student_code equality only), it
-- requires the caller to already be authenticated AND already hold a
-- role = 'student' profile (closes this off to teachers/admins probing
-- other teachers' rosters), it returns only the three fields needed to
-- let the student confirm "is this me" (id, first_name, last_name) —
-- never student_code, email, phone, or anything else on the row — and it
-- silently excludes any student already linked to somebody
-- (linked_profile_id is not null) rather than revealing "that code
-- exists but is taken," which would leak more than necessary to an
-- unauthorized prober. An exact-code match against MULTIPLE unlinked
-- students (student_code is NOT unique in this schema — see 0001's
-- "student_code duplicate strategy") is treated as an error rather than
-- silently returning an arbitrary one of them, so a request can never be
-- submitted against the wrong student by accident.
-- ==================================================

create or replace function public.find_student_for_link(p_student_code text)
returns table (student_id uuid, first_name text, last_name text)
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  v_code text := nullif(trim(p_student_code), '');
  v_match_count integer;
begin
  if auth.uid() is null then
    raise exception 'กรุณาเข้าสู่ระบบก่อนใช้งาน' using errcode = '28000';
  end if;

  if not exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'student'
  ) then
    raise exception 'เฉพาะบัญชีนักเรียนเท่านั้นที่ใช้งานฟังก์ชันนี้ได้' using errcode = '42501';
  end if;

  if v_code is null then
    raise exception 'กรุณากรอกรหัสนักเรียน' using errcode = '22023';
  end if;

  select count(*) into v_match_count
  from public.students s
  where s.student_code = v_code and s.linked_profile_id is null;

  if v_match_count = 0 then
    return;
  end if;

  if v_match_count > 1 then
    raise exception 'พบรหัสนักเรียนนี้มากกว่าหนึ่งคน กรุณาติดต่อครูผู้สอนเพื่อขอความช่วยเหลือ' using errcode = '22023';
  end if;

  return query
  select s.id, s.first_name, s.last_name
  from public.students s
  where s.student_code = v_code and s.linked_profile_id is null;
end;
$$;

revoke all on function public.find_student_for_link(text) from public;
grant execute on function public.find_student_for_link(text) to authenticated;

-- ==================================================
-- approve_student_link_request / reject_student_link_request
--
-- Both SECURITY DEFINER — deliberately NOT the SECURITY INVOKER choice
-- create_student_and_enroll (0001) made, because there is intentionally
-- NO RLS UPDATE policy on student_account_link_requests for these to
-- lean on (see the RLS section above: that absence IS the security
-- control). Each function performs its own explicit authorization check
-- in PL/pgSQL instead: caller must be a teacher/admin, and either an
-- admin or someone who owns a classroom the target student currently
-- belongs to. `select ... for update` locks the request row for the rest
-- of the transaction, closing the race where two teachers (or the same
-- teacher, double-clicking) try to approve/reject the same pending
-- request concurrently — the second call simply finds status <> 'pending'
-- once the lock releases and raises instead of double-processing it.
-- ==================================================

create or replace function public.approve_student_link_request(p_request_id uuid)
returns public.student_account_link_requests
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request public.student_account_link_requests;
  v_authorized boolean;
begin
  if auth.uid() is null then
    raise exception 'กรุณาเข้าสู่ระบบก่อนใช้งาน' using errcode = '28000';
  end if;

  if not exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('teacher', 'admin')
  ) then
    raise exception 'ไม่มีสิทธิ์อนุมัติคำขอ' using errcode = '42501';
  end if;

  select * into v_request
  from public.student_account_link_requests
  where id = p_request_id
  for update;

  if v_request.id is null then
    raise exception 'ไม่พบคำขอนี้' using errcode = 'P0002';
  end if;

  if v_request.status <> 'pending' then
    raise exception 'คำขอนี้ถูกดำเนินการไปแล้ว' using errcode = '22023';
  end if;

  select
    exists (
      select 1
      from public.classroom_students cs
      join public.classrooms c on c.id = cs.classroom_id
      where cs.student_id = v_request.student_id
        and c.teacher_id = auth.uid()
    )
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  into v_authorized;

  if not v_authorized then
    raise exception 'คุณไม่มีสิทธิ์อนุมัติคำขอของนักเรียนคนนี้' using errcode = '42501';
  end if;

  -- Re-check the requester is still genuinely a student account and the
  -- target hasn't been claimed by someone else since the request was
  -- submitted — both defense-in-depth against state changing between
  -- request and review, on top of what the unique indexes already
  -- guarantee.
  if not exists (
    select 1 from public.profiles p
    where p.id = v_request.requested_by and p.role = 'student'
  ) then
    raise exception 'บัญชีผู้ขอไม่ใช่บัญชีนักเรียนแล้ว' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.students s
    where s.id = v_request.student_id and s.linked_profile_id is not null
  ) then
    raise exception 'นักเรียนคนนี้เชื่อมบัญชีไปแล้ว' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.students s
    where s.linked_profile_id = v_request.requested_by
  ) then
    raise exception 'บัญชีนี้เชื่อมกับนักเรียนคนอื่นไปแล้ว' using errcode = '22023';
  end if;

  update public.students
  set linked_profile_id = v_request.requested_by
  where id = v_request.student_id;

  update public.student_account_link_requests
  set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now()
  where id = p_request_id
  returning * into v_request;

  -- One auth account can only ever end up with one approved student, so
  -- any OTHER pending request from this same requester can never be
  -- approved anyway (student_link_target_valid / the "already claimed
  -- elsewhere" check above would reject it) — auto-rejecting them now
  -- avoids leaving stale, permanently-unapprovable rows sitting in a
  -- teacher's pending queue.
  update public.student_account_link_requests
  set status = 'rejected',
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      review_note = 'ปฏิเสธอัตโนมัติ: บัญชีนี้เชื่อมกับนักเรียนคนอื่นแล้ว'
  where requested_by = v_request.requested_by
    and status = 'pending'
    and id <> v_request.id;

  return v_request;
end;
$$;

revoke all on function public.approve_student_link_request(uuid) from public;
grant execute on function public.approve_student_link_request(uuid) to authenticated;

create or replace function public.reject_student_link_request(p_request_id uuid, p_note text default null)
returns public.student_account_link_requests
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request public.student_account_link_requests;
  v_authorized boolean;
begin
  if auth.uid() is null then
    raise exception 'กรุณาเข้าสู่ระบบก่อนใช้งาน' using errcode = '28000';
  end if;

  if not exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('teacher', 'admin')
  ) then
    raise exception 'ไม่มีสิทธิ์ปฏิเสธคำขอ' using errcode = '42501';
  end if;

  select * into v_request
  from public.student_account_link_requests
  where id = p_request_id
  for update;

  if v_request.id is null then
    raise exception 'ไม่พบคำขอนี้' using errcode = 'P0002';
  end if;

  if v_request.status <> 'pending' then
    raise exception 'คำขอนี้ถูกดำเนินการไปแล้ว' using errcode = '22023';
  end if;

  select
    exists (
      select 1
      from public.classroom_students cs
      join public.classrooms c on c.id = cs.classroom_id
      where cs.student_id = v_request.student_id
        and c.teacher_id = auth.uid()
    )
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  into v_authorized;

  if not v_authorized then
    raise exception 'คุณไม่มีสิทธิ์ปฏิเสธคำขอของนักเรียนคนนี้' using errcode = '42501';
  end if;

  update public.student_account_link_requests
  set status = 'rejected',
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      review_note = nullif(trim(p_note), '')
  where id = p_request_id
  returning * into v_request;

  return v_request;
end;
$$;

revoke all on function public.reject_student_link_request(uuid, text) from public;
grant execute on function public.reject_student_link_request(uuid, text) to authenticated;

-- ==================================================
-- Future relationship (not implemented yet, documented for reference):
--
--   auth.users --> profiles (role='student')
--                     |
--                     v (via approve_student_link_request)
--   student_account_link_requests --> students.linked_profile_id
--                                          |
--                                          v
--                                   classroom_students / attendance /
--                                   assignment_submissions (Phase 2:
--                                   the real Student Dashboard reads
--                                   FROM students.linked_profile_id =
--                                   auth.uid() — deliberately not built
--                                   in this phase)
-- ==================================================
