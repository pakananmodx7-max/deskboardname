-- Regression / adversarial test script for
-- 0013_assignment_resources.sql. NOT applied automatically and NOT part
-- of the application schema — this is a dev-only verification tool,
-- meant to be run against a throwaway local Postgres instance that
-- already has 0001-0013 applied (plus a hand-rolled auth/storage shim —
-- see docs/DATABASE.md's "Empirical RLS verification methodology" for
-- how prior migrations' equivalents were verified the same way).
--
-- Self-contained: creates its own fixtures (two teachers, two
-- classrooms/subjects/assignments, two students each in a different
-- classroom, one linked auth.users row per person), asserts every rule
-- below with RAISE EXCEPTION on failure, and cleans up its own rows at
-- the end so it can be re-run repeatedly against the same scratch
-- database.
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

delete from storage.objects where name like '%TEST0013%';
delete from public.assignment_resources where title like 'TEST0013:%';
delete from public.assignments where title like 'TEST0013:%';
delete from public.subject_classrooms where subject_id in (
  select id from public.subjects where name like 'TEST0013:%'
);
delete from public.subjects where name like 'TEST0013:%';
delete from public.classroom_students where classroom_id in (
  select id from public.classrooms where name like 'TEST0013:%'
);
delete from public.students where first_name like 'TEST0013:%';
delete from public.classrooms where name like 'TEST0013:%';
delete from public.profiles where display_name like 'TEST0013:%';
delete from auth.users where email like 'test0013_%';

insert into auth.users (id, email) values
  ('00000000-0013-0000-0000-000000000001', 'test0013_teacher_a@example.com'),
  ('00000000-0013-0000-0000-000000000002', 'test0013_teacher_b@example.com'),
  ('00000000-0013-0000-0000-000000000003', 'test0013_student1@example.com'),
  ('00000000-0013-0000-0000-000000000004', 'test0013_student2@example.com');

insert into public.profiles (id, display_name, email, role) values
  ('00000000-0013-0000-0000-000000000001', 'TEST0013: Teacher A', 'test0013_teacher_a@example.com', 'teacher'),
  ('00000000-0013-0000-0000-000000000002', 'TEST0013: Teacher B', 'test0013_teacher_b@example.com', 'teacher'),
  ('00000000-0013-0000-0000-000000000003', 'TEST0013: Student1 Profile', 'test0013_student1@example.com', 'student'),
  ('00000000-0013-0000-0000-000000000004', 'TEST0013: Student2 Profile', 'test0013_student2@example.com', 'student');

-- Classroom A1 (teacher A), Classroom B1 (teacher B)
insert into public.classrooms (id, teacher_id, name) values
  ('00000000-0013-0001-0000-000000000001', '00000000-0013-0000-0000-000000000001', 'TEST0013: Classroom A1'),
  ('00000000-0013-0001-0000-000000000002', '00000000-0013-0000-0000-000000000002', 'TEST0013: Classroom B1');

-- Student1 in A1, Student2 in B1
insert into public.students (id, first_name, last_name, student_code, linked_profile_id) values
  ('00000000-0013-0002-0000-000000000001', 'TEST0013: S1', 'Student', 'S0013-1', '00000000-0013-0000-0000-000000000003'),
  ('00000000-0013-0002-0000-000000000002', 'TEST0013: S2', 'Student', 'S0013-2', '00000000-0013-0000-0000-000000000004');

insert into public.classroom_students (classroom_id, student_id) values
  ('00000000-0013-0001-0000-000000000001', '00000000-0013-0002-0000-000000000001'), -- S1 in A1
  ('00000000-0013-0001-0000-000000000002', '00000000-0013-0002-0000-000000000002'); -- S2 in B1

-- Subject A (teacher A, linked to A1), Subject B (teacher B, linked to B1)
insert into public.subjects (id, teacher_id, name) values
  ('00000000-0013-0003-0000-000000000001', '00000000-0013-0000-0000-000000000001', 'TEST0013: Subject A'),
  ('00000000-0013-0003-0000-000000000002', '00000000-0013-0000-0000-000000000002', 'TEST0013: Subject B');

insert into public.subject_classrooms (subject_id, classroom_id) values
  ('00000000-0013-0003-0000-000000000001', '00000000-0013-0001-0000-000000000001'),
  ('00000000-0013-0003-0000-000000000002', '00000000-0013-0001-0000-000000000002');

-- Assignment A (subject A / classroom A1, owned by teacher A),
-- Assignment B (subject B / classroom B1, owned by teacher B)
insert into public.assignments (id, subject_id, classroom_id, title, created_by) values
  ('00000000-0013-0004-0000-000000000001', '00000000-0013-0003-0000-000000000001', '00000000-0013-0001-0000-000000000001', 'TEST0013: Assignment A', '00000000-0013-0000-0000-000000000001'),
  ('00000000-0013-0004-0000-000000000002', '00000000-0013-0003-0000-000000000002', '00000000-0013-0001-0000-000000000002', 'TEST0013: Assignment B', '00000000-0013-0000-0000-000000000002');

-- ==================================================
-- TEST 1: teacher can insert a FILE resource on own assignment
-- ==================================================
set role authenticated;
select set_test_user('00000000-0013-0000-0000-000000000001');

insert into public.assignment_resources (id, assignment_id, resource_type, title, file_path, sort_order, created_by)
values (
  '00000000-0013-0005-0000-000000000001',
  '00000000-0013-0004-0000-000000000001',
  'file',
  'TEST0013: ใบงานบทที่ 2',
  '00000000-0013-0000-0000-000000000001/00000000-0013-0003-0000-000000000001/00000000-0013-0001-0000-000000000001/00000000-0013-0004-0000-000000000001/abc123.pdf',
  0,
  '00000000-0013-0000-0000-000000000001'
);

do $$
begin
  if not exists (select 1 from public.assignment_resources where title = 'TEST0013: ใบงานบทที่ 2') then
    raise exception 'TEST 1 FAILED: teacher could not insert a file resource on own assignment';
  end if;
  raise notice 'TEST 1 passed: teacher adds file resource';
end $$;

-- ==================================================
-- TEST 2: teacher can insert a LINK resource on own assignment
-- ==================================================
insert into public.assignment_resources (id, assignment_id, resource_type, title, url, sort_order, created_by)
values (
  '00000000-0013-0005-0000-000000000002',
  '00000000-0013-0004-0000-000000000001',
  'link',
  'TEST0013: แบบทดสอบ Google Form',
  'https://forms.google.com/test0013',
  1,
  '00000000-0013-0000-0000-000000000001'
);

do $$
begin
  if not exists (select 1 from public.assignment_resources where title = 'TEST0013: แบบทดสอบ Google Form') then
    raise exception 'TEST 2 FAILED: teacher could not insert a link resource on own assignment';
  end if;
  raise notice 'TEST 2 passed: teacher adds link resource';
end $$;

-- ==================================================
-- TEST 3: assignment now has both file + link + multiple resources
-- ==================================================
insert into public.assignment_resources (id, assignment_id, resource_type, title, url, sort_order, created_by)
values (
  '00000000-0013-0005-0000-000000000003',
  '00000000-0013-0004-0000-000000000001',
  'link',
  'TEST0013: Kahoot',
  'https://kahoot.it/test0013',
  2,
  '00000000-0013-0000-0000-000000000001'
);

do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.assignment_resources where assignment_id = '00000000-0013-0004-0000-000000000001';
  if v_count <> 3 then
    raise exception 'TEST 3 FAILED: expected 3 resources (1 file + 2 links) on Assignment A, got %', v_count;
  end if;
  raise notice 'TEST 3 passed: assignment holds both file + multiple link resources';
end $$;

-- ==================================================
-- TEST 4: invalid (non-https) URL is rejected by the check constraint
-- ==================================================
do $$
begin
  begin
    insert into public.assignment_resources (assignment_id, resource_type, title, url)
    values ('00000000-0013-0004-0000-000000000001', 'link', 'TEST0013: bad url', 'javascript:alert(1)');
    raise exception 'TEST 4 FAILED: a javascript: URL was accepted';
  exception
    when check_violation then
      raise notice 'TEST 4 passed: non-https URL rejected by check constraint';
  end;
end $$;

-- ==================================================
-- TEST 5: resource_type/field-shape mismatch is rejected (file with url set,
-- or a 'file' row missing file_path) — the type_fields_check constraint
-- ==================================================
do $$
begin
  begin
    insert into public.assignment_resources (assignment_id, resource_type, title, file_path, url)
    values ('00000000-0013-0004-0000-000000000001', 'file', 'TEST0013: bad shape', 'some/path.pdf', 'https://example.com');
    raise exception 'TEST 5 FAILED: a file resource with both file_path and url was accepted';
  exception
    when check_violation then
      raise notice 'TEST 5 passed: mismatched file/link fields rejected by check constraint';
  end;
end $$;

do $$
begin
  begin
    insert into public.assignment_resources (assignment_id, resource_type, title)
    values ('00000000-0013-0004-0000-000000000001', 'link', 'TEST0013: missing url');
    raise exception 'TEST 5b FAILED: a link resource with no url was accepted';
  exception
    when check_violation then
      raise notice 'TEST 5b passed: link resource with no url rejected';
  end;
end $$;

-- ==================================================
-- TEST 6: teacher B cannot insert a resource on teacher A's assignment
-- ==================================================
select set_test_user('00000000-0013-0000-0000-000000000002');

do $$
begin
  begin
    insert into public.assignment_resources (assignment_id, resource_type, title, url)
    values ('00000000-0013-0004-0000-000000000001', 'link', 'TEST0013: should not be allowed', 'https://example.com/hostile');
    raise exception 'TEST 6 FAILED: teacher B inserted a resource on teacher A''s assignment';
  exception
    when insufficient_privilege or check_violation then
      raise notice 'TEST 6 passed: cross-teacher insert denied';
  end;
end $$;

-- ==================================================
-- TEST 7: teacher B cannot SELECT teacher A's assignment resources
-- ==================================================
do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.assignment_resources where assignment_id = '00000000-0013-0004-0000-000000000001';
  if v_count <> 0 then
    raise exception 'TEST 7 FAILED: teacher B could see % of teacher A''s resources', v_count;
  end if;
  raise notice 'TEST 7 passed: cross-teacher select denied (0 rows)';
end $$;

-- ==================================================
-- TEST 8: teacher B cannot UPDATE/DELETE teacher A's resource (0 rows affected)
-- ==================================================
do $$
declare
  v_rows int;
begin
  update public.assignment_resources set title = 'TEST0013: hijacked' where id = '00000000-0013-0005-0000-000000000001';
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then
    raise exception 'TEST 8 FAILED: teacher B updated teacher A''s resource (% rows)', v_rows;
  end if;

  delete from public.assignment_resources where id = '00000000-0013-0005-0000-000000000001';
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then
    raise exception 'TEST 8b FAILED: teacher B deleted teacher A''s resource (% rows)', v_rows;
  end if;
  raise notice 'TEST 8 passed: cross-teacher update/delete both no-op (0 rows)';
end $$;

-- ==================================================
-- TEST 9: teacher A's resource is confirmed unchanged after teacher B's attempts
-- ==================================================
select set_test_user('00000000-0013-0000-0000-000000000001');

do $$
begin
  if not exists (select 1 from public.assignment_resources where id = '00000000-0013-0005-0000-000000000001' and title = 'TEST0013: ใบงานบทที่ 2') then
    raise exception 'TEST 9 FAILED: teacher A''s resource was altered by teacher B''s denied attempts';
  end if;
  raise notice 'TEST 9 passed: resource unchanged after other teacher''s denied attempts';
end $$;

-- ==================================================
-- TEST 10: student S1 (in classroom A1) can SELECT Assignment A's resources
-- ==================================================
select set_test_user('00000000-0013-0000-0000-000000000003');

do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.assignment_resources where assignment_id = '00000000-0013-0004-0000-000000000001';
  if v_count <> 3 then
    raise exception 'TEST 10 FAILED: student S1 (own classroom) saw % resources, expected 3', v_count;
  end if;
  raise notice 'TEST 10 passed: student sees own-classroom assignment resources';
end $$;

-- ==================================================
-- TEST 11: student S2 (in classroom B1) cannot SELECT Assignment A's
-- resources (different classroom) — 0 rows
-- ==================================================
select set_test_user('00000000-0013-0000-0000-000000000004');

do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.assignment_resources where assignment_id = '00000000-0013-0004-0000-000000000001';
  if v_count <> 0 then
    raise exception 'TEST 11 FAILED: student S2 (different classroom) saw % of Assignment A''s resources', v_count;
  end if;
  raise notice 'TEST 11 passed: cross-classroom student read denied (0 rows)';
end $$;

-- ==================================================
-- TEST 12: student cannot INSERT/UPDATE/DELETE assignment_resources at all
-- ==================================================
select set_test_user('00000000-0013-0000-0000-000000000003');

do $$
begin
  begin
    insert into public.assignment_resources (assignment_id, resource_type, title, url)
    values ('00000000-0013-0004-0000-000000000001', 'link', 'TEST0013: student inserted', 'https://example.com/student');
    raise exception 'TEST 12 FAILED: student was able to insert a resource';
  exception
    when insufficient_privilege then
      raise notice 'TEST 12 passed (insert): student insert denied';
  end;
end $$;

do $$
declare
  v_rows int;
begin
  update public.assignment_resources set title = 'TEST0013: student edited' where id = '00000000-0013-0005-0000-000000000001';
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then
    raise exception 'TEST 12 FAILED (update): student updated a resource (% rows)', v_rows;
  end if;

  delete from public.assignment_resources where id = '00000000-0013-0005-0000-000000000001';
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then
    raise exception 'TEST 12 FAILED (delete): student deleted a resource (% rows)', v_rows;
  end if;
  raise notice 'TEST 12 passed (update/delete): student write attempts both no-op (0 rows)';
end $$;

-- ==================================================
-- TEST 13: deleted resource disappears safely (owning teacher deletes it,
-- confirm 0 rows afterward, no error, no orphan)
-- ==================================================
select set_test_user('00000000-0013-0000-0000-000000000001');

delete from public.assignment_resources where id = '00000000-0013-0005-0000-000000000003';

do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.assignment_resources where id = '00000000-0013-0005-0000-000000000003';
  if v_count <> 0 then
    raise exception 'TEST 13 FAILED: resource still present after owning teacher deleted it';
  end if;
  select count(*) into v_count from public.assignment_resources where assignment_id = '00000000-0013-0004-0000-000000000001';
  if v_count <> 2 then
    raise exception 'TEST 13 FAILED: expected 2 remaining resources on Assignment A, got %', v_count;
  end if;
  raise notice 'TEST 13 passed: deleted resource disappears safely, siblings unaffected';
end $$;

-- ==================================================
-- TEST 14: existing assignment (no resources at all) still selects/works
-- normally — Assignment B has zero assignment_resources rows.
-- ==================================================
select set_test_user('00000000-0013-0000-0000-000000000002');

do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.assignment_resources where assignment_id = '00000000-0013-0004-0000-000000000002';
  if v_count <> 0 then
    raise exception 'TEST 14 FAILED: Assignment B unexpectedly has resources';
  end if;
  if not exists (select 1 from public.assignments where id = '00000000-0013-0004-0000-000000000002') then
    raise exception 'TEST 14 FAILED: teacher B cannot even see own resource-less assignment';
  end if;
  raise notice 'TEST 14 passed: an assignment with zero resources remains fully valid/usable';
end $$;

-- ==================================================
-- STORAGE: 'assignment-files' bucket + storage.objects policies
-- ==================================================

reset role;

insert into storage.buckets (id, name, public) values ('assignment-files', 'assignment-files', false)
on conflict (id) do nothing;

set role authenticated;

-- TEST 15: teacher A can insert a storage object under own uid prefix
select set_test_user('00000000-0013-0000-0000-000000000001');

insert into storage.objects (bucket_id, name, owner)
values (
  'assignment-files',
  '00000000-0013-0000-0000-000000000001/00000000-0013-0003-0000-000000000001/00000000-0013-0001-0000-000000000001/00000000-0013-0004-0000-000000000001/TEST0013-file1.pdf',
  '00000000-0013-0000-0000-000000000001'
);

do $$
begin
  if not exists (select 1 from storage.objects where name like '%TEST0013-file1.pdf') then
    raise exception 'TEST 15 FAILED: teacher A could not insert an object under own uid prefix';
  end if;
  raise notice 'TEST 15 passed: teacher inserts storage object under own prefix';
end $$;

-- TEST 16: teacher A cannot insert a storage object under teacher B's prefix
do $$
begin
  begin
    insert into storage.objects (bucket_id, name, owner)
    values (
      'assignment-files',
      '00000000-0013-0000-0000-000000000002/00000000-0013-0003-0000-000000000002/00000000-0013-0001-0000-000000000002/00000000-0013-0004-0000-000000000002/TEST0013-hostile.pdf',
      '00000000-0013-0000-0000-000000000001'
    );
    raise exception 'TEST 16 FAILED: teacher A inserted an object under teacher B''s uid prefix';
  exception
    when insufficient_privilege then
      raise notice 'TEST 16 passed: cross-teacher storage insert denied';
  end;
end $$;

-- Teacher B writes their own object for the isolation checks below.
select set_test_user('00000000-0013-0000-0000-000000000002');

insert into storage.objects (bucket_id, name, owner)
values (
  'assignment-files',
  '00000000-0013-0000-0000-000000000002/00000000-0013-0003-0000-000000000002/00000000-0013-0001-0000-000000000002/00000000-0013-0004-0000-000000000002/TEST0013-file2.pdf',
  '00000000-0013-0000-0000-000000000002'
);

-- TEST 17: teacher A cannot SELECT teacher B's storage object
select set_test_user('00000000-0013-0000-0000-000000000001');

do $$
declare
  v_count int;
begin
  select count(*) into v_count from storage.objects where name like '%TEST0013-file2.pdf';
  if v_count <> 0 then
    raise exception 'TEST 17 FAILED: teacher A could see teacher B''s storage object';
  end if;
  raise notice 'TEST 17 passed: cross-teacher storage select denied (0 rows)';
end $$;

-- TEST 18: teacher A cannot UPDATE/DELETE teacher B's storage object
do $$
declare
  v_rows int;
begin
  update storage.objects set name = name || '-hijacked' where name like '%TEST0013-file2.pdf';
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then
    raise exception 'TEST 18 FAILED: teacher A updated teacher B''s storage object (% rows)', v_rows;
  end if;

  delete from storage.objects where name like '%TEST0013-file2.pdf';
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then
    raise exception 'TEST 18 FAILED: teacher A deleted teacher B''s storage object (% rows)', v_rows;
  end if;
  raise notice 'TEST 18 passed: cross-teacher storage update/delete both no-op (0 rows)';
end $$;

-- TEST 19: student S1 (classroom A1) can SELECT the storage object whose
-- path's classroom_id segment is A1 (teacher A's file)
select set_test_user('00000000-0013-0000-0000-000000000003');

do $$
begin
  if not exists (select 1 from storage.objects where name like '%TEST0013-file1.pdf') then
    raise exception 'TEST 19 FAILED: student S1 could not see own-classroom assignment file object';
  end if;
  raise notice 'TEST 19 passed: student sees own-classroom storage object';
end $$;

-- TEST 20: student S2 (classroom B1) cannot SELECT that same object
-- (different classroom) — 0 rows
select set_test_user('00000000-0013-0000-0000-000000000004');

do $$
declare
  v_count int;
begin
  select count(*) into v_count from storage.objects where name like '%TEST0013-file1.pdf';
  if v_count <> 0 then
    raise exception 'TEST 20 FAILED: student S2 (different classroom) saw teacher A''s file object';
  end if;
  raise notice 'TEST 20 passed: cross-classroom student storage read denied (0 rows)';
end $$;

-- TEST 21: student cannot INSERT/UPDATE/DELETE storage objects at all
select set_test_user('00000000-0013-0000-0000-000000000003');

do $$
begin
  begin
    insert into storage.objects (bucket_id, name, owner)
    values ('assignment-files', '00000000-0013-0000-0000-000000000001/x/00000000-0013-0001-0000-000000000001/y/TEST0013-student-upload.pdf', '00000000-0013-0000-0000-000000000003');
    raise exception 'TEST 21 FAILED: student inserted a storage object';
  exception
    when insufficient_privilege then
      raise notice 'TEST 21 passed: student storage insert denied';
  end;
end $$;

do $$
declare
  v_rows int;
begin
  update storage.objects set name = name || '-x' where name like '%TEST0013-file1.pdf';
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then
    raise exception 'TEST 21 FAILED (update): student updated a storage object (% rows)', v_rows;
  end if;

  delete from storage.objects where name like '%TEST0013-file1.pdf';
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then
    raise exception 'TEST 21 FAILED (delete): student deleted a storage object (% rows)', v_rows;
  end if;
  raise notice 'TEST 21 passed: student storage update/delete both no-op (0 rows)';
end $$;

-- TEST 22: malformed/short object name never errors the whole query —
-- assignment_files_path_classroom_id() returns NULL, not an exception,
-- and the row is simply excluded (never a false grant either).
reset role;

insert into storage.objects (bucket_id, name, owner) values
  ('assignment-files', 'TEST0013-malformed-no-slashes.pdf', null),
  ('assignment-files', '00000000-0013-0000-0000-000000000001/TEST0013-too-short/file.pdf', null),
  ('assignment-files', '00000000-0013-0000-0000-000000000001/subj/not-a-uuid/assign/TEST0013-bad-uuid.pdf', null);

set role authenticated;
select set_test_user('00000000-0013-0000-0000-000000000003');

do $$
declare
  v_count int;
begin
  -- Must not raise — this is the entire point of the test.
  select count(*) into v_count from storage.objects where name like '%TEST0013-malformed%' or name like '%TEST0013-too-short%' or name like '%TEST0013-bad-uuid%';
  if v_count <> 0 then
    raise exception 'TEST 22 FAILED: student could see % malformed-path object(s) (should be 0, denied)', v_count;
  end if;
  raise notice 'TEST 22 passed: malformed storage object names are safely denied, not erroring';
end $$;

reset role;

-- ==================================================
-- Cleanup
-- ==================================================

delete from storage.objects where name like '%TEST0013%';
delete from public.assignment_resources where title like 'TEST0013:%';
delete from public.assignments where title like 'TEST0013:%';
delete from public.subject_classrooms where subject_id in (
  select id from public.subjects where name like 'TEST0013:%'
);
delete from public.subjects where name like 'TEST0013:%';
delete from public.classroom_students where classroom_id in (
  select id from public.classrooms where name like 'TEST0013:%'
);
delete from public.students where first_name like 'TEST0013:%';
delete from public.classrooms where name like 'TEST0013:%';
delete from public.profiles where display_name like 'TEST0013:%';
delete from auth.users where email like 'test0013_%';

do $$
begin
  alter table auth.users enable trigger on_auth_user_created;
exception when undefined_object then null;
end $$;

\echo '0013_assignment_resources.sql: ALL TESTS PASSED'
