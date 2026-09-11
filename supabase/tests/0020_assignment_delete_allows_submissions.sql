-- Empirical verification for 0020_assignment_delete_allows_submissions.sql

set role authenticated;
select public.set_test_user(null);
reset role;
set role postgres;

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 't1@example.com'),
  ('22222222-2222-2222-2222-222222222222', 't2@example.com');
-- handle_new_user (0003) auto-creates a 'teacher' profile for each.

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

-- Assignment A: zero submissions.
insert into public.assignments (id, subject_id, classroom_id, title, max_score, created_by) values
  ('66666666-6666-6666-6666-666666666666', '44444444-4444-4444-4444-444444444444', '33333333-3333-3333-3333-333333333333', 'No submissions', 100, '11111111-1111-1111-1111-111111111111');

-- Assignment B: one submission WITH a score AND a submission resource row,
-- plus an assignment_resources row -- to prove the full cascade works.
insert into public.assignments (id, subject_id, classroom_id, title, max_score, created_by) values
  ('77777777-7777-7777-7777-777777777777', '44444444-4444-4444-4444-444444444444', '33333333-3333-3333-3333-333333333333', 'Has submission + score', 100, '11111111-1111-1111-1111-111111111111');

insert into public.assignment_resources (id, assignment_id, resource_type, title, url, created_by) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '77777777-7777-7777-7777-777777777777', 'link', 'ใบงาน', 'https://example.com/worksheet', '11111111-1111-1111-1111-111111111111');

insert into public.assignment_submissions (id, assignment_id, student_id, status, score, reviewed_at) values
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '77777777-7777-7777-7777-777777777777', '55555555-5555-5555-5555-555555555555', 'submitted', 95, now());

insert into public.assignment_submission_resources (id, assignment_submission_id, resource_type, title, external_url) values
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'link', 'งานของฉัน', 'https://example.com/my-work');

-- Assignment C: another assignment WITH a submission, used for the
-- cross-teacher denial test.
insert into public.assignments (id, subject_id, classroom_id, title, max_score, created_by) values
  ('88888888-8888-8888-8888-888888888888', '44444444-4444-4444-4444-444444444444', '33333333-3333-3333-3333-333333333333', 'Cross-teacher test (has submission)', 100, '11111111-1111-1111-1111-111111111111');
insert into public.assignment_submissions (assignment_id, student_id, status) values
  ('88888888-8888-8888-8888-888888888888', '55555555-5555-5555-5555-555555555555', 'submitted');

-- Assignment D: archived, zero submissions.
insert into public.assignments (id, subject_id, classroom_id, title, max_score, created_by, is_archived) values
  ('99999999-9999-9999-9999-999999999999', '44444444-4444-4444-4444-444444444444', '33333333-3333-3333-3333-333333333333', 'Archived, no subs', 100, '11111111-1111-1111-1111-111111111111', true);

reset role;

\echo '--- Test 1: owning teacher deletes assignment with ZERO submissions -> succeeds (unchanged from 0019)'
set role authenticated;
select public.set_test_user('11111111-1111-1111-1111-111111111111');
delete from public.assignments where id = '66666666-6666-6666-6666-666666666666';
select 'remaining rows for assignment A (expect 0):' as label, count(*) from public.assignments where id = '66666666-6666-6666-6666-666666666666';

\echo '--- Test 2: owning teacher deletes assignment WITH a submission+score+resources -> now SUCCEEDS (0020 change)'
delete from public.assignments where id = '77777777-7777-7777-7777-777777777777';
select 'remaining assignment B rows (expect 0):' as label, count(*) from public.assignments where id = '77777777-7777-7777-7777-777777777777';
reset role;
set role postgres;
select 'remaining assignment_resources for B (expect 0, cascade):' as label, count(*) from public.assignment_resources where assignment_id = '77777777-7777-7777-7777-777777777777';
select 'remaining assignment_submissions for B (expect 0, cascade):' as label, count(*) from public.assignment_submissions where assignment_id = '77777777-7777-7777-7777-777777777777';
select 'remaining assignment_submission_resources for the deleted submission (expect 0, cascade of cascade):' as label, count(*) from public.assignment_submission_resources where id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
reset role;

\echo '--- Test 3: a DIFFERENT teacher (not the owner) cannot delete, even though it has a submission'
set role authenticated;
select public.set_test_user('22222222-2222-2222-2222-222222222222');
delete from public.assignments where id = '88888888-8888-8888-8888-888888888888';
reset role;
set role postgres;
select 'remaining rows for assignment C after OTHER teacher delete attempt, checked as superuser (expect 1, still there):' as label, count(*) from public.assignments where id = '88888888-8888-8888-8888-888888888888';
select 'assignment C submissions still intact (expect 1):' as label, count(*) from public.assignment_submissions where assignment_id = '88888888-8888-8888-8888-888888888888';
reset role;

\echo '--- Test 4: original owning teacher CAN still delete assignment C (has a submission) -- confirms it is really an ownership-only gate now'
set role authenticated;
select public.set_test_user('11111111-1111-1111-1111-111111111111');
delete from public.assignments where id = '88888888-8888-8888-8888-888888888888';
select 'remaining rows for assignment C after OWNER delete (expect 0):' as label, count(*) from public.assignments where id = '88888888-8888-8888-8888-888888888888';

\echo '--- Test 5: archived assignment (no submissions) can still be permanently deleted'
delete from public.assignments where id = '99999999-9999-9999-9999-999999999999';
select 'remaining rows for archived assignment (expect 0):' as label, count(*) from public.assignments where id = '99999999-9999-9999-9999-999999999999';

\echo '--- Test 6: archiving (UPDATE) still works exactly as before -- "เก็บถาวร" remains a separate, non-destructive option'
set role postgres;
insert into public.assignments (id, subject_id, classroom_id, title, max_score, created_by) values
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', '44444444-4444-4444-4444-444444444444', '33333333-3333-3333-3333-333333333333', 'Archive me', 100, '11111111-1111-1111-1111-111111111111');
reset role;
set role authenticated;
select public.set_test_user('11111111-1111-1111-1111-111111111111');
update public.assignments set is_archived = true where id = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
select 'assignment is_archived (expect t):' as label, is_archived from public.assignments where id = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

\echo '--- Test 7: the old 0019 helper function is gone (dropped, no longer needed)'
reset role;
set role postgres;
select 'assignment_has_submissions still exists (expect 0 = dropped):' as label, count(*) from pg_proc where proname = 'assignment_has_submissions';

reset role;
