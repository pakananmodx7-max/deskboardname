-- Empirical verification for 0033_teacher_workspace.sql
--
-- DEV-ONLY verification script, never applied to any real database and
-- never run automatically. Run against a disposable local Postgres with
-- every migration through 0033 applied in order, using the auth shim
-- described in supabase/tests/0009_student_link_rpc_permissions.sql.
-- Works with or without 0012/0029 installed (production has neither).
-- Every check raises (and, with ON_ERROR_STOP, aborts) on a mismatch.
--
--   W1  a teacher creates a note, link and task; owner_id is the session
--       user even when the request names another teacher
--   W2  the teacher reads/updates/deletes only their own rows
--   W3  another teacher sees nothing and cannot update/delete (0 rows)
--   W4  owner_id cannot be moved to another account by an update
--   W5  a student account reads nothing and cannot insert (RLS 42501)
--   W6  no session / anon: nothing readable, no privileges (42501)
--   W7  unsafe URLs are refused (javascript:, data:, spaces, ftp:)
--   W8  task completed_at follows status (done -> set, reopen -> null,
--       done -> done keeps the first timestamp)
--   W9  start_date after due_date is refused (23514)
--   W10 note revision is bumped by the server on every update, so a
--       "where revision = n" save made from a stale copy updates 0 rows
--   W11 due_date is a calendar day: it round-trips unchanged whatever
--       the session time zone is
--   W12 workspace_link_opened bumps only the caller's own link
--   W13 an admin profile is also allowed its own workspace

\set ON_ERROR_STOP 1

set role postgres;

create or replace function public.t_assert(p_label text, p_actual bigint, p_expected bigint)
returns void language plpgsql as $$
begin
  if p_actual is distinct from p_expected then
    raise exception 'TEST FAILED: % — expected %, got %', p_label, p_expected, p_actual;
  end if;
  raise notice 'ok  %  (= %)', p_label, p_actual;
end $$;
grant execute on function public.t_assert(text, bigint, bigint) to authenticated, anon;

create or replace function public.t_expect_error(p_label text, p_sql text, p_code text)
returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlstate = p_code then
      raise notice 'ok  % blocked with %: %', p_label, sqlstate, sqlerrm;
      return;
    end if;
    raise exception 'TEST FAILED: % — expected SQLSTATE %, got % (%)', p_label, p_code, sqlstate, sqlerrm;
  end;
  raise exception 'TEST FAILED: % — expected SQLSTATE %, but it succeeded', p_label, p_code;
end $$;
grant execute on function public.t_expect_error(text, text, text) to authenticated, anon;

-- ---------------------------------------------------------------------
-- Fixture: T1, T2 teachers, AD admin, ST student
-- ---------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data) values
  ('10000000-0000-0000-0000-0000000000a1', 't1@example.com', '{}', '{"krunameclass_allow_teacher":"true"}'),
  ('10000000-0000-0000-0000-0000000000a2', 't2@example.com', '{}', '{"krunameclass_allow_teacher":"true"}'),
  ('10000000-0000-0000-0000-0000000000ad', 'admin@example.com', '{}', '{"krunameclass_allow_teacher":"true"}'),
  ('10000000-0000-0000-0000-0000000000b1', 'st@example.com', '{"intended_role":"student"}', '{}');
update public.profiles set role = 'admin' where id = '10000000-0000-0000-0000-0000000000ad';
select public.t_assert('fixture: student profile is a student',
  (select count(*) from public.profiles where id = '10000000-0000-0000-0000-0000000000b1' and role = 'student'), 1);

-- ---------------------------------------------------------------------
-- W1 create as T1 (request claims T2 as owner — must be ignored)
-- ---------------------------------------------------------------------
set role authenticated;
select public.set_test_user('10000000-0000-0000-0000-0000000000a1');

insert into public.workspace_notes (id, owner_id, title, body, category, tags, pinned)
values ('e0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-0000000000a2', 'ไอเดียกิจกรรม ม.2', 'ให้นักเรียนวิเคราะห์', 'การสอน', '{ม.2,กิจกรรม}', true);
insert into public.workspace_links (id, owner_id, title, url, category)
values ('e1000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-0000000000a2', 'Google Drive', 'https://drive.google.com/', 'เอกสารการสอน');
insert into public.workspace_tasks (id, owner_id, title, priority, due_date, important, urgent)
values ('e2000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-0000000000a2', 'ส่งรายงานโครงการ', 'high', '2026-11-03', true, true);
insert into public.workspace_tasks (id, title, due_date) values ('e2000000-0000-0000-0000-000000000002', 'เตรียมสื่อ', '2026-11-04');

select public.t_assert('W1 note owner is the session user',
  (select count(*) from public.workspace_notes where owner_id = '10000000-0000-0000-0000-0000000000a1'), 1);
select public.t_assert('W1 link owner is the session user',
  (select count(*) from public.workspace_links where owner_id = '10000000-0000-0000-0000-0000000000a1'), 1);
select public.t_assert('W1 task owner is the session user',
  (select count(*) from public.workspace_tasks where owner_id = '10000000-0000-0000-0000-0000000000a1'), 2);

-- ---------------------------------------------------------------------
-- W2 own rows: read, update, delete
-- ---------------------------------------------------------------------
select public.t_assert('W2 T1 reads own tasks', (select count(*) from public.workspace_tasks), 2);
with u as (update public.workspace_tasks set status = 'in_progress' where id = 'e2000000-0000-0000-0000-000000000002' returning 1)
select public.t_assert('W2 T1 updates own task', (select count(*) from u), 1);

-- ---------------------------------------------------------------------
-- W3 another teacher
-- ---------------------------------------------------------------------
select public.set_test_user('10000000-0000-0000-0000-0000000000a2');
select public.t_assert('W3 T2 reads no notes', (select count(*) from public.workspace_notes), 0);
select public.t_assert('W3 T2 reads no links', (select count(*) from public.workspace_links), 0);
select public.t_assert('W3 T2 reads no tasks', (select count(*) from public.workspace_tasks), 0);
with u as (update public.workspace_notes set title = 'hijack' returning 1)
select public.t_assert('W3 T2 updates 0 of T1 notes', (select count(*) from u), 0);
with d as (delete from public.workspace_tasks returning 1)
select public.t_assert('W3 T2 deletes 0 of T1 tasks', (select count(*) from d), 0);
with d as (delete from public.workspace_links returning 1)
select public.t_assert('W3 T2 deletes 0 of T1 links', (select count(*) from d), 0);
-- T2's own note works and stays T2's
insert into public.workspace_notes (id, title) values ('e0000000-0000-0000-0000-000000000002', 'ของครู 2');
select public.t_assert('W3 T2 sees only own note', (select count(*) from public.workspace_notes), 1);

-- ---------------------------------------------------------------------
-- W4 owner_id is immutable
-- ---------------------------------------------------------------------
select public.set_test_user('10000000-0000-0000-0000-0000000000a1');
update public.workspace_notes set owner_id = '10000000-0000-0000-0000-0000000000a2' where id = 'e0000000-0000-0000-0000-000000000001';
set role postgres;
select public.t_assert('W4 note still owned by T1',
  (select count(*) from public.workspace_notes where id = 'e0000000-0000-0000-0000-000000000001' and owner_id = '10000000-0000-0000-0000-0000000000a1'), 1);
set role authenticated;

-- ---------------------------------------------------------------------
-- W5 student account
-- ---------------------------------------------------------------------
select public.set_test_user('10000000-0000-0000-0000-0000000000b1');
select public.t_assert('W5 student reads no notes', (select count(*) from public.workspace_notes), 0);
select public.t_assert('W5 student reads no links', (select count(*) from public.workspace_links), 0);
select public.t_assert('W5 student reads no tasks', (select count(*) from public.workspace_tasks), 0);
select public.t_expect_error('W5 student cannot insert a note', $q$insert into public.workspace_notes (title) values ('x')$q$, '42501');
select public.t_expect_error('W5 student cannot insert a task', $q$insert into public.workspace_tasks (title) values ('x')$q$, '42501');
select public.t_expect_error('W5 student cannot insert a link', $q$insert into public.workspace_links (title, url) values ('x', 'https://a.example')$q$, '42501');
select public.t_assert('W5 student calling link_opened changes nothing',
  (select case when public.workspace_link_opened('e1000000-0000-0000-0000-000000000001') then 1 else 0 end), 0);

-- ---------------------------------------------------------------------
-- W6 no session, and the anon role
-- ---------------------------------------------------------------------
select public.clear_test_user();
select public.t_assert('W6 no session reads no tasks', (select count(*) from public.workspace_tasks), 0);
select public.t_expect_error('W6 no session cannot insert', $q$insert into public.workspace_tasks (title) values ('x')$q$, '42501');
set role anon;
select public.t_expect_error('W6 anon cannot select', $q$select * from public.workspace_notes$q$, '42501');
select public.t_expect_error('W6 anon cannot insert', $q$insert into public.workspace_links (title, url) values ('x', 'https://a.example')$q$, '42501');
select public.t_expect_error('W6 anon cannot call link_opened', $q$select public.workspace_link_opened(gen_random_uuid())$q$, '42501');
set role authenticated;

-- ---------------------------------------------------------------------
-- W7 URL backstop
-- ---------------------------------------------------------------------
select public.set_test_user('10000000-0000-0000-0000-0000000000a1');
select public.t_expect_error('W7 javascript: refused', $q$insert into public.workspace_links (title, url) values ('x', 'javascript:alert(1)')$q$, '23514');
select public.t_expect_error('W7 data: refused', $q$insert into public.workspace_links (title, url) values ('x', 'data:text/html,hi')$q$, '23514');
select public.t_expect_error('W7 ftp: refused', $q$insert into public.workspace_links (title, url) values ('x', 'ftp://a.example')$q$, '23514');
select public.t_expect_error('W7 whitespace refused', $q$insert into public.workspace_links (title, url) values ('x', 'https://a.example/ x')$q$, '23514');
select public.t_expect_error('W7 empty title refused', $q$insert into public.workspace_links (title, url) values ('  ', 'https://a.example')$q$, '23514');
insert into public.workspace_links (title, url) values ('ระบบ สพม.', 'HTTP://www.sesao.kpp.go.th/path?q=1');
select public.t_assert('W7 http (any case) accepted', (select count(*) from public.workspace_links), 2);

-- ---------------------------------------------------------------------
-- W8 completed_at follows status
-- ---------------------------------------------------------------------
update public.workspace_tasks set status = 'done', completed_at = '2000-01-01' where id = 'e2000000-0000-0000-0000-000000000001';
select public.t_assert('W8 done sets completed_at (client value ignored)',
  (select count(*) from public.workspace_tasks where id = 'e2000000-0000-0000-0000-000000000001' and completed_at > now() - interval '1 minute'), 1);
create temp table t_first as select completed_at from public.workspace_tasks where id = 'e2000000-0000-0000-0000-000000000001';
update public.workspace_tasks set title = 'ส่งรายงานโครงการ (แก้)' where id = 'e2000000-0000-0000-0000-000000000001';
select public.t_assert('W8 editing a done task keeps completed_at',
  (select count(*) from public.workspace_tasks t, t_first f where t.id = 'e2000000-0000-0000-0000-000000000001' and t.completed_at = f.completed_at), 1);
update public.workspace_tasks set status = 'todo' where id = 'e2000000-0000-0000-0000-000000000001';
select public.t_assert('W8 reopen clears completed_at',
  (select count(*) from public.workspace_tasks where id = 'e2000000-0000-0000-0000-000000000001' and completed_at is null), 1);
insert into public.workspace_tasks (title, status, completed_at) values ('สร้างแบบเสร็จ', 'todo', now());
select public.t_assert('W8 not-done insert has no completed_at',
  (select count(*) from public.workspace_tasks where title = 'สร้างแบบเสร็จ' and completed_at is null), 1);

-- ---------------------------------------------------------------------
-- W9 dates ordered
-- ---------------------------------------------------------------------
select public.t_expect_error('W9 start after due refused',
  $q$insert into public.workspace_tasks (title, start_date, due_date) values ('x', '2026-11-10', '2026-11-09')$q$, '23514');

-- ---------------------------------------------------------------------
-- W10 note revision / stale save
-- ---------------------------------------------------------------------
-- (W4's no-op owner update already bumped it to 2.)
select public.t_assert('W10 revision bumped by every update',
  (select revision from public.workspace_notes where id = 'e0000000-0000-0000-0000-000000000001'), 2);
with u as (update public.workspace_notes set body = 'อุปกรณ์ A' where id = 'e0000000-0000-0000-0000-000000000001' and revision = 2 returning revision)
select public.t_assert('W10 save on revision 2 -> revision 3', (select revision from u), 3);
with u as (update public.workspace_notes set body = 'อุปกรณ์ B (ค้าง)' where id = 'e0000000-0000-0000-0000-000000000001' and revision = 2 returning 1)
select public.t_assert('W10 stale save updates nothing', (select count(*) from u), 0);
update public.workspace_notes set revision = 99 where id = 'e0000000-0000-0000-0000-000000000001';
select public.t_assert('W10 client cannot set revision',
  (select revision from public.workspace_notes where id = 'e0000000-0000-0000-0000-000000000001'), 4);
select public.t_assert('W10 body is device A',
  (select count(*) from public.workspace_notes where body = 'อุปกรณ์ A'), 1);

-- ---------------------------------------------------------------------
-- W11 calendar day round-trips in any time zone
-- ---------------------------------------------------------------------
set time zone 'Pacific/Kiritimati';
insert into public.workspace_tasks (id, title, due_date) values ('e2000000-0000-0000-0000-000000000009', 'วันสิ้นเดือน', '2026-11-30');
set time zone 'America/Los_Angeles';
select public.t_assert('W11 due_date unchanged across time zones',
  (select count(*) from public.workspace_tasks where id = 'e2000000-0000-0000-0000-000000000009' and due_date::text = '2026-11-30'), 1);
reset time zone;

-- ---------------------------------------------------------------------
-- W12 link opened
-- ---------------------------------------------------------------------
select public.t_assert('W12 owner bumps own link',
  (select case when public.workspace_link_opened('e1000000-0000-0000-0000-000000000001') then 1 else 0 end), 1);
select public.t_assert('W12 open_count = 1',
  (select open_count from public.workspace_links where id = 'e1000000-0000-0000-0000-000000000001'), 1);
select public.set_test_user('10000000-0000-0000-0000-0000000000a2');
select public.t_assert('W12 other teacher cannot bump it',
  (select case when public.workspace_link_opened('e1000000-0000-0000-0000-000000000001') then 1 else 0 end), 0);
set role postgres;
select public.t_assert('W12 still 1', (select open_count from public.workspace_links where id = 'e1000000-0000-0000-0000-000000000001'), 1);
set role authenticated;

-- ---------------------------------------------------------------------
-- W13 admin has a workspace of their own, and only their own
-- ---------------------------------------------------------------------
select public.set_test_user('10000000-0000-0000-0000-0000000000ad');
insert into public.workspace_tasks (title) values ('งานแอดมิน');
select public.t_assert('W13 admin sees only own task', (select count(*) from public.workspace_tasks), 1);

-- W2 (cont.) T1 deletes own rows
select public.set_test_user('10000000-0000-0000-0000-0000000000a1');
with d as (delete from public.workspace_links where id = 'e1000000-0000-0000-0000-000000000001' returning 1)
select public.t_assert('W2 T1 deletes own link', (select count(*) from d), 1);
with d as (delete from public.workspace_notes where id = 'e0000000-0000-0000-0000-000000000001' returning 1)
select public.t_assert('W2 T1 deletes own note', (select count(*) from d), 1);

select public.clear_test_user();
set role postgres;
select public.t_assert('T2 note untouched by everything above',
  (select count(*) from public.workspace_notes where id = 'e0000000-0000-0000-0000-000000000002' and title = 'ของครู 2'), 1);

\echo 'ALL 0033 WORKSPACE CHECKS PASSED'
