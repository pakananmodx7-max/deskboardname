-- Regression / adversarial test script for
-- 0012_student_calendar_notifications.sql. NOT applied automatically and
-- NOT part of the application schema — this is a dev-only verification
-- tool, meant to be run against a throwaway local Postgres instance that
-- already has 0001-0012 applied (plus a hand-rolled auth/storage shim —
-- see docs/DATABASE.md's "Empirical RLS verification methodology" for
-- how prior migrations' equivalents were verified the same way).
--
-- Self-contained: creates its own fixtures (two teachers, three students
-- across two classrooms, two auth.users rows one linked one not) inside
-- a single transaction-per-section, asserts every rule below with
-- RAISE EXCEPTION on failure, and cleans up its own rows at the end so
-- it can be re-run repeatedly against the same scratch database.
--
-- Run as a superuser/owner (so it can freely SET ROLE / set_test_user).

\set ON_ERROR_STOP on

-- ==================================================
-- Fixtures
-- ==================================================

do $$
begin
  alter table auth.users disable trigger on_auth_user_created;
exception when undefined_object then null;
end $$;

delete from public.teacher_student_notifications where message like 'TEST0012:%';
delete from public.student_calendar_entries where title like 'TEST0012:%';
delete from storage.objects where name like 'TEST0012:%';
delete from public.classroom_students where classroom_id in (
  select id from public.classrooms where name like 'TEST0012:%'
);
delete from public.students where first_name like 'TEST0012:%';
delete from public.classrooms where name like 'TEST0012:%';
delete from public.profiles where display_name like 'TEST0012:%';
delete from auth.users where email like 'test0012_%';

insert into auth.users (id, email) values
  ('00000000-0012-0000-0000-000000000001', 'test0012_teacher_a@example.com'),
  ('00000000-0012-0000-0000-000000000002', 'test0012_teacher_b@example.com'),
  ('00000000-0012-0000-0000-000000000003', 'test0012_student1@example.com'),
  ('00000000-0012-0000-0000-000000000004', 'test0012_student2@example.com'),
  ('00000000-0012-0000-0000-000000000005', 'test0012_student3@example.com'),
  ('00000000-0012-0000-0000-000000000006', 'test0012_unlinked@example.com');

insert into public.profiles (id, display_name, email, role) values
  ('00000000-0012-0000-0000-000000000001', 'TEST0012: Teacher A', 'test0012_teacher_a@example.com', 'teacher'),
  ('00000000-0012-0000-0000-000000000002', 'TEST0012: Teacher B', 'test0012_teacher_b@example.com', 'teacher'),
  ('00000000-0012-0000-0000-000000000003', 'TEST0012: Student1 Profile', 'test0012_student1@example.com', 'student'),
  ('00000000-0012-0000-0000-000000000004', 'TEST0012: Student2 Profile', 'test0012_student2@example.com', 'student'),
  ('00000000-0012-0000-0000-000000000005', 'TEST0012: Student3 Profile', 'test0012_student3@example.com', 'student'),
  ('00000000-0012-0000-0000-000000000006', 'TEST0012: Unlinked Profile', 'test0012_unlinked@example.com', 'student');

insert into public.classrooms (id, teacher_id, name) values
  ('00000000-0012-0001-0000-000000000001', '00000000-0012-0000-0000-000000000001', 'TEST0012: Classroom A1'),
  ('00000000-0012-0001-0000-000000000002', '00000000-0012-0000-0000-000000000002', 'TEST0012: Classroom B1');

insert into public.students (id, first_name, last_name, student_code, linked_profile_id) values
  ('00000000-0012-0002-0000-000000000001', 'TEST0012: S1', 'Student', 'S0012-1', '00000000-0012-0000-0000-000000000003'),
  ('00000000-0012-0002-0000-000000000002', 'TEST0012: S2', 'Student', 'S0012-2', '00000000-0012-0000-0000-000000000004'),
  ('00000000-0012-0002-0000-000000000003', 'TEST0012: S3', 'Student', 'S0012-3', '00000000-0012-0000-0000-000000000005');

insert into public.classroom_students (classroom_id, student_id) values
  ('00000000-0012-0001-0000-000000000001', '00000000-0012-0002-0000-000000000001'), -- S1 in A1 (teacher A)
  ('00000000-0012-0001-0000-000000000001', '00000000-0012-0002-0000-000000000002'), -- S2 in A1 (teacher A)
  ('00000000-0012-0001-0000-000000000002', '00000000-0012-0002-0000-000000000003'); -- S3 in B1 (teacher B)


-- ==================================================
-- TEST 1: teacher can notify own student
-- ==================================================
set role authenticated;
select set_test_user('00000000-0012-0000-0000-000000000001');

insert into public.teacher_student_notifications (student_id, teacher_id, title, message)
values ('00000000-0012-0002-0000-000000000001', '00000000-0012-0000-0000-000000000001', 'TEST0012: หัวข้อ', 'TEST0012: กรุณาติดต่อครูเรื่องใบงานที่ 2');

do $$
begin
  if not exists (
    select 1 from public.teacher_student_notifications
    where message = 'TEST0012: กรุณาติดต่อครูเรื่องใบงานที่ 2'
  ) then
    raise exception 'TEST 1 FAILED: teacher could not notify own student';
  end if;
  raise notice 'TEST 1 passed: teacher can notify own student';
end $$;

-- ==================================================
-- TEST 2: teacher cannot notify another teacher's student
-- ==================================================
do $$
begin
  begin
    insert into public.teacher_student_notifications (student_id, teacher_id, message)
    values ('00000000-0012-0002-0000-000000000003', '00000000-0012-0000-0000-000000000001', 'TEST0012: should not be allowed');
    raise exception 'TEST 2 FAILED: teacher A was able to notify teacher B''s student';
  exception
    when insufficient_privilege then
      raise notice 'TEST 2 passed: teacher A cannot notify teacher B''s student (RLS blocked)';
  end;
end $$;

-- teacher cannot spoof another teacher as the sender
do $$
begin
  begin
    insert into public.teacher_student_notifications (student_id, teacher_id, message)
    values ('00000000-0012-0002-0000-000000000001', '00000000-0012-0000-0000-000000000002', 'TEST0012: spoofed sender');
    raise exception 'TEST 2b FAILED: teacher A was able to send as teacher B';
  exception
    when insufficient_privilege then
      raise notice 'TEST 2b passed: teacher A cannot spoof teacher B as sender';
  end;
end $$;

-- ==================================================
-- TEST 3: student sees own notifications only / cannot read another
-- student's notification
-- ==================================================
select set_test_user('00000000-0012-0000-0000-000000000001');
insert into public.teacher_student_notifications (student_id, teacher_id, message)
values ('00000000-0012-0002-0000-000000000002', '00000000-0012-0000-0000-000000000001', 'TEST0012: for S2 only');

select set_test_user('00000000-0012-0000-0000-000000000003');
do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.teacher_student_notifications where message = 'TEST0012: for S2 only';
  if v_count <> 0 then
    raise exception 'TEST 3 FAILED: student1 could read student2''s notification';
  end if;
  raise notice 'TEST 3 passed: student cannot read another student''s notification';
end $$;

do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.teacher_student_notifications
  where message = 'TEST0012: กรุณาติดต่อครูเรื่องใบงานที่ 2';
  if v_count <> 1 then
    raise exception 'TEST 3b FAILED: student1 could not see own notification (count=%)', v_count;
  end if;
  raise notice 'TEST 3b passed: student sees own notification';
end $$;

-- TEST 3c: student can read the display_name of a teacher who teaches
-- them (used as the notification "sender" label), but NOT an unrelated
-- teacher's profile (profiles_select_my_teachers).
do $$
declare
  v_name text;
  v_other_count int;
begin
  select display_name into v_name from public.profiles where id = '00000000-0012-0000-0000-000000000001';
  if v_name is distinct from 'TEST0012: Teacher A' then
    raise exception 'TEST 3c FAILED: student1 could not read their own teacher''s display_name';
  end if;

  select count(*) into v_other_count from public.profiles where id = '00000000-0012-0000-0000-000000000002';
  if v_other_count <> 0 then
    raise exception 'TEST 3d FAILED: student1 could read an unrelated teacher''s (teacher B) profile';
  end if;
  raise notice 'TEST 3c/3d passed: student sees own teacher''s display_name, not an unrelated teacher''s profile';
end $$;

-- ==================================================
-- TEST 4: student cannot create a teacher notification
-- ==================================================
do $$
begin
  begin
    insert into public.teacher_student_notifications (student_id, teacher_id, message)
    values ('00000000-0012-0002-0000-000000000001', '00000000-0012-0000-0000-000000000001', 'TEST0012: student forging a teacher message');
    raise exception 'TEST 4 FAILED: student1 was able to insert a notification';
  exception
    when insufficient_privilege then
      raise notice 'TEST 4 passed: student cannot create a teacher notification';
  end;
end $$;

-- ==================================================
-- TEST 5: student cannot change message/recipient/sender via raw UPDATE
-- (no UPDATE policy exists on this table at all)
-- ==================================================
do $$
declare
  v_before text;
  v_after text;
begin
  select message into v_before from public.teacher_student_notifications
  where message = 'TEST0012: กรุณาติดต่อครูเรื่องใบงานที่ 2';

  update public.teacher_student_notifications
  set message = 'TEST0012: TAMPERED'
  where message = 'TEST0012: กรุณาติดต่อครูเรื่องใบงานที่ 2';

  select message into v_after from public.teacher_student_notifications
  where message = v_before;

  if v_after is distinct from v_before then
    raise exception 'TEST 5 FAILED: student was able to change a notification message';
  end if;
  raise notice 'TEST 5 passed: student cannot alter message/recipient/sender (no UPDATE policy)';
end $$;

-- ==================================================
-- TEST 6: student can mark own notification read; mark_all_notifications_read
-- only touches the caller's own rows
-- ==================================================
do $$
declare
  v_id uuid;
  v_read_at timestamptz;
begin
  select id into v_id from public.teacher_student_notifications
  where message = 'TEST0012: กรุณาติดต่อครูเรื่องใบงานที่ 2';

  perform public.mark_notification_read(v_id);

  select read_at into v_read_at from public.teacher_student_notifications where id = v_id;
  if v_read_at is null then
    raise exception 'TEST 6 FAILED: mark_notification_read did not set read_at';
  end if;
  raise notice 'TEST 6 passed: student can mark own notification read';
end $$;

-- student1 cannot mark student2's notification read via the RPC either
do $$
declare
  v_id uuid;
  v_read_at timestamptz;
begin
  select id into v_id from public.teacher_student_notifications where message = 'TEST0012: for S2 only';
  perform public.mark_notification_read(v_id);
  select read_at into v_read_at from public.teacher_student_notifications where id = v_id;
  if v_read_at is not null then
    raise exception 'TEST 6b FAILED: student1 marked student2''s notification read';
  end if;
  raise notice 'TEST 6b passed: mark_notification_read cannot touch another student''s row';
end $$;

-- mark_all_notifications_read
select set_test_user('00000000-0012-0000-0000-000000000001');
insert into public.teacher_student_notifications (student_id, teacher_id, message) values
  ('00000000-0012-0002-0000-000000000001', '00000000-0012-0000-0000-000000000001', 'TEST0012: bulk 1'),
  ('00000000-0012-0002-0000-000000000001', '00000000-0012-0000-0000-000000000001', 'TEST0012: bulk 2');

select set_test_user('00000000-0012-0000-0000-000000000003');
select public.mark_all_notifications_read();

do $$
declare
  v_unread int;
begin
  select count(*) into v_unread from public.teacher_student_notifications
  where student_id = '00000000-0012-0002-0000-000000000001' and read_at is null;
  if v_unread <> 0 then
    raise exception 'TEST 7 FAILED: mark_all_notifications_read left % unread for s1', v_unread;
  end if;
  raise notice 'TEST 7 passed: mark_all_notifications_read clears all of the caller''s unread';
end $$;

-- Switch to teacher_a (who can SELECT what they sent) to check this —
-- student1's own session cannot see student2's row at all (RLS), which
-- would make this assertion pass vacuously for the wrong reason.
select set_test_user('00000000-0012-0000-0000-000000000001');

do $$
declare
  v_still_unread int;
begin
  select count(*) into v_still_unread from public.teacher_student_notifications
  where message = 'TEST0012: for S2 only' and read_at is null;
  if v_still_unread <> 1 then
    raise exception 'TEST 7b FAILED: mark_all_notifications_read touched student2''s notification';
  end if;
  raise notice 'TEST 7b passed: mark_all_notifications_read never touches another student''s rows';
end $$;

-- ==================================================
-- TEST 8: student creates a private calendar note; student A cannot
-- access student B's calendar note; teacher cannot read private
-- calendar notes at all
-- ==================================================
select set_test_user('00000000-0012-0000-0000-000000000003');
insert into public.student_calendar_entries (student_id, title, note, event_date)
values ('00000000-0012-0002-0000-000000000001', 'TEST0012: ทบทวนก่อนสอบ', 'TEST0012: อ่านบทที่ 5', current_date + 3);

do $$
begin
  if not exists (select 1 from public.student_calendar_entries where title = 'TEST0012: ทบทวนก่อนสอบ') then
    raise exception 'TEST 8 FAILED: student could not read own calendar entry after insert';
  end if;
  raise notice 'TEST 8 passed: student creates and reads own private calendar note';
end $$;

-- student1 cannot spoof student2 as the owner
do $$
begin
  begin
    insert into public.student_calendar_entries (student_id, title, event_date)
    values ('00000000-0012-0002-0000-000000000002', 'TEST0012: spoofed calendar entry', current_date);
    raise exception 'TEST 8b FAILED: student1 inserted a calendar entry owned by student2';
  exception
    when insufficient_privilege then
      raise notice 'TEST 8b passed: student cannot insert a calendar entry for another student';
  end;
end $$;

select set_test_user('00000000-0012-0000-0000-000000000004');
do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.student_calendar_entries where title = 'TEST0012: ทบทวนก่อนสอบ';
  if v_count <> 0 then
    raise exception 'TEST 9 FAILED: student2 could read student1''s calendar entry';
  end if;
  raise notice 'TEST 9 passed: student A cannot access student B''s calendar note';
end $$;

select set_test_user('00000000-0012-0000-0000-000000000001');
do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.student_calendar_entries where title like 'TEST0012:%';
  if v_count <> 0 then
    raise exception 'TEST 10 FAILED: teacher could read % private calendar entries', v_count;
  end if;
  raise notice 'TEST 10 passed: teacher has zero access to private student calendar notes';
end $$;

-- ==================================================
-- TEST 11: avatar ownership/isolation via update_my_avatar_path
-- ==================================================
select set_test_user('00000000-0012-0000-0000-000000000003');
select public.update_my_avatar_path('00000000-0012-0002-0000-000000000001' || '/avatar.jpg');

do $$
declare
  v_path text;
begin
  select avatar_path into v_path from public.students where id = '00000000-0012-0002-0000-000000000001';
  if v_path is distinct from ('00000000-0012-0002-0000-000000000001' || '/avatar.jpg') then
    raise exception 'TEST 11 FAILED: update_my_avatar_path did not set own avatar_path (got %)', v_path;
  end if;
  raise notice 'TEST 11 passed: student can set own avatar_path';
end $$;

-- student1 cannot point their avatar at student2's storage path
do $$
begin
  begin
    perform public.update_my_avatar_path('00000000-0012-0002-0000-000000000002' || '/avatar.jpg');
    raise exception 'TEST 11b FAILED: student1 set avatar_path to a path outside their own id';
  exception
    when others then
      if sqlerrm not like '%พาธรูปโปรไฟล์ไม่ถูกต้อง%' then
        raise;
      end if;
      raise notice 'TEST 11b passed: update_my_avatar_path rejects a foreign path prefix';
  end;
end $$;

do $$
declare
  v_path_s2 text;
begin
  select avatar_path into v_path_s2 from public.students where id = '00000000-0012-0002-0000-000000000002';
  if v_path_s2 is not null then
    raise exception 'TEST 11c FAILED: student2''s avatar_path was modified by student1''s call';
  end if;
  raise notice 'TEST 11c passed: student1''s failed call never touched student2''s row';
end $$;

-- an unlinked (never-approved) account cannot set any avatar_path
select set_test_user('00000000-0012-0000-0000-000000000006');
do $$
begin
  begin
    perform public.update_my_avatar_path('some/path.jpg');
    raise exception 'TEST 11d FAILED: an unlinked account was able to call update_my_avatar_path';
  exception
    when others then
      if sqlerrm not like '%คุณไม่มีสิทธิ์ดำเนินการนี้%' then
        raise;
      end if;
      raise notice 'TEST 11d passed: unlinked account is rejected by update_my_avatar_path';
  end;
end $$;

-- ==================================================
-- TEST 12: storage.objects — student can only write/read under their own
-- student_id folder in the 'avatars' bucket
-- ==================================================
select set_test_user('00000000-0012-0000-0000-000000000003');
insert into storage.objects (bucket_id, name, owner)
values ('avatars', '00000000-0012-0002-0000-000000000001' || '/avatar.jpg', '00000000-0012-0000-0000-000000000003');

do $$
begin
  begin
    insert into storage.objects (bucket_id, name, owner)
    values ('avatars', '00000000-0012-0002-0000-000000000002' || '/avatar.jpg', '00000000-0012-0000-0000-000000000003');
    raise exception 'TEST 12 FAILED: student1 uploaded into student2''s avatar folder';
  exception
    when insufficient_privilege then
      raise notice 'TEST 12 passed: student cannot upload into another student''s avatar folder';
  end;
end $$;

do $$
declare
  v_count int;
begin
  select count(*) into v_count from storage.objects where name = '00000000-0012-0002-0000-000000000001' || '/avatar.jpg';
  if v_count <> 1 then
    raise exception 'TEST 12b FAILED: student1 cannot see their own uploaded avatar object';
  end if;
  raise notice 'TEST 12b passed: student can read their own avatar object';
end $$;

select set_test_user('00000000-0012-0000-0000-000000000004');
do $$
declare
  v_count int;
begin
  select count(*) into v_count from storage.objects where name = '00000000-0012-0002-0000-000000000001' || '/avatar.jpg';
  if v_count <> 0 then
    raise exception 'TEST 12c FAILED: student2 could see student1''s avatar object via storage.objects RLS';
  end if;
  raise notice 'TEST 12c passed: student cannot see another student''s avatar object';
end $$;

-- ==================================================
-- Regression: existing teacher-side student update flow (0001) is
-- unaffected — this migration adds no UPDATE policy on students at all,
-- only a new column, so students_update_via_classroom must still work
-- exactly as before.
-- ==================================================
select set_test_user('00000000-0012-0000-0000-000000000001');
update public.students set nickname = 'TEST0012: regression ok' where id = '00000000-0012-0002-0000-000000000001';

do $$
begin
  if not exists (select 1 from public.students where id = '00000000-0012-0002-0000-000000000001' and nickname = 'TEST0012: regression ok') then
    raise exception 'TEST 13 FAILED: existing teacher update-student flow regressed';
  end if;
  raise notice 'TEST 13 passed: existing teacher student-update flow (0001) still works';
end $$;

reset role;

-- ==================================================
-- Cleanup
-- ==================================================
delete from storage.objects where name like '00000000-0012-%';
delete from public.teacher_student_notifications where message like 'TEST0012:%';
delete from public.student_calendar_entries where title like 'TEST0012:%';
delete from public.classroom_students where classroom_id in (
  select id from public.classrooms where name like 'TEST0012:%'
);
delete from public.students where first_name like 'TEST0012:%';
delete from public.classrooms where name like 'TEST0012:%';
delete from public.profiles where display_name like 'TEST0012:%';
delete from auth.users where email like 'test0012_%';

do $$
begin
  raise notice '=== 0012_student_calendar_notifications.sql: ALL TESTS PASSED ===';
end $$;
