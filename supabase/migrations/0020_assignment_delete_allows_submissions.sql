-- AI Classroom Management — Assignment: permanent delete is no longer
-- blocked by existing student submissions/scores ("ลบงานและข้อมูลนักเรียน?").
--
-- SUPERSEDES 0019_assignment_copy_delete.sql's
-- assignments_delete_own_no_submissions policy. 0019 has ALREADY BEEN
-- APPLIED to production — it is NOT edited here (a database that already
-- recorded 0019 as applied will never re-run an edited copy of it). This
-- migration instead explicitly DROPS that policy and its now-unused
-- helper function, and CREATES a replacement.
--
-- PRODUCT DECISION CHANGE: 0019's original design blocked permanent
-- deletion whenever ANY assignment_submissions row existed, forcing the
-- teacher to archive instead. That was the wrong default — a teacher
-- must be able to fully delete an assignment (and everything that
-- depends on it) even after students have submitted work or received
-- scores, as long as they are warned clearly first (see the
-- "ลบงานและข้อมูลนักเรียน?" confirmation the frontend now shows before
-- ever calling this). "เก็บถาวร" remains available as a separate,
-- non-forced, non-destructive alternative — this migration does not
-- remove or alter assignments_update_own (0006) in any way.
--
-- WHAT STILL HAPPENS AT THE DATABASE LEVEL ON DELETE (unchanged by this
-- migration — these FKs already existed):
--   assignments row deleted
--     -> assignment_resources rows cascade-deleted (0013, on delete cascade)
--     -> assignment_submissions rows cascade-deleted (0006, on delete cascade)
--         -> assignment_submission_resources rows cascade-deleted (0016, on delete cascade)
--
-- Storage objects (the 'assignment-files' and 'submission-files' bucket
-- objects) are still NOT covered by any FK — the application
-- (assignment-service.ts's deleteAssignmentPermanently) is responsible
-- for removing them, and MUST do so BEFORE this DELETE runs:
-- assignment_files_delete_teacher's and submission_files_delete_teacher's
-- own storage.objects RLS policies (0013/0016) re-derive "do I own this
-- object" from the STILL-EXISTING assignment_resources /
-- assignment_submissions row behind each object's path
-- (is_teacher_of_assignment / teacher_owns_submission). Once this DELETE
-- cascades those rows away, that ownership proof is gone and any later
-- Storage delete attempt for this assignment would be denied by RLS,
-- permanently orphaning the objects — this ordering requirement is
-- documented in detail in assignment-service.ts's own
-- deleteAssignmentPermanently.
drop policy if exists "assignments_delete_own_no_submissions" on public.assignments;

-- The 0019 helper is no longer referenced by any policy after the drop
-- above — removed rather than left behind as dead code with a now
-- misleading name/purpose.
drop function if exists public.assignment_has_submissions(uuid);

-- Ownership is the ONLY remaining condition — identical shape to
-- assignments_update_own (0006): the caller must own the classroom the
-- assignment belongs to. No submissions check, no other restriction.
create policy "assignments_delete_own"
  on public.assignments for delete
  using (
    exists (
      select 1 from public.classrooms c
      where c.id = assignments.classroom_id and c.teacher_id = auth.uid()
    )
  );

-- ==================================================
-- Nothing above touches any table's columns, any other existing policy,
-- any trigger, or any previously-applied migration (0001-0019) beyond the
-- two DROPs named above — this migration only replaces ONE DELETE policy
-- on `assignments` and removes its now-unused 0019 helper function.
-- ==================================================
