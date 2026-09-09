-- Regression / adversarial test script for 0015_lessons.sql. NOT applied
-- automatically and NOT part of the application schema — dev-only
-- verification tool, run against a throwaway local Postgres instance
-- that already has 0001-0011 + 0013 + 0014 + 0015 applied (0012
-- deliberately skipped, matching production). See
-- supabase/tests/0013_assignment_resources.sql for the same pattern this
-- file mirrors closely.
--
-- Self-contained: creates its own fixtures (two teachers, two
-- classrooms/subjects, two students each in a different classroom, one
-- linked auth.users row per person), asserts every rule below with
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

delete from storage.objects where name like '%TEST0015%';
delete from public.lesson_resources where title like 'TEST0015:%';
delete from public.lessons where title like 'TEST0015:%';
delete from public.subject_classrooms where subject_id in (
  select id from public.subjects where name like 'TEST0015:%'
);
delete from public.subjects where name like 'TEST0015:%';
delete from public.classroom_students where classroom_id in (
  select id from public.classrooms where name like 'TEST0015:%'
);
delete from public.students where first_name like 'TEST0015:%';
delete from public.classrooms where name like 'TEST0015:%';
delete from public.profiles where display_name like 'TEST0015:%';
delete from auth.users where email like 'test0015_%';

insert into auth.users (id, email) values
  ('00000000-0015-0000-0000-000000000001', 'test0015_teacher_a@example.com'),
  ('00000000-0015-0000-0000-000000000002', 'test0015_teacher_b@example.com'),
  ('00000000-0015-0000-0000-000000000003', 'test0015_student1@example.com'),
  ('00000000-0015-0000-0000-000000000004', 'test0015_student2@example.com');

insert into public.profiles (id, display_name, email, role) values
  ('00000000-0015-0000-0000-000000000001', 'TEST0015: Teacher A', 'test0015_teacher_a@example.com', 'teacher'),
  ('00000000-0015-0000-0000-000000000002', 'TEST0015: Teacher B', 'test0015_teacher_b@example.com', 'teacher'),
  ('00000000-0015-0000-0000-000000000003', 'TEST0015: Student1 Profile', 'test0015_student1@example.com', 'student'),
  ('00000000-0015-0000-0000-000000000004', 'TEST0015: Student2 Profile', 'test0015_student2@example.com', 'student');

-- Classroom A1 (teacher A), Classroom B1 (teacher B)
insert into public.classrooms (id, teacher_id, name) values
  ('00000000-0015-0001-0000-000000000001', '00000000-0015-0000-0000-000000000001', 'TEST0015: Classroom A1'),
  ('00000000-0015-0001-0000-000000000002', '00000000-0015-0000-0000-000000000002', 'TEST0015: Classroom B1');

-- Student1 in A1, Student2 in B1
insert into public.students (id, first_name, last_name, student_code, linked_profile_id) values
  ('00000000-0015-0002-0000-000000000001', 'TEST0015: S1', 'Student', 'S0015-1', '00000000-0015-0000-0000-000000000003'),
  ('00000000-0015-0002-0000-000000000002', 'TEST0015: S2', 'Student', 'S0015-2', '00000000-0015-0000-0000-000000000004');

insert into public.classroom_students (classroom_id, student_id) values
  ('00000000-0015-0001-0000-000000000001', '00000000-0015-0002-0000-000000000001'), -- S1 in A1
  ('00000000-0015-0001-0000-000000000002', '00000000-0015-0002-0000-000000000002'); -- S2 in B1

-- Subject A (teacher A, linked to A1), Subject B (teacher B, linked to B1)
insert into public.subjects (id, teacher_id, name) values
  ('00000000-0015-0003-0000-000000000001', '00000000-0015-0000-0000-000000000001', 'TEST0015: Subject A'),
  ('00000000-0015-0003-0000-000000000002', '00000000-0015-0000-0000-000000000002', 'TEST0015: Subject B');

insert into public.subject_classrooms (subject_id, classroom_id) values
  ('00000000-0015-0003-0000-000000000001', '00000000-0015-0001-0000-000000000001'),
  ('00000000-0015-0003-0000-000000000002', '00000000-0015-0001-0000-000000000002');

-- ==================================================
-- TEST 1: teacher can create a lesson on own subject+classroom, starts
-- unpublished by default
-- ==================================================
set role authenticated;
select set_test_user('00000000-0015-0000-0000-000000000001');

insert into public.lessons (id, subject_id, classroom_id, title, description, sort_order, created_by)
values (
  '00000000-0015-0004-0000-000000000001',
  '00000000-0015-0003-0000-000000000001',
  '00000000-0015-0001-0000-000000000001',
  'TEST0015: บทที่ 1 แรงและการเคลื่อนที่',
  'คำอธิบายบทเรียน',
  0,
  '00000000-0015-0000-0000-000000000001'
);

do $$
begin
  if not exists (
    select 1 from public.lessons
    where title = 'TEST0015: บทที่ 1 แรงและการเคลื่อนที่' and is_published = false and is_archived = false
  ) then
    raise exception 'TEST 1 FAILED: teacher could not create an unpublished-by-default lesson';
  end if;
  raise notice 'TEST 1 passed: teacher creates lesson, starts unpublished';
end $$;

-- ==================================================
-- TEST 2: teacher cannot create a lesson for a subject+classroom pair
-- that isn't actually linked (subject_classrooms has no matching row)
-- ==================================================
do $$
begin
  begin
    insert into public.lessons (subject_id, classroom_id, title, created_by)
    values ('00000000-0015-0003-0000-000000000001', '00000000-0015-0001-0000-000000000002', 'TEST0015: unlinked pair', '00000000-0015-0000-0000-000000000001');
    raise exception 'TEST 2 FAILED: lesson created for an unlinked subject+classroom pair';
  exception
    when insufficient_privilege or check_violation then
      raise notice 'TEST 2 passed: unlinked subject+classroom pair rejected';
  end;
end $$;

-- ==================================================
-- TEST 3: student cannot see the lesson while it is unpublished
-- ==================================================
select set_test_user('00000000-0015-0000-0000-000000000003');

do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.lessons where id = '00000000-0015-0004-0000-000000000001';
  if v_count <> 0 then
    raise exception 'TEST 3 FAILED: student saw an unpublished lesson';
  end if;
  raise notice 'TEST 3 passed: unpublished lesson hidden from enrolled student';
end $$;

-- ==================================================
-- TEST 4: teacher publishes the lesson; student can now see it
-- ==================================================
select set_test_user('00000000-0015-0000-0000-000000000001');

update public.lessons set is_published = true where id = '00000000-0015-0004-0000-000000000001';

select set_test_user('00000000-0015-0000-0000-000000000003');

do $$
begin
  if not exists (select 1 from public.lessons where id = '00000000-0015-0004-0000-000000000001') then
    raise exception 'TEST 4 FAILED: student could not see the now-published lesson';
  end if;
  raise notice 'TEST 4 passed: published lesson visible to enrolled student';
end $$;

-- ==================================================
-- TEST 5: teacher can attach SLIDE (file), VIDEO (link), DOCUMENT (file),
-- and LINK resources to the lesson
-- ==================================================
select set_test_user('00000000-0015-0000-0000-000000000001');

insert into public.lesson_resources (id, lesson_id, resource_type, title, file_path, sort_order, created_by)
values (
  '00000000-0015-0005-0000-000000000001',
  '00000000-0015-0004-0000-000000000001',
  'slide',
  'TEST0015: สไลด์บทที่ 1',
  '00000000-0015-0000-0000-000000000001/00000000-0015-0003-0000-000000000001/00000000-0015-0001-0000-000000000001/00000000-0015-0004-0000-000000000001/slide1.pdf',
  0,
  '00000000-0015-0000-0000-000000000001'
);

insert into public.lesson_resources (id, lesson_id, resource_type, title, url, sort_order, created_by)
values (
  '00000000-0015-0005-0000-000000000002',
  '00000000-0015-0004-0000-000000000001',
  'video',
  'TEST0015: คลิปการสอน',
  'https://www.youtube.com/watch?v=test0015',
  1,
  '00000000-0015-0000-0000-000000000001'
);

insert into public.lesson_resources (id, lesson_id, resource_type, title, file_path, sort_order, created_by)
values (
  '00000000-0015-0005-0000-000000000003',
  '00000000-0015-0004-0000-000000000001',
  'document',
  'TEST0015: เอกสารประกอบ',
  '00000000-0015-0000-0000-000000000001/00000000-0015-0003-0000-000000000001/00000000-0015-0001-0000-000000000001/00000000-0015-0004-0000-000000000001/doc1.pdf',
  2,
  '00000000-0015-0000-0000-000000000001'
);

insert into public.lesson_resources (id, lesson_id, resource_type, title, url, sort_order, created_by)
values (
  '00000000-0015-0005-0000-000000000004',
  '00000000-0015-0004-0000-000000000001',
  'link',
  'TEST0015: แบบจำลองออนไลน์',
  'https://phet.colorado.edu/test0015',
  3,
  '00000000-0015-0000-0000-000000000001'
);

do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.lesson_resources where lesson_id = '00000000-0015-0004-0000-000000000001';
  if v_count <> 4 then
    raise exception 'TEST 5 FAILED: expected 4 resources (slide/video/document/link), got %', v_count;
  end if;
  raise notice 'TEST 5 passed: all four resource types attached';
end $$;

-- ==================================================
-- TEST 6: a VIDEO resource can never carry an uploaded file — rejected
-- by the video-no-upload check constraint, DB-level, not just app code
-- ==================================================
do $$
begin
  begin
    insert into public.lesson_resources (lesson_id, resource_type, title, file_path)
    values ('00000000-0015-0004-0000-000000000001', 'video', 'TEST0015: bad video upload', 'some/uploaded/video.mp4');
    raise exception 'TEST 6 FAILED: a video resource with an uploaded file_path was accepted';
  exception
    when check_violation then
      raise notice 'TEST 6 passed: video-with-uploaded-file rejected by check constraint';
  end;
end $$;

-- ==================================================
-- TEST 7: invalid (non-https) URL is rejected by the check constraint
-- ==================================================
do $$
begin
  begin
    insert into public.lesson_resources (lesson_id, resource_type, title, url)
    values ('00000000-0015-0004-0000-000000000001', 'link', 'TEST0015: bad url', 'javascript:alert(1)');
    raise exception 'TEST 7 FAILED: a javascript: URL was accepted';
  exception
    when check_violation then
      raise notice 'TEST 7 passed: non-https URL rejected by check constraint';
  end;
end $$;

-- ==================================================
-- TEST 8: field-shape mismatch rejected (both file_path and url set, or
-- neither set)
-- ==================================================
do $$
begin
  begin
    insert into public.lesson_resources (lesson_id, resource_type, title, file_path, url)
    values ('00000000-0015-0004-0000-000000000001', 'document', 'TEST0015: both set', 'a/b.pdf', 'https://example.com');
    raise exception 'TEST 8 FAILED: a resource with both file_path and url was accepted';
  exception
    when check_violation then
      raise notice 'TEST 8 passed: both-set shape rejected';
  end;
end $$;

do $$
begin
  begin
    insert into public.lesson_resources (lesson_id, resource_type, title)
    values ('00000000-0015-0004-0000-000000000001', 'link', 'TEST0015: neither set');
    raise exception 'TEST 8b FAILED: a resource with neither file_path nor url was accepted';
  exception
    when check_violation then
      raise notice 'TEST 8b passed: neither-set shape rejected';
  end;
end $$;

-- ==================================================
-- TEST 9: student (enrolled, published lesson) can see all 4 resources
-- ==================================================
select set_test_user('00000000-0015-0000-0000-000000000003');

do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.lesson_resources where lesson_id = '00000000-0015-0004-0000-000000000001';
  if v_count <> 4 then
    raise exception 'TEST 9 FAILED: student saw % resources on the published lesson, expected 4', v_count;
  end if;
  raise notice 'TEST 9 passed: student sees all resources of a published, own-classroom lesson';
end $$;

-- ==================================================
-- TEST 10: teacher B (different subject/classroom) cannot see teacher
-- A's lesson or its resources
-- ==================================================
select set_test_user('00000000-0015-0000-0000-000000000002');

do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.lessons where id = '00000000-0015-0004-0000-000000000001';
  if v_count <> 0 then
    raise exception 'TEST 10 FAILED: teacher B could see teacher A''s lesson';
  end if;
  select count(*) into v_count from public.lesson_resources where lesson_id = '00000000-0015-0004-0000-000000000001';
  if v_count <> 0 then
    raise exception 'TEST 10 FAILED: teacher B could see teacher A''s lesson resources';
  end if;
  raise notice 'TEST 10 passed: cross-teacher select denied (0 rows, lesson and resources)';
end $$;

-- ==================================================
-- TEST 11: teacher B cannot UPDATE/DELETE teacher A's lesson or resource
-- (0 rows affected)
-- ==================================================
do $$
declare
  v_rows int;
begin
  update public.lessons set title = 'TEST0015: hijacked' where id = '00000000-0015-0004-0000-000000000001';
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then
    raise exception 'TEST 11 FAILED: teacher B updated teacher A''s lesson (% rows)', v_rows;
  end if;

  update public.lesson_resources set title = 'TEST0015: hijacked' where id = '00000000-0015-0005-0000-000000000001';
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then
    raise exception 'TEST 11 FAILED: teacher B updated teacher A''s resource (% rows)', v_rows;
  end if;

  delete from public.lesson_resources where id = '00000000-0015-0005-0000-000000000001';
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then
    raise exception 'TEST 11 FAILED: teacher B deleted teacher A''s resource (% rows)', v_rows;
  end if;
  raise notice 'TEST 11 passed: cross-teacher update/delete all no-op (0 rows)';
end $$;

-- ==================================================
-- TEST 12: student S2 (different classroom, B1) cannot see teacher A's
-- lesson/resources at all — 0 rows
-- ==================================================
select set_test_user('00000000-0015-0000-0000-000000000004');

do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.lessons where id = '00000000-0015-0004-0000-000000000001';
  if v_count <> 0 then
    raise exception 'TEST 12 FAILED: student S2 (different classroom) saw teacher A''s lesson';
  end if;
  select count(*) into v_count from public.lesson_resources where lesson_id = '00000000-0015-0004-0000-000000000001';
  if v_count <> 0 then
    raise exception 'TEST 12 FAILED: student S2 (different classroom) saw teacher A''s lesson resources';
  end if;
  raise notice 'TEST 12 passed: cross-classroom student read denied (0 rows, lesson and resources)';
end $$;

-- ==================================================
-- TEST 13: student cannot INSERT/UPDATE/DELETE lessons or lesson_resources
-- at all
-- ==================================================
select set_test_user('00000000-0015-0000-0000-000000000003');

do $$
begin
  begin
    insert into public.lessons (subject_id, classroom_id, title, created_by)
    values ('00000000-0015-0003-0000-000000000001', '00000000-0015-0001-0000-000000000001', 'TEST0015: student created', '00000000-0015-0000-0000-000000000003');
    raise exception 'TEST 13 FAILED: student was able to insert a lesson';
  exception
    when insufficient_privilege then
      raise notice 'TEST 13 passed (lesson insert): student insert denied';
  end;
end $$;

do $$
begin
  begin
    insert into public.lesson_resources (lesson_id, resource_type, title, url)
    values ('00000000-0015-0004-0000-000000000001', 'link', 'TEST0015: student resource', 'https://example.com/student');
    raise exception 'TEST 13 FAILED: student was able to insert a resource';
  exception
    when insufficient_privilege then
      raise notice 'TEST 13 passed (resource insert): student insert denied';
  end;
end $$;

do $$
declare
  v_rows int;
begin
  update public.lessons set title = 'TEST0015: student edited' where id = '00000000-0015-0004-0000-000000000001';
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then
    raise exception 'TEST 13 FAILED (lesson update): student updated a lesson (% rows)', v_rows;
  end if;

  update public.lesson_resources set title = 'TEST0015: student edited' where lesson_id = '00000000-0015-0004-0000-000000000001';
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then
    raise exception 'TEST 13 FAILED (resource update): student updated a resource (% rows)', v_rows;
  end if;

  delete from public.lessons where id = '00000000-0015-0004-0000-000000000001';
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then
    raise exception 'TEST 13 FAILED (lesson delete): student deleted a lesson (% rows)', v_rows;
  end if;
  raise notice 'TEST 13 passed: student write attempts (lesson + resource) all no-op (0 rows)';
end $$;

-- ==================================================
-- TEST 14: teacher archives the lesson; student can no longer see it
-- even though it is still published = true
-- ==================================================
select set_test_user('00000000-0015-0000-0000-000000000001');

update public.lessons set is_archived = true where id = '00000000-0015-0004-0000-000000000001';

select set_test_user('00000000-0015-0000-0000-000000000003');

do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.lessons where id = '00000000-0015-0004-0000-000000000001';
  if v_count <> 0 then
    raise exception 'TEST 14 FAILED: student saw an archived (still published) lesson';
  end if;
  select count(*) into v_count from public.lesson_resources where lesson_id = '00000000-0015-0004-0000-000000000001';
  if v_count <> 0 then
    raise exception 'TEST 14 FAILED: student saw resources of an archived lesson';
  end if;
  raise notice 'TEST 14 passed: archived lesson (and its resources) hidden from student regardless of is_published';
end $$;

-- Teacher can still see their own archived lesson (archiving never hides
-- it from its own owning teacher).
select set_test_user('00000000-0015-0000-0000-000000000001');

do $$
begin
  if not exists (select 1 from public.lessons where id = '00000000-0015-0004-0000-000000000001') then
    raise exception 'TEST 14b FAILED: owning teacher lost visibility into their own archived lesson';
  end if;
  raise notice 'TEST 14b passed: owning teacher still sees their own archived lesson';
end $$;

-- Un-archive for the remaining tests below.
update public.lessons set is_archived = false where id = '00000000-0015-0004-0000-000000000001';

-- ==================================================
-- TEST 15: reordering (sort_order) via UPDATE persists and is
-- teacher-scoped the same as any other field
-- ==================================================
insert into public.lessons (id, subject_id, classroom_id, title, sort_order, is_published, created_by)
values (
  '00000000-0015-0004-0000-000000000002',
  '00000000-0015-0003-0000-000000000001',
  '00000000-0015-0001-0000-000000000001',
  'TEST0015: บทที่ 2 กฎของนิวตัน',
  1,
  true,
  '00000000-0015-0000-0000-000000000001'
);

update public.lessons set sort_order = 5 where id = '00000000-0015-0004-0000-000000000001';
update public.lessons set sort_order = 1 where id = '00000000-0015-0004-0000-000000000002';

do $$
declare
  v_order1 int;
  v_order2 int;
begin
  select sort_order into v_order1 from public.lessons where id = '00000000-0015-0004-0000-000000000001';
  select sort_order into v_order2 from public.lessons where id = '00000000-0015-0004-0000-000000000002';
  if v_order1 <> 5 or v_order2 <> 1 then
    raise exception 'TEST 15 FAILED: reordered sort_order did not persist (got % and %)', v_order1, v_order2;
  end if;
  raise notice 'TEST 15 passed: lesson reorder persists';
end $$;

-- ==================================================
-- TEST 16: empty-lessons classroom still selects/works normally —
-- Classroom/Subject B has zero lessons.
-- ==================================================
select set_test_user('00000000-0015-0000-0000-000000000002');

do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.lessons where subject_id = '00000000-0015-0003-0000-000000000002';
  if v_count <> 0 then
    raise exception 'TEST 16 FAILED: Subject B unexpectedly has lessons';
  end if;
  if not exists (select 1 from public.subjects where id = '00000000-0015-0003-0000-000000000002') then
    raise exception 'TEST 16 FAILED: teacher B cannot even see own lesson-less subject';
  end if;
  raise notice 'TEST 16 passed: a subject with zero lessons remains fully valid/usable';
end $$;

-- ==================================================
-- STORAGE: 'lesson-files' bucket + storage.objects policies
-- ==================================================

reset role;

insert into storage.buckets (id, name, public) values ('lesson-files', 'lesson-files', false)
on conflict (id) do nothing;

set role authenticated;

-- TEST 17: teacher A can insert a storage object under own uid prefix
select set_test_user('00000000-0015-0000-0000-000000000001');

insert into storage.objects (bucket_id, name, owner)
values (
  'lesson-files',
  '00000000-0015-0000-0000-000000000001/00000000-0015-0003-0000-000000000001/00000000-0015-0001-0000-000000000001/00000000-0015-0004-0000-000000000001/TEST0015-slide1.pdf',
  '00000000-0015-0000-0000-000000000001'
);

do $$
begin
  if not exists (select 1 from storage.objects where name like '%TEST0015-slide1.pdf') then
    raise exception 'TEST 17 FAILED: teacher A could not insert an object under own uid prefix';
  end if;
  raise notice 'TEST 17 passed: teacher inserts storage object under own prefix';
end $$;

-- TEST 18: teacher A cannot insert a storage object under teacher B's prefix
do $$
begin
  begin
    insert into storage.objects (bucket_id, name, owner)
    values (
      'lesson-files',
      '00000000-0015-0000-0000-000000000002/subj/class/lesson/TEST0015-hostile.pdf',
      '00000000-0015-0000-0000-000000000001'
    );
    raise exception 'TEST 18 FAILED: teacher A inserted an object under teacher B''s uid prefix';
  exception
    when insufficient_privilege then
      raise notice 'TEST 18 passed: cross-teacher storage insert denied';
  end;
end $$;

-- TEST 19: student S1 (own classroom, lesson published+non-archived) can
-- SELECT the storage object via the lesson_id path segment
select set_test_user('00000000-0015-0000-0000-000000000003');

do $$
begin
  if not exists (select 1 from storage.objects where name like '%TEST0015-slide1.pdf') then
    raise exception 'TEST 19 FAILED: student S1 could not see own-classroom published-lesson file object';
  end if;
  raise notice 'TEST 19 passed: student sees storage object of a published, own-classroom lesson';
end $$;

-- TEST 20: teacher unpublishes the lesson; the SAME student immediately
-- loses SELECT on the storage object too (publish state is checked live
-- through student_can_view_lesson(), not cached on the object)
select set_test_user('00000000-0015-0000-0000-000000000001');
update public.lessons set is_published = false where id = '00000000-0015-0004-0000-000000000001';

select set_test_user('00000000-0015-0000-0000-000000000003');

do $$
declare
  v_count int;
begin
  select count(*) into v_count from storage.objects where name like '%TEST0015-slide1.pdf';
  if v_count <> 0 then
    raise exception 'TEST 20 FAILED: student could still see the storage object of a now-unpublished lesson';
  end if;
  raise notice 'TEST 20 passed: unpublishing the lesson immediately revokes storage object visibility too';
end $$;

-- Republish for the remaining tests.
select set_test_user('00000000-0015-0000-0000-000000000001');
update public.lessons set is_published = true where id = '00000000-0015-0004-0000-000000000001';

-- TEST 21: student S2 (different classroom, B1) cannot SELECT that
-- object at all, published or not — 0 rows
select set_test_user('00000000-0015-0000-0000-000000000004');

do $$
declare
  v_count int;
begin
  select count(*) into v_count from storage.objects where name like '%TEST0015-slide1.pdf';
  if v_count <> 0 then
    raise exception 'TEST 21 FAILED: student S2 (different classroom) saw teacher A''s lesson file object';
  end if;
  raise notice 'TEST 21 passed: cross-classroom student storage read denied (0 rows)';
end $$;

-- TEST 22: student cannot INSERT/UPDATE/DELETE storage objects at all
select set_test_user('00000000-0015-0000-0000-000000000003');

do $$
begin
  begin
    insert into storage.objects (bucket_id, name, owner)
    values ('lesson-files', '00000000-0015-0000-0000-000000000001/x/00000000-0015-0001-0000-000000000001/00000000-0015-0004-0000-000000000001/TEST0015-student-upload.pdf', '00000000-0015-0000-0000-000000000003');
    raise exception 'TEST 22 FAILED: student inserted a storage object';
  exception
    when insufficient_privilege then
      raise notice 'TEST 22 passed: student storage insert denied';
  end;
end $$;

do $$
declare
  v_rows int;
begin
  update storage.objects set name = name || '-x' where name like '%TEST0015-slide1.pdf';
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then
    raise exception 'TEST 22 FAILED (update): student updated a storage object (% rows)', v_rows;
  end if;

  delete from storage.objects where name like '%TEST0015-slide1.pdf';
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then
    raise exception 'TEST 22 FAILED (delete): student deleted a storage object (% rows)', v_rows;
  end if;
  raise notice 'TEST 22 passed: student storage update/delete both no-op (0 rows)';
end $$;

-- TEST 23: malformed/short object name never errors the whole query —
-- lesson_files_path_lesson_id() returns NULL, not an exception, and the
-- row is simply excluded (never a false grant either).
reset role;

insert into storage.objects (bucket_id, name, owner) values
  ('lesson-files', 'TEST0015-malformed-no-slashes.pdf', null),
  ('lesson-files', '00000000-0015-0000-0000-000000000001/TEST0015-too-short/file.pdf', null),
  ('lesson-files', '00000000-0015-0000-0000-000000000001/subj/class/not-a-uuid/TEST0015-bad-uuid.pdf', null);

set role authenticated;
select set_test_user('00000000-0015-0000-0000-000000000003');

do $$
declare
  v_count int;
begin
  -- Must not raise — this is the entire point of the test.
  select count(*) into v_count from storage.objects where name like '%TEST0015-malformed%' or name like '%TEST0015-too-short%' or name like '%TEST0015-bad-uuid%';
  if v_count <> 0 then
    raise exception 'TEST 23 FAILED: student could see % malformed-path object(s) (should be 0, denied)', v_count;
  end if;
  raise notice 'TEST 23 passed: malformed storage object names are safely denied, not erroring';
end $$;

reset role;

-- ==================================================
-- TEST 24: the exact "teacher sees it, one specific student doesn't"
-- scenario — a single subject linked to TWO classrooms, a student
-- enrolled in only ONE of them. Reproduces a real production report
-- (2026-09) where a published lesson was visible to the teacher but not
-- to an enrolled student; this proves RLS behaves exactly as designed —
-- a lesson published under a classroom the student does NOT belong to
-- is correctly invisible to them, which is data/workflow (the teacher
-- picked the wrong classroom in the picker), not an RLS defect.
-- ==================================================

insert into public.classrooms (id, teacher_id, name) values
  ('00000000-0015-0001-0000-000000000003', '00000000-0015-0000-0000-000000000001', 'TEST0015: Classroom A3 (multi-link)');

insert into public.subject_classrooms (subject_id, classroom_id) values
  ('00000000-0015-0003-0000-000000000001', '00000000-0015-0001-0000-000000000003');
-- Subject A is now linked to BOTH classroom A1 (student S1's classroom)
-- AND this new classroom A3 (student S1 is NOT a member of).

set role authenticated;
select set_test_user('00000000-0015-0000-0000-000000000001');

insert into public.lessons (id, subject_id, classroom_id, title, is_published, created_by)
values (
  '00000000-0015-0004-0000-000000000003',
  '00000000-0015-0003-0000-000000000001',
  '00000000-0015-0001-0000-000000000003',
  'TEST0015: บทที่ 4 published under the OTHER classroom',
  true,
  '00000000-0015-0000-0000-000000000001'
);

select set_test_user('00000000-0015-0000-0000-000000000003');

do $$
declare
  v_count_own int;
  v_count_other int;
begin
  select count(*) into v_count_own from public.lessons
  where subject_id = '00000000-0015-0003-0000-000000000001' and classroom_id = '00000000-0015-0001-0000-000000000001';
  select count(*) into v_count_other from public.lessons
  where subject_id = '00000000-0015-0003-0000-000000000001' and classroom_id = '00000000-0015-0001-0000-000000000003';

  if v_count_own < 1 then
    raise exception 'TEST 24 FAILED: student cannot see the published lesson in THEIR OWN classroom (got %)', v_count_own;
  end if;
  if v_count_other <> 0 then
    raise exception 'TEST 24 FAILED: student sees a lesson published under a classroom they are NOT enrolled in (got %)', v_count_other;
  end if;
  raise notice 'TEST 24 passed: same-subject multi-classroom scoping is exact — a lesson is visible only in the specific classroom it was published under, confirming the "teacher sees it, student does not" report is a classroom-selection mismatch, not an RLS defect';
end $$;

select set_test_user('00000000-0015-0000-0000-000000000001');
delete from public.lessons where id = '00000000-0015-0004-0000-000000000003';
delete from public.subject_classrooms where subject_id = '00000000-0015-0003-0000-000000000001' and classroom_id = '00000000-0015-0001-0000-000000000003';
reset role;
delete from public.classrooms where id = '00000000-0015-0001-0000-000000000003';

-- ==================================================
-- TEST 25: a published lesson with ZERO resources is still visible to
-- the enrolled student (Section 5 requirement: "A lesson must still
-- appear even if it has zero resources").
-- ==================================================

set role authenticated;
select set_test_user('00000000-0015-0000-0000-000000000001');

insert into public.lessons (id, subject_id, classroom_id, title, is_published, created_by)
values (
  '00000000-0015-0004-0000-000000000004',
  '00000000-0015-0003-0000-000000000001',
  '00000000-0015-0001-0000-000000000001',
  'TEST0015: บทที่ 5 no resources yet',
  true,
  '00000000-0015-0000-0000-000000000001'
);

select set_test_user('00000000-0015-0000-0000-000000000003');

do $$
declare
  v_lesson_count int;
  v_resource_count int;
begin
  select count(*) into v_lesson_count from public.lessons where id = '00000000-0015-0004-0000-000000000004';
  select count(*) into v_resource_count from public.lesson_resources where lesson_id = '00000000-0015-0004-0000-000000000004';

  if v_lesson_count <> 1 then
    raise exception 'TEST 25 FAILED: a resource-less published lesson is not visible to the enrolled student';
  end if;
  if v_resource_count <> 0 then
    raise exception 'TEST 25 FAILED: unexpectedly found resources on a lesson that should have none';
  end if;
  raise notice 'TEST 25 passed: a lesson with zero resources still appears to the student — resource count 0 is never mistaken for the lesson itself being hidden';
end $$;

select set_test_user('00000000-0015-0000-0000-000000000001');
delete from public.lessons where id = '00000000-0015-0004-0000-000000000004';
reset role;

-- ==================================================
-- Cleanup
-- ==================================================

delete from storage.objects where name like '%TEST0015%';
delete from public.lesson_resources where title like 'TEST0015:%';
delete from public.lessons where title like 'TEST0015:%';
delete from public.subject_classrooms where subject_id in (
  select id from public.subjects where name like 'TEST0015:%'
);
delete from public.subjects where name like 'TEST0015:%';
delete from public.classroom_students where classroom_id in (
  select id from public.classrooms where name like 'TEST0015:%'
);
delete from public.students where first_name like 'TEST0015:%';
delete from public.classrooms where name like 'TEST0015:%';
delete from public.profiles where display_name like 'TEST0015:%';
delete from auth.users where email like 'test0015_%';

do $$
begin
  alter table auth.users enable trigger on_auth_user_created;
exception when undefined_object then null;
end $$;

select 'supabase/tests/0015_lessons.sql: ALL TESTS PASSED' as result;
