-- KrunameClass — in-app notifications (header bell) for teachers and students.
--
-- NOT APPLIED AUTOMATICALLY. Prepared for manual review; the project owner
-- runs it in the Supabase SQL editor after reviewing (see
-- docs/NOTIFICATIONS.md). Until it is applied the app keeps working: the
-- teacher bell shows "not set up yet", the student bell keeps showing the
-- existing teacher messages (teacher_student_notifications, 0012).
--
-- Additive and re-runnable: one new table, helper/trigger functions, three
-- RPCs and new triggers. No existing table, column, policy, function or
-- row is changed or deleted; SGS tables are not touched.
--
-- Event sources (all existing tables, all written through their existing,
-- unchanged RLS-checked paths):
--   assignment_submissions        student submits / resubmits  -> teacher
--                                 teacher records a score       -> student
--   assignments                   new (or un-archived) assignment -> students
--   student_account_link_requests new pending request          -> teachers
--                                 approved / rejected           -> student
--   refresh_my_deadline_notifications() (called by the signed-in user for
--                                 themselves)                   -> due soon
-- Teacher -> student messages stay in teacher_student_notifications (0012);
-- the student bell merges them client-side, so nothing is duplicated.
-- Not created (no data for them exists in this schema): student -> teacher
-- messages and "returned for revision" (there is no such submission state).
--
-- SECURITY MODEL
--   * Recipients can SELECT only their own rows (recipient_user_id =
--     auth.uid()). There is NO insert/update/delete policy and those
--     privileges are revoked: rows are created only by the SECURITY DEFINER
--     trigger functions below, which derive the recipient from ownership
--     data (classrooms.teacher_id, students.linked_profile_id,
--     student_account_link_requests.requested_by) — never from client input
--     — so nobody can forge a notification for someone else.
--   * read_at changes only through mark_my_notifications_read /
--     mark_all_my_notifications_read, scoped to auth.uid().
--   * Reading a notification never touches the request/submission it is
--     about: approving or rejecting a student stays an explicit teacher
--     action through the existing 0008 RPCs.
--   * Notification work never blocks the source write: every trigger body
--     catches its own errors (raises a WARNING) so a submission, grade,
--     assignment or link request always saves.
--   * Idempotent: unique (recipient_user_id, dedupe_key) — the same event
--     can never produce two rows.

-- ==================================================
-- Table
-- ==================================================

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_user_id uuid not null references public.profiles (id) on delete cascade,
  actor_user_id uuid references public.profiles (id) on delete set null,
  notification_type text not null check (notification_type in (
    'assignment_submitted',
    'assignment_resubmitted',
    'link_request',
    'deadline_teacher',
    'link_approved',
    'link_rejected',
    'assignment_published',
    'submission_graded',
    'deadline_student'
  )),
  title text not null check (char_length(title) between 1 and 200),
  body text check (body is null or char_length(body) <= 500),
  entity_type text not null check (entity_type in ('assignment_submission', 'assignment', 'student_link_request')),
  entity_id uuid,
  -- Display details (names, ids for navigation, status). Only what the
  -- recipient may already see through their own RLS-scoped pages.
  metadata jsonb not null default '{}'::jsonb,
  -- Event identity for idempotency (e.g. 'submission:<id>:<epoch>').
  dedupe_key text not null,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notifications_recipient_dedupe_key unique (recipient_user_id, dedupe_key)
);

-- Feed (newest first, keyset pagination on (created_at, id)).
create index if not exists notifications_recipient_created_idx
  on public.notifications (recipient_user_id, created_at desc, id desc);
-- Unread badge count.
create index if not exists notifications_recipient_unread_idx
  on public.notifications (recipient_user_id)
  where read_at is null;
-- Updating teacher request notifications when a request is decided.
create index if not exists notifications_entity_idx
  on public.notifications (entity_type, entity_id);

drop trigger if exists set_notifications_updated_at on public.notifications;
create trigger set_notifications_updated_at
  before update on public.notifications
  for each row
  execute function public.set_updated_at();

alter table public.notifications enable row level security;

drop policy if exists "notifications_select_own" on public.notifications;
create policy "notifications_select_own"
  on public.notifications for select
  using (recipient_user_id = auth.uid());

-- Read-only for every client role; writes happen only in the SECURITY
-- DEFINER functions below (owned by the migration role).
revoke insert, update, delete, truncate on public.notifications from public, anon, authenticated;
grant select on public.notifications to authenticated;

-- Realtime: postgres_changes (INSERT/UPDATE) for the recipient, filtered
-- by the SELECT policy above. Wrapped so a re-run (or an environment
-- without the publication) does not fail.
do $$
begin
  alter publication supabase_realtime add table public.notifications;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

-- ==================================================
-- Internal helpers (not callable by clients)
-- ==================================================

-- Insert one notification; the same (recipient, dedupe_key) twice is a
-- no-op. Recipients that are not a profile yet are skipped.
create or replace function public.notifications_insert(
  p_recipient uuid,
  p_actor uuid,
  p_type text,
  p_title text,
  p_body text,
  p_entity_type text,
  p_entity_id uuid,
  p_metadata jsonb,
  p_dedupe_key text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_recipient is null or not exists (select 1 from public.profiles where id = p_recipient) then
    return;
  end if;
  insert into public.notifications (recipient_user_id, actor_user_id, notification_type, title, body, entity_type, entity_id, metadata, dedupe_key)
  values (p_recipient, p_actor, p_type, left(p_title, 200), left(p_body, 500), p_entity_type, p_entity_id, coalesce(p_metadata, '{}'::jsonb), p_dedupe_key)
  on conflict on constraint notifications_recipient_dedupe_key do nothing;
end;
$$;

revoke all on function public.notifications_insert(uuid, uuid, text, text, text, text, uuid, jsonb, text) from public, anon, authenticated;

create or replace function public.notifications_student_name(p_student_id uuid)
returns text
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select coalesce(nullif(trim(concat_ws(' ', s.first_name, s.last_name)), ''), 'นักเรียน')
  from public.students s
  where s.id = p_student_id
$$;

revoke all on function public.notifications_student_name(uuid) from public, anon, authenticated;

-- 10 -> '10', 7.50 -> '7.5', 8.25 -> '8.25'
create or replace function public.notifications_format_number(p_value numeric)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when p_value is null then '-'
    when p_value::text like '%.%' then rtrim(rtrim(p_value::text, '0'), '.')
    else p_value::text
  end
$$;

revoke all on function public.notifications_format_number(numeric) from public, anon, authenticated;

-- ==================================================
-- assignment_submissions: submitted / resubmitted (-> teacher),
-- graded (-> student)
-- ==================================================

create or replace function public.notify_on_submission_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_assignment record;
  v_student_name text;
  v_student_profile uuid;
  v_resubmission boolean;
  v_event_key text;
  v_meta jsonb;
  v_title text;
  v_body text;
  v_existing uuid;
begin
  begin
    select a.id, a.title, a.max_score, a.subject_id, a.classroom_id, a.is_archived,
           c.teacher_id, c.name as classroom_name, s.name as subject_name
      into v_assignment
      from public.assignments a
      join public.classrooms c on c.id = a.classroom_id
      left join public.subjects s on s.id = a.subject_id
     where a.id = new.assignment_id;
    if v_assignment.id is null then
      return new;
    end if;

    v_student_name := public.notifications_student_name(new.student_id);
    select st.linked_profile_id into v_student_profile from public.students st where st.id = new.student_id;

    -- Student finalised a submission: submitted_at set or moved forward
    -- by "ส่งงาน" (finalizeSubmission), status submitted/late.
    if new.submitted_at is not null
       and new.status in ('submitted', 'late')
       and (tg_op = 'INSERT' or new.submitted_at is distinct from old.submitted_at) then
      v_resubmission := tg_op = 'UPDATE' and old.submitted_at is not null;
      v_event_key := 'submission:' || new.id || ':' || extract(epoch from new.submitted_at)::text;
      v_meta := jsonb_build_object(
        'submission_id', new.id,
        'student_id', new.student_id,
        'student_name', v_student_name,
        'assignment_id', v_assignment.id,
        'assignment_title', v_assignment.title,
        'subject_id', v_assignment.subject_id,
        'subject_name', v_assignment.subject_name,
        'classroom_id', v_assignment.classroom_id,
        'classroom_name', v_assignment.classroom_name,
        'submitted_at', new.submitted_at,
        'late', new.status = 'late',
        'resubmission', v_resubmission,
        'needs_grading', true
      );
      v_title := case when v_resubmission then 'ส่งงานแก้ไขใหม่ — รอตรวจ' else 'ส่งงานใหม่ — รอตรวจ' end;
      v_body := v_student_name || ' ส่ง “' || v_assignment.title || '” · ' || coalesce(v_assignment.subject_name, '-') || ' · ' || v_assignment.classroom_name;

      -- At most one UNREAD submission notification per submission: a
      -- resubmission while the previous one is still unread refreshes it
      -- (moves it to the top) instead of stacking a second row.
      select n.id into v_existing
        from public.notifications n
       where n.recipient_user_id = v_assignment.teacher_id
         and n.entity_type = 'assignment_submission'
         and n.entity_id = new.id
         and n.read_at is null
       limit 1;

      if v_existing is not null then
        update public.notifications
           set notification_type = case when v_resubmission then 'assignment_resubmitted' else notification_type end,
               title = v_title,
               body = left(v_body, 500),
               metadata = v_meta,
               dedupe_key = v_event_key,
               actor_user_id = v_student_profile,
               created_at = now()
         where id = v_existing
           and dedupe_key <> v_event_key;
      else
        perform public.notifications_insert(
          v_assignment.teacher_id, v_student_profile,
          case when v_resubmission then 'assignment_resubmitted' else 'assignment_submitted' end,
          v_title, v_body, 'assignment_submission', new.id, v_meta, v_event_key);
      end if;
    end if;

    -- Teacher recorded a score (setSubmissionScore). Students cannot change
    -- score (0016's enforce_submission_field_ownership), so this is always
    -- the teacher. One notification per submission: a later score change
    -- refreshes it and marks it unread again.
    if new.score is not null
       and (tg_op = 'INSERT' or new.score is distinct from old.score)
       and v_student_profile is not null then
      v_meta := jsonb_build_object(
        'submission_id', new.id,
        'assignment_id', v_assignment.id,
        'assignment_title', v_assignment.title,
        'subject_id', v_assignment.subject_id,
        'subject_name', v_assignment.subject_name,
        'classroom_id', v_assignment.classroom_id,
        'score', new.score,
        'max_score', v_assignment.max_score
      );
      v_body := '“' || v_assignment.title || '” · ' || coalesce(v_assignment.subject_name, '-') || ' · ได้ '
        || public.notifications_format_number(new.score) || '/'
        || public.notifications_format_number(v_assignment.max_score) || ' คะแนน';
      insert into public.notifications (recipient_user_id, actor_user_id, notification_type, title, body, entity_type, entity_id, metadata, dedupe_key)
      values (v_student_profile, auth.uid(), 'submission_graded', 'ครูตรวจงานแล้ว', left(v_body, 500), 'assignment_submission', new.id, v_meta, 'graded:' || new.id)
      on conflict on constraint notifications_recipient_dedupe_key do update
        set body = excluded.body,
            metadata = excluded.metadata,
            actor_user_id = excluded.actor_user_id,
            read_at = null,
            created_at = now()
        where notifications.body is distinct from excluded.body;
    end if;
  exception when others then
    raise warning 'notify_on_submission_change skipped: %', sqlerrm;
  end;
  return new;
end;
$$;

revoke all on function public.notify_on_submission_change() from public, anon, authenticated;

drop trigger if exists notify_on_submission_change on public.assignment_submissions;
create trigger notify_on_submission_change
  after insert or update of submitted_at, status, score on public.assignment_submissions
  for each row
  execute function public.notify_on_submission_change();

-- ==================================================
-- assignments: new (or un-archived) assignment -> every linked, active
-- student of that classroom
-- ==================================================

create or replace function public.notify_on_assignment_published()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_subject_name text;
  v_classroom_name text;
  v_body text;
begin
  begin
    if new.is_archived then
      return new;
    end if;
    if tg_op = 'UPDATE' and not (old.is_archived and not new.is_archived) then
      return new;
    end if;

    select s.name into v_subject_name from public.subjects s where s.id = new.subject_id;
    select c.name into v_classroom_name from public.classrooms c where c.id = new.classroom_id;
    v_body := '“' || new.title || '” · ' || coalesce(v_subject_name, '-')
      || case when new.due_date is not null then ' · ครบกำหนด ' || to_char(new.due_date, 'DD/MM/') || (extract(year from new.due_date)::int + 543)::text else '' end;

    insert into public.notifications (recipient_user_id, actor_user_id, notification_type, title, body, entity_type, entity_id, metadata, dedupe_key)
    select distinct st.linked_profile_id, auth.uid(), 'assignment_published', 'มีงานใหม่', left(v_body, 500), 'assignment', new.id,
           jsonb_build_object(
             'assignment_id', new.id,
             'assignment_title', new.title,
             'subject_id', new.subject_id,
             'subject_name', v_subject_name,
             'classroom_id', new.classroom_id,
             'classroom_name', v_classroom_name,
             'due_date', new.due_date
           ),
           'assignment:' || new.id
      from public.classroom_students cs
      join public.students st on st.id = cs.student_id
      join public.profiles p on p.id = st.linked_profile_id
     where cs.classroom_id = new.classroom_id
       and st.status = 'active'
    on conflict on constraint notifications_recipient_dedupe_key do nothing;
  exception when others then
    raise warning 'notify_on_assignment_published skipped: %', sqlerrm;
  end;
  return new;
end;
$$;

revoke all on function public.notify_on_assignment_published() from public, anon, authenticated;

drop trigger if exists notify_on_assignment_published on public.assignments;
create trigger notify_on_assignment_published
  after insert or update of is_archived on public.assignments
  for each row
  execute function public.notify_on_assignment_published();

-- ==================================================
-- student_account_link_requests: pending request -> the teacher(s) who own
-- a classroom the student belongs to (the same teachers the existing
-- approve/reject RPCs authorise); decision -> the requesting account.
-- ==================================================

create or replace function public.notify_on_link_request_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_student_name text;
begin
  begin
    v_student_name := public.notifications_student_name(new.student_id);

    if tg_op = 'INSERT' and new.status = 'pending' then
      insert into public.notifications (recipient_user_id, actor_user_id, notification_type, title, body, entity_type, entity_id, metadata, dedupe_key)
      select t.teacher_id, new.requested_by, 'link_request', 'คำขอเชื่อมบัญชีนักเรียน',
             left(v_student_name || ' ขอเชื่อมบัญชีกับห้อง ' || t.classroom_names || ' — รออนุมัติ', 500),
             'student_link_request', new.id,
             jsonb_build_object(
               'request_id', new.id,
               'student_id', new.student_id,
               'student_name', v_student_name,
               'classroom_names', t.classroom_names,
               'status', new.status,
               'requested_at', new.created_at
             ),
             'link_request:' || new.id
        from (
          select c.teacher_id, string_agg(c.name, ', ' order by c.name) as classroom_names
            from public.classroom_students cs
            join public.classrooms c on c.id = cs.classroom_id
           where cs.student_id = new.student_id
           group by c.teacher_id
        ) t
        join public.profiles p on p.id = t.teacher_id
      on conflict on constraint notifications_recipient_dedupe_key do nothing;
    end if;

    if tg_op = 'UPDATE' and old.status = 'pending' and new.status in ('approved', 'rejected') then
      -- Keep the teachers' request notifications showing the live status
      -- (read state untouched).
      update public.notifications
         set metadata = metadata || jsonb_build_object('status', new.status, 'reviewed_at', new.reviewed_at)
       where entity_type = 'student_link_request'
         and entity_id = new.id
         and notification_type = 'link_request';

      perform public.notifications_insert(
        new.requested_by, new.reviewed_by,
        case when new.status = 'approved' then 'link_approved' else 'link_rejected' end,
        case when new.status = 'approved' then 'บัญชีได้รับการอนุมัติแล้ว' else 'คำขอเชื่อมบัญชีถูกปฏิเสธ' end,
        case when new.status = 'approved'
             then 'ครูอนุมัติการเชื่อมบัญชีกับ ' || v_student_name || ' แล้ว เข้าใช้งานได้ทันที'
             else 'ครูปฏิเสธคำขอเชื่อมบัญชี' || coalesce(': ' || left(new.review_note, 200), '') || ' — ตรวจสอบรหัสนักเรียนแล้วส่งคำขอใหม่'
        end,
        'student_link_request', new.id,
        jsonb_build_object('request_id', new.id, 'status', new.status, 'review_note', left(new.review_note, 200), 'reviewed_at', new.reviewed_at),
        'link_decision:' || new.id);
    end if;
  exception when others then
    raise warning 'notify_on_link_request_change skipped: %', sqlerrm;
  end;
  return new;
end;
$$;

revoke all on function public.notify_on_link_request_change() from public, anon, authenticated;

drop trigger if exists notify_on_link_request_change on public.student_account_link_requests;
create trigger notify_on_link_request_change
  after insert or update of status on public.student_account_link_requests
  for each row
  execute function public.notify_on_link_request_change();

-- ==================================================
-- RPCs for the signed-in user (own rows only)
-- ==================================================

-- Mark specific notifications read. Ids that are not the caller's simply
-- match nothing (no error, no existence leak). Returns rows changed.
create or replace function public.mark_my_notifications_read(p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  if auth.uid() is null then
    raise exception 'กรุณาเข้าสู่ระบบก่อนใช้งาน' using errcode = '28000';
  end if;
  update public.notifications
     set read_at = now()
   where recipient_user_id = auth.uid()
     and id = any(coalesce(p_ids, '{}'::uuid[]))
     and read_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.mark_my_notifications_read(uuid[]) from public, anon;
grant execute on function public.mark_my_notifications_read(uuid[]) to authenticated;

create or replace function public.mark_all_my_notifications_read()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  if auth.uid() is null then
    raise exception 'กรุณาเข้าสู่ระบบก่อนใช้งาน' using errcode = '28000';
  end if;
  update public.notifications
     set read_at = now()
   where recipient_user_id = auth.uid()
     and read_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.mark_all_my_notifications_read() from public, anon;
grant execute on function public.mark_all_my_notifications_read() to authenticated;

-- Deadline reminders for the CALLER only (no scheduler needed: the app
-- calls this when the bell loads). Assignments due today or tomorrow
-- (Thai time):
--   student — their own assignments not yet submitted;
--   teacher — their classrooms' assignments with students not yet
--             submitted (count refreshed on each call, read state kept).
-- One notification per assignment and due date. Returns rows created.
create or replace function public.refresh_my_deadline_notifications()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
  v_student uuid;
  v_role text;
  v_count integer := 0;
  v_rows integer;
begin
  if v_uid is null then
    raise exception 'กรุณาเข้าสู่ระบบก่อนใช้งาน' using errcode = '28000';
  end if;
  select p.role into v_role from public.profiles p where p.id = v_uid;

  if v_role = 'student' then
    v_student := public.my_student_id();
    if v_student is null then
      return 0;
    end if;
    insert into public.notifications (recipient_user_id, actor_user_id, notification_type, title, body, entity_type, entity_id, metadata, dedupe_key)
    select v_uid, null, 'deadline_student',
           case when a.due_date = v_today then 'งานครบกำหนดวันนี้' else 'งานครบกำหนดพรุ่งนี้' end,
           left('“' || a.title || '” · ' || coalesce(s.name, '-') || ' — ยังไม่ได้ส่ง', 500),
           'assignment', a.id,
           jsonb_build_object('assignment_id', a.id, 'assignment_title', a.title, 'subject_id', a.subject_id, 'subject_name', s.name,
                              'classroom_id', a.classroom_id, 'due_date', a.due_date),
           'deadline:' || a.id || ':' || a.due_date
      from public.assignments a
      join public.classroom_students cs on cs.classroom_id = a.classroom_id and cs.student_id = v_student
      left join public.subjects s on s.id = a.subject_id
      left join public.assignment_submissions sub on sub.assignment_id = a.id and sub.student_id = v_student
     where not a.is_archived
       and a.due_date between v_today and v_today + 1
       and (sub.id is null or (sub.submitted_at is null and sub.status not in ('submitted', 'late')))
    on conflict on constraint notifications_recipient_dedupe_key do nothing;
    get diagnostics v_count = row_count;
    return v_count;
  end if;

  if v_role in ('teacher', 'admin') then
    with due as (
      select a.id, a.title, a.subject_id, a.classroom_id, a.due_date, s.name as subject_name, c.name as classroom_name,
             (select count(*)
                from public.classroom_students cs
                join public.students st on st.id = cs.student_id and st.status = 'active'
                left join public.assignment_submissions sub on sub.assignment_id = a.id and sub.student_id = cs.student_id
               where cs.classroom_id = a.classroom_id
                 and (sub.id is null or (sub.submitted_at is null and sub.status not in ('submitted', 'late')))) as pending
        from public.assignments a
        join public.classrooms c on c.id = a.classroom_id and c.teacher_id = v_uid
        left join public.subjects s on s.id = a.subject_id
       where not a.is_archived
         and a.due_date between v_today and v_today + 1
    )
    insert into public.notifications (recipient_user_id, actor_user_id, notification_type, title, body, entity_type, entity_id, metadata, dedupe_key)
    select v_uid, null, 'deadline_teacher',
           case when d.due_date = v_today then 'งานครบกำหนดวันนี้' else 'งานครบกำหนดพรุ่งนี้' end,
           left('“' || d.title || '” · ' || coalesce(d.subject_name, '-') || ' · ' || d.classroom_name || ' — ยังไม่ส่ง ' || d.pending || ' คน', 500),
           'assignment', d.id,
           jsonb_build_object('assignment_id', d.id, 'assignment_title', d.title, 'subject_id', d.subject_id, 'subject_name', d.subject_name,
                              'classroom_id', d.classroom_id, 'classroom_name', d.classroom_name, 'due_date', d.due_date, 'pending_count', d.pending),
           'deadline:' || d.id || ':' || d.due_date
      from due d
     where d.pending > 0
    on conflict on constraint notifications_recipient_dedupe_key do update
      set body = excluded.body, metadata = excluded.metadata
      where notifications.body is distinct from excluded.body;
    get diagnostics v_rows = row_count;
    return v_rows;
  end if;

  return 0;
end;
$$;

revoke all on function public.refresh_my_deadline_notifications() from public, anon;
grant execute on function public.refresh_my_deadline_notifications() to authenticated;
