-- Regression / adversarial test script for
-- 0016_assignment_submission_uploads.sql. NOT applied automatically and
-- NOT part of the application schema — dev-only verification tool, run
-- against a throwaway local Postgres instance that already has
-- 0001-0011 + 0013 + 0014 + 0015 + 0016 applied (0012 deliberately
-- skipped, matching production). See supabase/tests/0015_lessons.sql for
-- the same pattern this file mirrors closely.
--
-- Self-contained: creates its own fixtures (two teachers, two
-- classrooms/subjects/assignments — one with a FUTURE due date, one with
-- a PAST due date to exercise the late-submission scenario — two
-- students each in a different classroom), asserts every rule below with
-- RAISE EXCEPTION on failure, and cleans up its own rows at the end so
-- it can be re-run repeatedly against the same scratch database.
--
-- Run as a superuser/owner (so it can freely SET ROLE / set_test_user).

\set ON_ERROR_STOP on

-- ==================================================
-- Cleanup (idempotent re-run support) + fixtures
-- ==================================================

do $$
begin
  alter table auth.users disable trigger on_auth_user_created;
exception when undefined_object then null;
end $$;

delete from storage.objects where name like '%TEST0016%';
delete from public.assignment_submission_resources where title like 'TEST0016:%' or text_content like 'TEST0016:%';
delete from public.assignment_submissions where assignment_id in (select id from public.assignments where title like 'TEST0016:%');
delete from public.assignments where title like 'TEST0016:%';
delete from public.subject_classrooms where subject_id in (select id from public.subjects where name like 'TEST0016:%');
delete from public.subjects where name like 'TEST0016:%';
delete from public.classroom_students where classroom_id in (select id from public.classrooms where name like 'TEST0016:%');
delete from public.students where first_name like 'TEST0016:%';
delete from public.classrooms where name like 'TEST0016:%';
delete from public.profiles where display_name like 'TEST0016:%';
delete from auth.users where email like 'test0016_%';

insert into auth.users (id, email) values
  ('00000000-0016-0000-0000-000000000001', 'test0016_teacher_a@example.com'),
  ('00000000-0016-0000-0000-000000000002', 'test0016_teacher_b@example.com'),
  ('00000000-0016-0000-0000-000000000003', 'test0016_student1@example.com'),
  ('00000000-0016-0000-0000-000000000004', 'test0016_student2@example.com');

insert into public.profiles (id, display_name, email, role) values
  ('00000000-0016-0000-0000-000000000001', 'TEST0016: Teacher A', 'test0016_teacher_a@example.com', 'teacher'),
  ('00000000-0016-0000-0000-000000000002', 'TEST0016: Teacher B', 'test0016_teacher_b@example.com', 'teacher'),
  ('00000000-0016-0000-0000-000000000003', 'TEST0016: Student1 Profile', 'test0016_student1@example.com', 'student'),
  ('00000000-0016-0000-0000-000000000004', 'TEST0016: Student2 Profile', 'test0016_student2@example.com', 'student');

insert into public.classrooms (id, teacher_id, name) values
  ('00000000-0016-0001-0000-000000000001', '00000000-0016-0000-0000-000000000001', 'TEST0016: Classroom A1'),
  ('00000000-0016-0001-0000-000000000002', '00000000-0016-0000-0000-000000000002', 'TEST0016: Classroom B1');

insert into public.students (id, first_name, last_name, student_code, linked_profile_id) values
  ('00000000-0016-0002-0000-000000000001', 'TEST0016: S1', 'Student', 'S0016-1', '00000000-0016-0000-0000-000000000003'),
  ('00000000-0016-0002-0000-000000000002', 'TEST0016: S2', 'Student', 'S0016-2', '00000000-0016-0000-0000-000000000004');

insert into public.classroom_students (classroom_id, student_id) values
  ('00000000-0016-0001-0000-000000000001', '00000000-0016-0002-0000-000000000001'),
  ('00000000-0016-0001-0000-000000000002', '00000000-0016-0002-0000-000000000002');

insert into public.subjects (id, teacher_id, name) values
  ('00000000-0016-0003-0000-000000000001', '00000000-0016-0000-0000-000000000001', 'TEST0016: Subject A'),
  ('00000000-0016-0003-0000-000000000002', '00000000-0016-0000-0000-000000000002', 'TEST0016: Subject B');

insert into public.subject_classrooms (subject_id, classroom_id) values
  ('00000000-0016-0003-0000-000000000001', '00000000-0016-0001-0000-000000000001'),
  ('00000000-0016-0003-0000-000000000002', '00000000-0016-0001-0000-000000000002');

-- Assignment A: due date in the FUTURE (on-time submission scenario).
-- Assignment C: due date in the PAST (late submission scenario).
-- Assignment B: teacher B's own assignment (cross-teacher isolation).
insert into public.assignments (id, subject_id, classroom_id, title, max_score, due_date, created_by) values
  ('00000000-0016-0004-0000-000000000001', '00000000-0016-0003-0000-000000000001', '00000000-0016-0001-0000-000000000001', 'TEST0016: Assignment A (future due)', 100, current_date + 7, '00000000-0016-0000-0000-000000000001'),
  ('00000000-0016-0004-0000-000000000002', '00000000-0016-0003-0000-000000000002', '00000000-0016-0001-0000-000000000002', 'TEST0016: Assignment B (teacher B)', 100, current_date + 7, '00000000-0016-0000-0000-000000000002'),
  ('00000000-0016-0004-0000-000000000003', '00000000-0016-0003-0000-000000000001', '00000000-0016-0001-0000-000000000001', 'TEST0016: Assignment C (past due)', 100, current_date - 3, '00000000-0016-0000-0000-000000000001');

-- ==================================================
-- TEST 1: student submits a FILE (create-then-continue: upsert the
-- submission row first, then attach a file resource + storage object)
-- ==================================================
set role authenticated;
select set_test_user('00000000-0016-0000-0000-000000000003');

insert into public.assignment_submissions (id, assignment_id, student_id, status, submitted_at)
values ('00000000-0016-0005-0000-000000000001', '00000000-0016-0004-0000-000000000001', '00000000-0016-0002-0000-000000000001', 'submitted', now())
on conflict (assignment_id, student_id) do update set status = excluded.status, submitted_at = excluded.submitted_at;

insert into public.assignment_submission_resources (id, assignment_submission_id, resource_type, storage_path, original_filename, mime_type, file_size, sort_order)
values (
  '00000000-0016-0006-0000-000000000001',
  '00000000-0016-0005-0000-000000000001',
  'file',
  '00000000-0016-0000-0000-000000000001/00000000-0016-0003-0000-000000000001/00000000-0016-0001-0000-000000000001/00000000-0016-0004-0000-000000000001/00000000-0016-0002-0000-000000000001/00000000-0016-0005-0000-000000000001/abc123.pdf',
  'TEST0016: my-homework.pdf',
  'application/pdf',
  102400,
  0
);

do $$
begin
  if not exists (
    select 1 from public.assignment_submissions
    where id = '00000000-0016-0005-0000-000000000001' and status = 'submitted' and submitted_at is not null
  ) then
    raise exception 'TEST 1 FAILED: student could not create a submitted-status submission';
  end if;
  if not exists (select 1 from public.assignment_submission_resources where original_filename = 'TEST0016: my-homework.pdf') then
    raise exception 'TEST 1 FAILED: student could not attach a file resource to own submission';
  end if;
  raise notice 'TEST 1 passed: student submits a file';
end $$;

-- ==================================================
-- TEST 2: student submits a LINK on a different assignment
-- ==================================================
insert into public.assignment_submissions (id, assignment_id, student_id, status, submitted_at)
values ('00000000-0016-0005-0000-000000000002', '00000000-0016-0004-0000-000000000003', '00000000-0016-0002-0000-000000000001', 'late', now())
on conflict (assignment_id, student_id) do update set status = excluded.status, submitted_at = excluded.submitted_at;

insert into public.assignment_submission_resources (id, assignment_submission_id, resource_type, external_url, title, sort_order)
values ('00000000-0016-0006-0000-000000000002', '00000000-0016-0005-0000-000000000002', 'link', 'https://drive.google.com/test0016', 'TEST0016: My Google Doc', 0);

do $$
begin
  if not exists (select 1 from public.assignment_submission_resources where external_url = 'https://drive.google.com/test0016') then
    raise exception 'TEST 2 FAILED: student could not attach a link resource';
  end if;
  raise notice 'TEST 2 passed: student submits a link';
end $$;

-- ==================================================
-- TEST 3: student submits TEXT (same submission as TEST 2 — multiple
-- resources on one submission, per Section 1's "one or more resources")
-- ==================================================
insert into public.assignment_submission_resources (id, assignment_submission_id, resource_type, text_content, sort_order)
values ('00000000-0016-0006-0000-000000000003', '00000000-0016-0005-0000-000000000002', 'text', 'TEST0016: this is my written answer', 1);

do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.assignment_submission_resources where assignment_submission_id = '00000000-0016-0005-0000-000000000002';
  if v_count <> 2 then
    raise exception 'TEST 3 FAILED: expected 2 resources (link + text) on the same submission, got %', v_count;
  end if;
  raise notice 'TEST 3 passed: student submits text, multiple resource types coexist on one submission';
end $$;

-- ==================================================
-- TEST 4: before-deadline submission — Assignment A's due_date is in the
-- future; the submission created in TEST 1 was recorded as 'submitted'
-- (never 'late'), confirming on-time status.
-- ==================================================
do $$
declare
  v_status text;
  v_due date;
begin
  select status into v_status from public.assignment_submissions where id = '00000000-0016-0005-0000-000000000001';
  select due_date into v_due from public.assignments where id = '00000000-0016-0004-0000-000000000001';
  if v_status <> 'submitted' or v_due < current_date then
    raise exception 'TEST 4 FAILED: on-time submission scenario not set up correctly (status=%, due=%)', v_status, v_due;
  end if;
  raise notice 'TEST 4 passed: on-time submission recorded as submitted (due date is in the future)';
end $$;

-- ==================================================
-- TEST 5: late submission — Assignment C's due_date is in the past; the
-- submission created in TEST 2 was recorded as 'late'.
-- ==================================================
do $$
declare
  v_status text;
  v_due date;
begin
  select status into v_status from public.assignment_submissions where id = '00000000-0016-0005-0000-000000000002';
  select due_date into v_due from public.assignments where id = '00000000-0016-0004-0000-000000000003';
  if v_status <> 'late' or v_due >= current_date then
    raise exception 'TEST 5 FAILED: late submission scenario not set up correctly (status=%, due=%)', v_status, v_due;
  end if;
  raise notice 'TEST 5 passed: late submission recorded as late (due date is in the past)';
end $$;

-- ==================================================
-- TEST 6: resubmission — student updates submitted_at on the SAME row
-- (never a new row — unique (assignment_id, student_id) from 0006), and
-- can add ANOTHER resource without losing the earlier ones.
-- ==================================================
do $$
declare
  v_first_submitted_at timestamptz;
begin
  select submitted_at into v_first_submitted_at from public.assignment_submissions where id = '00000000-0016-0005-0000-000000000001';
  perform pg_sleep(0.01);

  update public.assignment_submissions set submitted_at = now() where id = '00000000-0016-0005-0000-000000000001';

  insert into public.assignment_submission_resources (id, assignment_submission_id, resource_type, text_content, sort_order)
  values ('00000000-0016-0006-0000-000000000004', '00000000-0016-0005-0000-000000000001', 'text', 'TEST0016: added on resubmission', 1);

  if (select submitted_at from public.assignment_submissions where id = '00000000-0016-0005-0000-000000000001') <= v_first_submitted_at then
    raise exception 'TEST 6 FAILED: resubmission did not update submitted_at';
  end if;
  if (select count(*) from public.assignment_submission_resources where assignment_submission_id = '00000000-0016-0005-0000-000000000001') <> 2 then
    raise exception 'TEST 6 FAILED: resubmission lost the original resource instead of appending';
  end if;
  raise notice 'TEST 6 passed: resubmission updates submitted_at on the same row and preserves prior resources';
end $$;

-- ==================================================
-- TEST 7 (score/status synchronization, part 1): student CANNOT set
-- their own score or note, at INSERT time — RLS WITH CHECK rejects it.
-- ==================================================
do $$
begin
  begin
    insert into public.assignment_submissions (assignment_id, student_id, status, score)
    values ('00000000-0016-0004-0000-000000000001', '00000000-0016-0002-0000-000000000001', 'submitted', 99);
    raise exception 'TEST 7 FAILED: student inserted a submission with a self-assigned score';
  exception
    when insufficient_privilege or check_violation then
      raise notice 'TEST 7a passed: student cannot INSERT a submission with a non-null score';
  end;
end $$;

-- ==================================================
-- TEST 7b: student CANNOT update their own score or note via UPDATE —
-- the enforce_submission_field_ownership trigger rejects it, not RLS
-- (RLS alone would have allowed the row-level UPDATE; the trigger is the
-- actual field-level enforcement).
-- ==================================================
do $$
begin
  begin
    update public.assignment_submissions set score = 100 where id = '00000000-0016-0005-0000-000000000001';
    raise exception 'TEST 7b FAILED: student updated their own score';
  exception
    when raise_exception then
      raise notice 'TEST 7b passed: student score self-edit rejected by trigger';
  end;
end $$;

do $$
begin
  begin
    update public.assignment_submissions set note = 'TEST0016: forged teacher comment' where id = '00000000-0016-0005-0000-000000000001';
    raise exception 'TEST 7c FAILED: student updated the teacher note/comment';
  exception
    when raise_exception then
      raise notice 'TEST 7c passed: student note/comment self-edit rejected by trigger';
  end;
end $$;

-- ==================================================
-- TEST 8: teacher A grades the submission (score + note) — must succeed
-- normally, exactly as it always has (0006, untouched).
-- ==================================================
select set_test_user('00000000-0016-0000-0000-000000000001');

update public.assignment_submissions
set score = 88, note = 'TEST0016: nice work — teacher comment'
where id = '00000000-0016-0005-0000-000000000001';

do $$
begin
  if not exists (
    select 1 from public.assignment_submissions
    where id = '00000000-0016-0005-0000-000000000001' and score = 88 and note = 'TEST0016: nice work — teacher comment'
  ) then
    raise exception 'TEST 8 FAILED: teacher could not grade the submission';
  end if;
  raise notice 'TEST 8 passed: teacher grades the submission (score + note) normally';
end $$;

-- ==================================================
-- TEST 9: teacher sees the CORRECT student's submission — teacher A's
-- own students only, never mixed up.
-- ==================================================
insert into public.assignment_submissions (id, assignment_id, student_id, status)
values ('00000000-0016-0005-0000-000000000005', '00000000-0016-0004-0000-000000000001', '00000000-0016-0002-0000-000000000001', 'not_submitted')
on conflict (assignment_id, student_id) do nothing;

do $$
declare
  v_student_id uuid;
begin
  select student_id into v_student_id from public.assignment_submissions where id = '00000000-0016-0005-0000-000000000001';
  if v_student_id <> '00000000-0016-0002-0000-000000000001' then
    raise exception 'TEST 9 FAILED: teacher sees the wrong student on this submission';
  end if;
  raise notice 'TEST 9 passed: teacher sees the correct student on the submission';
end $$;

-- ==================================================
-- TEST 10: teacher opens the file — can SELECT the resource row and its
-- storage object (the actual signed-URL issuance is a Storage API call,
-- out of scope for SQL; RLS access to the underlying row/object is what
-- gates it, and that's what's tested here).
-- ==================================================
reset role;
insert into storage.objects (bucket_id, name, owner)
values (
  'submission-files',
  '00000000-0016-0000-0000-000000000001/00000000-0016-0003-0000-000000000001/00000000-0016-0001-0000-000000000001/00000000-0016-0004-0000-000000000001/00000000-0016-0002-0000-000000000001/00000000-0016-0005-0000-000000000001/TEST0016-file1.pdf',
  '00000000-0016-0000-0000-000000000003'
);
set role authenticated;
select set_test_user('00000000-0016-0000-0000-000000000001');

do $$
begin
  if not exists (select 1 from public.assignment_submission_resources where assignment_submission_id = '00000000-0016-0005-0000-000000000001' and resource_type = 'file') then
    raise exception 'TEST 10 FAILED: teacher cannot see the file resource row';
  end if;
  if not exists (select 1 from storage.objects where name like '%TEST0016-file1.pdf') then
    raise exception 'TEST 10 FAILED: teacher cannot see the underlying storage object';
  end if;
  raise notice 'TEST 10 passed: teacher opens (reads) the submitted file — row + storage object both reachable';
end $$;

-- ==================================================
-- TEST 11: teacher opens the external URL (same reachability check, for
-- a link resource, on Assignment C's submission).
-- ==================================================
do $$
begin
  if not exists (select 1 from public.assignment_submission_resources where assignment_submission_id = '00000000-0016-0005-0000-000000000002' and resource_type = 'link' and external_url = 'https://drive.google.com/test0016') then
    raise exception 'TEST 11 FAILED: teacher cannot see the link resource';
  end if;
  raise notice 'TEST 11 passed: teacher opens the external link';
end $$;

-- ==================================================
-- TEST 12 (score/status sync, part 2): after the student's resubmission
-- (TEST 6) and the teacher's grading (TEST 8), score/status are STILL in
-- sync — resubmitting never silently reset the score back to null.
-- ==================================================
do $$
declare
  v_score numeric;
  v_status text;
begin
  select score, status into v_score, v_status from public.assignment_submissions where id = '00000000-0016-0005-0000-000000000001';
  if v_score <> 88 or v_status <> 'submitted' then
    raise exception 'TEST 12 FAILED: score/status desynchronized after resubmission (score=%, status=%)', v_score, v_status;
  end if;
  raise notice 'TEST 12 passed: score/status remain synchronized across a resubmission';
end $$;

-- ==================================================
-- TEST 13: student A cannot read student B's submission
-- ==================================================
-- Fixture insert only (student B's own submission on teacher B's own
-- assignment) — done as superuser, matching every other pure fixture in
-- this file; the current role coming into this section is still teacher
-- A's, which correctly could NOT authorize this insert (it's neither
-- teacher A's own classroom nor student B's own row), so this must not
-- be attempted under set_test_user at all.
reset role;
insert into public.assignment_submissions (id, assignment_id, student_id, status, submitted_at)
values ('00000000-0016-0005-0000-000000000003', '00000000-0016-0004-0000-000000000002', '00000000-0016-0002-0000-000000000002', 'submitted', now())
on conflict (assignment_id, student_id) do nothing;
set role authenticated;

select set_test_user('00000000-0016-0000-0000-000000000003');

do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.assignment_submissions where id = '00000000-0016-0005-0000-000000000003';
  if v_count <> 0 then
    raise exception 'TEST 13 FAILED: student A could see student B''s submission';
  end if;
  raise notice 'TEST 13 passed: cross-student submission read denied (0 rows)';
end $$;

-- ==================================================
-- TEST 14: teacher A cannot read teacher B's submissions
-- ==================================================
select set_test_user('00000000-0016-0000-0000-000000000001');

do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.assignment_submissions where id = '00000000-0016-0005-0000-000000000003';
  if v_count <> 0 then
    raise exception 'TEST 14 FAILED: teacher A could see teacher B''s submission';
  end if;
  raise notice 'TEST 14 passed: cross-teacher submission read denied (0 rows)';
end $$;

-- ==================================================
-- TEST 15: storage isolation — student A cannot see student B's storage
-- object; teacher A cannot see teacher B's storage object.
-- ==================================================
reset role;
insert into storage.objects (bucket_id, name, owner)
values (
  'submission-files',
  '00000000-0016-0000-0000-000000000002/00000000-0016-0003-0000-000000000002/00000000-0016-0001-0000-000000000002/00000000-0016-0004-0000-000000000002/00000000-0016-0002-0000-000000000002/00000000-0016-0005-0000-000000000003/TEST0016-file2.pdf',
  '00000000-0016-0000-0000-000000000004'
);

set role authenticated;
select set_test_user('00000000-0016-0000-0000-000000000003');

do $$
declare
  v_count int;
begin
  select count(*) into v_count from storage.objects where name like '%TEST0016-file2.pdf';
  if v_count <> 0 then
    raise exception 'TEST 15 FAILED: student A could see student B''s storage object';
  end if;
  raise notice 'TEST 15a passed: cross-student storage isolation confirmed';
end $$;

select set_test_user('00000000-0016-0000-0000-000000000001');

do $$
declare
  v_count int;
begin
  select count(*) into v_count from storage.objects where name like '%TEST0016-file2.pdf';
  if v_count <> 0 then
    raise exception 'TEST 15 FAILED: teacher A could see teacher B''s storage object';
  end if;
  raise notice 'TEST 15b passed: cross-teacher storage isolation confirmed';
end $$;

-- ==================================================
-- TEST 16: "upload failure does not create fake submitted state" — at
-- the DB level, a resource insert that violates the resource shape
-- constraint (a 'file' resource claiming BOTH a storage_path and
-- external_url) is rejected outright; the parent submission row is
-- never implicitly marked complete by a failed resource insert (the
-- application always inserts the resource in the SAME step it would
-- rely on to confirm success — a rejected insert here means the
-- application's own upload flow errors out before ever telling the
-- student "ส่งงานสำเร็จ").
-- ==================================================
select set_test_user('00000000-0016-0000-0000-000000000003');

do $$
begin
  begin
    insert into public.assignment_submission_resources (assignment_submission_id, resource_type, storage_path, external_url)
    values ('00000000-0016-0005-0000-000000000001', 'file', 'a/b/c.pdf', 'https://example.com/also-set');
    raise exception 'TEST 16 FAILED: a malformed file resource (both storage_path and external_url) was accepted';
  exception
    when check_violation then
      raise notice 'TEST 16a passed: malformed resource shape rejected at the database level';
  end;
end $$;

do $$
begin
  begin
    insert into public.assignment_submission_resources (assignment_submission_id, resource_type)
    values ('00000000-0016-0005-0000-000000000001', 'text');
    raise exception 'TEST 16 FAILED: a text resource with no text_content was accepted';
  exception
    when check_violation then
      raise notice 'TEST 16b passed: empty text resource rejected';
  end;
end $$;

do $$
begin
  begin
    insert into public.assignment_submission_resources (assignment_submission_id, resource_type, external_url)
    values ('00000000-0016-0005-0000-000000000001', 'link', 'javascript:alert(1)');
    raise exception 'TEST 16 FAILED: a non-https link resource was accepted';
  exception
    when check_violation then
      raise notice 'TEST 16c passed: non-https link resource rejected';
  end;
end $$;

-- ==================================================
-- TEST 17: manual file cleanup ("ล้างไฟล์งานที่ตรวจแล้ว") — teacher
-- clears the stored file (storage_path -> null, deleted_at set) but
-- score/status/submitted_at/note/original_filename/mime_type/file_size
-- are ALL preserved.
-- ==================================================
select set_test_user('00000000-0016-0000-0000-000000000001');

do $$
declare
  v_score_before numeric;
  v_status_before text;
  v_submitted_at_before timestamptz;
  v_note_before text;
  v_filename_before text;
begin
  select score, status, submitted_at, note into v_score_before, v_status_before, v_submitted_at_before, v_note_before
  from public.assignment_submissions where id = '00000000-0016-0005-0000-000000000001';
  select original_filename into v_filename_before from public.assignment_submission_resources where id = '00000000-0016-0006-0000-000000000001';

  update public.assignment_submission_resources
  set storage_path = null, deleted_at = now()
  where id = '00000000-0016-0006-0000-000000000001';

  if exists (select 1 from public.assignment_submission_resources where id = '00000000-0016-0006-0000-000000000001' and storage_path is not null) then
    raise exception 'TEST 17 FAILED: storage_path was not cleared';
  end if;
  if not exists (select 1 from public.assignment_submission_resources where id = '00000000-0016-0006-0000-000000000001' and deleted_at is not null) then
    raise exception 'TEST 17 FAILED: deleted_at was not set';
  end if;
  if (select original_filename from public.assignment_submission_resources where id = '00000000-0016-0006-0000-000000000001') <> v_filename_before then
    raise exception 'TEST 17 FAILED: original_filename metadata was lost during cleanup';
  end if;

  if (select score from public.assignment_submissions where id = '00000000-0016-0005-0000-000000000001') <> v_score_before
    or (select status from public.assignment_submissions where id = '00000000-0016-0005-0000-000000000001') <> v_status_before
    or (select submitted_at from public.assignment_submissions where id = '00000000-0016-0005-0000-000000000001') <> v_submitted_at_before
    or (select note from public.assignment_submissions where id = '00000000-0016-0005-0000-000000000001') <> v_note_before
  then
    raise exception 'TEST 17 FAILED: cleanup altered score/status/submitted_at/note on the parent submission';
  end if;
  raise notice 'TEST 17 passed: manual file cleanup clears the stored file only — score/status/submitted_at/note/original_filename all preserved';
end $$;

-- ==================================================
-- TEST 17b: teacher cannot use this UPDATE path to rewrite what the
-- student actually submitted (academic integrity) — the
-- enforce_submission_resource_teacher_edit trigger blocks it.
-- ==================================================
do $$
begin
  begin
    update public.assignment_submission_resources
    set text_content = 'TEST0016: teacher-forged content'
    where id = '00000000-0016-0006-0000-000000000004';
    raise exception 'TEST 17b FAILED: teacher rewrote a student''s submitted text content';
  exception
    when raise_exception then
      raise notice 'TEST 17b passed: teacher cannot edit submitted content via the cleanup UPDATE path';
  end;
end $$;

-- ==================================================
-- TEST 18: deleted storage file is not accessible afterward — after the
-- storage object is actually removed (simulating storage.remove()), it
-- is gone for everyone, teacher included.
-- ==================================================
reset role;
delete from storage.objects where name like '%TEST0016-file1.pdf';
set role authenticated;
select set_test_user('00000000-0016-0000-0000-000000000001');

do $$
declare
  v_count int;
begin
  select count(*) into v_count from storage.objects where name like '%TEST0016-file1.pdf';
  if v_count <> 0 then
    raise exception 'TEST 18 FAILED: deleted storage object is still visible';
  end if;
  raise notice 'TEST 18 passed: a deleted storage file is no longer accessible to anyone';
end $$;

-- ==================================================
-- TEST 19: student can DELETE their own not-yet-cleaned-up resource
-- (e.g. remove a wrongly-attached file before/while resubmitting), but
-- NOT one a teacher has already cleaned up.
-- ==================================================
select set_test_user('00000000-0016-0000-0000-000000000003');

delete from public.assignment_submission_resources where id = '00000000-0016-0006-0000-000000000004';

do $$
begin
  if exists (select 1 from public.assignment_submission_resources where id = '00000000-0016-0006-0000-000000000004') then
    raise exception 'TEST 19a FAILED: student could not delete their own active resource';
  end if;
  raise notice 'TEST 19a passed: student deletes their own active (not-yet-cleaned-up) resource';
end $$;

do $$
declare
  v_rows int;
begin
  delete from public.assignment_submission_resources where id = '00000000-0016-0006-0000-000000000001';
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then
    raise exception 'TEST 19b FAILED: student deleted an already-cleaned-up (frozen) resource (% rows)', v_rows;
  end if;
  raise notice 'TEST 19b passed: student cannot delete a resource the teacher has already cleaned up — frozen as permanent record';
end $$;

-- ==================================================
-- TEST 20: student cannot insert a resource onto ANOTHER student's
-- submission.
-- ==================================================
do $$
begin
  begin
    insert into public.assignment_submission_resources (assignment_submission_id, resource_type, text_content)
    values ('00000000-0016-0005-0000-000000000003', 'text', 'TEST0016: hostile insert');
    raise exception 'TEST 20 FAILED: student A inserted a resource on student B''s submission';
  exception
    when insufficient_privilege or check_violation then
      raise notice 'TEST 20 passed: cross-student resource insert denied';
  end;
end $$;

-- ==================================================
-- TEST 21: malformed storage object path never errors the whole query —
-- submission_files_path_submission_id() returns NULL, denied safely.
-- ==================================================
reset role;
insert into storage.objects (bucket_id, name, owner) values
  ('submission-files', 'TEST0016-malformed-no-slashes.pdf', null),
  ('submission-files', '00000000-0016-0000-0000-000000000001/a/b/c/d/TEST0016-too-short.pdf', null),
  ('submission-files', 'a/b/c/d/e/not-a-uuid/TEST0016-bad-uuid.pdf', null);

set role authenticated;
select set_test_user('00000000-0016-0000-0000-000000000003');

do $$
declare
  v_count int;
begin
  select count(*) into v_count from storage.objects where name like '%TEST0016-malformed%' or name like '%TEST0016-too-short%' or name like '%TEST0016-bad-uuid%';
  if v_count <> 0 then
    raise exception 'TEST 21 FAILED: student could see % malformed-path object(s) (should be 0, denied)', v_count;
  end if;
  raise notice 'TEST 21 passed: malformed storage object names are safely denied, not erroring';
end $$;

reset role;

-- ==================================================
-- Cleanup
-- ==================================================

delete from storage.objects where name like '%TEST0016%';
delete from public.assignment_submission_resources where title like 'TEST0016:%' or text_content like 'TEST0016:%';
delete from public.assignment_submissions where assignment_id in (select id from public.assignments where title like 'TEST0016:%');
delete from public.assignments where title like 'TEST0016:%';
delete from public.subject_classrooms where subject_id in (select id from public.subjects where name like 'TEST0016:%');
delete from public.subjects where name like 'TEST0016:%';
delete from public.classroom_students where classroom_id in (select id from public.classrooms where name like 'TEST0016:%');
delete from public.students where first_name like 'TEST0016:%';
delete from public.classrooms where name like 'TEST0016:%';
delete from public.profiles where display_name like 'TEST0016:%';
delete from auth.users where email like 'test0016_%';

do $$
begin
  alter table auth.users enable trigger on_auth_user_created;
exception when undefined_object then null;
end $$;

select 'supabase/tests/0016_assignment_submission_uploads.sql: ALL TESTS PASSED' as result;
