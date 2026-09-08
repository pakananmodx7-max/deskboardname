-- AI Classroom Management — Student Portal: classroom-scoped account
-- linking lookup.
-- See docs/DATABASE.md for the full explanation.
--
-- Fixes a real usability bug in 0008's find_student_for_link(student_code):
-- student_code is NOT unique across the whole `students` table by design
-- (0001's "student_code duplicate strategy" explicitly rejected forcing
-- global uniqueness — each teacher numbers their own roster
-- independently, so the same code, e.g. "04103", can legitimately belong
-- to a different student in a different classroom). Any such collision
-- made 0008's RPC raise "พบรหัสนักเรียนนี้มากกว่าหนึ่งคน" for every one of
-- those students, permanently blocking account linking for all of them —
-- not a security bug, but a real dead end. This migration fixes it by
-- scoping the lookup key to student_code + classroom, exactly what
-- actually identifies a student in this schema, instead of student_code
-- alone.
--
-- This migration has NOT been applied to a live database yet — do NOT
-- run it automatically. 0008 has already been applied and is
-- deliberately left untouched: this migration only ADDS new function
-- objects and revokes EXECUTE on the one now-superseded function; it
-- changes nothing that already shipped in 0008.

-- ==================================================
-- list_classrooms_for_student_code: secure minimal classroom selector
--
-- Backs the classroom dropdown on /student/link-account. Deliberately
-- NOT "list every classroom in the system" — returning the full
-- classroom directory (every class name run by every teacher in the
-- school) to any signed-in student account would be a real information
-- leak, well beyond what linking requires. Instead this returns only
-- classrooms that currently contain an UNLINKED student with the given
-- student_code — exactly the "which one is me?" choices the student
-- genuinely needs, and nothing else. A student account has no baseline
-- SELECT access to `classrooms` at all (0001's classrooms_select_own is
-- teacher-only) — SECURITY DEFINER is what lets this narrow,
-- purpose-built query see across teachers for this one specific
-- purpose, same bootstrapping pattern as student_link_target_valid
-- (0008).
--
-- Returns classroom_id + classroom_name ONLY — never teacher_id,
-- is_active, academic_year, section, or any other classrooms column, and
-- never anything from students, classroom_students, attendance,
-- assignments, or grades. An empty result (bad/unknown code, or a code
-- that only matches already-linked students) looks identical either
-- way — same "don't reveal more than necessary" posture
-- find_student_for_link already takes in 0008.
-- ==================================================

create or replace function public.list_classrooms_for_student_code(p_student_code text)
returns table (classroom_id uuid, classroom_name text)
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  v_code text := nullif(trim(p_student_code), '');
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

  return query
  select distinct c.id, c.name
  from public.students s
  join public.classroom_students cs on cs.student_id = s.id
  join public.classrooms c on c.id = cs.classroom_id
  where s.student_code = v_code and s.linked_profile_id is null
  order by c.name;
end;
$$;

revoke all on function public.list_classrooms_for_student_code(text) from public;
grant execute on function public.list_classrooms_for_student_code(text) to authenticated;

-- ==================================================
-- find_student_for_link_in_classroom: classroom-scoped secure lookup
--
-- Replaces find_student_for_link(text) (0008) as the RPC the frontend
-- actually calls (see the revoke below) — same security posture,
-- narrowed identity key from student_code alone to
-- (student_code, classroom_id), which is what actually uniquely
-- identifies a student row in this schema (student_code is only
-- guaranteed unique WITHIN one classroom's currently-enrolled roster,
-- never across the whole table — see 0001).
--
-- Verifies through students -> classroom_students -> classrooms exactly
-- as required: a match must be an unlinked student whose student_code
-- equals the input AND who is currently enrolled (via classroom_students)
-- in the given classroom_id. Still refuses to guess: if more than one
-- unlinked student in the SAME classroom somehow shares the same
-- student_code (a data-quality edge case — student_code was deliberately
-- never made unique by any constraint), this raises instead of returning
-- an arbitrary match, exactly like 0008's original ambiguity guard, just
-- re-scoped to "within this classroom" instead of "in the whole table".
--
-- Returns exactly the minimal confirmation fields required: student_id,
-- student_code, first_name, last_name, and the classroom_name of the
-- classroom the student selected (echoed back for the confirmation
-- screen) — never the roster, never the teacher, never any other
-- student's data. student_code is safe to return here (unlike 0008,
-- which withheld it): the caller already typed it themselves to reach
-- this point, and it is no longer, by itself, the whole lookup key.
-- ==================================================

create or replace function public.find_student_for_link_in_classroom(
  p_student_code text,
  p_classroom_id uuid
)
returns table (
  student_id uuid,
  student_code text,
  first_name text,
  last_name text,
  classroom_name text
)
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  v_code text := nullif(trim(p_student_code), '');
  v_match_count integer;
  v_classroom_name text;
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

  if p_classroom_id is null then
    raise exception 'กรุณาเลือกห้องเรียน' using errcode = '22023';
  end if;

  select count(*) into v_match_count
  from public.students s
  join public.classroom_students cs on cs.student_id = s.id
  where cs.classroom_id = p_classroom_id
    and s.student_code = v_code
    and s.linked_profile_id is null;

  if v_match_count = 0 then
    return;
  end if;

  if v_match_count > 1 then
    raise exception 'พบรหัสนักเรียนนี้มากกว่าหนึ่งคนในห้องเรียนนี้ กรุณาติดต่อครูผู้สอนเพื่อขอความช่วยเหลือ' using errcode = '22023';
  end if;

  select c.name into v_classroom_name
  from public.classrooms c
  where c.id = p_classroom_id;

  return query
  select s.id, s.student_code, s.first_name, s.last_name, v_classroom_name
  from public.students s
  join public.classroom_students cs on cs.student_id = s.id
  where cs.classroom_id = p_classroom_id
    and s.student_code = v_code
    and s.linked_profile_id is null;
end;
$$;

revoke all on function public.find_student_for_link_in_classroom(text, uuid) from public;
grant execute on function public.find_student_for_link_in_classroom(text, uuid) to authenticated;

-- ==================================================
-- Retire find_student_for_link(text) (0008) as a callable entrypoint.
--
-- Left in place, unmodified — 0008 is not edited by this migration —
-- but EXECUTE is revoked from `authenticated`. The frontend now calls
-- find_student_for_link_in_classroom exclusively. This closes the one
-- behavioral gap that would otherwise remain: the old single-argument
-- RPC would still succeed whenever a student_code happens to be globally
-- unique across the WHOLE table (true for most codes — just not
-- "04103"-style collisions), silently accepting a lookup that bypassed
-- the classroom disambiguation this migration exists to enforce.
-- Revoking EXECUTE (rather than dropping the function) is deliberately
-- the smallest possible change: no DROP of anything 0008 shipped, fully
-- reversible by a future `grant execute ... to authenticated` if ever
-- needed again.
-- ==================================================

revoke execute on function public.find_student_for_link(text) from authenticated;
