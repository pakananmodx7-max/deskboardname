-- Rollback of 0033 (พื้นที่ทำงาน) — only if needed. Runs as one transaction.
--
-- WARNING: this DROPS the three workspace tables, i.e. every teacher's
-- personal notes, links and tasks. Nothing else in the database refers
-- to them, and no other table, policy or function is touched.
-- If teachers have already used the workspace, export first, e.g.:
--   select * from public.workspace_notes;   (download as CSV)
--   select * from public.workspace_links;
--   select * from public.workspace_tasks;
-- The app copes with a missing 0033: พื้นที่ทำงาน shows
-- "ยังไม่ได้ติดตั้งฐานข้อมูลของพื้นที่ทำงาน" and every other page works.
begin;
set local lock_timeout = '5s';

drop function if exists public.workspace_link_opened(uuid);
drop table if exists public.workspace_tasks;
drop table if exists public.workspace_links;
drop table if exists public.workspace_notes;
drop function if exists public.workspace_tasks_completed_at();
drop function if exists public.workspace_notes_bump_revision();
drop function if exists public.workspace_guard_owner();
drop function if exists public.workspace_is_teacher();

commit;
