-- AI Classroom Management — SGS Score Calculator: saved formula storage
-- Adds ONE nullable column to the EXISTING sgs_score_columns table
-- (0023_sgs_score_workspace.sql). This migration has NOT been applied
-- to a live database yet — do NOT run it automatically. It is safe to
-- edit in place if a review finds issues before it is ever run.
--
-- Scope: purely additive. No new table, no new RLS policy, no change to
-- any existing column, trigger, or policy. `sgs_score_columns` already
-- has row-level RLS scoping every column of the row by classroom/subject
-- ownership (sgs_score_columns_select_own/_insert_own/_update_own/
-- _delete_own) — adding a column does not change what those policies
-- check or who they let through, so no new policy is needed here.
--
-- What this stores: the teacher's saved calculation configuration for
-- one SGS score column — which assignment scores feed it, the
-- calculation mode, weights/groups, the missing-score policy, and the
-- rounding rule (see src/types/sgs-score-calculation.ts's
-- SgsScoreCalculationFormula for the exact JSON shape the app reads and
-- writes here; this column is intentionally untyped JSONB rather than a
-- normalized set of tables, since the shape is entirely app-interpreted
-- configuration, never queried or filtered on by SQL itself).
--
-- Saving/clearing a formula NEVER writes or changes an sgs_scores value
-- by itself — see sgs-score-calculation-service.ts's
-- applySgsScoreCalculation, the ONLY function that writes a score, and
-- it does so through the SAME setSgsScore already used for manual entry.
-- This column is configuration only.

alter table public.sgs_score_columns
  add column if not exists calculation_formula jsonb;

comment on column public.sgs_score_columns.calculation_formula is
  'Optional saved SGS Score Calculator formula (SgsScoreCalculationFormula JSON) — configuration only, never itself a score value. See src/types/sgs-score-calculation.ts.';
