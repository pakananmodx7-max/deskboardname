-- AI Classroom Management — Phase 4: real teacher authentication
-- See docs/DATABASE.md for the full explanation.
--
-- Builds on 0001_init.sql (profiles, classrooms, students, classroom_students)
-- and 0002_subjects_topics.sql (subjects, subject_classrooms, topics), both
-- already applied. This migration has NOT been applied yet — do not run it
-- automatically.
--
-- Scope: this migration only wires up "a new Supabase auth user
-- automatically gets a public.profiles row with role = 'teacher'," and
-- removes the client's ability to insert its own profiles row now that the
-- trigger below is the sole path. It does not touch classrooms, students,
-- subjects, or topics.

-- ==================================================
-- handle_new_user: auto-create a profile row for every new auth user
--
-- The problem this replaces: 0001's `profiles_insert_own` RLS policy let
-- an authenticated client INSERT its own profiles row directly, gated by
-- `with check (id = auth.uid() and role = 'teacher')`. That was already
-- safe against role escalation (the check forces 'teacher'), but it still
-- meant profile creation was a client-initiated, client-timed action —
-- one more request the frontend has to remember to make, and one more
-- INSERT statement whose WITH CHECK clause is the only thing standing
-- between a normal signup and a client that (accidentally or not) tries
-- to send `role: 'admin'` in that request.
--
-- The fix: move profile creation entirely server-side, triggered
-- automatically the instant a row is inserted into `auth.users` (i.e. the
-- moment `supabase.auth.signUp()` succeeds) — a normal signup flow never
-- has to insert into `profiles` at all, and no client request can ever
-- reach the role column:
--
--   - `role` is hardcoded to the literal 'teacher' below. It is NEVER
--     read from `new.raw_user_meta_data` or any other client-controlled
--     input — even if a malicious client calls
--     `supabase.auth.signUp({ ..., options: { data: { role: 'admin' } } })`,
--     that `role` key is simply never looked at. There is no code path in
--     this function through which client-supplied data can influence the
--     row's `role` value.
--   - `id` and `email` come from `new.id` / `new.email` — the just-created
--     `auth.users` row itself, not from any parameter the client passes,
--     so this trigger can never be used to create or spoof a profile for
--     an id other than the auth user that was actually just created. There
--     is no user-supplied "which id" parameter anywhere in this function —
--     unlike an RPC, a trigger has no caller-supplied arguments at all,
--     only `NEW`/`OLD`, which eliminates the spoofing surface by
--     construction rather than by a runtime check.
--   - `display_name` is read from `new.raw_user_meta_data->>'display_name'`
--     (the signup form's "display name" field, passed via
--     `supabase.auth.signUp({ options: { data: { display_name } } })`).
--     This field is NOT authorization-sensitive — worst case a user picks
--     a silly display name for their own account, same as `email`/
--     `display_name` already being freely self-editable via
--     `profiles_update_own` in 0001.
--
-- SECURITY DEFINER is necessary here (unlike most functions in this
-- schema): this trigger fires as part of the `auth.users` INSERT that
-- Supabase's own auth service performs, not as a normal client request
-- running as `authenticated` — the invoking role has no reason to already
-- hold INSERT privileges on `public.profiles`, and `public.profiles` has
-- RLS enabled with no INSERT policy at all after this migration (see
-- below). Running as the function's owner (via SECURITY DEFINER) is what
-- lets it write the profile row regardless of which role fired the
-- `auth.users` insert. `search_path` is pinned so it can't be redirected
-- by the caller — same safety pattern as every other SECURITY DEFINER
-- function in this schema (`is_student_creator`,
-- `has_existing_classroom_link` in 0001).
--
-- `on conflict (id) do nothing`: defensive only — under normal operation
-- this trigger fires exactly once per new auth user and `id` is fresh, so
-- there is nothing to conflict with. This just means a retry (e.g. Auth
-- hook re-delivery) or a profile that already exists for some other
-- reason can never turn into a hard error that blocks signup.
--
-- No EXECUTE grant/revoke is added for this function, unlike
-- `is_student_creator`/`has_existing_classroom_link` in 0001. Those are
-- called directly from RLS policies evaluated in a normal client session
-- (role `authenticated`), so PUBLIC's default EXECUTE had to be revoked
-- and re-granted narrowly. This function is never called that way — it
-- is declared `returns trigger`, which Postgres refuses to execute except
-- as a trigger (`select public.handle_new_user()` fails outright), so it
-- has no callable surface for a client to invoke directly regardless of
-- grants. Revoking PUBLIC's default EXECUTE here would risk silently
-- breaking Supabase's own internal auth flow (whichever Postgres role it
-- uses to perform the `auth.users` insert) for a security property this
-- function already has for free.
-- ==================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, email, display_name, role)
  values (
    new.id,
    new.email,
    nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
    'teacher'
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

-- ==================================================
-- RLS: profiles — remove client-side self-insert
--
-- Now that every profile is created automatically by the trigger above,
-- the client never legitimately needs to INSERT into `profiles` itself.
-- Dropping `profiles_insert_own` (from 0001) removes that entire request
-- from the app's authorization surface instead of leaving a
-- now-unnecessary "insert your own row, but only as role='teacher'"
-- policy in place purely for defense in depth. `profiles` ends up with NO
-- insert policy at all: every write to it that creates a new row must go
-- through `handle_new_user()` (SECURITY DEFINER, bypasses RLS, hardcodes
-- role), which is the only thing this migration trusts to create a
-- profile.
--
-- `profiles_select_own` and `profiles_update_own` (0001) are untouched —
-- a teacher can still read and update their own row, and
-- `protect_profile_privileged_fields` (0001's BEFORE UPDATE trigger)
-- still blocks any change to `role` via that update path. Nothing in
-- this migration weakens either of those.
-- ==================================================

drop policy if exists "profiles_insert_own" on public.profiles;
