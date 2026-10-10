-- Regression / adversarial test for 0029_notifications.sql. Dev-only: run
-- against a throwaway local Postgres with the Supabase shim (auth.users,
-- auth.uid() reading request.jwt.claim.sub, set_test_user(), anon/
-- authenticated roles — see docs/DATABASE.md "Empirical RLS/RPC
-- verification") and migrations 0001 → 0029 applied. Never run against
-- production. Self-contained and re-runnable: creates and removes its own
-- TEST0029 fixtures. Every check raises an exception on failure.

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

delete from public.notifications where recipient_user_id in (select id from public.profiles where display_name like 'TEST0029:%');
delete from public.student_account_link_requests where requested_by in (select id from public.profiles where display_name like 'TEST0029:%');
delete from public.assignment_submissions where assignment_id in (select id from public.assignments where title like 'TEST0029:%');
delete from public.assignments where title like 'TEST0029:%';
delete from public.subject_classrooms where subject_id in (select id from public.subjects where name like 'TEST0029:%');
delete from public.subjects where name like 'TEST0029:%';
delete from public.classroom_students where classroom_id in (select id from public.classrooms where name like 'TEST0029:%');
update public.students set linked_profile_id = null where first_name like 'TEST0029:%';
delete from public.students where first_name like 'TEST0029:%';
delete from public.classrooms where name like 'TEST0029:%';
delete from public.profiles where display_name like 'TEST0029:%';
delete from auth.users where email like 'test0029_%';

insert into auth.users (id, email) values
  ('00000000-0029-0000-0000-00000000000a', 'test0029_teacher_a@example.com'),
  ('00000000-0029-0000-0000-00000000000b', 'test0029_teacher_b@example.com'),
  ('00000000-0029-0000-0000-000000000001', 'test0029_student1@example.com'),
  ('00000000-0029-0000-0000-000000000002', 'test0029_student2@example.com'),
  ('00000000-0029-0000-0000-000000000003', 'test0029_requester@example.com');

insert into public.profiles (id, display_name, email, role) values
  ('00000000-0029-0000-0000-00000000000a', 'TEST0029: Teacher A', 'test0029_teacher_a@example.com', 'teacher'),
  ('00000000-0029-0000-0000-00000000000b', 'TEST0029: Teacher B', 'test0029_teacher_b@example.com', 'teacher'),
  ('00000000-0029-0000-0000-000000000001', 'TEST0029: Student1', 'test0029_student1@example.com', 'student'),
  ('00000000-0029-0000-0000-000000000002', 'TEST0029: Student2', 'test0029_student2@example.com', 'student'),
  ('00000000-0029-0000-0000-000000000003', 'TEST0029: Requester', 'test0029_requester@example.com', 'student');

insert into public.classrooms (id, teacher_id, name) values
  ('00000000-0029-0001-0000-00000000000a', '00000000-0029-0000-0000-00000000000a', 'TEST0029: ม.4/1'),
  ('00000000-0029-0001-0000-00000000000b', '00000000-0029-0000-0000-00000000000b', 'TEST0029: ม.4/2');

-- s1: linked (student1) in A's room; s2: linked (student2) in B's room;
-- s3: unlinked in A's room (target of the link request); s4: unlinked in A's room.
insert into public.students (id, first_name, last_name, student_code, linked_profile_id) values
  ('00000000-0029-0002-0000-000000000001', 'TEST0029: สมชาย', 'ใจดี', 'T29-1', '00000000-0029-0000-0000-000000000001'),
  ('00000000-0029-0002-0000-000000000002', 'TEST0029: สมหญิง', 'รักเรียน', 'T29-2', '00000000-0029-0000-0000-000000000002'),
  ('00000000-0029-0002-0000-000000000003', 'TEST0029: มานี', 'มีนา', 'T29-3', null),
  ('00000000-0029-0002-0000-000000000004', 'TEST0029: ปิติ', 'ชูใจ', 'T29-4', null);

insert into public.classroom_students (classroom_id, student_id) values
  ('00000000-0029-0001-0000-00000000000a', '00000000-0029-0002-0000-000000000001'),
  ('00000000-0029-0001-0000-00000000000a', '00000000-0029-0002-0000-000000000003'),
  ('00000000-0029-0001-0000-00000000000a', '00000000-0029-0002-0000-000000000004'),
  ('00000000-0029-0001-0000-00000000000b', '00000000-0029-0002-0000-000000000002');

insert into public.subjects (id, teacher_id, name) values
  ('00000000-0029-0003-0000-00000000000a', '00000000-0029-0000-0000-00000000000a', 'TEST0029: วิทยาศาสตร์'),
  ('00000000-0029-0003-0000-00000000000b', '00000000-0029-0000-0000-00000000000b', 'TEST0029: คณิตศาสตร์');

-- ==================================================
-- 1. New assignment -> linked, active students of that classroom only
-- ==================================================

select set_test_user('00000000-0029-0000-0000-00000000000a');
insert into public.assignments (id, subject_id, classroom_id, title, max_score, due_date, created_by) values
  ('00000000-0029-0004-0000-000000000001', '00000000-0029-0003-0000-00000000000a', '00000000-0029-0001-0000-00000000000a', 'TEST0029: รายงานการทดลอง', 10,
   ((now() at time zone 'Asia/Bangkok')::date + 1), '00000000-0029-0000-0000-00000000000a');

do $$
begin
  if (select count(*) from public.notifications where notification_type = 'assignment_published' and entity_id = '00000000-0029-0004-0000-000000000001') <> 1 then
    raise exception 'FAIL 1: expected exactly one published notification (student1 only)';
  end if;
  if not exists (select 1 from public.notifications where notification_type = 'assignment_published' and recipient_user_id = '00000000-0029-0000-0000-000000000001') then
    raise exception 'FAIL 1: student1 did not get the new assignment';
  end if;
  if exists (select 1 from public.notifications where recipient_user_id = '00000000-0029-0000-0000-000000000002') then
    raise exception 'FAIL 1: student2 (other classroom) was notified';
  end if;
  raise notice 'PASS 1: new assignment notifies only linked students of that classroom';
end $$;

-- ==================================================
-- 2. Student submission (through RLS as the student) -> owning teacher
-- ==================================================

set role authenticated;
select set_test_user('00000000-0029-0000-0000-000000000001');
insert into public.assignment_submissions (id, assignment_id, student_id, status)
values ('00000000-0029-0005-0000-000000000001', '00000000-0029-0004-0000-000000000001', '00000000-0029-0002-0000-000000000001', 'not_submitted');
update public.assignment_submissions set status = 'submitted', submitted_at = now() - interval '2 minutes' where id = '00000000-0029-0005-0000-000000000001';
reset role;

do $$
declare
  v record;
begin
  select * into v from public.notifications where recipient_user_id = '00000000-0029-0000-0000-00000000000a' and entity_id = '00000000-0029-0005-0000-000000000001';
  if v.id is null or v.notification_type <> 'assignment_submitted' then
    raise exception 'FAIL 2: teacher A did not get a submission notification';
  end if;
  if v.metadata->>'student_name' <> 'TEST0029: สมชาย ใจดี' or v.metadata->>'classroom_name' <> 'TEST0029: ม.4/1'
     or v.metadata->>'subject_name' <> 'TEST0029: วิทยาศาสตร์' or v.metadata->>'assignment_title' <> 'TEST0029: รายงานการทดลอง'
     or v.metadata->>'submitted_at' is null or v.actor_user_id <> '00000000-0029-0000-0000-000000000001' then
    raise exception 'FAIL 2: submission metadata incomplete: %', v.metadata;
  end if;
  if exists (select 1 from public.notifications where recipient_user_id = '00000000-0029-0000-0000-00000000000b') then
    raise exception 'FAIL 2: teacher B was notified about teacher A''s student';
  end if;
  raise notice 'PASS 2: submission -> owning teacher with student, classroom, subject, assignment, time';
end $$;

-- 3. Same event again (status-only update, same submitted_at) -> no duplicate
set role authenticated;
select set_test_user('00000000-0029-0000-0000-000000000001');
update public.assignment_submissions set status = 'submitted' where id = '00000000-0029-0005-0000-000000000001';
reset role;
do $$
begin
  if (select count(*) from public.notifications where entity_id = '00000000-0029-0005-0000-000000000001' and recipient_user_id = '00000000-0029-0000-0000-00000000000a') <> 1 then
    raise exception 'FAIL 3: duplicate submission notification';
  end if;
  raise notice 'PASS 3: re-firing the same submission event is idempotent';
end $$;

-- 4. Resubmission while unread -> same row refreshed as "resubmitted"
set role authenticated;
select set_test_user('00000000-0029-0000-0000-000000000001');
update public.assignment_submissions set submitted_at = now() - interval '1 minute' where id = '00000000-0029-0005-0000-000000000001';
reset role;
do $$
begin
  if (select count(*) from public.notifications where entity_id = '00000000-0029-0005-0000-000000000001' and recipient_user_id = '00000000-0029-0000-0000-00000000000a') <> 1 then
    raise exception 'FAIL 4: unread resubmission stacked a second row';
  end if;
  if (select notification_type from public.notifications where entity_id = '00000000-0029-0005-0000-000000000001' and recipient_user_id = '00000000-0029-0000-0000-00000000000a') <> 'assignment_resubmitted' then
    raise exception 'FAIL 4: resubmission not marked as resubmitted';
  end if;
  raise notice 'PASS 4: unread resubmission refreshes the existing notification';
end $$;

-- ==================================================
-- 5. Own-row reads, mark read, cross-user authorization, forgery
-- ==================================================

set role authenticated;
select set_test_user('00000000-0029-0000-0000-00000000000b');
do $$
declare
  v_other uuid;
begin
  if (select count(*) from public.notifications) <> 0 then
    raise exception 'FAIL 5a: teacher B can read other users'' notifications';
  end if;
  select id into v_other from public.notifications limit 1; -- sees nothing
  if public.mark_my_notifications_read(array(select id from public.notifications)) <> 0 then
    raise exception 'FAIL 5a: mark read changed rows';
  end if;
  raise notice 'PASS 5a: another teacher sees none of them';
end $$;
reset role;

-- Teacher B tries to mark teacher A's notification read by id -> 0 rows.
do $$
declare
  v_id uuid;
  v_changed integer;
begin
  select id into v_id from public.notifications where recipient_user_id = '00000000-0029-0000-0000-00000000000a' limit 1;
  perform set_test_user('00000000-0029-0000-0000-00000000000b');
  set local role authenticated;
  v_changed := public.mark_my_notifications_read(array[v_id]);
  reset role;
  if v_changed <> 0 or (select read_at from public.notifications where id = v_id) is not null then
    raise exception 'FAIL 5b: cross-user mark read';
  end if;
  raise notice 'PASS 5b: cannot mark someone else''s notification read';
end $$;

set role authenticated;
select set_test_user('00000000-0029-0000-0000-000000000001');
do $$
begin
  begin
    insert into public.notifications (recipient_user_id, notification_type, title, entity_type, dedupe_key)
    values ('00000000-0029-0000-0000-00000000000a', 'link_request', 'forged', 'assignment', 'forged');
    raise exception 'FAIL 5c: client insert allowed';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.notifications set title = 'x';
    raise exception 'FAIL 5c: client update allowed';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.notifications;
    raise exception 'FAIL 5c: client delete allowed';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.notifications_insert('00000000-0029-0000-0000-00000000000a', null, 'link_request', 'forged', null, 'assignment', null, '{}', 'forged2');
    raise exception 'FAIL 5c: internal insert helper callable';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS 5c: clients cannot insert/update/delete or call the internal helper';
end $$;
reset role;

set role anon;
select clear_test_user();
do $$
begin
  if (select count(*) from public.notifications) <> 0 then
    raise exception 'FAIL 5d: anon can read notifications';
  end if;
  raise notice 'PASS 5d: anon reads nothing';
exception when insufficient_privilege then
  raise notice 'PASS 5d: anon has no access';
end $$;
reset role;

-- Teacher A marks own read; a later resubmission becomes a new row.
set role authenticated;
select set_test_user('00000000-0029-0000-0000-00000000000a');
do $$
begin
  if public.mark_all_my_notifications_read() <> 1 then
    raise exception 'FAIL 6: mark all read count';
  end if;
  if exists (select 1 from public.notifications where read_at is null) then
    raise exception 'FAIL 6: unread left after mark all';
  end if;
  raise notice 'PASS 6: mark all read (own rows only)';
end $$;
reset role;

set role authenticated;
select set_test_user('00000000-0029-0000-0000-000000000001');
update public.assignment_submissions set submitted_at = now() where id = '00000000-0029-0005-0000-000000000001';
reset role;
do $$
begin
  if (select count(*) from public.notifications where entity_id = '00000000-0029-0005-0000-000000000001' and recipient_user_id = '00000000-0029-0000-0000-00000000000a') <> 2
     or (select count(*) from public.notifications where entity_id = '00000000-0029-0005-0000-000000000001' and recipient_user_id = '00000000-0029-0000-0000-00000000000a' and read_at is null) <> 1 then
    raise exception 'FAIL 7: resubmission after reading should add one new unread row';
  end if;
  raise notice 'PASS 7: resubmission after the teacher read it -> new unread notification';
end $$;

-- ==================================================
-- 8. Grading (as the teacher, through RLS) -> the student
-- ==================================================

set role authenticated;
select set_test_user('00000000-0029-0000-0000-00000000000a');
update public.assignment_submissions set score = 8, reviewed_at = now() where id = '00000000-0029-0005-0000-000000000001';
reset role;
do $$
declare
  v record;
begin
  select * into v from public.notifications where recipient_user_id = '00000000-0029-0000-0000-000000000001' and notification_type = 'submission_graded';
  if v.id is null or position('ได้ 8/10 คะแนน' in v.body) = 0 then
    raise exception 'FAIL 8: graded notification missing or wrong body: %', v.body;
  end if;
  raise notice 'PASS 8: grading notifies the student (%).', v.body;
end $$;

-- Student reads it; same score again -> unchanged; new score -> same row, unread again.
set role authenticated;
select set_test_user('00000000-0029-0000-0000-000000000001');
select public.mark_all_my_notifications_read();
select set_test_user('00000000-0029-0000-0000-00000000000a');
update public.assignment_submissions set score = 8 where id = '00000000-0029-0005-0000-000000000001';
reset role;
do $$
begin
  if (select read_at from public.notifications where recipient_user_id = '00000000-0029-0000-0000-000000000001' and notification_type = 'submission_graded') is null then
    raise exception 'FAIL 9: unchanged score re-notified';
  end if;
end $$;
set role authenticated;
select set_test_user('00000000-0029-0000-0000-00000000000a');
update public.assignment_submissions set score = 10 where id = '00000000-0029-0005-0000-000000000001';
reset role;
do $$
begin
  if (select count(*) from public.notifications where recipient_user_id = '00000000-0029-0000-0000-000000000001' and notification_type = 'submission_graded') <> 1
     or (select read_at from public.notifications where recipient_user_id = '00000000-0029-0000-0000-000000000001' and notification_type = 'submission_graded') is not null
     or position('ได้ 10/10 คะแนน' in (select body from public.notifications where recipient_user_id = '00000000-0029-0000-0000-000000000001' and notification_type = 'submission_graded')) = 0 then
    raise exception 'FAIL 9: changed score should refresh the one graded notification as unread';
  end if;
  raise notice 'PASS 9: grade notifications are coalesced per submission';
end $$;

-- ==================================================
-- 10. Link request -> owning teacher; decision -> requester
-- ==================================================

set role authenticated;
select set_test_user('00000000-0029-0000-0000-000000000003');
insert into public.student_account_link_requests (id, student_id, requested_by)
values ('00000000-0029-0006-0000-000000000001', '00000000-0029-0002-0000-000000000003', '00000000-0029-0000-0000-000000000003');
reset role;
do $$
declare
  v record;
begin
  select * into v from public.notifications where notification_type = 'link_request' and entity_id = '00000000-0029-0006-0000-000000000001';
  if v.id is null or v.recipient_user_id <> '00000000-0029-0000-0000-00000000000a' then
    raise exception 'FAIL 10: owning teacher did not get the link request';
  end if;
  if v.metadata->>'status' <> 'pending' or v.metadata->>'classroom_names' <> 'TEST0029: ม.4/1' or v.metadata->>'student_name' <> 'TEST0029: มานี มีนา' then
    raise exception 'FAIL 10: link request metadata: %', v.metadata;
  end if;
  if exists (select 1 from public.notifications where recipient_user_id = '00000000-0029-0000-0000-00000000000b') then
    raise exception 'FAIL 10: other teacher notified';
  end if;
  if (select status from public.student_account_link_requests where id = '00000000-0029-0006-0000-000000000001') <> 'pending' then
    raise exception 'FAIL 10: request status changed';
  end if;
  raise notice 'PASS 10: pending request -> owning teacher only, request stays pending';
end $$;

-- Reading the notification never approves the request.
set role authenticated;
select set_test_user('00000000-0029-0000-0000-00000000000a');
select public.mark_all_my_notifications_read();
reset role;
do $$
begin
  if (select status from public.student_account_link_requests where id = '00000000-0029-0006-0000-000000000001') <> 'pending'
     or (select linked_profile_id from public.students where id = '00000000-0029-0002-0000-000000000003') is not null then
    raise exception 'FAIL 11: reading the notification changed the request';
  end if;
  raise notice 'PASS 11: reading a request notification does not approve it';
end $$;

set role authenticated;
select set_test_user('00000000-0029-0000-0000-00000000000a');
select public.approve_student_link_request('00000000-0029-0006-0000-000000000001');
reset role;
do $$
begin
  if (select metadata->>'status' from public.notifications where notification_type = 'link_request' and entity_id = '00000000-0029-0006-0000-000000000001') <> 'approved' then
    raise exception 'FAIL 12: teacher notification status not updated';
  end if;
  if not exists (select 1 from public.notifications where recipient_user_id = '00000000-0029-0000-0000-000000000003' and notification_type = 'link_approved') then
    raise exception 'FAIL 12: requester not told about approval';
  end if;
  raise notice 'PASS 12: approval -> requester notified, teacher card shows approved';
end $$;

-- Rejection path (a second requester for s4).
update public.profiles set display_name = 'TEST0029: Requester2' where id = '00000000-0029-0000-0000-000000000002' and false; -- no-op, keeps fixtures stable
insert into auth.users (id, email) values ('00000000-0029-0000-0000-000000000004', 'test0029_requester2@example.com');
insert into public.profiles (id, display_name, email, role) values ('00000000-0029-0000-0000-000000000004', 'TEST0029: Requester2', 'test0029_requester2@example.com', 'student');
set role authenticated;
select set_test_user('00000000-0029-0000-0000-000000000004');
insert into public.student_account_link_requests (id, student_id, requested_by)
values ('00000000-0029-0006-0000-000000000002', '00000000-0029-0002-0000-000000000004', '00000000-0029-0000-0000-000000000004');
select set_test_user('00000000-0029-0000-0000-00000000000a');
select public.reject_student_link_request('00000000-0029-0006-0000-000000000002', 'รหัสไม่ตรง');
reset role;
do $$
declare
  v record;
begin
  select * into v from public.notifications where recipient_user_id = '00000000-0029-0000-0000-000000000004' and notification_type = 'link_rejected';
  if v.id is null or position('รหัสไม่ตรง' in v.body) = 0 then
    raise exception 'FAIL 13: rejection notification missing note';
  end if;
  raise notice 'PASS 13: rejection -> requester notified with the teacher''s note';
end $$;

-- ==================================================
-- 14. Deadline reminders (caller only, idempotent)
-- ==================================================

insert into public.assignments (id, subject_id, classroom_id, title, max_score, due_date) values
  ('00000000-0029-0004-0000-000000000002', '00000000-0029-0003-0000-00000000000a', '00000000-0029-0001-0000-00000000000a', 'TEST0029: แบบฝึกหัดบทที่ 2', 10,
   ((now() at time zone 'Asia/Bangkok')::date));

set role authenticated;
select set_test_user('00000000-0029-0000-0000-000000000001');
do $$
declare
  v1 integer;
  v2 integer;
begin
  v1 := public.refresh_my_deadline_notifications();
  v2 := public.refresh_my_deadline_notifications();
  -- assignment 1 is submitted, assignment 2 (due today) is not.
  if v1 <> 1 or v2 <> 0 then
    raise exception 'FAIL 14: student deadline counts % then %', v1, v2;
  end if;
  if (select count(*) from public.notifications where notification_type = 'deadline_student') <> 1 then
    raise exception 'FAIL 14: student sees wrong deadline rows';
  end if;
  raise notice 'PASS 14a: student deadline reminder once, only for unsubmitted work';
end $$;
select set_test_user('00000000-0029-0000-0000-00000000000a');
do $$
declare
  v record;
begin
  perform public.refresh_my_deadline_notifications();
  perform public.refresh_my_deadline_notifications();
  if (select count(*) from public.notifications where notification_type = 'deadline_teacher') <> 2 then
    raise exception 'FAIL 14b: teacher should get one reminder per due assignment';
  end if;
  select * into v from public.notifications where notification_type = 'deadline_teacher' and entity_id = '00000000-0029-0004-0000-000000000002';
  -- s1 (linked) + s3 (now linked) + s4: none submitted assignment 2.
  if (v.metadata->>'pending_count')::int <> 3 then
    raise exception 'FAIL 14b: pending count %', v.metadata->>'pending_count';
  end if;
  raise notice 'PASS 14b: teacher deadline reminder with pending count, idempotent';
end $$;
reset role;

-- ==================================================
-- 15. Notification failures never block the source write
-- ==================================================

-- Make every notification write fail (table hidden inside a rolled-back
-- transaction): a student's resubmission must still save.
begin;
alter table public.notifications rename to notifications_hidden_by_test;
set local role authenticated;
select set_test_user('00000000-0029-0000-0000-000000000001');
update public.assignment_submissions set submitted_at = now() + interval '1 second' where id = '00000000-0029-0005-0000-000000000001';
do $$
begin
  if (select submitted_at from public.assignment_submissions where id = '00000000-0029-0005-0000-000000000001') <= now() then
    raise exception 'FAIL 15: submission did not save when notifications failed';
  end if;
  raise notice 'PASS 15: a failing notification never blocks the submission';
end $$;
rollback;

-- ==================================================
-- Cleanup
-- ==================================================

reset role;
select clear_test_user();
delete from public.notifications where recipient_user_id in (select id from public.profiles where display_name like 'TEST0029:%');
delete from public.student_account_link_requests where requested_by in (select id from public.profiles where display_name like 'TEST0029:%');
delete from public.assignment_submissions where assignment_id in (select id from public.assignments where title like 'TEST0029:%');
delete from public.assignments where title like 'TEST0029:%';
delete from public.subjects where name like 'TEST0029:%';
delete from public.classroom_students where classroom_id in (select id from public.classrooms where name like 'TEST0029:%');
update public.students set linked_profile_id = null where first_name like 'TEST0029:%';
delete from public.students where first_name like 'TEST0029:%';
delete from public.classrooms where name like 'TEST0029:%';
delete from public.profiles where display_name like 'TEST0029:%';
delete from auth.users where email like 'test0029_%';

\echo 'ALL 0029 NOTIFICATION CHECKS PASSED'
