-- AI Classroom Management — Fix: an SGS score column with NO real score
-- entered anywhere in it could not be deleted.
--
-- Reported live: "ช่อง 10" (every cell blank/—) refused to delete with
-- "ไม่สามารถลบคอลัมน์ได้", while a different column named "10" holding a
-- real score correctly stayed protected. Root cause:
-- prevent_nonempty_sgs_score_column_delete() (0023) judged a column
-- "non-empty" by ROW EXISTENCE alone:
--
--   exists (select 1 from public.sgs_scores where column_id = old.id)
--
-- but a `sgs_scores` row with `score IS NULL` is exactly the "no score
-- entered yet" placeholder state 0023 itself documents as a real, valid
-- state (never conflated with an explicit 0) — every roster student can
-- end up with a NULL row for a column nobody ever actually scored, which
-- made that column permanently undeletable even though it holds no real
-- data at all.
--
-- Fix: the guard now checks for at least one row with `score IS NOT
-- NULL`. A column may be deleted when it has zero sgs_scores rows, or
-- when every one of its rows has score IS NULL. It must NOT be deleted
-- once at least one row has a real score — and 0 IS a real score (the
-- table's own check constraint, `score is null or score >= 0`, already
-- treats 0 as a legitimate entered value, distinct from NULL) — so a
-- column with any row scored 0 still correctly blocks deletion.
--
-- Unchanged: the pg_trigger_depth() <= 1 guard (a column deleted only as
-- part of a cascaded classroom/subject delete is never blocked here,
-- exactly as 0023 already established), the trigger itself (it already
-- calls this function by name, so `create or replace function` alone is
-- enough — no need to drop/recreate it), and the ON DELETE CASCADE from
-- sgs_scores.column_id (0023) that removes a deleted column's own
-- NULL-placeholder rows along with it.
--
-- This does not touch assignments/assignment_submissions in any way —
-- normal assignment grades have no delete-guard trigger at all (0006)
-- and are untouched by this migration.

create or replace function public.prevent_nonempty_sgs_score_column_delete()
returns trigger
language plpgsql
as $$
begin
  if pg_trigger_depth() <= 1 and exists (
    select 1
    from public.sgs_scores
    where column_id = old.id
      and score is not null
  ) then
    raise exception 'cannot delete sgs_score_column % — it has at least one row with a real (non-null) score; only a column with zero rows or all-NULL rows may be deleted', old.id;
  end if;
  return old;
end;
$$;
