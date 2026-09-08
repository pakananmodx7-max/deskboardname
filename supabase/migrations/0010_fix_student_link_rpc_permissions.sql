-- AI Classroom Management — defensive re-assertion of 0009's RPC grants.
-- See docs/DATABASE.md for the full incident writeup.
--
-- PRODUCTION INCIDENT: after 0009 was applied, an authenticated account
-- with profiles.role = 'student' got "คุณไม่มีสิทธิ์ดำเนินการนี้" (the
-- frontend's GENERIC fallback for a raw, English-language Postgres
-- SQLSTATE 42501) on /student/link-account, instead of either succeeding
-- or getting one of this schema's own Thai-language rejection messages.
--
-- Root cause, confirmed empirically against a byte-for-byte local replay
-- of 0001-0009 in order: 0009's SQL, exactly as committed and exactly as
-- it was applied here, is correct — a correctly-provisioned role='student'
-- caller successfully calls list_classrooms_for_student_code and
-- find_student_for_link_in_classroom, and every intended rejection path
-- (wrong role, no session, no profile row, the literal `anon` Postgres
-- role) raises one of THIS schema's own Thai-language exceptions, which
-- the frontend displays verbatim (see looksLikeFriendlyMessage in
-- src/lib/errors.ts — it only substitutes the generic fallback when the
-- error message does NOT contain Thai text). The reported generic
-- fallback can therefore only come from a genuine Postgres-native
-- "permission denied for function ..." — i.e. EXECUTE missing on the
-- function actually being called — which was reproduced exactly by (a)
-- revoking EXECUTE on list_classrooms_for_student_code and calling it as
-- a correctly-roled student, and (b) calling the OLD, deliberately
-- EXECUTE-revoked find_student_for_link(text) (0008) as a correctly-roled
-- student — both produce the identical byte-for-byte symptom.
--
-- This migration does NOT change any logic. It is a pure, idempotent
-- re-assertion of exactly the GRANT/REVOKE statements 0009 already
-- contains, in case they did not fully land in production (e.g. a
-- partially-applied migration script) — GRANT/REVOKE are idempotent in
-- Postgres (re-running them is always safe and a no-op if the state is
-- already correct), so applying this changes nothing if 0009 already
-- landed cleanly. If instead the real cause turns out to be the deployed
-- frontend still calling the old find_student_for_link(text) RPC (a
-- stale/rolled-back deploy, not a database issue at all), this migration
-- alone will NOT fix the symptom — see the verification query at the
-- bottom of this file, and docs/DATABASE.md, for how to tell the two
-- apart on the live database before assuming this is enough.
--
-- 0008 and 0009 are NOT modified by this migration. This migration has
-- NOT been applied to a live database yet — do NOT run it automatically.

-- ==================================================
-- Re-assert: list_classrooms_for_student_code(text) — authenticated only.
-- ==================================================

revoke all on function public.list_classrooms_for_student_code(text) from public;
revoke all on function public.list_classrooms_for_student_code(text) from anon;
grant execute on function public.list_classrooms_for_student_code(text) to authenticated;

-- ==================================================
-- Re-assert: find_student_for_link_in_classroom(text, uuid) — authenticated only.
-- ==================================================

revoke all on function public.find_student_for_link_in_classroom(text, uuid) from public;
revoke all on function public.find_student_for_link_in_classroom(text, uuid) from anon;
grant execute on function public.find_student_for_link_in_classroom(text, uuid) to authenticated;

-- ==================================================
-- Re-assert: find_student_for_link(text) (0008) stays retired — EXECUTE
-- revoked from authenticated, exactly as 0009 already specified.
-- ==================================================

revoke all on function public.find_student_for_link(text) from public;
revoke all on function public.find_student_for_link(text) from authenticated;
revoke all on function public.find_student_for_link(text) from anon;

-- ==================================================
-- Diagnostic only (does not modify anything): prints the CURRENT grant
-- state for all three functions when this migration is applied via
-- `psql`, so the exact before/after can be seen in the session log
-- rather than assumed. Safe to ignore if applying through a tool that
-- doesn't surface RAISE NOTICE output.
-- ==================================================

do $$
declare
  r record;
begin
  for r in
    select
      p.proname,
      pg_get_function_identity_arguments(p.oid) as args,
      has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute,
      has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can_execute
    from pg_proc p
    where p.proname in (
      'list_classrooms_for_student_code',
      'find_student_for_link_in_classroom',
      'find_student_for_link'
    )
    order by p.proname
  loop
    raise notice '% (%) -> authenticated: %, anon: %', r.proname, r.args, r.authenticated_can_execute, r.anon_can_execute;
  end loop;
end;
$$;

-- Expected output after this migration:
--   find_student_for_link (p_student_code text) -> authenticated: f, anon: f
--   find_student_for_link_in_classroom (p_student_code text, p_classroom_id uuid) -> authenticated: t, anon: f
--   list_classrooms_for_student_code (p_student_code text) -> authenticated: t, anon: f
--
-- If, after applying this migration, /student/link-account STILL shows
-- the generic "คุณไม่มีสิทธิ์ดำเนินการนี้" on the first search step, the
-- database side is now provably correct and the remaining cause is the
-- deployed FRONTEND — confirm the live Vercel deployment is actually
-- serving commit 40bb590 or later (the commit that switched the client
-- to call list_classrooms_for_student_code / find_student_for_link_in_classroom
-- instead of the old single-argument find_student_for_link), not a stale
-- or rolled-back build.
