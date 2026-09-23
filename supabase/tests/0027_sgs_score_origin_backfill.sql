-- Empirical verification of 0027's BACKFILL on pre-existing data.
--
-- DEV-ONLY. Run against a disposable local Postgres with the auth shim
-- and every migration through 0026 applied (NOT 0027), in two steps:
--
--   psql -v ON_ERROR_STOP=1 -d <db> -v phase=before -f supabase/tests/0027_sgs_score_origin_backfill.sql
--   psql -v ON_ERROR_STOP=1 -d <db> -f supabase/migrations/0027_sgs_score_origin.sql
--   psql -v ON_ERROR_STOP=1 -d <db> -v phase=after  -f supabase/tests/0027_sgs_score_origin_backfill.sql
--   psql -v ON_ERROR_STOP=1 -d <db> -f supabase/migrations/0027_sgs_score_origin.sql   (re-run: must be a no-op)
--   psql -v ON_ERROR_STOP=1 -d <db> -v phase=after  -f supabase/tests/0027_sgs_score_origin_backfill.sql
--
-- Checks: an existing 7 and an existing 0 become overrides with `score`
-- untouched; an existing NULL stays NULL (never 0, never an override);
-- re-running the migration changes nothing.

\set ON_ERROR_STOP 1
reset role;
set role postgres;

\if :{?phase}
\else
  \echo 'pass -v phase=before or -v phase=after'
  \quit
\endif

select (:'phase' = 'before') as is_before \gset

\if :is_before
insert into auth.users (id, email) values ('27b00000-0000-0000-0000-00000000f001', 't-backfill@example.com');
insert into public.classrooms (id, teacher_id, name) values ('27b00000-0000-0000-0000-00000000a001', '27b00000-0000-0000-0000-00000000f001', 'backfill room');
insert into public.students (id, created_by, first_name, last_name) values
  ('27b00000-0000-0000-0000-000000005001', '27b00000-0000-0000-0000-00000000f001', 'Seven', 'S'),
  ('27b00000-0000-0000-0000-000000005002', '27b00000-0000-0000-0000-00000000f001', 'Zero', 'S'),
  ('27b00000-0000-0000-0000-000000005003', '27b00000-0000-0000-0000-00000000f001', 'Null', 'S');
insert into public.classroom_students (classroom_id, student_id) values
  ('27b00000-0000-0000-0000-00000000a001', '27b00000-0000-0000-0000-000000005001'),
  ('27b00000-0000-0000-0000-00000000a001', '27b00000-0000-0000-0000-000000005002'),
  ('27b00000-0000-0000-0000-00000000a001', '27b00000-0000-0000-0000-000000005003');
insert into public.subjects (id, teacher_id, name) values ('27b00000-0000-0000-0000-00000000b001', '27b00000-0000-0000-0000-00000000f001', 'backfill subject');
insert into public.subject_classrooms (subject_id, classroom_id) values ('27b00000-0000-0000-0000-00000000b001', '27b00000-0000-0000-0000-00000000a001');
insert into public.sgs_score_columns (id, subject_id, classroom_id, label, max_score, position, created_by) values
  ('27b00000-0000-0000-0000-00000000c001', '27b00000-0000-0000-0000-00000000b001', '27b00000-0000-0000-0000-00000000a001', 'ช่อง 10', 10, 1, '27b00000-0000-0000-0000-00000000f001');
insert into public.sgs_scores (column_id, student_id, score) values
  ('27b00000-0000-0000-0000-00000000c001', '27b00000-0000-0000-0000-000000005001', 7),
  ('27b00000-0000-0000-0000-00000000c001', '27b00000-0000-0000-0000-000000005002', 0),
  ('27b00000-0000-0000-0000-00000000c001', '27b00000-0000-0000-0000-000000005003', null);
\echo 'legacy rows inserted (7, 0, NULL)'
\else
do $$
declare r record;
begin
  select score, override_score, calculated_score, auto_suppressed into r from public.sgs_scores
  where column_id = '27b00000-0000-0000-0000-00000000c001' and student_id = '27b00000-0000-0000-0000-000000005001';
  if not (r.score = 7 and r.override_score = 7 and r.calculated_score is null and r.auto_suppressed = false) then
    raise exception 'FAIL: existing 7 not backfilled as override';
  end if;
  select score, override_score into r from public.sgs_scores
  where column_id = '27b00000-0000-0000-0000-00000000c001' and student_id = '27b00000-0000-0000-0000-000000005002';
  if not (r.score = 0 and r.override_score = 0) then
    raise exception 'FAIL: existing 0 not preserved as override 0';
  end if;
  select score, override_score, calculated_score into r from public.sgs_scores
  where column_id = '27b00000-0000-0000-0000-00000000c001' and student_id = '27b00000-0000-0000-0000-000000005003';
  if not (r.score is null and r.override_score is null and r.calculated_score is null) then
    raise exception 'FAIL: existing NULL was changed';
  end if;
  raise notice 'PASS: backfill 7 -> override 7, 0 -> override 0, NULL stays NULL, score untouched';
end;
$$;
\endif
