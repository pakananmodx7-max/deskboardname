-- Empirical verification for 0021_lesson_subject_delete.sql

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

insert into public.students (id, created_by, first_name, last_name) values
  ('55555555-5555-5555-5555-555555555555', '11111111-1111-1111-1111-111111111111', 'Somchai', 'Test');

insert into public.classroom_students (classroom_id, student_id) values
  ('33333333-3333-3333-3333-333333333333', '55555555-5555-5555-5555-555555555555');

reset role;

\echo '=================================================='
\echo 'PART 1: LESSON DELETE'
\echo '=================================================='

set role postgres;

insert into public.subjects (id, teacher_id, name) values
  ('44444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111', 'คณิตศาสตร์');
insert into public.subject_classrooms (subject_id, classroom_id) values
  ('44444444-4444-4444-4444-444444444444', '33333333-3333-3333-3333-333333333333');

insert into public.lessons (id, subject_id, classroom_id, title, created_by) values
  ('66666666-6666-6666-6666-666666666666', '44444444-4444-4444-4444-444444444444', '33333333-3333-3333-3333-333333333333', 'บทที่ 1', '11111111-1111-1111-1111-111111111111');
insert into public.lesson_resources (id, lesson_id, resource_type, title, url) values
  ('77777777-7777-7777-7777-777777777777', '66666666-6666-6666-6666-666666666666', 'link', 'สไลด์', 'https://example.com/slide');

-- an unrelated lesson (different subject) whose resources must survive
insert into public.subjects (id, teacher_id, name) values
  ('88888888-8888-8888-8888-888888888888', '11111111-1111-1111-1111-111111111111', 'ภาษาไทย');
insert into public.subject_classrooms (subject_id, classroom_id) values
  ('88888888-8888-8888-8888-888888888888', '33333333-3333-3333-3333-333333333333');
insert into public.lessons (id, subject_id, classroom_id, title, created_by) values
  ('99999999-9999-9999-9999-999999999999', '88888888-8888-8888-8888-888888888888', '33333333-3333-3333-3333-333333333333', 'unrelated lesson', '11111111-1111-1111-1111-111111111111');
insert into public.lesson_resources (id, lesson_id, resource_type, title, url) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '99999999-9999-9999-9999-999999999999', 'link', 'unrelated resource', 'https://example.com/unrelated');

reset role;

\echo '--- Test L1: a DIFFERENT teacher cannot delete the lesson'
set role authenticated;
select public.set_test_user('22222222-2222-2222-2222-222222222222');
delete from public.lessons where id = '66666666-6666-6666-6666-666666666666';
reset role;
set role postgres;
select 'lesson still exists after OTHER teacher delete attempt (expect 1):' as label, count(*) from public.lessons where id = '66666666-6666-6666-6666-666666666666';
reset role;

\echo '--- Test L2: the OWNING teacher deletes the lesson -> succeeds, its resource cascades away'
set role authenticated;
select public.set_test_user('11111111-1111-1111-1111-111111111111');
delete from public.lessons where id = '66666666-6666-6666-6666-666666666666';
select 'remaining lesson rows (expect 0):' as label, count(*) from public.lessons where id = '66666666-6666-6666-6666-666666666666';
reset role;
set role postgres;
select 'remaining lesson_resources for deleted lesson (expect 0, cascade):' as label, count(*) from public.lesson_resources where lesson_id = '66666666-6666-6666-6666-666666666666';
select 'UNRELATED lesson (different subject) still exists (expect 1):' as label, count(*) from public.lessons where id = '99999999-9999-9999-9999-999999999999';
select 'UNRELATED lesson resource still exists (expect 1):' as label, count(*) from public.lesson_resources where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
reset role;

\echo '=================================================='
\echo 'PART 2: SUBJECT DELETE (no attendance) -- full cascade'
\echo '=================================================='

set role postgres;

-- Subject B: lessons, assignments, submissions, scores -- everything.
insert into public.assignments (id, subject_id, classroom_id, title, max_score, created_by) values
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '44444444-4444-4444-4444-444444444444', '33333333-3333-3333-3333-333333333333', 'งาน 1', 100, '11111111-1111-1111-1111-111111111111');
insert into public.assignment_resources (id, assignment_id, resource_type, title, url) values
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'link', 'ใบงาน', 'https://example.com/worksheet');
insert into public.assignment_submissions (id, assignment_id, student_id, status, score, reviewed_at) values
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '55555555-5555-5555-5555-555555555555', 'submitted', 95, now());
insert into public.assignment_submission_resources (id, assignment_submission_id, resource_type, title, external_url) values
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'link', 'งานของฉัน', 'https://example.com/my-work');

reset role;

\echo '--- Test S1: a DIFFERENT teacher cannot delete the subject'
set role authenticated;
select public.set_test_user('22222222-2222-2222-2222-222222222222');
delete from public.subjects where id = '44444444-4444-4444-4444-444444444444';
reset role;
set role postgres;
select 'subject still exists after OTHER teacher delete attempt (expect 1):' as label, count(*) from public.subjects where id = '44444444-4444-4444-4444-444444444444';
reset role;

\echo '--- Test S2: the OWNING teacher deletes subject B -> succeeds, full cascade'
set role authenticated;
select public.set_test_user('11111111-1111-1111-1111-111111111111');
delete from public.subjects where id = '44444444-4444-4444-4444-444444444444';
select 'remaining subject rows (expect 0):' as label, count(*) from public.subjects where id = '44444444-4444-4444-4444-444444444444';
reset role;
set role postgres;
select 'remaining subject_classrooms LINK rows (expect 0):' as label, count(*) from public.subject_classrooms where subject_id = '44444444-4444-4444-4444-444444444444';
select 'the CLASSROOM itself still exists (expect 1, never deleted by subject delete):' as label, count(*) from public.classrooms where id = '33333333-3333-3333-3333-333333333333';
select 'remaining assignments for subject B (expect 0):' as label, count(*) from public.assignments where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
select 'remaining assignment_resources (expect 0, cascade):' as label, count(*) from public.assignment_resources where id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
select 'remaining assignment_submissions (expect 0, cascade):' as label, count(*) from public.assignment_submissions where id = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
select 'remaining assignment_submission_resources (expect 0, cascade of cascade):' as label, count(*) from public.assignment_submission_resources where id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
select 'the STUDENT account itself still exists (expect 1, never deleted):' as label, count(*) from public.students where id = '55555555-5555-5555-5555-555555555555';
select 'UNRELATED subject (ภาษาไทย) still exists (expect 1):' as label, count(*) from public.subjects where id = '88888888-8888-8888-8888-888888888888';
select 'UNRELATED subject''s lesson still exists (expect 1):' as label, count(*) from public.lessons where id = '99999999-9999-9999-9999-999999999999';
reset role;

\echo '=================================================='
\echo 'PART 3: SUBJECT DELETE blocked by existing attendance (ON DELETE RESTRICT, unchanged)'
\echo '=================================================='

set role postgres;

insert into public.subjects (id, teacher_id, name) values
  ('ffffffff-ffff-ffff-ffff-ffffffffffff', '11111111-1111-1111-1111-111111111111', 'สังคมศึกษา');
insert into public.subject_classrooms (subject_id, classroom_id) values
  ('ffffffff-ffff-ffff-ffff-ffffffffffff', '33333333-3333-3333-3333-333333333333');
insert into public.attendance_sessions (id, classroom_id, subject_id, attendance_date, created_by) values
  ('01010101-0101-0101-0101-010101010101', '33333333-3333-3333-3333-333333333333', 'ffffffff-ffff-ffff-ffff-ffffffffffff', '2026-09-01', '11111111-1111-1111-1111-111111111111');

reset role;

set role authenticated;
select public.set_test_user('11111111-1111-1111-1111-111111111111');
\echo '--- Test S3: DELETE FROM subjects fails with a foreign-key violation (23503) because attendance_sessions references it'
do $$
begin
  begin
    delete from public.subjects where id = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
    raise exception 'TEST FAILED: delete should have raised a foreign_key_violation';
  exception
    when foreign_key_violation then
      raise notice 'CORRECTLY BLOCKED: foreign_key_violation (23503) as expected — attendance_sessions.subject_id is still ON DELETE RESTRICT';
  end;
end $$;
select 'subject with attendance still exists (expect 1, delete was rolled back):' as label, count(*) from public.subjects where id = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
select 'attendance_sessions row still exists (expect 1):' as label, count(*) from public.attendance_sessions where id = '01010101-0101-0101-0101-010101010101';

\echo '=================================================='
\echo 'PART 4: archive still works for both lessons and subjects (unchanged, additive-only migration)'
\echo '=================================================='

update public.lessons set is_archived = true where id = '99999999-9999-9999-9999-999999999999';
select 'lesson is_archived (expect t):' as label, is_archived from public.lessons where id = '99999999-9999-9999-9999-999999999999';

update public.subjects set is_active = false where id = '88888888-8888-8888-8888-888888888888';
select 'subject is_active (expect f):' as label, is_active from public.subjects where id = '88888888-8888-8888-8888-888888888888';

reset role;
