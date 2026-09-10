-- ==================================================
-- Attendance Production Diagnostic — READ-ONLY
-- ==================================================
--
-- Purpose: confirm (or rule out) the leading hypothesis for the
-- production bug where BOTH the attendance-session READ
-- (getAttendance) and the save WRITE (saveAttendance ->
-- save_attendance_session RPC) fail with generic errors —
-- "ไม่สามารถบันทึกการเช็คชื่อได้" / "ไม่สามารถโหลดสถานะการเช็คชื่อที่บันทึกไว้ได้".
--
-- HYPOTHESIS (reproduced locally against a disposable Postgres instance
-- with only 0001-0004 applied, i.e. WITHOUT 0005_subject_attendance.sql):
-- if migration 0005_subject_attendance.sql was never applied to this
-- production database, then:
--   - attendance_sessions has NO period_number column, so getAttendance's
--     `.is('period_number', null)` filter fails with Postgres 42703
--     ("column ... does not exist").
--   - save_attendance_session only exists as the OLD 3-argument
--     (classroom_id, attendance_date, records) function — the frontend
--     always calls it with 5 named arguments (adding subject_id/
--     period_number, since attendance is exclusively subject-scoped in
--     this app now), which resolves to NO matching function: Postgres
--     42883 ("function ... does not exist"), which PostgREST reports to
--     the browser as PGRST202 ("Could not find the function ... in the
--     schema cache").
-- Both reproduced exactly with these SQLSTATEs locally. Section A and E1
-- below directly confirm or refute this for YOUR production database.
--
-- THIS SCRIPT DOES NOT MODIFY ANYTHING. Every statement below is a
-- SELECT against catalog views or your own data. Nothing is inserted,
-- updated, or deleted, and no schema object is created or dropped.
--
-- HOW TO RUN: paste into the Supabase SQL Editor. The editor only shows
-- the result of the LAST statement in a run, so run each lettered block
-- (A, B, C, D, E1, E2, E3) separately — highlight just that block and
-- run it — to see every result. Send the results back for a definitive
-- diagnosis.
-- ==================================================


-- ==================================================
-- A. Every live signature of save_attendance_session — THE key check for
--    the WRITE failure. A healthy database (0005 applied) should show
--    EXACTLY ONE row here, with 5 arguments including p_subject_id and
--    p_period_number. If you see a 3-argument row (or no
--    p_subject_id/p_period_number), 0005 was not applied. If you see
--    BOTH a 3-arg and a 5-arg row, 0005's own `drop function` step did
--    not run — report that explicitly, it means two overloads coexist.
-- ==================================================
select
  p.oid::regprocedure                 as signature,
  pg_get_function_arguments(p.oid)    as arguments,
  pg_get_function_result(p.oid)       as returns,
  p.prosecdef                         as is_security_definer,
  case p.provolatile
    when 'i' then 'immutable'
    when 's' then 'stable'
    else 'volatile'
  end                                  as volatility
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'save_attendance_session';


-- ==================================================
-- B. EXECUTE privileges on every save_attendance_session overload found
--    in A — confirms `authenticated` can actually call it (should be
--    GRANTed per 0004/0005's own `grant execute ... to authenticated`).
-- ==================================================
select
  routine_name,
  specific_name,
  grantee,
  privilege_type
from information_schema.routine_privileges
where routine_schema = 'public'
  and routine_name = 'save_attendance_session'
order by grantee;


-- ==================================================
-- C. attendance_sessions rows for the teacher's own classroom(s)/
--    subject(s) named in the bug report ("ds" subject, "dasd"
--    classroom) — adjust the ilike patterns if your real names differ.
--    Empty result here (with no error) means no session has ever been
--    successfully saved for this pairing yet, consistent with "no
--    attendance saved for this date" rather than a hidden duplicate.
-- ==================================================
select
  s.id            as session_id,
  s.classroom_id,
  c.name          as classroom_name,
  s.subject_id,
  sub.name        as subject_name,
  s.period_number,
  s.attendance_date,
  s.created_by,
  pr.email        as created_by_email,
  s.created_at,
  s.updated_at
from public.attendance_sessions s
join public.classrooms c on c.id = s.classroom_id
left join public.subjects sub on sub.id = s.subject_id
left join public.profiles pr on pr.id = s.created_by
where c.name ilike '%dasd%' or sub.name ilike '%ds%'
order by s.attendance_date desc, s.updated_at desc
limit 50;


-- ==================================================
-- D. Duplicate-session groups — Section 3/4's "if duplicates exist,
--    report them rather than hiding them." Should return ZERO rows in a
--    healthy database (0004/0005's partial unique indexes make a true
--    duplicate impossible via any normal write path). A non-empty
--    result here is a real, separate data anomaly worth reporting back.
-- ==================================================
select
  classroom_id,
  subject_id,
  period_number,
  attendance_date,
  count(*) as row_count,
  array_agg(id order by updated_at desc) as session_ids
from public.attendance_sessions
group by classroom_id, subject_id, period_number, attendance_date
having count(*) > 1
order by row_count desc;


-- ==================================================
-- E1. THE single most direct check for the READ failure: does
--     attendance_sessions even HAVE a period_number column? If this
--     query returns fewer columns than expected (no period_number row),
--     0005_subject_attendance.sql was never applied — full stop, this
--     alone explains both the READ and WRITE failures, since 0005 adds
--     the column AND replaces the RPC in the same migration.
-- ==================================================
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'attendance_sessions'
order by ordinal_position;


-- ==================================================
-- E2. Indexes on attendance_sessions — a healthy, fully-migrated
--     database has THREE partial unique indexes:
--       attendance_sessions_classroom_date_no_subject_uidx
--       attendance_sessions_subject_date_no_period_uidx
--       attendance_sessions_subject_date_period_uidx
--     (0004 creates the first one plus an old
--     attendance_sessions_classroom_subject_date_uidx that 0005 drops
--     and replaces with the latter two — seeing that old name still
--     present alongside the new ones means 0005's DROP step did not run.)
-- ==================================================
select indexname, indexdef
from pg_indexes
where schemaname = 'public' and tablename = 'attendance_sessions'
order by indexname;


-- ==================================================
-- E3. Check constraints on attendance_sessions — 0005 adds
--     attendance_sessions_period_number_check (period_number is null or
--     period_number > 0). Absence confirms 0005 was not applied.
-- ==================================================
select conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'public.attendance_sessions'::regclass
order by conname;
