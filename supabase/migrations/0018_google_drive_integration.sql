-- AI Classroom Management — Google Drive API Integration.
-- See docs/DATABASE.md for the schema explanation and RLS rationale of
-- every prior migration this one builds on.
--
-- This migration has NOT been applied to a live database yet — do NOT
-- run it automatically. 0001-0017 have already been applied and are NOT
-- modified here: this migration only ADDS two columns (via
-- `alter table ... add column if not exists`) and two new tables, plus
-- their RLS (both new tables — see SECURITY MODEL below).
--
-- SCOPE — lets a teacher connect their own Google account (OAuth) and
-- pick a file directly from Google Drive (via the Google Picker) when
-- adding a lesson/assignment resource, instead of only pasting a URL by
-- hand. Google Drive stays an EXTERNAL file provider, exactly as in the
-- Google Drive Integration (Phase 1, URL-paste-only) migration-free
-- feature this one extends — Supabase remains the source of truth for
-- academic data, and this migration does NOT change that: it adds
-- nowhere to copy a Drive file's actual bytes into Supabase, only a
-- `drive_file_id` column (Drive's own file id, alongside the resource's
-- existing `url`/`mime_type` columns) so the frontend can show a
-- Picker-added resource without re-parsing its id out of the URL.
--
-- SECURITY MODEL — the central problem this migration solves: a Google
-- OAuth refresh token is a long-lived, highly sensitive credential (it
-- alone can mint fresh Drive-scoped access tokens indefinitely, until
-- revoked). It must NEVER be readable by this app's client-side
-- Supabase key (anon/authenticated role) — only by trusted server-side
-- code. This app has no traditional backend server; Supabase Edge
-- Functions (deployed separately from this migration, see
-- docs/GOOGLE_DRIVE_SETUP.md) play that role, using the service_role
-- key, which bypasses RLS entirely by Supabase's own design. Both new
-- tables below therefore have RLS enabled with ZERO policies for
-- `anon`/`authenticated` — a deliberate deny-all, not an oversight. No
-- policy is ever added for those two roles on these two tables. The
-- browser (and therefore a student, and a teacher's own direct
-- PostgREST/Supabase-client access) can never SELECT, INSERT, UPDATE, or
-- DELETE a row here under any circumstance; the Edge Functions are the
-- only access path.
-- ==================================================

alter table public.lesson_resources add column if not exists drive_file_id text;
alter table public.assignment_resources add column if not exists drive_file_id text;

comment on column public.lesson_resources.drive_file_id is
  'Google Drive''s own file id, set only for a resource added via the Google Picker (never for a manually pasted link) — purely a display/API convenience alongside the existing url/mime_type columns; the resource''s provider is still always DERIVED from url at render time (detectResourceProvider), never trusted from this column or any client-supplied label.';
comment on column public.assignment_resources.drive_file_id is
  'See lesson_resources.drive_file_id — identical meaning and the identical "never trusted for provider display" rule.';

-- ==================================================
-- google_oauth_connections — one row per teacher who has connected a
-- Google account. Holds the long-lived refresh_token plus a cached
-- short-lived access_token (refreshed by the token Edge Function as
-- needed) so a Picker session never has to force a fresh consent
-- screen. `teacher_id` is unique — connecting a second Google account
-- replaces the stored connection, it never accumulates a second row.
-- ==================================================

create table if not exists public.google_oauth_connections (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null unique references public.profiles (id) on delete cascade,
  google_email text,
  -- Space-separated OAuth scope string actually granted — recorded so
  -- the Integrations page can show exactly what was authorized, and so
  -- a future scope change can detect an existing connection that needs
  -- re-consent rather than assuming.
  scope text not null,
  refresh_token text not null,
  access_token text,
  access_token_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_google_oauth_connections_updated_at
  before update on public.google_oauth_connections
  for each row execute function public.set_updated_at();

alter table public.google_oauth_connections enable row level security;
-- Deliberately NO policies for anon/authenticated — see SECURITY MODEL
-- above. Every read/write goes through an Edge Function using the
-- service_role key.

-- ==================================================
-- google_oauth_states — short-lived, one-time CSRF state tokens for the
-- OAuth authorization-code flow. google-oauth-start (Edge Function)
-- inserts a row when a teacher begins connecting; google-oauth-callback
-- (Edge Function) looks it up by state, checks it belongs to the SAME
-- authenticated teacher who is completing the callback and hasn't
-- expired, then deletes it (one-time use — a replayed state can never
-- succeed twice). expires_at defaults to 10 minutes out, matching how
-- long a teacher plausibly takes on Google's consent screen.
-- ==================================================

create table if not exists public.google_oauth_states (
  state text primary key,
  teacher_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '10 minutes')
);

create index if not exists google_oauth_states_expires_at_idx
  on public.google_oauth_states (expires_at);

alter table public.google_oauth_states enable row level security;
-- Deliberately NO policies for anon/authenticated — see SECURITY MODEL
-- above. Every read/write goes through an Edge Function using the
-- service_role key.
