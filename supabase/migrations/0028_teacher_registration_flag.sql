-- AI Classroom Management — temporarily disable public teacher registration
--
-- This migration has NOT been applied to a live database yet — do NOT
-- run it automatically. Apply it manually (see
-- docs/TEACHER_REGISTRATION.md). Until it is applied, teacher sign-up is
-- only hidden in the app (VITE_ENABLE_TEACHER_REGISTRATION) and is NOT yet
-- blocked on the server.
--
-- WHY A DATABASE CHANGE: handle_new_user (0003, 0008) gives every new
-- auth user role = 'teacher' unless the sign-up metadata says
-- intended_role = 'student'. Hiding the /signup page does not stop anyone
-- calling Supabase Auth's public sign-up endpoint directly with the
-- publishable key, which would create a teacher account. This migration
-- makes the trigger itself refuse to create a TEACHER profile while
-- teacher registration is disabled. The refusal aborts that sign-up, so
-- no auth user is created either.
--
-- WHAT IT DOES (additive; no existing row is updated or deleted):
--   1. public.app_settings — a small key/value table for server-side
--      settings. RLS on, no policies, no grants to anon/authenticated:
--      only the SQL editor / service role (and SECURITY DEFINER
--      functions) can read or change it. A client can never flip the flag.
--   2. Seeds 'enable_teacher_registration' = false (on conflict do
--      nothing, so re-running never overwrites a value set later).
--   3. public.is_teacher_registration_enabled() — reads the flag; a
--      missing row or unreadable value counts as DISABLED (fail closed).
--   4. Re-creates handle_new_user with the same body as 0008 plus one
--      check: a sign-up that would become a teacher is refused while the
--      flag is false.
--
-- NOT AFFECTED:
--   - Existing teachers/students: the trigger only runs on a brand-new
--     auth.users INSERT. Sign-in, password reset/recovery and email
--     confirmation never insert a user, so they keep working.
--   - Student registration (intended_role = 'student') is unchanged.
--   - RLS policies and teacher permissions are unchanged. Profiles still
--     have no INSERT policy, and role still cannot be changed by the user
--     (0003), so a student account cannot be turned into a teacher.
--   - Supabase Authentication stays enabled globally.
--
-- CREATING A TEACHER WHILE REGISTRATION IS CLOSED (administrators):
--   - create the user with the Admin API and app_metadata
--     {"krunameclass_allow_teacher": true}. app_metadata can only be set
--     with the service role (never by the public sign-up request), so
--     this cannot be abused by the public; or
--   - briefly set the flag to true, create the account, set it back.
--
-- RE-ENABLING LATER (no code change):
--   update public.app_settings
--      set value = 'true'::jsonb, updated_at = now()
--    where key = 'enable_teacher_registration';
-- and set VITE_ENABLE_TEACHER_REGISTRATION=true for the web app.

-- ==================================================
-- 1. app_settings
-- ==================================================

create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

comment on table public.app_settings is
  'Server-side application settings (feature flags). Readable/writable only by the SQL editor / service role and SECURITY DEFINER functions.';

alter table public.app_settings enable row level security;
-- Deliberately no policies: anon/authenticated can neither read nor write.
revoke all on table public.app_settings from anon, authenticated;

insert into public.app_settings (key, value)
values ('enable_teacher_registration', 'false'::jsonb)
on conflict (key) do nothing;

-- ==================================================
-- 2. is_teacher_registration_enabled()
-- ==================================================

create or replace function public.is_teacher_registration_enabled()
returns boolean
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  v_value jsonb;
begin
  select s.value into v_value
  from public.app_settings s
  where s.key = 'enable_teacher_registration';

  -- Only a JSON true (or the string "true") opens registration; anything
  -- else — no row, null, a typo — keeps it closed.
  return coalesce(v_value = 'true'::jsonb or v_value = '"true"'::jsonb, false);
end;
$$;

comment on function public.is_teacher_registration_enabled() is
  'True only when app_settings.enable_teacher_registration is true. Used by handle_new_user; fails closed.';

-- Internal helper: called from handle_new_user (SECURITY DEFINER), never
-- from the client.
revoke all on function public.is_teacher_registration_enabled() from public, anon, authenticated;

-- ==================================================
-- 3. handle_new_user — same as 0008, plus the teacher-registration gate
-- ==================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text;
begin
  if new.raw_user_meta_data ->> 'intended_role' = 'student' then
    v_role := 'student';
  else
    v_role := 'teacher';
  end if;

  -- Teacher self-registration gate. raw_app_meta_data is set by Supabase
  -- Auth / the service role only — a public sign-up cannot supply it —
  -- so the administrator exemption cannot be claimed by the public.
  if v_role = 'teacher'
     and not public.is_teacher_registration_enabled()
     and coalesce(new.raw_app_meta_data ->> 'krunameclass_allow_teacher', 'false') <> 'true' then
    raise exception 'ปิดรับสมัครบัญชีครูชั่วคราว กรุณาติดต่อผู้ดูแลระบบ'
      using errcode = 'P0001',
            hint = 'teacher_registration_disabled';
  end if;

  insert into public.profiles (id, email, display_name, role)
  values (
    new.id,
    new.email,
    nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
    v_role
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

-- The trigger itself (on_auth_user_created, 0003) is unchanged — it
-- already executes public.handle_new_user(), which is replaced above.

-- ==================================================
-- Verification (read-only; run after applying)
-- ==================================================
-- select key, value from public.app_settings where key = 'enable_teacher_registration';
--   -> false
-- select public.is_teacher_registration_enabled();
--   -> false
-- select count(*) from public.profiles;   -- same count as before applying
