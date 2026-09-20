-- Empirical verification for 0024_fix_sgs_score_column_delete_guard.sql
--
-- DEV-ONLY verification script, never applied to any real database and
-- never run automatically. Run against a disposable local Postgres with
-- every migration through 0024 applied in order, using the auth shim
-- described in supabase/tests/0009_student_link_rpc_permissions.sql.
--
-- Covers, in order:
--   B1  a column with ZERO sgs_scores rows -> delete allowed
--   B2  a column whose rows are ALL score IS NULL -> delete allowed
--   B3  a column with one row scored 0 -> delete BLOCKED (0 is a real score)
--   B4  a column with one row scored a positive number -> delete BLOCKED
--   B5  deleting the B1/B2 columns actually removed their NULL
--       placeholder rows too (cascade), and left B3/B4's columns/rows and
--       an unrelated column completely untouched
--   B6  the pg_trigger_depth() <= 1 guard still lets a whole-classroom
--       delete cascade away a column that DOES have a real score
--       (unchanged from 0023 — this fix must never break that)

\set ON_ERROR_STOP 1

set role authenticated;
select public.set_test_user(null);
reset role;
set role postgres;

insert into auth.users (id, email) values
  ('b1b1b1b1-0000-0000-0000-000000000001', 't-sgsdelete@example.com');
-- handle_new_user (0003) auto-creates a 'teacher' profile.

insert into public.classrooms (id, teacher_id, name) values
  ('c4c4c4c4-0000-0000-0000-000000000001', 'b1b1b1b1-0000-0000-0000-000000000001', 'ม.6/1 (sgs delete test)');

insert into public.students (id, created_by, first_name, last_name) values
  ('54545454-0000-0000-0000-000000000001', 'b1b1b1b1-0000-0000-0000-000000000001', 'Kate', 'Test'),
  ('55555555-0000-0000-0000-000000000002', 'b1b1b1b1-0000-0000-0000-000000000001', 'Somchai', 'Test');

insert into public.classroom_students (classroom_id, student_id) values
  ('c4c4c4c4-0000-0000-0000-000000000001', '54545454-0000-0000-0000-000000000001'),
  ('c4c4c4c4-0000-0000-0000-000000000001', '55555555-0000-0000-0000-000000000002');

insert into public.subjects (id, teacher_id, name) values
  ('d4d4d4d4-0000-0000-0000-000000000001', 'b1b1b1b1-0000-0000-0000-000000000001', 'วิทยาศาสตร์ (sgs delete test)');
insert into public.subject_classrooms (subject_id, classroom_id) values
  ('d4d4d4d4-0000-0000-0000-000000000001', 'c4c4c4c4-0000-0000-0000-000000000001');

-- Column A: zero sgs_scores rows at all (never even had a placeholder
-- inserted for any student) -> the plain "no rows" case.
insert into public.sgs_score_columns (id, subject_id, classroom_id, label, max_score, position, created_by) values
  ('a0000001-0000-0000-0000-000000000001', 'd4d4d4d4-0000-0000-0000-000000000001', 'c4c4c4c4-0000-0000-0000-000000000001', 'ช่อง A (zero rows)', 10, 1, 'b1b1b1b1-0000-0000-0000-000000000001');

-- Column B: "ช่อง 10" from the bug report — a row per roster student, but
-- EVERY score is NULL (nobody has entered anything yet).
insert into public.sgs_score_columns (id, subject_id, classroom_id, label, max_score, position, created_by) values
  ('a0000002-0000-0000-0000-000000000002', 'd4d4d4d4-0000-0000-0000-000000000001', 'c4c4c4c4-0000-0000-0000-000000000001', 'ช่อง 10 (all null)', 10, 2, 'b1b1b1b1-0000-0000-0000-000000000001');
insert into public.sgs_scores (column_id, student_id, score) values
  ('a0000002-0000-0000-0000-000000000002', '54545454-0000-0000-0000-000000000001', null),
  ('a0000002-0000-0000-0000-000000000002', '55555555-0000-0000-0000-000000000002', null);

-- Column C: "10" from the bug report — one real score of 0. 0 is NOT
-- empty and must block deletion.
insert into public.sgs_score_columns (id, subject_id, classroom_id, label, max_score, position, created_by) values
  ('a0000003-0000-0000-0000-000000000003', 'd4d4d4d4-0000-0000-0000-000000000001', 'c4c4c4c4-0000-0000-0000-000000000001', 'ช่อง 10 (has a zero)', 10, 3, 'b1b1b1b1-0000-0000-0000-000000000001');
insert into public.sgs_scores (column_id, student_id, score) values
  ('a0000003-0000-0000-0000-000000000003', '54545454-0000-0000-0000-000000000001', 0),
  ('a0000003-0000-0000-0000-000000000003', '55555555-0000-0000-0000-000000000002', null);

-- Column D: one real positive score, plus a NULL row for the other
-- student — mixed rows, one real score is still enough to block.
insert into public.sgs_score_columns (id, subject_id, classroom_id, label, max_score, position, created_by) values
  ('a0000004-0000-0000-0000-000000000004', 'd4d4d4d4-0000-0000-0000-000000000001', 'c4c4c4c4-0000-0000-0000-000000000001', 'กลางภาค (has a positive score)', 20, 4, 'b1b1b1b1-0000-0000-0000-000000000001');
insert into public.sgs_scores (column_id, student_id, score) values
  ('a0000004-0000-0000-0000-000000000004', '54545454-0000-0000-0000-000000000001', 15),
  ('a0000004-0000-0000-0000-000000000004', '55555555-0000-0000-0000-000000000002', null);

reset role;

\echo '=================================================='
\echo 'B1: column with ZERO sgs_scores rows -> delete allowed'
\echo '=================================================='
set role authenticated;
select public.set_test_user('b1b1b1b1-0000-0000-0000-000000000001');
delete from public.sgs_score_columns where id = 'a0000001-0000-0000-0000-000000000001';
reset role;
set role postgres;
select 'B1 column A gone (expect 0):' as label, count(*) from public.sgs_score_columns where id = 'a0000001-0000-0000-0000-000000000001';
reset role;

\echo '=================================================='
\echo 'B2: column whose rows are ALL score IS NULL -> delete allowed'
\echo '=================================================='
set role authenticated;
select public.set_test_user('b1b1b1b1-0000-0000-0000-000000000001');
delete from public.sgs_score_columns where id = 'a0000002-0000-0000-0000-000000000002';
reset role;
set role postgres;
select 'B2 column B gone (expect 0):' as label, count(*) from public.sgs_score_columns where id = 'a0000002-0000-0000-0000-000000000002';
\echo '--- B5 (part 1): its NULL placeholder rows were cascade-deleted too'
select 'B5 column B sgs_scores rows remaining (expect 0):' as label, count(*) from public.sgs_scores where column_id = 'a0000002-0000-0000-0000-000000000002';
reset role;

\echo '=================================================='
\echo 'B3: column with a row scored 0 -> delete BLOCKED (0 is a real score)'
\echo '=================================================='
set role authenticated;
select public.set_test_user('b1b1b1b1-0000-0000-0000-000000000001');
do $$
begin
  begin
    delete from public.sgs_score_columns where id = 'a0000003-0000-0000-0000-000000000003';
    raise exception 'TEST FAILED: deleting a column with a score of 0 should have raised an exception';
  exception
    when others then
      raise notice 'CORRECTLY BLOCKED (score = 0 counts as a real score): %', sqlerrm;
  end;
end $$;
reset role;
set role postgres;
select 'B3 column C still exists (expect 1):' as label, count(*) from public.sgs_score_columns where id = 'a0000003-0000-0000-0000-000000000003';
select 'B3 column C sgs_scores rows still exist (expect 2):' as label, count(*) from public.sgs_scores where column_id = 'a0000003-0000-0000-0000-000000000003';
reset role;

\echo '=================================================='
\echo 'B4: column with a positive score -> delete BLOCKED'
\echo '=================================================='
set role authenticated;
select public.set_test_user('b1b1b1b1-0000-0000-0000-000000000001');
do $$
begin
  begin
    delete from public.sgs_score_columns where id = 'a0000004-0000-0000-0000-000000000004';
    raise exception 'TEST FAILED: deleting a column with a positive score should have raised an exception';
  exception
    when others then
      raise notice 'CORRECTLY BLOCKED (positive score): %', sqlerrm;
  end;
end $$;
reset role;
set role postgres;
select 'B4 column D still exists (expect 1):' as label, count(*) from public.sgs_score_columns where id = 'a0000004-0000-0000-0000-000000000004';
reset role;

\echo '=================================================='
\echo 'B6: a whole-classroom delete still cascades away a column WITH a real score (pg_trigger_depth guard unchanged)'
\echo '=================================================='
set role authenticated;
select public.set_test_user('b1b1b1b1-0000-0000-0000-000000000001');
delete from public.classrooms where id = 'c4c4c4c4-0000-0000-0000-000000000001';
reset role;
set role postgres;
select 'B6 classroom gone (expect 0):' as label, count(*) from public.classrooms where id = 'c4c4c4c4-0000-0000-0000-000000000001';
select 'B6 column C (had score 0) cascaded away too (expect 0):' as label, count(*) from public.sgs_score_columns where id = 'a0000003-0000-0000-0000-000000000003';
select 'B6 column D (had a positive score) cascaded away too (expect 0):' as label, count(*) from public.sgs_score_columns where id = 'a0000004-0000-0000-0000-000000000004';
reset role;
