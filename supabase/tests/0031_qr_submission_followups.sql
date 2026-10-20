-- Regression test for 0031_qr_submission_followups.sql.
-- Dev-only: run against a throwaway local Postgres with the Supabase shim
-- and migrations 0001 → 0031 applied (0030 required; 0029 optional — the
-- notification checks run only when 0029 is installed, and without it the
-- test checks that 0031 created none of the notification functions).
-- Never run against production. Self-contained and re-runnable: creates
-- and removes its own TEST0031 fixtures. Every check raises an exception
-- on failure.

\set ON_ERROR_STOP on

reset role;
select clear_test_user();

select (to_regclass('public.notifications') is not null) as has_0029 \gset
\if :has_0029
\echo '0031 test: 0029 installed — notification checks included'
\else
\echo '0031 test: 0029 NOT installed — notification checks skipped'
\endif

-- ==================================================
-- Fixtures
-- ==================================================

do $$
begin
  alter table auth.users disable trigger on_auth_user_created;
exception when undefined_object then null;
end $$;

delete from public.assignment_submission_events where assignment_id in (select id from public.assignments where title like 'TEST0031:%');
\if :has_0029
delete from public.notifications where recipient_user_id in (select id from public.profiles where display_name like 'TEST0031:%');
\endif
delete from public.assignment_submissions where assignment_id in (select id from public.assignments where title like 'TEST0031:%');
delete from public.assignments where title like 'TEST0031:%';
delete from public.subject_classrooms where subject_id in (select id from public.subjects where name like 'TEST0031:%');
delete from public.subjects where name like 'TEST0031:%';
delete from public.classroom_students where classroom_id in (select id from public.classrooms where name like 'TEST0031:%');
delete from public.student_qr_identities where student_id in (select id from public.students where first_name like 'TEST0031:%');
update public.students set linked_profile_id = null where first_name like 'TEST0031:%';
delete from public.students where first_name like 'TEST0031:%';
delete from public.classrooms where name like 'TEST0031:%';
delete from public.profiles where display_name like 'TEST0031:%';
delete from auth.users where email like 'test0031_%';

insert into auth.users (id, email) values
  ('00000000-0031-0000-0000-00000000000a', 'test0031_teacher_a@example.com'),
  ('00000000-0031-0000-0000-000000000001', 'test0031_student_x@example.com'),
  ('00000000-0031-0000-0000-000000000002', 'test0031_student_w@example.com');

insert into public.profiles (id, display_name, email, role) values
  ('00000000-0031-0000-0000-00000000000a', 'TEST0031: Teacher A', 'test0031_teacher_a@example.com', 'teacher'),
  ('00000000-0031-0000-0000-000000000001', 'TEST0031: Student X', 'test0031_student_x@example.com', 'student'),
  ('00000000-0031-0000-0000-000000000002', 'TEST0031: Student W', 'test0031_student_w@example.com', 'student');

insert into public.classrooms (id, teacher_id, name, academic_year, semester) values
  ('00000000-0031-0001-0000-00000000000a', '00000000-0031-0000-0000-00000000000a', 'TEST0031: ม.4/1', '2569', '1');

-- X and W have student accounts; Y and Z do not.
insert into public.students (id, first_name, last_name, number, student_code, linked_profile_id) values
  ('00000000-0031-0002-0000-000000000001', 'TEST0031: เอก', 'ใจดี', 1, 'T31-1', '00000000-0031-0000-0000-000000000001'),
  ('00000000-0031-0002-0000-000000000002', 'TEST0031: วันดี', 'ตั้งใจ', 2, 'T31-2', '00000000-0031-0000-0000-000000000002'),
  ('00000000-0031-0002-0000-000000000003', 'TEST0031: ยุพา', 'รักเรียน', 3, 'T31-3', null),
  ('00000000-0031-0002-0000-000000000004', 'TEST0031: ศิริ', 'มีสุข', 4, 'T31-4', null);

insert into public.classroom_students (classroom_id, student_id)
select '00000000-0031-0001-0000-00000000000a', id from public.students where first_name like 'TEST0031:%';

insert into public.subjects (id, teacher_id, name) values
  ('00000000-0031-0003-0000-00000000000a', '00000000-0031-0000-0000-00000000000a', 'TEST0031: วิทยาศาสตร์');
insert into public.subject_classrooms (subject_id, classroom_id) values
  ('00000000-0031-0003-0000-00000000000a', '00000000-0031-0001-0000-00000000000a');

-- t1 open, no deadline (scanning) · t2 due today (reminders) · t3 due tomorrow
insert into public.assignments (id, subject_id, classroom_id, title, max_score, due_date) values
  ('00000000-0031-0004-0000-000000000001', '00000000-0031-0003-0000-00000000000a', '00000000-0031-0001-0000-00000000000a', 'TEST0031: งานสแกน', 10, null),
  ('00000000-0031-0004-0000-000000000002', '00000000-0031-0003-0000-00000000000a', '00000000-0031-0001-0000-00000000000a', 'TEST0031: งานวันนี้', 10, (now() at time zone 'Asia/Bangkok')::date),
  ('00000000-0031-0004-0000-000000000003', '00000000-0031-0003-0000-00000000000a', '00000000-0031-0001-0000-00000000000a', 'TEST0031: งานพรุ่งนี้', 10, (now() at time zone 'Asia/Bangkok')::date + 1);

-- Existing grade that must survive everything below: Z on t1, missing, 3/10.
insert into public.assignment_submissions (assignment_id, student_id, status, score, note) values
  ('00000000-0031-0004-0000-000000000001', '00000000-0031-0002-0000-000000000004', 'missing', 3, 'คะแนนเดิม');

-- Called as teacher A: tokens come from the owner-only RPC, as in the app.
create or replace function pg_temp.tok(p uuid) returns text language sql as $$
  select q.token from public.get_classroom_student_qr_codes('00000000-0031-0001-0000-00000000000a') q where q.student_id = p
$$;
\if :has_0029
create or replace function pg_temp.teacher_submission_notifications() returns int language sql as $$
  select count(*)::int from public.notifications
   where recipient_user_id = '00000000-0031-0000-0000-00000000000a'
     and notification_type in ('assignment_submitted', 'assignment_resubmitted')
$$;
\endif

-- ==================================================
-- 0. What 0031 installed matches the configuration
-- ==================================================

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'log_student_submission_after_excused_trigger') then
    raise exception 'FAIL 0: audit trigger missing';
  end if;
  if to_regclass('public.notifications') is null
     and (to_regprocedure('public.notify_on_submission_change()') is not null
          or to_regprocedure('public.refresh_my_deadline_notifications()') is not null) then
    raise exception 'FAIL 0: 0031 created notification functions without 0029';
  end if;
  if to_regclass('public.notifications') is not null
     and (select md5(replace(prosrc, E'\r', '')) from pg_proc where oid = to_regprocedure('public.notify_on_submission_change()'))
         is distinct from 'db150fd803bab3afcad940364c5805e9' then
    raise exception 'FAIL 0: notify_on_submission_change is not the 0031 version';
  end if;
  raise notice 'PASS 0: installed objects match the configuration (0029 %)',
    case when to_regclass('public.notifications') is null then 'absent' else 'present' end;
end $$;

-- ==================================================
-- 1. Teacher-recorded submissions (QR behaviour unchanged; with 0029:
--    no teacher self-notification)
-- ==================================================

set role authenticated;
select set_test_user('00000000-0031-0000-0000-00000000000a');

do $$
declare
  r jsonb;
begin
  r := public.record_submission_scan('00000000-0031-0004-0000-000000000001', 'kcqr1' || pg_temp.tok('00000000-0031-0002-0000-000000000003'));
  if r->>'outcome' <> 'recorded' then raise exception 'FAIL 1: scan outcome %', r->>'outcome'; end if;
  r := public.record_submission_scan('00000000-0031-0004-0000-000000000001', 'kcqr1' || pg_temp.tok('00000000-0031-0002-0000-000000000003'));
  if r->>'outcome' <> 'duplicate' then raise exception 'FAIL 1: repeat scan outcome %', r->>'outcome'; end if;
  r := public.record_submission_scan('00000000-0031-0004-0000-000000000001', 'kcqr1' || pg_temp.tok('00000000-0031-0002-0000-000000000004'));
  if r->>'outcome' <> 'recorded' then raise exception 'FAIL 1: scan of the missing row: %', r->>'outcome'; end if;
  r := public.record_submission_manual('00000000-0031-0004-0000-000000000003', '00000000-0031-0002-0000-000000000003');
  if r->>'outcome' <> 'recorded' then raise exception 'FAIL 1: manual outcome %', r->>'outcome'; end if;
  r := public.correct_submission_status('00000000-0031-0004-0000-000000000002', '00000000-0031-0002-0000-000000000004', 'submitted', 'ส่งกระดาษกับครู');
  if r->>'outcome' <> 'corrected' then raise exception 'FAIL 1: correction outcome %', r->>'outcome'; end if;
  raise notice 'PASS 1: QR scan, duplicate, manual record and correction behave as in 0030';
end $$;

\if :has_0029
do $$
begin
  if pg_temp.teacher_submission_notifications() <> 0 then
    raise exception 'FAIL 1n: teacher got % self-notifications', pg_temp.teacher_submission_notifications();
  end if;
  raise notice 'PASS 1n: teacher-recorded submissions create no teacher notification';
end $$;

-- ==================================================
-- 2. A student's own "ส่งงาน" still notifies the teacher (unchanged)
-- ==================================================

select set_test_user('00000000-0031-0000-0000-000000000002');
insert into public.assignment_submissions (assignment_id, student_id, status, submitted_at)
values ('00000000-0031-0004-0000-000000000001', '00000000-0031-0002-0000-000000000002', 'submitted', now());

reset role;
select clear_test_user();
do $$
begin
  if pg_temp.teacher_submission_notifications() <> 1 then
    raise exception 'FAIL 2: expected 1 teacher notification for the student submission, got %', pg_temp.teacher_submission_notifications();
  end if;
  raise notice 'PASS 2: student self-submission still notifies the teacher';
end $$;

-- 2b. A change by someone other than the classroom teacher (no auth user:
-- service role / SQL) still notifies, as in 0029.
insert into public.assignment_submissions (assignment_id, student_id, status, submitted_at)
values ('00000000-0031-0004-0000-000000000003', '00000000-0031-0002-0000-000000000002', 'submitted', now());
do $$
begin
  if pg_temp.teacher_submission_notifications() <> 2 then
    raise exception 'FAIL 2b: a non-teacher change no longer notifies (got %)', pg_temp.teacher_submission_notifications();
  end if;
  raise notice 'PASS 2b: changes by others still notify the teacher';
end $$;

-- 2c. Grading still notifies the student (unchanged).
set role authenticated;
select set_test_user('00000000-0031-0000-0000-00000000000a');
update public.assignment_submissions set score = 8, reviewed_at = now()
 where assignment_id = '00000000-0031-0004-0000-000000000001' and student_id = '00000000-0031-0002-0000-000000000002';
reset role;
select clear_test_user();
do $$
begin
  if not exists (select 1 from public.notifications
                  where recipient_user_id = '00000000-0031-0000-0000-000000000002' and notification_type = 'submission_graded') then
    raise exception 'FAIL 2c: graded notification to the student is missing';
  end if;
  raise notice 'PASS 2c: score notification to the student unchanged';
end $$;
\else
-- Without 0029: a student's own submission and grading still work.
select set_test_user('00000000-0031-0000-0000-000000000002');
insert into public.assignment_submissions (assignment_id, student_id, status, submitted_at)
values ('00000000-0031-0004-0000-000000000001', '00000000-0031-0002-0000-000000000002', 'submitted', now());
select set_test_user('00000000-0031-0000-0000-00000000000a');
update public.assignment_submissions set score = 8, reviewed_at = now()
 where assignment_id = '00000000-0031-0004-0000-000000000001' and student_id = '00000000-0031-0002-0000-000000000002';
reset role;
select clear_test_user();
insert into public.assignment_submissions (assignment_id, student_id, status, submitted_at)
values ('00000000-0031-0004-0000-000000000003', '00000000-0031-0002-0000-000000000002', 'submitted', now());
do $$
begin
  if (select score from public.assignment_submissions
       where assignment_id = '00000000-0031-0004-0000-000000000001' and student_id = '00000000-0031-0002-0000-000000000002') is distinct from 8 then
    raise exception 'FAIL 2: student submission / grading broken without 0029';
  end if;
  raise notice 'PASS 2: student submission and grading work without 0029';
end $$;
\endif

-- ==================================================
-- 3. Excuse X on "today"; with 0029: reminders skip excused students
-- ==================================================

set role authenticated;
select set_test_user('00000000-0031-0000-0000-00000000000a');
select public.correct_submission_status('00000000-0031-0004-0000-000000000002', '00000000-0031-0002-0000-000000000001', 'excused', 'ลาป่วย');

\if :has_0029
-- X is excused on "today"; X has nothing on "tomorrow". W has nothing on
-- "today". Z was corrected to submitted on "today" in (1), Y nothing.
select public.refresh_my_deadline_notifications();
select set_test_user('00000000-0031-0000-0000-000000000001');
select public.refresh_my_deadline_notifications();
select set_test_user('00000000-0031-0000-0000-000000000002');
select public.refresh_my_deadline_notifications();

reset role;
select clear_test_user();
do $$
declare
  v_body text;
begin
  -- Teacher, "today": X excused, Z submitted → pending = W + Y = 2.
  select body into v_body from public.notifications
   where recipient_user_id = '00000000-0031-0000-0000-00000000000a' and notification_type = 'deadline_teacher'
     and entity_id = '00000000-0031-0004-0000-000000000002';
  if v_body is null or v_body not like '%ยังไม่ส่ง 2 คน' then
    raise exception 'FAIL 3: teacher reminder should count 2 pending, got %', v_body;
  end if;
  -- Excused X: no reminder for "today", still one for "tomorrow".
  if exists (select 1 from public.notifications where recipient_user_id = '00000000-0031-0000-0000-000000000001'
              and notification_type = 'deadline_student' and entity_id = '00000000-0031-0004-0000-000000000002') then
    raise exception 'FAIL 3: excused student was reminded';
  end if;
  if not exists (select 1 from public.notifications where recipient_user_id = '00000000-0031-0000-0000-000000000001'
                  and notification_type = 'deadline_student' and entity_id = '00000000-0031-0004-0000-000000000003') then
    raise exception 'FAIL 3: the same student lost the reminder for a non-excused assignment';
  end if;
  -- Non-excused W still reminded for "today".
  if not exists (select 1 from public.notifications where recipient_user_id = '00000000-0031-0000-0000-000000000002'
                  and notification_type = 'deadline_student' and entity_id = '00000000-0031-0004-0000-000000000002') then
    raise exception 'FAIL 3: a non-excused student was not reminded';
  end if;
  raise notice 'PASS 3: reminders skip excused students only';
end $$;
\endif

-- ==================================================
-- 4. An excused student who submits anyway
-- ==================================================

-- Teacher adds a note on the excused row first: it must survive.
reset role;
select clear_test_user();
set role authenticated;
select set_test_user('00000000-0031-0000-0000-00000000000a');
update public.assignment_submissions set note = 'ยกเว้นเพราะป่วย'
 where assignment_id = '00000000-0031-0004-0000-000000000002' and student_id = '00000000-0031-0002-0000-000000000001';

-- QR scan on an excused row changes nothing (0030 behaviour).
do $$
declare
  r jsonb;
begin
  r := public.record_submission_scan('00000000-0031-0004-0000-000000000002', 'kcqr1' || pg_temp.tok('00000000-0031-0002-0000-000000000001'));
  if r->>'outcome' <> 'excused' then raise exception 'FAIL 4: scan on excused row: %', r->>'outcome'; end if;
end $$;

-- The student hands in work through "ส่งงาน" (finalizeSubmission).
select set_test_user('00000000-0031-0000-0000-000000000001');
update public.assignment_submissions set status = 'submitted', submitted_at = now()
 where assignment_id = '00000000-0031-0004-0000-000000000002' and student_id = '00000000-0031-0002-0000-000000000001';

reset role;
select clear_test_user();
do $$
declare
  v_sub record;
  v_events int;
begin
  select * into v_sub from public.assignment_submissions
   where assignment_id = '00000000-0031-0004-0000-000000000002' and student_id = '00000000-0031-0002-0000-000000000001';
  if v_sub.status <> 'submitted' or v_sub.submitted_at is null then raise exception 'FAIL 4: status %', v_sub.status; end if;
  if v_sub.note is distinct from 'ยกเว้นเพราะป่วย' or v_sub.score is not null then raise exception 'FAIL 4: note/score changed'; end if;
  select count(*) into v_events from public.assignment_submission_events
   where assignment_id = '00000000-0031-0004-0000-000000000002' and student_id = '00000000-0031-0002-0000-000000000001'
     and event_type = 'student_submitted_after_excused' and previous_status = 'excused' and new_status = 'submitted'
     and actor_id = '00000000-0031-0000-0000-000000000001';
  if v_events <> 1 then raise exception 'FAIL 4: expected 1 audit event, got %', v_events; end if;
  raise notice 'PASS 4: excused student can still submit — status submitted, note kept, audited';
end $$;

\if :has_0029
do $$
begin
  if not exists (select 1 from public.notifications where recipient_user_id = '00000000-0031-0000-0000-00000000000a'
                  and notification_type = 'assignment_submitted' and metadata->>'student_id' = '00000000-0031-0002-0000-000000000001') then
    raise exception 'FAIL 4n: teacher was not notified of the submission after excuse';
  end if;
  raise notice 'PASS 4n: teacher notified of the submission after excuse';
end $$;
\endif

-- 4b. A teacher's own correction out of excused is NOT logged as a
-- student submission (it is already a status_corrected event).
set role authenticated;
select set_test_user('00000000-0031-0000-0000-00000000000a');
select public.correct_submission_status('00000000-0031-0004-0000-000000000003', '00000000-0031-0002-0000-000000000004', 'excused', 'ย้ายห้อง');
select public.correct_submission_status('00000000-0031-0004-0000-000000000003', '00000000-0031-0002-0000-000000000004', 'late', 'ส่งย้อนหลัง');
reset role;
select clear_test_user();
do $$
begin
  if exists (select 1 from public.assignment_submission_events
              where assignment_id = '00000000-0031-0004-0000-000000000003' and student_id = '00000000-0031-0002-0000-000000000004'
                and event_type = 'student_submitted_after_excused') then
    raise exception 'FAIL 4b: teacher correction logged as a student submission';
  end if;
  raise notice 'PASS 4b: teacher corrections are not logged as student submissions';
end $$;

-- 4c. Students still cannot excuse themselves, nor write audit events.
set role authenticated;
select set_test_user('00000000-0031-0000-0000-000000000002');
do $$
begin
  begin
    update public.assignment_submissions set status = 'excused'
     where assignment_id = '00000000-0031-0004-0000-000000000001' and student_id = '00000000-0031-0002-0000-000000000002';
    raise exception 'FAIL 4c: student excused themselves';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.assignment_submission_events (assignment_id, student_id, event_type)
    values ('00000000-0031-0004-0000-000000000001', '00000000-0031-0002-0000-000000000002', 'student_submitted_after_excused');
    raise exception 'FAIL 4c: student inserted an audit event';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS 4c: students cannot self-excuse or forge audit events';
end $$;
reset role;
select clear_test_user();

-- ==================================================
-- 5. Scores intact, privileges unchanged
-- ==================================================

do $$
declare
  v_score numeric;
  v_note text;
begin
  select score, note into v_score, v_note from public.assignment_submissions
   where assignment_id = '00000000-0031-0004-0000-000000000001' and student_id = '00000000-0031-0002-0000-000000000004';
  if v_score is distinct from 3 or v_note is distinct from 'คะแนนเดิม' then
    raise exception 'FAIL 5: existing score/note changed (% / %)', v_score, v_note;
  end if;
  if has_function_privilege('authenticated', 'public.log_student_submission_after_excused()', 'execute')
     or has_function_privilege('anon', 'public.log_student_submission_after_excused()', 'execute') then
    raise exception 'FAIL 5: audit trigger function is callable by clients';
  end if;
  if to_regclass('public.notifications') is not null then
    if has_function_privilege('authenticated', 'public.notify_on_submission_change()', 'execute')
       or not has_function_privilege('authenticated', 'public.refresh_my_deadline_notifications()', 'execute')
       or has_function_privilege('anon', 'public.refresh_my_deadline_notifications()', 'execute') then
      raise exception 'FAIL 5: 0029 function grants changed';
    end if;
  end if;
  raise notice 'PASS 5: scores and notes intact, privileges as before';
end $$;

-- ==================================================
-- Cleanup
-- ==================================================

delete from public.assignment_submission_events where assignment_id in (select id from public.assignments where title like 'TEST0031:%');
\if :has_0029
delete from public.notifications where recipient_user_id in (select id from public.profiles where display_name like 'TEST0031:%');
\endif
delete from public.assignment_submissions where assignment_id in (select id from public.assignments where title like 'TEST0031:%');
delete from public.assignments where title like 'TEST0031:%';
delete from public.subject_classrooms where subject_id in (select id from public.subjects where name like 'TEST0031:%');
delete from public.subjects where name like 'TEST0031:%';
delete from public.classroom_students where classroom_id in (select id from public.classrooms where name like 'TEST0031:%');
delete from public.student_qr_identities where student_id in (select id from public.students where first_name like 'TEST0031:%');
update public.students set linked_profile_id = null where first_name like 'TEST0031:%';
delete from public.students where first_name like 'TEST0031:%';
delete from public.classrooms where name like 'TEST0031:%';
delete from public.profiles where display_name like 'TEST0031:%';
delete from auth.users where email like 'test0031_%';

\echo 'ALL 0031 CHECKS PASSED'
