-- Empirical verification for 0027_sgs_score_origin.sql
--
-- DEV-ONLY verification script, never applied to any real database and
-- never run automatically. Run against a disposable local Postgres with
-- the auth shim described in supabase/tests/0009_student_link_rpc_permissions.sql
-- and every migration through 0027 applied in order:
--
--   psql -v ON_ERROR_STOP=1 -d <disposable_db> -f supabase/tests/0027_sgs_score_origin.sql
--
-- Every check raises (aborting the script) on failure and prints PASS
-- otherwise. Covers:
--   O1  AUTO: a recalculation makes calculated = effective (score)
--   O2  OVERRIDE keeps calculated_score; effective = override
--   O3  source change while AUTO -> effective follows
--   O4  source change while OVERRIDE -> calculated updates, override and
--       effective preserved
--   O5  restore AUTO (clear_override) -> effective = CURRENT calculated
--   O6  clear a manual value in a column with NO calculation -> EMPTY
--   O7  0 stays 0 (override 0 and calculated 0 are real scores)
--   O8  NULL stays NULL (never 0)
--   O9  not-calculable recalculation empties an AUTO cell (the old
--       "stale calculated value never clears" bug) but keeps an override
--   O10 per-student suppression -> EMPTY, mapping/calculated intact;
--       restore brings AUTO back
--   O11 bulk reset: overrides + suppressions cleared, count returned
--   O12 legacy direct write of `score` (older client) is adopted as the
--       teacher's intent, never overwritten by a recalculation
--   O13 invalid value aborts the WHOLE recalculation (all-or-nothing)
--   O14 another teacher cannot touch this column via any RPC
--   O15 override above the column max is rejected
--   O16 anon has NO EXECUTE privilege on the three application RPCs
--       (authenticated still does)

\set ON_ERROR_STOP 1

reset role;
set role postgres;

create or replace function pg_temp.check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if p_ok is distinct from true then
    raise exception 'FAIL: %', p_label;
  end if;
  raise notice 'PASS: %', p_label;
end;
$$;

delete from public.sgs_scores where column_id in ('27270000-0000-0000-0000-00000000c001', '27270000-0000-0000-0000-00000000c002');
delete from public.sgs_score_columns where id in ('27270000-0000-0000-0000-00000000c001', '27270000-0000-0000-0000-00000000c002');
delete from public.subject_classrooms where subject_id = '27270000-0000-0000-0000-00000000b001';
delete from public.subjects where id = '27270000-0000-0000-0000-00000000b001';
delete from public.classroom_students where classroom_id = '27270000-0000-0000-0000-00000000a001';
delete from public.students where id in (
  '27270000-0000-0000-0000-000000005001', '27270000-0000-0000-0000-000000005002', '27270000-0000-0000-0000-000000005003'
);
delete from public.classrooms where id = '27270000-0000-0000-0000-00000000a001';
delete from public.profiles where id in ('27270000-0000-0000-0000-00000000f001', '27270000-0000-0000-0000-00000000f002');
delete from auth.users where id in ('27270000-0000-0000-0000-00000000f001', '27270000-0000-0000-0000-00000000f002');

insert into auth.users (id, email) values
  ('27270000-0000-0000-0000-00000000f001', 't-origin-a@example.com'),
  ('27270000-0000-0000-0000-00000000f002', 't-origin-b@example.com');
-- handle_new_user (0003/0008) auto-creates 'teacher' profiles.

insert into public.classrooms (id, teacher_id, name) values
  ('27270000-0000-0000-0000-00000000a001', '27270000-0000-0000-0000-00000000f001', 'ม.2/1 (origin test)');
insert into public.students (id, created_by, first_name, last_name) values
  ('27270000-0000-0000-0000-000000005001', '27270000-0000-0000-0000-00000000f001', 'Auto', 'Student'),
  ('27270000-0000-0000-0000-000000005002', '27270000-0000-0000-0000-00000000f001', 'Zero', 'Student'),
  ('27270000-0000-0000-0000-000000005003', '27270000-0000-0000-0000-00000000f001', 'Legacy', 'Student');
insert into public.classroom_students (classroom_id, student_id) values
  ('27270000-0000-0000-0000-00000000a001', '27270000-0000-0000-0000-000000005001'),
  ('27270000-0000-0000-0000-00000000a001', '27270000-0000-0000-0000-000000005002'),
  ('27270000-0000-0000-0000-00000000a001', '27270000-0000-0000-0000-000000005003');
insert into public.subjects (id, teacher_id, name) values
  ('27270000-0000-0000-0000-00000000b001', '27270000-0000-0000-0000-00000000f001', 'สังคมศึกษา (origin test)');
insert into public.subject_classrooms (subject_id, classroom_id) values
  ('27270000-0000-0000-0000-00000000b001', '27270000-0000-0000-0000-00000000a001');
insert into public.sgs_score_columns (id, subject_id, classroom_id, label, max_score, position, created_by) values
  ('27270000-0000-0000-0000-00000000c001', '27270000-0000-0000-0000-00000000b001', '27270000-0000-0000-0000-00000000a001', 'ช่อง 10', 10, 1, '27270000-0000-0000-0000-00000000f001'),
  ('27270000-0000-0000-0000-00000000c002', '27270000-0000-0000-0000-00000000b001', '27270000-0000-0000-0000-00000000a001', 'ช่องกรอกมือ', 20, 2, '27270000-0000-0000-0000-00000000f001');

set role authenticated;
select public.set_test_user('27270000-0000-0000-0000-00000000f001');

-- O1 AUTO
select public.recalculate_sgs_score_column('27270000-0000-0000-0000-00000000c001',
  '[{"student_id":"27270000-0000-0000-0000-000000005001","calculated_score":7.5}]'::jsonb);
select pg_temp.check(
  (select score = 7.5 and calculated_score = 7.5 and override_score is null and calculated_at is not null
   from public.sgs_scores where column_id = '27270000-0000-0000-0000-00000000c001' and student_id = '27270000-0000-0000-0000-000000005001'),
  'O1 AUTO: effective = calculated = 7.5');

-- O2 OVERRIDE
select public.set_sgs_score_cell('27270000-0000-0000-0000-00000000c001', '27270000-0000-0000-0000-000000005001', 'override', 9);
select pg_temp.check(
  (select score = 9 and calculated_score = 7.5 and override_score = 9
   from public.sgs_scores where column_id = '27270000-0000-0000-0000-00000000c001' and student_id = '27270000-0000-0000-0000-000000005001'),
  'O2 OVERRIDE: calculated 7.5 kept, override 9, effective 9');

-- O4 source change while OVERRIDE
select public.recalculate_sgs_score_column('27270000-0000-0000-0000-00000000c001',
  '[{"student_id":"27270000-0000-0000-0000-000000005001","calculated_score":8.5}]'::jsonb);
select pg_temp.check(
  (select score = 9 and calculated_score = 8.5 and override_score = 9
   from public.sgs_scores where column_id = '27270000-0000-0000-0000-00000000c001' and student_id = '27270000-0000-0000-0000-000000005001'),
  'O4 source change while OVERRIDE: calculated -> 8.5, override/effective stay 9');

-- O5 restore AUTO
select public.set_sgs_score_cell('27270000-0000-0000-0000-00000000c001', '27270000-0000-0000-0000-000000005001', 'clear_override');
select pg_temp.check(
  (select score = 8.5 and calculated_score = 8.5 and override_score is null and auto_suppressed = false
   from public.sgs_scores where column_id = '27270000-0000-0000-0000-00000000c001' and student_id = '27270000-0000-0000-0000-000000005001'),
  'O5 restore AUTO: effective = current calculated 8.5');

-- O3 source change while AUTO
select public.recalculate_sgs_score_column('27270000-0000-0000-0000-00000000c001',
  '[{"student_id":"27270000-0000-0000-0000-000000005001","calculated_score":6}]'::jsonb);
select pg_temp.check(
  (select score = 6 and calculated_score = 6
   from public.sgs_scores where column_id = '27270000-0000-0000-0000-00000000c001' and student_id = '27270000-0000-0000-0000-000000005001'),
  'O3 source change while AUTO: effective follows to 6');

-- O7 zero stays zero
select public.recalculate_sgs_score_column('27270000-0000-0000-0000-00000000c001',
  '[{"student_id":"27270000-0000-0000-0000-000000005002","calculated_score":0}]'::jsonb);
select pg_temp.check(
  (select score = 0 and calculated_score = 0
   from public.sgs_scores where column_id = '27270000-0000-0000-0000-00000000c001' and student_id = '27270000-0000-0000-0000-000000005002'),
  'O7a calculated 0 is a real effective 0');
select public.set_sgs_score_cell('27270000-0000-0000-0000-00000000c002', '27270000-0000-0000-0000-000000005002', 'override', 0);
select pg_temp.check(
  (select score = 0 and override_score = 0
   from public.sgs_scores where column_id = '27270000-0000-0000-0000-00000000c002' and student_id = '27270000-0000-0000-0000-000000005002'),
  'O7b override 0 is a real effective 0');

-- O6 clear a manual value (column never calculated) -> EMPTY
select public.set_sgs_score_cell('27270000-0000-0000-0000-00000000c002', '27270000-0000-0000-0000-000000005001', 'override', 15);
select public.set_sgs_score_cell('27270000-0000-0000-0000-00000000c002', '27270000-0000-0000-0000-000000005001', 'clear_override');
select pg_temp.check(
  (select score is null and override_score is null and calculated_score is null
   from public.sgs_scores where column_id = '27270000-0000-0000-0000-00000000c002' and student_id = '27270000-0000-0000-0000-000000005001'),
  'O6 clearing a manual value with no calculation -> EMPTY (NULL, not 0)');

-- O8 null stays null: clear_override on a student with no row creates nothing
select public.set_sgs_score_cell('27270000-0000-0000-0000-00000000c002', '27270000-0000-0000-0000-000000005003', 'clear_override');
select pg_temp.check(
  (select count(*) = 0 from public.sgs_scores
   where column_id = '27270000-0000-0000-0000-00000000c002' and student_id = '27270000-0000-0000-0000-000000005003'),
  'O8 clearing a never-scored cell creates no row and no 0');

-- O9 not calculable -> AUTO empties, OVERRIDE preserved
select public.set_sgs_score_cell('27270000-0000-0000-0000-00000000c001', '27270000-0000-0000-0000-000000005002', 'override', 4);
select public.recalculate_sgs_score_column('27270000-0000-0000-0000-00000000c001',
  '[{"student_id":"27270000-0000-0000-0000-000000005001","calculated_score":null},
    {"student_id":"27270000-0000-0000-0000-000000005002","calculated_score":null}]'::jsonb);
select pg_temp.check(
  (select score is null and calculated_score is null
   from public.sgs_scores where column_id = '27270000-0000-0000-0000-00000000c001' and student_id = '27270000-0000-0000-0000-000000005001'),
  'O9a AUTO cell whose sources became un-calculable is emptied (no stale value)');
select pg_temp.check(
  (select score = 4 and override_score = 4 and calculated_score is null
   from public.sgs_scores where column_id = '27270000-0000-0000-0000-00000000c001' and student_id = '27270000-0000-0000-0000-000000005002'),
  'O9b OVERRIDE survives an un-calculable recalculation');

-- O10 suppression
select public.recalculate_sgs_score_column('27270000-0000-0000-0000-00000000c001',
  '[{"student_id":"27270000-0000-0000-0000-000000005001","calculated_score":8}]'::jsonb);
select public.set_sgs_score_cell('27270000-0000-0000-0000-00000000c001', '27270000-0000-0000-0000-000000005001', 'suppress_auto');
select pg_temp.check(
  (select score is null and calculated_score = 8 and auto_suppressed
   from public.sgs_scores where column_id = '27270000-0000-0000-0000-00000000c001' and student_id = '27270000-0000-0000-0000-000000005001'),
  'O10a suppression -> EMPTY, calculated 8 kept');
select public.recalculate_sgs_score_column('27270000-0000-0000-0000-00000000c001',
  '[{"student_id":"27270000-0000-0000-0000-000000005001","calculated_score":9}]'::jsonb);
select pg_temp.check(
  (select score is null and calculated_score = 9 and auto_suppressed
   from public.sgs_scores where column_id = '27270000-0000-0000-0000-00000000c001' and student_id = '27270000-0000-0000-0000-000000005001'),
  'O10b recalculation keeps a suppressed cell EMPTY (calculated -> 9)');
select public.set_sgs_score_cell('27270000-0000-0000-0000-00000000c001', '27270000-0000-0000-0000-000000005001', 'clear_override');
select pg_temp.check(
  (select score = 9 and auto_suppressed = false
   from public.sgs_scores where column_id = '27270000-0000-0000-0000-00000000c001' and student_id = '27270000-0000-0000-0000-000000005001'),
  'O10c restore AUTO after suppression -> 9');

-- O12 legacy direct write (older client / setSgsScore) is adopted
update public.sgs_scores set score = 3
where column_id = '27270000-0000-0000-0000-00000000c001' and student_id = '27270000-0000-0000-0000-000000005001';
select public.recalculate_sgs_score_column('27270000-0000-0000-0000-00000000c001',
  '[{"student_id":"27270000-0000-0000-0000-000000005001","calculated_score":9.5}]'::jsonb);
select pg_temp.check(
  (select score = 3 and override_score = 3 and calculated_score = 9.5
   from public.sgs_scores where column_id = '27270000-0000-0000-0000-00000000c001' and student_id = '27270000-0000-0000-0000-000000005001'),
  'O12 a direct legacy write of 3 is adopted as an override, never overwritten by recalculation');

-- O11 bulk reset
select pg_temp.check(
  (select public.reset_sgs_score_column_to_auto('27270000-0000-0000-0000-00000000c001') = 2),
  'O11a reset returns the number of changed cells (2 overrides)');
select pg_temp.check(
  (select bool_and(override_score is null and auto_suppressed = false and score is not distinct from calculated_score)
   from public.sgs_scores where column_id = '27270000-0000-0000-0000-00000000c001'),
  'O11b after reset every cell is AUTO (effective = calculated, NULL where not calculable)');
select pg_temp.check(
  (select public.reset_sgs_score_column_to_auto('27270000-0000-0000-0000-00000000c001') = 0),
  'O11c a second reset changes nothing (idempotent)');

-- O13 all-or-nothing
do $$
begin
  perform public.recalculate_sgs_score_column('27270000-0000-0000-0000-00000000c001',
    '[{"student_id":"27270000-0000-0000-0000-000000005002","calculated_score":1},
      {"student_id":"27270000-0000-0000-0000-000000005001","calculated_score":99}]'::jsonb);
  raise exception 'FAIL: O13 out-of-range recalculation was accepted';
exception when sqlstate '22023' then
  raise notice 'PASS: O13a out-of-range value rejected';
end;
$$;
select pg_temp.check(
  (select score is null and calculated_score is null
   from public.sgs_scores where column_id = '27270000-0000-0000-0000-00000000c001' and student_id = '27270000-0000-0000-0000-000000005002'),
  'O13b the valid first row of the rejected batch was NOT written (atomic)');

-- O15 override above max
do $$
begin
  perform public.set_sgs_score_cell('27270000-0000-0000-0000-00000000c001', '27270000-0000-0000-0000-000000005002', 'override', 10.5);
  raise exception 'FAIL: O15 override above max accepted';
exception when sqlstate '22023' then
  raise notice 'PASS: O15 override above max rejected';
end;
$$;

-- O14 another teacher
select public.set_test_user('27270000-0000-0000-0000-00000000f002');
do $$
begin
  perform public.set_sgs_score_cell('27270000-0000-0000-0000-00000000c001', '27270000-0000-0000-0000-000000005001', 'override', 1);
  raise exception 'FAIL: O14 other teacher set a cell';
exception when sqlstate '42501' then
  raise notice 'PASS: O14a other teacher cannot set a cell';
end;
$$;
do $$
begin
  perform public.recalculate_sgs_score_column('27270000-0000-0000-0000-00000000c001',
    '[{"student_id":"27270000-0000-0000-0000-000000005001","calculated_score":1}]'::jsonb);
  raise exception 'FAIL: O14 other teacher recalculated';
exception when sqlstate '42501' then
  raise notice 'PASS: O14b other teacher cannot recalculate';
end;
$$;
do $$
begin
  perform public.reset_sgs_score_column_to_auto('27270000-0000-0000-0000-00000000c001');
  raise exception 'FAIL: O14 other teacher reset';
exception when sqlstate '42501' then
  raise notice 'PASS: O14c other teacher cannot reset';
end;
$$;

reset role;
set role postgres;
select pg_temp.check(
  (select score = 9.5 from public.sgs_scores
   where column_id = '27270000-0000-0000-0000-00000000c001' and student_id = '27270000-0000-0000-0000-000000005001'),
  'O14d the column is unchanged after the other teacher''s attempts');

-- O16 privileges — checked against the role itself, independent of
-- whatever default privileges the environment grants to new functions.
select pg_temp.check(
  not has_function_privilege('anon', 'public.set_sgs_score_cell(uuid, uuid, text, numeric)', 'EXECUTE'),
  'O16a anon cannot EXECUTE set_sgs_score_cell');
select pg_temp.check(
  not has_function_privilege('anon', 'public.recalculate_sgs_score_column(uuid, jsonb)', 'EXECUTE'),
  'O16b anon cannot EXECUTE recalculate_sgs_score_column');
select pg_temp.check(
  not has_function_privilege('anon', 'public.reset_sgs_score_column_to_auto(uuid)', 'EXECUTE'),
  'O16c anon cannot EXECUTE reset_sgs_score_column_to_auto');
select pg_temp.check(
  has_function_privilege('authenticated', 'public.set_sgs_score_cell(uuid, uuid, text, numeric)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.recalculate_sgs_score_column(uuid, jsonb)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.reset_sgs_score_column_to_auto(uuid)', 'EXECUTE'),
  'O16d authenticated can still EXECUTE all three RPCs');
do $$
begin
  set local role anon;
  perform public.set_sgs_score_cell('27270000-0000-0000-0000-00000000c001', '27270000-0000-0000-0000-000000005001', 'override', 1);
  raise exception 'FAIL: O16e anon executed set_sgs_score_cell';
exception when insufficient_privilege then
  raise notice 'PASS: O16e an anon call is refused with permission denied (42501), before the function body runs';
end;
$$;

\echo '0027 origin verification: ALL PASS'
