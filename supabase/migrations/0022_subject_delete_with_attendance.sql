-- AI Classroom Management — Permanent subject delete now also removes the
-- subject's OWN attendance history ("ลบรายวิชาและข้อมูลทั้งหมด" including
-- การเช็คชื่อ).
--
-- Builds on 0004_attendance.sql / 0005_subject_attendance.sql
-- (attendance_sessions, attendance_records), 0002 (subjects), and
-- 0021_lesson_subject_delete.sql (subjects_delete_own). 0001-0021 have
-- already been applied — 0019, 0020 and 0021 are applied to PRODUCTION
-- and are NOT edited here. This migration only ADDS one RPC. No table,
-- column, index, existing policy, trigger, or FK action is altered.
--
-- ==================================================
-- PROBLEM THIS SOLVES
--
-- 0021 made subjects deletable by their owner, but
-- attendance_sessions.subject_id has been `on delete restrict` since
-- 0004, so any subject with even one recorded เช็คชื่อ session could not
-- be deleted at all (the whole DELETE was rejected with SQLSTATE 23503
-- and subject-service.ts refused up front with a Thai message). The
-- product decision is now: when the teacher explicitly confirms the
-- (strengthened) "ลบรายวิชาและข้อมูลทั้งหมด" dialog, attendance history
-- that belongs ONLY to that subject is deleted together with the subject.
--
-- ==================================================
-- AUDIT PERFORMED BEFORE WRITING THIS MIGRATION — the complete attendance
-- dependency graph, as it exists after 0001-0021:
--
--   attendance_sessions.classroom_id -> classrooms.id   on delete cascade  (0004)
--   attendance_sessions.subject_id   -> subjects.id     on delete RESTRICT (0004) *
--   attendance_sessions.created_by   -> profiles.id     on delete set null (0004)
--   attendance_records.attendance_session_id
--                                    -> attendance_sessions.id on delete cascade (0004)
--   attendance_records.student_id    -> students.id     on delete RESTRICT (0004)
--
--   No other table references attendance_sessions or attendance_records
--   (verified across every migration file: 0012's notifications and
--   0008/0009's student links reference neither). No trigger fires on
--   either table except set_updated_at.
--
--   RLS on attendance_sessions / attendance_records: SELECT/INSERT/UPDATE
--   for the owning teacher (0004/0005), SELECT for linked students
--   (0011/0014). There is deliberately NO DELETE policy on either table
--   ("attendance is never hard-deleted through the app", 0004).
--
-- Subject-scoped vs. not: a session with subject_id = X belongs to
-- subject X and exactly one classroom. Homeroom sessions (subject_id is
-- null) and sessions of every other subject — including other subjects
-- taught to the SAME classroom — are untouched by `where subject_id = X`.
-- attendance_records never reference a subject directly; they belong to
-- a session, and cascade away with it (0004's existing FK).
--
-- ==================================================
-- DESIGN DECISIONS
--
-- 1. The RESTRICT FK is NOT changed to CASCADE. It still protects
--    against every OTHER path that could delete a subject (a raw DELETE
--    through subjects_delete_own, a future admin script, etc.): attendance
--    can only disappear through this one explicit, ownership-checked
--    entrypoint after the teacher confirmed a dialog that names it.
--
-- 2. No general DELETE policy is added to attendance_sessions or
--    attendance_records. Adding one would let ANY client code path hard-
--    delete attendance, reversing 0004's stated boundary far more broadly
--    than this feature needs. Instead this migration adds ONE narrowly-
--    scoped SECURITY DEFINER RPC — the same pattern 0013/0015/0016/0019
--    already use for helpers that must bypass a specific RLS gap — whose
--    body does exactly two deletes, in one transaction.
--
-- 3. Authorization is enforced INSIDE the function, at the database:
--    auth.uid() must be the subject's teacher_id. A non-owner (or an
--    unknown id) gets 42501 and NOTHING is deleted. The function is
--    revoked from public/anon and granted to authenticated only.
--
-- 4. Atomicity: the attendance delete and the subject delete run in the
--    same statement-level transaction. If the subject delete fails for
--    any reason, the attendance delete is rolled back with it — the
--    half-deleted state "attendance gone but subject still exists" can
--    never be observed.
--
-- ==================================================
-- DELETION ORDER (inside the function, one transaction):
--
--   1. attendance_sessions where subject_id = p_subject_id
--        -> attendance_records cascade (0004 FK) — records of THOSE
--           sessions only; the students rows they point at are never
--           touched (students.id FK is RESTRICT, and nothing here deletes
--           students).
--   2. subjects where id = p_subject_id
--        -> subject_classrooms LINK rows cascade (0002) — classrooms
--           themselves are never deleted
--        -> topics cascade (0002)
--        -> lessons cascade (0015) -> lesson_resources cascade
--        -> assignments cascade (0006) -> assignment_resources (0013)
--                                      -> assignment_submissions (0006)
--                                         -> assignment_submission_resources (0016)
--      With this subject's own sessions already gone in step 1, the
--      RESTRICT FK no longer has any referencing row and the delete goes
--      through. Any session of ANOTHER subject is not referenced by this
--      subject at all, so it neither blocks nor is affected.
--
-- Storage objects (lesson-files, assignment-files, submission-files) are
-- still NOT covered by any FK — subject-service.ts's
-- deleteSubjectPermanently removes them BEFORE calling this RPC, for
-- the same ordering reason documented in 0020/0021 (submission-files'
-- delete policy re-derives ownership from the still-existing
-- assignment_submissions row). Attendance has no Storage objects.
-- Google Drive originals are never touched by anything here — a Drive
-- resource is only ever a URL reference row in our own database.
-- ==================================================

create or replace function public.delete_subject_permanently(p_subject_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'กรุณาเข้าสู่ระบบก่อนใช้งาน' using errcode = '28000';
  end if;

  if p_subject_id is null then
    raise exception 'กรุณาระบุรายวิชา' using errcode = '22023';
  end if;

  -- Ownership is the ONLY condition — identical to subjects_delete_own
  -- (0021) and subjects_update_own (0002). Checked explicitly because this
  -- function is SECURITY DEFINER and therefore not subject to RLS.
  if not exists (
    select 1 from public.subjects s
    where s.id = p_subject_id and s.teacher_id = auth.uid()
  ) then
    raise exception 'ไม่พบรายวิชานี้ หรือคุณไม่มีสิทธิ์เข้าถึง' using errcode = '42501';
  end if;

  -- Step 1: this subject's own attendance sessions only. attendance_records
  -- for those sessions cascade (0004). subject_id = p_subject_id can never
  -- match a homeroom session (subject_id is null) or another subject's
  -- session, regardless of classroom.
  delete from public.attendance_sessions
  where subject_id = p_subject_id;

  -- Step 2: the subject itself; every subject-scoped table cascades
  -- exactly as it already did under 0021.
  delete from public.subjects
  where id = p_subject_id and teacher_id = auth.uid();
end;
$$;

revoke all on function public.delete_subject_permanently(uuid) from public;
revoke all on function public.delete_subject_permanently(uuid) from anon;
grant execute on function public.delete_subject_permanently(uuid) to authenticated;

-- ==================================================
-- Nothing above touches any table's columns, any existing policy or
-- trigger, any FK's ON DELETE action (attendance_sessions.subject_id's
-- RESTRICT included), or any previously-applied migration (0001-0021) —
-- this migration only adds one ownership-checked SECURITY DEFINER RPC.
-- ==================================================
