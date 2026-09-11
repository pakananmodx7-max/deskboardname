-- AI Classroom Management — Assignment: safe permanent delete support for
-- "ลบงาน" in the teacher assignment card menu (Copy/Delete assignment
-- management feature).
--
-- Builds on 0006_subject_assignments.sql (assignments, assignment_submissions,
-- the classroom-ownership derivation assignments_update_own already uses).
-- 0001-0018 have already been applied and are NOT modified here — this
-- migration only ADDS one new, narrowly-scoped DELETE policy to
-- `assignments`. No new table, no new column, no change to any existing
-- policy or trigger.
--
-- AUDIT PERFORMED BEFORE WRITING THIS MIGRATION:
--   - `assignments` has NO existing delete policy (0006) — RLS enabled +
--     no matching permissive policy = deny by default, so a hard DELETE
--     is currently impossible through the app at all, regardless of
--     dependent data. "Archive" (is_archived = true via
--     assignments_update_own) has been the only removal path.
--   - assignments.id is referenced by assignment_resources.assignment_id
--     (0013, `on delete cascade`) and assignment_submissions.assignment_id
--     (0006, `on delete cascade`). assignment_submission_resources (0016)
--     cascades a further level from assignment_submissions. So a hard
--     DELETE of an assignments row already cascades away its resources and
--     (if any existed) its submissions/submission-resources at the FK
--     level — this migration does not change any of those FK actions.
--   - Storage objects (the 'assignment-files' bucket's resource files, the
--     'submission-files' bucket's submission files) are NOT covered by any
--     FK — a DB-level row cascade never removes them. The application is
--     responsible for removing any assignment_resources file objects
--     explicitly before/around the delete (see assignment-service.ts's
--     deleteAssignmentPermanently), or they become orphaned, unreachable
--     objects. This migration's DELETE policy only fires when zero
--     assignment_submissions rows exist (see below), so no
--     'submission-files' object can ever be orphaned by it — student
--     submission storage is never touched by this feature.
--
-- SAFETY DECISION: permanent delete is allowed ONLY when the assignment has
-- ZERO assignment_submissions rows — enforced here at the DATABASE level,
-- not only by a client-side check, so a hard delete can never silently
-- destroy a student's submission/score/reviewed-state history. When
-- submissions already exist, the ONLY supported removal path remains the
-- existing archive (is_archived = true, 0006's assignments_update_own) —
-- this migration deliberately does NOT add any form of cascading/forced
-- deletion for that case: the existing product/data model does not already
-- support destroying student academic records, and doing so would not be
-- demonstrably safe.
--
-- RECURSION AVOIDANCE: a raw `not exists (select 1 from
-- assignment_submissions ...)` subquery inline in this policy was tried
-- first and empirically hit Postgres' "infinite recursion detected in
-- policy for relation assignments" — evaluating assignment_submissions'
-- OWN RLS policies (e.g. assignment_submissions_select_own, 0006) requires
-- re-evaluating assignments' RLS in turn, forming a cycle with THIS
-- policy's own evaluation. Fixed with the exact same SECURITY DEFINER
-- wrapper pattern already established in 0013/0015/0016
-- (is_teacher_of_assignment, teacher_owns_submission, etc.) — the helper
-- function's body runs as its owner and is not itself subject to RLS, so
-- it can read assignment_submissions directly without re-entering
-- assignments' RLS.
create or replace function public.assignment_has_submissions(p_assignment_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.assignment_submissions s
    where s.assignment_id = p_assignment_id
  )
$$;

revoke all on function public.assignment_has_submissions(uuid) from public;
grant execute on function public.assignment_has_submissions(uuid) to authenticated;

create policy "assignments_delete_own_no_submissions"
  on public.assignments for delete
  using (
    exists (
      select 1 from public.classrooms c
      where c.id = assignments.classroom_id and c.teacher_id = auth.uid()
    )
    and not public.assignment_has_submissions(assignments.id)
  );

-- ==================================================
-- Nothing above touches any existing table's existing policy, any
-- previously-applied migration (0001-0018), or grants any broader
-- table-level privilege — this migration only adds one additive DELETE
-- policy to `assignments` (scoped to rows the caller owns AND that have no
-- dependent assignment_submissions rows) plus the one narrowly-scoped
-- SECURITY DEFINER helper function that policy needs to avoid RLS
-- recursion.
-- ==================================================
