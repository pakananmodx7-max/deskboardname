-- AI Classroom Management — Phase 9: enforce score <= assignment.max_score
-- server-side, closing a data-integrity gap surfaced during the Grades
-- feature's security review.
--
-- This migration has NOT been applied to a live database yet — do NOT
-- run it automatically. It is safe to edit in place if a review finds
-- issues before it is ever run.
--
-- Context: assignment_submissions.score already has
--   check (score is null or score >= 0)
-- (0006) enforcing the lower bound, but the UPPER bound — a score must
-- never exceed the assignment's own max_score — was only ever enforced
-- in the UI (assignment-service.ts's parseScoreInput, used by both the
-- assignment detail page and the Grades tab). A plain `check()`
-- constraint can't express this because max_score lives on a different
-- table (assignments), not on assignment_submissions itself. Nothing
-- about this is an authorization bypass — RLS already restricts every
-- write to the submission's own owning teacher (0006) — but a teacher
-- (or a bug in a future client) could still write an out-of-range score
-- for their OWN data by calling the Supabase REST/JS API directly,
-- bypassing the React form's validation entirely. This migration closes
-- that gap the same way every other cross-row invariant in this schema
-- is enforced: a trigger, since a bare CHECK constraint cannot reference
-- another table's column.
--
-- Builds on 0006_subject_assignments.sql (assignments, assignment_submissions).

create or replace function public.check_submission_score_within_max()
returns trigger
language plpgsql
as $$
declare
  assignment_max_score numeric;
begin
  if new.score is null then
    return new;
  end if;

  select a.max_score into assignment_max_score
  from public.assignments a
  where a.id = new.assignment_id;

  if assignment_max_score is not null and new.score > assignment_max_score then
    raise exception 'คะแนน (%) เกินคะแนนเต็มของงานนี้ (%)', new.score, assignment_max_score
      using errcode = '22023';
  end if;

  return new;
end;
$$;

drop trigger if exists assignment_submissions_score_within_max on public.assignment_submissions;

create trigger assignment_submissions_score_within_max
  before insert or update on public.assignment_submissions
  for each row
  execute function public.check_submission_score_within_max();

-- Note: this only guards the current row's own assignment_id — it does
-- NOT need to (and does not) re-validate every submission when an
-- assignment's max_score is later lowered via UPDATE assignments SET
-- max_score = ...; an already-recorded score that is now "too high" for
-- the new max_score is left as historical data, matching this schema's
-- general no-retroactive-invalidation stance (e.g. archiving an
-- assignment never touches its existing submissions either).
