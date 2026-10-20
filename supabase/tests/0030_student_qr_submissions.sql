-- Regression / adversarial test for 0030_student_qr_submissions.sql.
-- Dev-only: run against a throwaway local Postgres with the Supabase shim
-- (auth.users, auth.uid() reading request.jwt.claim.sub, set_test_user(),
-- anon/authenticated roles, Supabase-style default privileges — see
-- docs/DATABASE.md "Empirical RLS/RPC verification") and migrations
-- 0001 → 0030 applied. Never run against production. Self-contained and
-- re-runnable: creates and removes its own TEST0030 fixtures. Every
-- check raises an exception on failure.

\set ON_ERROR_STOP on

reset role;
select clear_test_user();

-- ==================================================
-- Fixtures
-- ==================================================

do $$
begin
  alter table auth.users disable trigger on_auth_user_created;
exception when undefined_object then null;
end $$;

delete from public.assignment_submission_events where assignment_id in (select id from public.assignments where title like 'TEST0030:%');
delete from public.notifications where recipient_user_id in (select id from public.profiles where display_name like 'TEST0030:%');
delete from public.assignment_submissions where assignment_id in (select id from public.assignments where title like 'TEST0030:%');
delete from public.assignments where title like 'TEST0030:%';
delete from public.subject_classrooms where subject_id in (select id from public.subjects where name like 'TEST0030:%');
delete from public.subjects where name like 'TEST0030:%';
delete from public.classroom_students where classroom_id in (select id from public.classrooms where name like 'TEST0030:%');
delete from public.student_qr_identities where student_id in (select id from public.students where first_name like 'TEST0030:%');
update public.students set linked_profile_id = null where first_name like 'TEST0030:%';
delete from public.students where first_name like 'TEST0030:%';
delete from public.classrooms where name like 'TEST0030:%';
delete from public.profiles where display_name like 'TEST0030:%';
delete from auth.users where email like 'test0030_%';

insert into auth.users (id, email) values
  ('00000000-0030-0000-0000-00000000000a', 'test0030_teacher_a@example.com'),
  ('00000000-0030-0000-0000-00000000000b', 'test0030_teacher_b@example.com'),
  ('00000000-0030-0000-0000-000000000001', 'test0030_student_x@example.com');

insert into public.profiles (id, display_name, email, role) values
  ('00000000-0030-0000-0000-00000000000a', 'TEST0030: Teacher A', 'test0030_teacher_a@example.com', 'teacher'),
  ('00000000-0030-0000-0000-00000000000b', 'TEST0030: Teacher B', 'test0030_teacher_b@example.com', 'teacher'),
  ('00000000-0030-0000-0000-000000000001', 'TEST0030: Student X', 'test0030_student_x@example.com', 'student');

insert into public.classrooms (id, teacher_id, name, academic_year, semester) values
  ('00000000-0030-0001-0000-00000000000a', '00000000-0030-0000-0000-00000000000a', 'TEST0030: ม.5/1', '2569', '1'),
  ('00000000-0030-0001-0000-00000000000b', '00000000-0030-0000-0000-00000000000b', 'TEST0030: ม.5/2', '2569', '1');

-- X and Y in A's room (X linked to a student account); Z in B's room.
insert into public.students (id, first_name, last_name, number, student_code, linked_profile_id) values
  ('00000000-0030-0002-0000-000000000001', 'TEST0030: เอกชัย', 'ใจดี', 1, 'T30-1', '00000000-0030-0000-0000-000000000001'),
  ('00000000-0030-0002-0000-000000000002', 'TEST0030: ยุพา', 'รักเรียน', 2, 'T30-2', null),
  ('00000000-0030-0002-0000-000000000003', 'TEST0030: ศิริ', 'มีสุข', 1, 'T30-3', null);

insert into public.classroom_students (classroom_id, student_id) values
  ('00000000-0030-0001-0000-00000000000a', '00000000-0030-0002-0000-000000000001'),
  ('00000000-0030-0001-0000-00000000000a', '00000000-0030-0002-0000-000000000002'),
  ('00000000-0030-0001-0000-00000000000b', '00000000-0030-0002-0000-000000000003');

insert into public.subjects (id, teacher_id, name) values
  ('00000000-0030-0003-0000-00000000000a', '00000000-0030-0000-0000-00000000000a', 'TEST0030: ภาษาไทย');
insert into public.subject_classrooms (subject_id, classroom_id) values
  ('00000000-0030-0003-0000-00000000000a', '00000000-0030-0001-0000-00000000000a');

-- w1 no deadline · w2 future deadline · w3 past deadline (accept late)
-- w4 past deadline (reject late) · w5 closed · w6 due_date yesterday only
-- w7 due_date today only
insert into public.assignments (id, subject_id, classroom_id, title, max_score, due_date, submission_deadline, late_policy, accepting_submissions) values
  ('00000000-0030-0004-0000-000000000001', '00000000-0030-0003-0000-00000000000a', '00000000-0030-0001-0000-00000000000a', 'TEST0030: งานที่ 1', 5, null, null, 'accept_late', true),
  ('00000000-0030-0004-0000-000000000002', '00000000-0030-0003-0000-00000000000a', '00000000-0030-0001-0000-00000000000a', 'TEST0030: งานที่ 2', 5, null, now() + interval '1 day', 'accept_late', true),
  ('00000000-0030-0004-0000-000000000003', '00000000-0030-0003-0000-00000000000a', '00000000-0030-0001-0000-00000000000a', 'TEST0030: งานที่ 3', 5, null, now() - interval '1 hour', 'accept_late', true),
  ('00000000-0030-0004-0000-000000000004', '00000000-0030-0003-0000-00000000000a', '00000000-0030-0001-0000-00000000000a', 'TEST0030: งานที่ 4', 5, null, now() - interval '1 hour', 'reject_late', true),
  ('00000000-0030-0004-0000-000000000005', '00000000-0030-0003-0000-00000000000a', '00000000-0030-0001-0000-00000000000a', 'TEST0030: งานที่ 5', 5, null, null, 'accept_late', false),
  ('00000000-0030-0004-0000-000000000006', '00000000-0030-0003-0000-00000000000a', '00000000-0030-0001-0000-00000000000a', 'TEST0030: งานที่ 6', 5, ((now() at time zone 'Asia/Bangkok')::date - 1), null, 'accept_late', true),
  ('00000000-0030-0004-0000-000000000007', '00000000-0030-0003-0000-00000000000a', '00000000-0030-0001-0000-00000000000a', 'TEST0030: งานที่ 7', 5, ((now() at time zone 'Asia/Bangkok')::date), null, 'accept_late', true);

-- Existing grade: Y on w1 was explicitly marked missing with a score of 2.
insert into public.assignment_submissions (assignment_id, student_id, status, score, note) values
  ('00000000-0030-0004-0000-000000000001', '00000000-0030-0002-0000-000000000002', 'missing', 2, 'ครูบันทึกไว้เดิม');

-- Helper for the checks below: the active token of a student.
create or replace function pg_temp.tok(p uuid) returns text language sql as $$
  select token from public.student_qr_identities where student_id = p and status = 'active'
$$;

-- ==================================================
-- 1. Every student gets exactly one active, random, non-identifying QR
-- ==================================================

do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.student_qr_identities
   where student_id in ('00000000-0030-0002-0000-000000000001', '00000000-0030-0002-0000-000000000002', '00000000-0030-0002-0000-000000000003')
     and status = 'active';
  if v_count <> 3 then raise exception 'FAIL 1: expected 3 active identities from the insert trigger, got %', v_count; end if;
  if exists (select 1 from public.student_qr_identities q join public.students s on s.id = q.student_id
             where s.first_name like 'TEST0030:%' and (q.token !~ '^[0-9a-f]{64}$' or q.token like '%' || replace(s.id::text, '-', '') || '%' or q.token like '%' || lower(coalesce(s.student_code, 'x')) || '%')) then
    raise exception 'FAIL 1: token format or token contains the student id/code';
  end if;
  if pg_temp.tok('00000000-0030-0002-0000-000000000001') = pg_temp.tok('00000000-0030-0002-0000-000000000002') then
    raise exception 'FAIL 1: two students share a token';
  end if;
  begin
    insert into public.student_qr_identities (student_id, token) values ('00000000-0030-0002-0000-000000000001', repeat('a', 64));
    raise exception 'FAIL 1: a second active identity was accepted';
  exception when unique_violation then null;
  end;
  raise notice 'PASS 1: one active random QR per student, no duplicates';
end $$;

-- 1b. A student created while the trigger was off (stand-in for "existing
-- before the migration") gets one from the backfill / the classroom RPC.
alter table public.students disable trigger students_issue_qr_identity_trigger;
insert into public.students (id, first_name, last_name, number) values
  ('00000000-0030-0002-0000-000000000004', 'TEST0030: ดวงใจ', 'สดใส', 3);
insert into public.classroom_students (classroom_id, student_id) values
  ('00000000-0030-0001-0000-00000000000a', '00000000-0030-0002-0000-000000000004');
alter table public.students enable trigger students_issue_qr_identity_trigger;

set role authenticated;
select set_test_user('00000000-0030-0000-0000-00000000000a');
do $$
declare
  v_rows int;
  v_first text;
begin
  select count(*) into v_rows from public.get_classroom_student_qr_codes('00000000-0030-0001-0000-00000000000a');
  if v_rows <> 3 then raise exception 'FAIL 1b: expected 3 classroom QR codes, got %', v_rows; end if;
  select token into v_first from public.get_classroom_student_qr_codes('00000000-0030-0001-0000-00000000000a') where student_id = '00000000-0030-0002-0000-000000000004';
  if v_first is null then raise exception 'FAIL 1b: pre-existing student got no QR'; end if;
  -- Idempotent: a second call returns the same token, nothing new issued.
  if (select token from public.get_classroom_student_qr_codes('00000000-0030-0001-0000-00000000000a') where student_id = '00000000-0030-0002-0000-000000000004') <> v_first then
    raise exception 'FAIL 1b: repeated call changed the token';
  end if;
  raise notice 'PASS 1b: existing student receives a QR; the call is idempotent';
end $$;
reset role;
do $$
begin
  if (select count(*) from public.student_qr_identities where student_id = '00000000-0030-0002-0000-000000000004') <> 1 then
    raise exception 'FAIL 1b: duplicate identities issued';
  end if;
end $$;

-- ==================================================
-- 2. Tokens are invisible to clients; RPCs are owner-only
-- ==================================================

set role authenticated;
select set_test_user('00000000-0030-0000-0000-00000000000a');
do $$
begin
  begin
    perform 1 from public.student_qr_identities limit 1;
    raise exception 'FAIL 2: the identities table is readable by authenticated';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.qr_record_submission(
      (select a from public.assignments a where a.id = '00000000-0030-0004-0000-000000000001'),
      '00000000-0030-0002-0000-000000000001', 'qr_scan');
    raise exception 'FAIL 2: internal qr_record_submission is callable';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.issue_student_qr_identity('00000000-0030-0002-0000-000000000003');
    raise exception 'FAIL 2: internal issue_student_qr_identity is callable';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS 2: table and internal helpers are closed to clients';
end $$;

select set_test_user('00000000-0030-0000-0000-00000000000b');
do $$
begin
  begin
    perform * from public.get_classroom_student_qr_codes('00000000-0030-0001-0000-00000000000a');
    raise exception 'FAIL 2: teacher B read teacher A''s QR codes';
  exception when insufficient_privilege then null;
  end;
  begin
    perform * from public.regenerate_student_qr_code('00000000-0030-0001-0000-00000000000a', '00000000-0030-0002-0000-000000000001');
    raise exception 'FAIL 2: teacher B regenerated teacher A''s student QR';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.record_submission_scan('00000000-0030-0004-0000-000000000001', 'kcqr1' || repeat('0', 64));
    raise exception 'FAIL 2: teacher B scanned into teacher A''s assignment';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS 2b: another teacher is rejected everywhere';
end $$;

-- A student account (even holding a valid QR) cannot record anything.
select set_test_user('00000000-0030-0000-0000-000000000001');
do $$
begin
  begin
    perform public.record_submission_scan('00000000-0030-0004-0000-000000000001', 'kcqr1' || repeat('0', 64));
    raise exception 'FAIL 2: a student account recorded a scan';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS 2c: a student account is rejected';
end $$;
reset role;

set role anon;
select clear_test_user();
do $$
begin
  begin
    perform public.record_submission_scan('00000000-0030-0004-0000-000000000001', 'x');
    raise exception 'FAIL 2: anon can call the scan RPC';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS 2d: anon cannot call the scan RPC';
end $$;
reset role;

-- ==================================================
-- 3. Scanning: only the selected assignment, server time, deadlines
-- ==================================================

create temp table qr30 as select pg_temp.tok('00000000-0030-0002-0000-000000000001') as x, pg_temp.tok('00000000-0030-0002-0000-000000000002') as y, pg_temp.tok('00000000-0030-0002-0000-000000000003') as z;
grant select on qr30 to authenticated;

set role authenticated;
select set_test_user('00000000-0030-0000-0000-00000000000a');
do $$
declare
  r jsonb;
  v_x text := (select x from qr30);
begin
  -- 3a. X scanned for w1 (no deadline) → submitted, only w1 touched.
  r := public.record_submission_scan('00000000-0030-0004-0000-000000000001', 'KCQR1' || upper(v_x));
  if r->>'outcome' <> 'recorded' or r#>>'{submission,status}' <> 'submitted' then raise exception 'FAIL 3a: %', r; end if;
  if r#>>'{student,first_name}' <> 'TEST0030: เอกชัย' or r->'student' ? 'email' or r->'student' ? 'phone' then raise exception 'FAIL 3a: student summary %', r->'student'; end if;
  if r->'deadline' <> 'null'::jsonb then raise exception 'FAIL 3a: no-deadline assignment reported a deadline'; end if;
  if (select count(*) from public.assignment_submissions where student_id = '00000000-0030-0002-0000-000000000001' and assignment_id::text like '00000000-0030-0004-%') <> 1 then
    raise exception 'FAIL 3a: another assignment was touched';
  end if;

  -- 3b. Same QR for w2 (deadline tomorrow) → on time, w1 unchanged.
  r := public.record_submission_scan('00000000-0030-0004-0000-000000000002', v_x);
  if r->>'outcome' <> 'recorded' or r#>>'{submission,status}' <> 'submitted' then raise exception 'FAIL 3b: %', r; end if;
  if (select count(*) from public.assignment_submissions where student_id = '00000000-0030-0002-0000-000000000001' and assignment_id::text like '00000000-0030-0004-%') <> 2 then
    raise exception 'FAIL 3b: expected exactly two rows (w1, w2)';
  end if;

  -- 3c. w3 deadline passed, accept late → late.
  r := public.record_submission_scan('00000000-0030-0004-0000-000000000003', v_x);
  if r->>'outcome' <> 'recorded' or r#>>'{submission,status}' <> 'late' then raise exception 'FAIL 3c: %', r; end if;

  -- 3d. w4 deadline passed, reject late → refused, nothing written.
  r := public.record_submission_scan('00000000-0030-0004-0000-000000000004', v_x);
  if r->>'outcome' <> 'deadline_passed' then raise exception 'FAIL 3d: %', r; end if;

  -- 3e. w5 closed → refused.
  r := public.record_submission_scan('00000000-0030-0004-0000-000000000005', v_x);
  if r->>'outcome' <> 'assignment_closed' then raise exception 'FAIL 3e: %', r; end if;

  -- 3f. due_date only: yesterday → late; today → on time (valid to 23:59:59 Bangkok).
  r := public.record_submission_scan('00000000-0030-0004-0000-000000000006', v_x);
  if r#>>'{submission,status}' <> 'late' then raise exception 'FAIL 3f (yesterday): %', r; end if;
  r := public.record_submission_scan('00000000-0030-0004-0000-000000000007', v_x);
  if r#>>'{submission,status}' <> 'submitted' then raise exception 'FAIL 3f (today): %', r; end if;
  raise notice 'PASS 3: per-assignment scans, on-time/late/no-deadline/closed/reject rules';
end $$;
reset role;

do $$
begin
  if exists (select 1 from public.assignment_submissions where assignment_id in ('00000000-0030-0004-0000-000000000004', '00000000-0030-0004-0000-000000000005')) then
    raise exception 'FAIL 3: a refused scan wrote a row';
  end if;
  if (select submitted_at from public.assignment_submissions where assignment_id = '00000000-0030-0004-0000-000000000001' and student_id = '00000000-0030-0002-0000-000000000001') is null then
    raise exception 'FAIL 3: submitted_at not set by the server';
  end if;
  if (select recorded_via from public.assignment_submissions where assignment_id = '00000000-0030-0004-0000-000000000001' and student_id = '00000000-0030-0002-0000-000000000001') <> 'qr_scan' then
    raise exception 'FAIL 3: recorded_via not qr_scan';
  end if;
end $$;

-- ==================================================
-- 4. Duplicates, existing grades, invalid / foreign / revoked QR
-- ==================================================

create temp table qr30_first as
  select submitted_at from public.assignment_submissions
   where assignment_id = '00000000-0030-0004-0000-000000000001' and student_id = '00000000-0030-0002-0000-000000000001';
grant select on qr30_first to authenticated;

set role authenticated;
select set_test_user('00000000-0030-0000-0000-00000000000a');
do $$
declare
  r jsonb;
begin
  -- 4a. Repeated scan → duplicate; the original timestamp is kept.
  perform pg_sleep(0.05);
  r := public.record_submission_scan('00000000-0030-0004-0000-000000000001', (select x from qr30));
  if r->>'outcome' <> 'duplicate' then raise exception 'FAIL 4a: %', r; end if;
  if (r#>>'{submission,submitted_at}')::timestamptz <> (select submitted_at from qr30_first) then
    raise exception 'FAIL 4a: duplicate scan changed submitted_at';
  end if;

  -- 4b. Y had status missing + score 2 → scan records it, score stays 2.
  r := public.record_submission_scan('00000000-0030-0004-0000-000000000001', (select y from qr30));
  if r->>'outcome' <> 'recorded' or (r#>>'{submission,score}')::numeric <> 2 or r#>>'{submission,status}' <> 'submitted' then raise exception 'FAIL 4b: %', r; end if;

  -- 4c. Garbage and well-formed-but-unknown QR → invalid_qr, no details.
  r := public.record_submission_scan('00000000-0030-0004-0000-000000000001', 'https://example.com/?id=1');
  if r->>'outcome' <> 'invalid_qr' or r ? 'student' then raise exception 'FAIL 4c: %', r; end if;
  r := public.record_submission_scan('00000000-0030-0004-0000-000000000001', 'kcqr1' || repeat('f', 64));
  if r->>'outcome' <> 'invalid_qr' then raise exception 'FAIL 4c (unknown): %', r; end if;

  -- 4d. Z (teacher B's student) → not_in_roster, and no name leaks.
  r := public.record_submission_scan('00000000-0030-0004-0000-000000000001', (select z from qr30));
  if r->>'outcome' <> 'not_in_roster' or r ? 'student' then raise exception 'FAIL 4d: %', r; end if;
  raise notice 'PASS 4: duplicates keep the first timestamp; grades kept; invalid/foreign QR handled';
end $$;
reset role;

do $$
begin
  if (select count(*) from public.assignment_submissions where assignment_id = '00000000-0030-0004-0000-000000000001') <> 2 then
    raise exception 'FAIL 4: duplicate rows exist for w1';
  end if;
  if (select note from public.assignment_submissions where assignment_id = '00000000-0030-0004-0000-000000000001' and student_id = '00000000-0030-0002-0000-000000000002') <> 'ครูบันทึกไว้เดิม' then
    raise exception 'FAIL 4: teacher note changed';
  end if;
  if exists (select 1 from public.assignment_submissions where student_id = '00000000-0030-0002-0000-000000000003') then
    raise exception 'FAIL 4: a row was written for a foreign student';
  end if;
end $$;

-- 4e. Semester change: the classroom moves to 2569/2 — same token works.
update public.classrooms set semester = '2' where id = '00000000-0030-0001-0000-00000000000a';

set role authenticated;
select set_test_user('00000000-0030-0000-0000-00000000000a');
do $$
declare
  r jsonb;
  v_old text := (select x from qr30);
  v_new text;
begin
  r := public.record_submission_scan('00000000-0030-0004-0000-000000000002', (select y from qr30));
  if r->>'outcome' <> 'recorded' then raise exception 'FAIL 4e: token stopped working after a semester change: %', r; end if;

  -- 4f. Regenerate X: old token → revoked_qr (name shown, same roster), new works.
  select token into v_new from public.regenerate_student_qr_code('00000000-0030-0001-0000-00000000000a', '00000000-0030-0002-0000-000000000001');
  if v_new is null or v_new = v_old then raise exception 'FAIL 4f: no new token'; end if;
  r := public.record_submission_scan('00000000-0030-0004-0000-000000000007', v_old);
  if r->>'outcome' <> 'revoked_qr' or r#>>'{student,first_name}' <> 'TEST0030: เอกชัย' then raise exception 'FAIL 4f: old token %', r; end if;
  r := public.record_submission_scan('00000000-0030-0004-0000-000000000007', v_new);
  if r->>'outcome' <> 'duplicate' then raise exception 'FAIL 4f: new token %', r; end if;
  raise notice 'PASS 4e/4f: stable across semesters; revocation + regeneration';
end $$;
reset role;

do $$
begin
  if (select count(*) from public.student_qr_identities where student_id = '00000000-0030-0002-0000-000000000001' and status = 'active') <> 1
     or (select count(*) from public.student_qr_identities where student_id = '00000000-0030-0002-0000-000000000001' and status = 'revoked' and revoked_by = '00000000-0030-0000-0000-00000000000a') <> 1 then
    raise exception 'FAIL 4f: identity history wrong';
  end if;
end $$;

-- ==================================================
-- 5. Corrections (audited), excused, manual fallback
-- ==================================================

set role authenticated;
select set_test_user('00000000-0030-0000-0000-00000000000a');
do $$
declare
  r jsonb;
begin
  begin
    perform public.correct_submission_status('00000000-0030-0004-0000-000000000001', '00000000-0030-0002-0000-000000000002', 'excused', '');
    raise exception 'FAIL 5: correction without a reason accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.correct_submission_status('00000000-0030-0004-0000-000000000001', '00000000-0030-0002-0000-000000000002', 'graded', 'ทดสอบ');
    raise exception 'FAIL 5: unknown status accepted';
  exception when invalid_parameter_value then null;
  end;

  -- Wrong student scanned: undo Y on w1 → not_submitted, score kept.
  r := public.correct_submission_status('00000000-0030-0004-0000-000000000001', '00000000-0030-0002-0000-000000000002', 'not_submitted', 'สแกนผิดคน');
  if r->>'outcome' <> 'corrected' or r#>>'{submission,status}' <> 'not_submitted' or r#>'{submission,submitted_at}' <> 'null'::jsonb or (r#>>'{submission,score}')::numeric <> 2 then
    raise exception 'FAIL 5a: %', r;
  end if;

  -- Excuse the pre-existing student on w2, then a scan reports excused.
  r := public.correct_submission_status('00000000-0030-0004-0000-000000000002', '00000000-0030-0002-0000-000000000004', 'excused', 'ป่วย มีใบรับรองแพทย์');
  if r#>>'{submission,status}' <> 'excused' then raise exception 'FAIL 5b: %', r; end if;
  r := public.record_submission_manual('00000000-0030-0004-0000-000000000002', '00000000-0030-0002-0000-000000000004');
  if r->>'outcome' <> 'excused' then raise exception 'FAIL 5b: scan over excused %', r; end if;

  -- Manual fallback records like a scan.
  r := public.record_submission_manual('00000000-0030-0004-0000-000000000001', '00000000-0030-0002-0000-000000000004');
  if r->>'outcome' <> 'recorded' or r#>>'{submission,status}' <> 'submitted' then raise exception 'FAIL 5c: %', r; end if;

  -- Same status again → unchanged, no extra audit row.
  r := public.correct_submission_status('00000000-0030-0004-0000-000000000002', '00000000-0030-0002-0000-000000000004', 'excused', 'ซ้ำ');
  if r->>'outcome' <> 'unchanged' then raise exception 'FAIL 5d: %', r; end if;

  -- The audit trail is readable by the owning teacher.
  if (select count(*) from public.assignment_submission_events where assignment_id::text like '00000000-0030-0004-%' and event_type = 'status_corrected') <> 2 then
    raise exception 'FAIL 5e: expected 2 correction events';
  end if;
  if not exists (select 1 from public.assignment_submission_events where reason = 'สแกนผิดคน' and previous_status = 'submitted' and new_status = 'not_submitted' and previous_submitted_at is not null) then
    raise exception 'FAIL 5e: correction event lacks the previous values';
  end if;
  begin
    insert into public.assignment_submission_events (assignment_id, student_id, event_type) values ('00000000-0030-0004-0000-000000000001', '00000000-0030-0002-0000-000000000001', 'status_corrected');
    raise exception 'FAIL 5e: client could forge an audit event';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS 5: audited corrections, excused, manual fallback';
end $$;

select set_test_user('00000000-0030-0000-0000-00000000000b');
do $$
begin
  if exists (select 1 from public.assignment_submission_events where assignment_id::text like '00000000-0030-0004-%') then
    raise exception 'FAIL 5f: teacher B can read teacher A''s audit trail';
  end if;
  begin
    perform public.correct_submission_status('00000000-0030-0004-0000-000000000001', '00000000-0030-0002-0000-000000000001', 'excused', 'ไม่ควรได้');
    raise exception 'FAIL 5f: teacher B corrected teacher A''s submission';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS 5f: another teacher cannot read or correct';
end $$;

-- ==================================================
-- 6. Student self-service cannot excuse or forge recorded_via
-- ==================================================

select set_test_user('00000000-0030-0000-0000-000000000001');
do $$
begin
  begin
    update public.assignment_submissions set status = 'excused'
     where assignment_id = '00000000-0030-0004-0000-000000000001' and student_id = '00000000-0030-0002-0000-000000000001';
    raise exception 'FAIL 6: student excused their own submission';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.assignment_submissions set recorded_via = 'teacher_correction'
     where assignment_id = '00000000-0030-0004-0000-000000000001' and student_id = '00000000-0030-0002-0000-000000000001';
    raise exception 'FAIL 6: student forged recorded_via';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS 6: students cannot excuse themselves or forge the recording source';
end $$;
reset role;

-- ==================================================
-- 7. Assignment settings constraints
-- ==================================================

do $$
begin
  begin
    update public.assignments set late_policy = 'whatever' where id = '00000000-0030-0004-0000-000000000001';
    raise exception 'FAIL 7: invalid late_policy accepted';
  exception when check_violation then null;
  end;
  raise notice 'PASS 7: late_policy constrained';
end $$;

select clear_test_user();
\echo 'ALL 0030 CHECKS PASSED'
