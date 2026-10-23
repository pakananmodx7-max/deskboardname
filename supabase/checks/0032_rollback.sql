-- Rollback of 0032 (only if needed). Runs as one transaction.
--
-- Removes the archive/restore/preview/delete RPCs, their helpers and the
-- archive-state trigger, and restores 0001's classrooms_delete_own policy
-- exactly — i.e. the app goes back to archiving through a plain
-- `update classrooms set is_active` and the raw DELETE path is open again
-- (the app itself never uses it).
--
-- KEPT on purpose (no data is destroyed by a rollback):
--   * classrooms.archived_at / archived_by — nullable, ignored by the
--     pre-0032 app;
--   * classroom_lifecycle_events and classroom_file_cleanup_queue — the
--     audit trail of any archive/restore/delete already performed, and the
--     list of files still awaiting review. Clients keep read-only access.
-- To remove those too, run the commented block at the end SEPARATELY,
-- and only after exporting both tables.
begin;
set local lock_timeout = '5s';

drop function if exists public.delete_classroom_permanently(uuid, text, text);
drop function if exists public.get_classroom_deletion_preview(uuid);
drop function if exists public.set_classroom_archived(uuid, boolean);
drop function if exists public.classroom_deletion_blockers(public.classrooms, jsonb);
drop function if exists public.classroom_deletion_fingerprint(public.classrooms, jsonb);
drop function if exists public.classroom_deletion_counts(uuid);
drop function if exists public.classroom_lifecycle_authorize(public.classrooms);

drop trigger if exists classrooms_track_archive_state on public.classrooms;
drop function if exists public.classrooms_track_archive_state();

drop policy if exists "classrooms_delete_own" on public.classrooms;
create policy "classrooms_delete_own"
  on public.classrooms for delete
  using (teacher_id = auth.uid());

commit;

-- Optional, destructive, NOT part of the rollback above:
-- begin;
-- drop table if exists public.classroom_file_cleanup_queue;
-- drop table if exists public.classroom_lifecycle_events;
-- alter table public.classrooms drop column if exists archived_by, drop column if exists archived_at;
-- commit;
