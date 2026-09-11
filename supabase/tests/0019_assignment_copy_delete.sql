-- Empirical RLS verification for 0019_assignment_copy_delete.sql.
-- Run against a scratch database seeded with 0001-0019 plus the
-- auth/storage schema shim used throughout this project's local testing
-- (see docs/SUPABASE_SETUP.md) — NOT run against production.
--
-- Verifies (see the assignment copy/delete feature's completion report for
-- full results):
--   1. The owning teacher can permanently delete an assignment with ZERO
--      assignment_submissions rows.
--   2. The owning teacher CANNOT delete an assignment that already has at
--      least one assignment_submissions row (RLS denies — 0 rows
--      affected, no error) — the archive path remains the only option.
--   3. A DIFFERENT teacher (does not own the classroom) cannot delete the
--      assignment at all, regardless of its submission count.
--   4. An archived assignment (is_archived = true) with zero submissions
--      can still be permanently deleted — archiving never blocks it.
--   5. Archiving (UPDATE is_archived = true) an assignment that already
--      has submissions still works exactly as it did before this
--      migration (0006's assignments_update_own, untouched).
--
-- The first version of this policy used a raw
-- `not exists (select 1 from assignment_submissions ...)` subquery inline
-- in the DELETE policy and empirically hit Postgres' "infinite recursion
-- detected in policy for relation assignments" — evaluating
-- assignment_submissions' own RLS policies re-enters assignments' RLS,
-- forming a cycle with this policy's own evaluation. Fixed by wrapping the
-- check in the SECURITY DEFINER helper assignment_has_submissions(), the
-- same established pattern as is_teacher_of_assignment (0013) and
-- teacher_owns_submission (0016).

set role authenticated;
select public.set_test_user(null);
reset role;
set role postgres;

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 't1@example.com'),
  ('22222222-2222-2222-2222-222222222222', 't2@example.com');
-- handle_new_user (0003) auto-creates a 'teacher' profile row for each via
-- an AFTER INSERT trigger on auth.users — no manual profiles insert here.

insert into public.classrooms (id, teacher_id, name) values
  ('33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111', 'ม.5/1');

insert into public.subjects (id, teacher_id, name) values
  ('44444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111', 'คณิตศาสตร์');

insert into public.subject_classrooms (subject_id, classroom_id) values
  ('44444444-4444-4444-4444-444444444444', '33333333-3333-3333-3333-333333333333');

insert into public.students (id, created_by, first_name, last_name) values
  ('55555555-5555-5555-5555-555555555555', '11111111-1111-1111-1111-111111111111', 'Somchai', 'Test');

insert into public.classroom_students (classroom_id, student_id) values
  ('33333333-3333-3333-3333-333333333333', '55555555-5555-5555-5555-555555555555');

insert into public.assignments (id, subject_id, classroom_id, title, max_score, created_by) values
  ('66666666-6666-6666-6666-666666666666', '44444444-4444-4444-4444-444444444444', '33333333-3333-3333-3333-333333333333', 'No submissions', 100, '11111111-1111-1111-1111-111111111111');

insert into public.assignments (id, subject_id, classroom_id, title, max_score, created_by) values
  ('77777777-7777-7777-7777-777777777777', '44444444-4444-4444-4444-444444444444', '33333333-3333-3333-3333-333333333333', 'Has submission', 100, '11111111-1111-1111-1111-111111111111');

insert into public.assignment_submissions (assignment_id, student_id, status) values
  ('77777777-7777-7777-7777-777777777777', '55555555-5555-5555-5555-555555555555', 'submitted');

reset role;

\echo '--- Test 1: owning teacher deletes assignment with ZERO submissions -> should succeed'
set role authenticated;
select public.set_test_user('11111111-1111-1111-1111-111111111111');
delete from public.assignments where id = '66666666-6666-6666-6666-666666666666';
select 'remaining rows for assignment A (expect 0):' as label, count(*) from public.assignments where id = '66666666-6666-6666-6666-666666666666';

\echo '--- Test 2: owning teacher deletes assignment WITH a submission -> should be BLOCKED'
delete from public.assignments where id = '77777777-7777-7777-7777-777777777777';
select 'remaining rows for assignment B (expect 1, still there):' as label, count(*) from public.assignments where id = '77777777-7777-7777-7777-777777777777';

\echo '--- Test 3: a DIFFERENT teacher (does not own the classroom) cannot delete at all'
reset role;
set role postgres;
insert into public.assignments (id, subject_id, classroom_id, title, max_score, created_by) values
  ('88888888-8888-8888-8888-888888888888', '44444444-4444-4444-4444-444444444444', '33333333-3333-3333-3333-333333333333', 'Cross-teacher test', 100, '11111111-1111-1111-1111-111111111111');
reset role;

set role authenticated;
select public.set_test_user('22222222-2222-2222-2222-222222222222');
delete from public.assignments where id = '88888888-8888-8888-8888-888888888888';
reset role;
set role postgres;
select 'remaining rows for assignment C after OTHER teacher delete attempt, checked as superuser (expect 1, still there):' as label, count(*) from public.assignments where id = '88888888-8888-8888-8888-888888888888';
reset role;

\echo '--- Test 4: archived assignment (no submissions) can still be permanently deleted'
set role postgres;
insert into public.assignments (id, subject_id, classroom_id, title, max_score, created_by, is_archived) values
  ('99999999-9999-9999-9999-999999999999', '44444444-4444-4444-4444-444444444444', '33333333-3333-3333-3333-333333333333', 'Archived, no subs', 100, '11111111-1111-1111-1111-111111111111', true);
reset role;
set role authenticated;
select public.set_test_user('11111111-1111-1111-1111-111111111111');
delete from public.assignments where id = '99999999-9999-9999-9999-999999999999';
select 'remaining rows for archived assignment (expect 0):' as label, count(*) from public.assignments where id = '99999999-9999-9999-9999-999999999999';

\echo '--- Test 5: original owner can still ARCHIVE (update) the has-submission assignment B, unchanged'
update public.assignments set is_archived = true where id = '77777777-7777-7777-7777-777777777777';
select 'assignment B is_archived (expect t):' as label, is_archived from public.assignments where id = '77777777-7777-7777-7777-777777777777';

reset role;
