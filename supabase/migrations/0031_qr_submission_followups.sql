-- 0031: QR submission follow-ups. Requires 0029 (notifications) and 0030.
--
-- Small, additive fixes found after 0030 went to production. Nothing here
-- touches scores, notes, submitted_at values, students, QR tokens, RLS
-- policies, grants of existing RPCs, or any SGS table/function.
--
--   1. notify_on_submission_change() (0029): no "ส่งงานใหม่ — รอตรวจ"
--      notification when the classroom's own teacher records the
--      submission (QR scan, "บันทึกว่าส่ง", correction, existing grading
--      tools). Scanning a whole class no longer floods the teacher's bell.
--      A student's own "ส่งงาน" still notifies exactly as before, and so
--      does a change made by anyone else (admin, service role). The score
--      → student notification is unchanged.
--   2. refresh_my_deadline_notifications() (0029): students the teacher
--      excused (ยกเว้น) are neither reminded nor counted as "ยังไม่ส่ง".
--   3. An excused student may still hand in work through "ส่งงาน": the
--      row becomes submitted/late as before (score/note untouched) and the
--      teacher is notified (1). New: that override of the teacher's
--      decision is written to assignment_submission_events
--      ('student_submitted_after_excused').
--
-- (1) and (2) are verbatim copies of the 0029 functions with only the
-- marked lines changed. Run once in the SQL Editor wrapped in
-- begin; set local lock_timeout = '5s'; ... commit;  (re-runnable).

do $$
begin
  if to_regclass('public.notifications') is null
     or to_regprocedure('public.notify_on_submission_change()') is null
     or to_regprocedure('public.refresh_my_deadline_notifications()') is null then
    raise exception '0031 requires migration 0029 (notifications)';
  end if;
  if to_regclass('public.assignment_submission_events') is null
     or to_regprocedure('public.qr_record_submission(public.assignments, uuid, text)') is null then
    raise exception '0031 requires migration 0030 (QR submissions)';
  end if;
end $$;

-- ==================================================
-- 1. No self-notification for teacher-recorded submissions
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
    -- 0031: not when the classroom's own teacher made the change (QR scan,
    -- "บันทึกว่าส่ง", status correction, existing grading tools) — the
    -- teacher is the actor and would only be notifying themselves.
    if new.submitted_at is not null
       and new.status in ('submitted', 'late')
       and (tg_op = 'INSERT' or new.submitted_at is distinct from old.submitted_at)
       and auth.uid() is distinct from v_assignment.teacher_id then
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

-- ==================================================
-- 2. Deadline reminders skip excused students
-- ==================================================

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
       and (sub.id is null or (sub.submitted_at is null and sub.status not in ('submitted', 'late', 'excused')))
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
                 and (sub.id is null or (sub.submitted_at is null and sub.status not in ('submitted', 'late', 'excused')))) as pending
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

-- ==================================================
-- 3. Audit: an excused student submitted anyway
-- ==================================================

alter table public.assignment_submission_events
  drop constraint if exists assignment_submission_events_event_type_check;
alter table public.assignment_submission_events
  add constraint assignment_submission_events_event_type_check
  check (event_type in ('scan_recorded', 'manual_recorded', 'status_corrected', 'student_submitted_after_excused'));

create or replace function public.log_student_submission_after_excused()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.status = 'excused'
     and new.status in ('submitted', 'late')
     and new.student_id = public.my_student_id() then
    insert into public.assignment_submission_events
      (assignment_id, student_id, event_type, previous_status, new_status, previous_submitted_at, new_submitted_at, actor_id)
    values
      (new.assignment_id, new.student_id, 'student_submitted_after_excused',
       old.status, new.status, old.submitted_at, new.submitted_at, auth.uid());
  end if;
  return null;
end;
$$;

revoke all on function public.log_student_submission_after_excused() from public, anon, authenticated;

drop trigger if exists log_student_submission_after_excused_trigger on public.assignment_submissions;
create trigger log_student_submission_after_excused_trigger
  after update of status on public.assignment_submissions
  for each row
  when (old.status = 'excused' and new.status is distinct from old.status)
  execute function public.log_student_submission_after_excused();
