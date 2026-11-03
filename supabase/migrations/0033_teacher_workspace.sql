-- KrunameClass — พื้นที่ทำงานของฉัน (My Workspace): a teacher's private
-- notes, favourite links and personal tasks.
--
-- Tables: workspace_notes, workspace_links, workspace_tasks
-- Helper: workspace_is_teacher(), workspace_guard_owner() (trigger)
--
-- Builds on 0001 (profiles, set_updated_at) only. Works with or without
-- 0012 / 0029 (both missing in PRODUCTION) — nothing here references them.
-- Nothing in 0001-0032 is edited. This migration has NOT been applied to
-- any live database — do NOT run it automatically; see
-- docs/WORKSPACE.md for the reviewed production steps.
--
-- ==================================================
-- DESIGN
--
-- * One table per kind of record. The task manager, the Eisenhower
--   matrix, the calendar and the Kanban board are four VIEWS over the
--   same workspace_tasks rows — there is no separate matrix / calendar /
--   board table:
--     matrix quadrant = (important, urgent)   (separate from priority)
--     calendar day    = due_date
--     board column    = status, ordered by sort_order
-- * Categories are free text on each row (the UI offers the built-in
--   suggestions plus every category the teacher has already used), so a
--   teacher manages their own list without a categories table.
-- * due_date / start_date are plain `date` columns: a calendar day has no
--   time zone, so nothing can drift a day when it is saved from Bangkok
--   and read back anywhere else. "Today" is computed by the app in
--   Asia/Bangkok.
-- * workspace_notes.revision is bumped by the server on every update so
--   the app's autosave can save with "where revision = <what I loaded>"
--   and detect an edit made on another device instead of overwriting it.
--
-- ==================================================
-- SECURITY MODEL
--
-- * Every row belongs to exactly one owner (owner_id -> profiles.id).
-- * owner_id is NEVER taken from the client: a BEFORE INSERT trigger sets
--   it to auth.uid(), and a BEFORE UPDATE trigger keeps the old value, so
--   a request cannot create or move a row into another account.
-- * RLS (all four commands) requires owner_id = auth.uid() AND that the
--   caller's profile is a teacher/admin. A student account — even one
--   that guesses an id — reads and writes nothing; one teacher never sees
--   another teacher's rows.
-- * anon has no privileges at all. Real DELETE is allowed: these are a
--   teacher's own scratch records, not academic data (same reasoning as
--   student_followup_notes, 0026).
-- ==================================================

-- ==================================================
-- Helpers
-- ==================================================

-- SECURITY DEFINER so RLS policies can check the caller's role without
-- depending on profiles' own policies; reads only the caller's own row.
create or replace function public.workspace_is_teacher()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('teacher', 'admin')
  );
$$;

revoke all on function public.workspace_is_teacher() from public, anon;
grant execute on function public.workspace_is_teacher() to authenticated;

-- owner_id comes from the session, never from the request body.
create or replace function public.workspace_guard_owner()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      new.owner_id := auth.uid();
    end if;
    if new.owner_id is null then
      raise exception 'workspace record needs an owner' using errcode = '42501';
    end if;
  else
    new.owner_id := old.owner_id;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

revoke all on function public.workspace_guard_owner() from public, anon, authenticated;

-- ==================================================
-- workspace_notes
-- ==================================================

create table if not exists public.workspace_notes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  title text not null default '' check (char_length(title) <= 200),
  body text not null default '' check (char_length(body) <= 100000),
  category text check (category is null or char_length(category) between 1 and 60),
  tags text[] not null default '{}' check (cardinality(tags) <= 20),
  pinned boolean not null default false,
  archived_at timestamptz,
  revision integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists workspace_notes_owner_updated_idx
  on public.workspace_notes (owner_id, updated_at desc);

create or replace function public.workspace_notes_bump_revision()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.revision := old.revision + 1;
  return new;
end;
$$;

revoke all on function public.workspace_notes_bump_revision() from public, anon, authenticated;

create trigger workspace_notes_guard_owner
  before insert or update on public.workspace_notes
  for each row execute function public.workspace_guard_owner();

create trigger workspace_notes_bump_revision
  before update on public.workspace_notes
  for each row execute function public.workspace_notes_bump_revision();

create trigger set_workspace_notes_updated_at
  before update on public.workspace_notes
  for each row execute function public.set_updated_at();

-- ==================================================
-- workspace_links
-- ==================================================

create table if not exists public.workspace_links (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  -- Only http(s), no whitespace or control characters, bounded length.
  -- The app validates first (and blocks javascript:, data:, etc.); this
  -- is the backstop for any other client.
  url text not null check (
    char_length(url) <= 2048
    and url ~* '^https?://[^[:space:][:cntrl:]]+$'
  ),
  description text not null default '' check (char_length(description) <= 1000),
  category text check (category is null or char_length(category) between 1 and 60),
  pinned boolean not null default false,
  open_count integer not null default 0 check (open_count >= 0),
  last_opened_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists workspace_links_owner_updated_idx
  on public.workspace_links (owner_id, updated_at desc);

create trigger workspace_links_guard_owner
  before insert or update on public.workspace_links
  for each row execute function public.workspace_guard_owner();

create trigger set_workspace_links_updated_at
  before update on public.workspace_links
  for each row execute function public.set_updated_at();

-- ==================================================
-- workspace_tasks
-- ==================================================

create table if not exists public.workspace_tasks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 300),
  description text not null default '' check (char_length(description) <= 10000),
  status text not null default 'todo' check (status in ('todo', 'in_progress', 'done')),
  priority text not null default 'medium' check (priority in ('high', 'medium', 'low')),
  due_date date,
  start_date date,
  category text check (category is null or char_length(category) between 1 and 60),
  important boolean not null default false,
  urgent boolean not null default false,
  -- Position inside its Kanban column (lower first).
  sort_order double precision not null default 0,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workspace_tasks_dates_ordered check (start_date is null or due_date is null or start_date <= due_date)
);

create index if not exists workspace_tasks_owner_due_idx
  on public.workspace_tasks (owner_id, due_date);
create index if not exists workspace_tasks_owner_status_order_idx
  on public.workspace_tasks (owner_id, status, sort_order);

-- completed_at follows status: set when a task becomes done (kept if it
-- already was), cleared when it is reopened.
create or replace function public.workspace_tasks_completed_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'done' then
    if tg_op = 'UPDATE' and old.status = 'done' and old.completed_at is not null then
      new.completed_at := old.completed_at;
    else
      new.completed_at := now();
    end if;
  else
    new.completed_at := null;
  end if;
  return new;
end;
$$;

revoke all on function public.workspace_tasks_completed_at() from public, anon, authenticated;

create trigger workspace_tasks_guard_owner
  before insert or update on public.workspace_tasks
  for each row execute function public.workspace_guard_owner();

create trigger workspace_tasks_completed_at
  before insert or update on public.workspace_tasks
  for each row execute function public.workspace_tasks_completed_at();

create trigger set_workspace_tasks_updated_at
  before update on public.workspace_tasks
  for each row execute function public.set_updated_at();

-- ==================================================
-- Privileges + RLS (same four policies on each table)
-- ==================================================

revoke all on public.workspace_notes, public.workspace_links, public.workspace_tasks from public, anon;
grant select, insert, update, delete on public.workspace_notes, public.workspace_links, public.workspace_tasks to authenticated;

alter table public.workspace_notes enable row level security;
alter table public.workspace_links enable row level security;
alter table public.workspace_tasks enable row level security;

create policy "workspace_notes_select_own" on public.workspace_notes for select
  using (owner_id = auth.uid() and public.workspace_is_teacher());
create policy "workspace_notes_insert_own" on public.workspace_notes for insert
  with check (owner_id = auth.uid() and public.workspace_is_teacher());
create policy "workspace_notes_update_own" on public.workspace_notes for update
  using (owner_id = auth.uid() and public.workspace_is_teacher())
  with check (owner_id = auth.uid() and public.workspace_is_teacher());
create policy "workspace_notes_delete_own" on public.workspace_notes for delete
  using (owner_id = auth.uid() and public.workspace_is_teacher());

create policy "workspace_links_select_own" on public.workspace_links for select
  using (owner_id = auth.uid() and public.workspace_is_teacher());
create policy "workspace_links_insert_own" on public.workspace_links for insert
  with check (owner_id = auth.uid() and public.workspace_is_teacher());
create policy "workspace_links_update_own" on public.workspace_links for update
  using (owner_id = auth.uid() and public.workspace_is_teacher())
  with check (owner_id = auth.uid() and public.workspace_is_teacher());
create policy "workspace_links_delete_own" on public.workspace_links for delete
  using (owner_id = auth.uid() and public.workspace_is_teacher());

create policy "workspace_tasks_select_own" on public.workspace_tasks for select
  using (owner_id = auth.uid() and public.workspace_is_teacher());
create policy "workspace_tasks_insert_own" on public.workspace_tasks for insert
  with check (owner_id = auth.uid() and public.workspace_is_teacher());
create policy "workspace_tasks_update_own" on public.workspace_tasks for update
  using (owner_id = auth.uid() and public.workspace_is_teacher())
  with check (owner_id = auth.uid() and public.workspace_is_teacher());
create policy "workspace_tasks_delete_own" on public.workspace_tasks for delete
  using (owner_id = auth.uid() and public.workspace_is_teacher());

-- A link was opened: bumps open_count / last_opened_at for the caller's
-- own link only (RLS still applies — SECURITY INVOKER). Returns false if
-- the link is not the caller's.
create or replace function public.workspace_link_opened(p_link_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_found boolean;
begin
  update public.workspace_links
     set open_count = open_count + 1, last_opened_at = now()
   where id = p_link_id and owner_id = auth.uid()
  returning true into v_found;
  return coalesce(v_found, false);
end;
$$;

revoke all on function public.workspace_link_opened(uuid) from public, anon;
grant execute on function public.workspace_link_opened(uuid) to authenticated;
