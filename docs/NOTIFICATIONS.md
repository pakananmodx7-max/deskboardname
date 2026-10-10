# In-app notifications (header bell)

The bell in the teacher header and the student header shows notifications
for the signed-in user. They are stored in Supabase, so they persist across
logout/login and devices, and arrive live through Supabase Realtime.

## Manual step for the project owner (required once)

The database part is **not applied automatically**. Review and run:

1. `supabase/migrations/0029_notifications.sql` — in the Supabase dashboard,
   SQL Editor → paste the file → Run. It is additive and safe to run twice.
   Do not use `supabase db push` for production.
2. Check that Realtime is on for the table: Database → Publications →
   `supabase_realtime` should list `notifications` (the migration adds it).
   If it is missing, add it there.
3. No new environment variables, Edge Functions or secrets are needed.

Until step 1 is done the app keeps working: the teacher bell says
"ระบบแจ้งเตือนยังไม่พร้อมใช้งาน", and the student bell still shows teacher
messages (from `teacher_student_notifications`, migration 0012).

Optional local verification (never against production):
`supabase/tests/0029_notifications.sql` runs 20 checks against a throwaway
local Postgres with the usual auth shim and migrations 0001–0029 applied.

## What creates notifications

All rows are created inside the database by `SECURITY DEFINER` triggers on
the existing tables. The app never inserts notifications itself.

| Event | Source | Recipient |
|---|---|---|
| ส่งงานใหม่ — รอตรวจ | `assignment_submissions.submitted_at` set by the student ("ส่งงาน") | Teacher who owns the assignment's classroom |
| ส่งงานแก้ไขใหม่ — รอตรวจ | Same row submitted again | Same teacher (an unread one is refreshed instead of stacking) |
| คำขอเชื่อมบัญชีนักเรียน | New pending `student_account_link_requests` row | Teachers who own a classroom the student is in (the same teachers the approve/reject RPCs allow); the card shows the live status |
| บัญชีได้รับการอนุมัติแล้ว / คำขอเชื่อมบัญชีถูกปฏิเสธ | Request approved / rejected (existing RPCs) | The requesting student account |
| มีงานใหม่ | New (or un-archived) assignment | Linked, active students of that classroom |
| ครูตรวจงานแล้ว | Teacher records a score | The student (one per submission; a changed score refreshes it) |
| งานครบกำหนดวันนี้/พรุ่งนี้ | `refresh_my_deadline_notifications()`, called when the bell loads | Student: own unsubmitted work. Teacher: own classrooms' assignments with students not yet submitted |
| ข้อความจากครู | Existing teacher → student messages (0012) | Shown in the student bell; still stored in `teacher_student_notifications` |

Not created, because the app has no data for them: messages from students
to teachers, and "returned for revision" (submissions have no such state).

## Security

- RLS: a user can read only rows where `recipient_user_id = auth.uid()`.
- No insert/update/delete policy; those privileges are revoked from
  `anon`/`authenticated`. Nobody can create or edit a notification for
  someone else from the client.
- Read state changes only through `mark_my_notifications_read(ids)` and
  `mark_all_my_notifications_read()`, which touch the caller's own rows.
- Opening a request notification only navigates to the existing approval
  page; it never approves or rejects.
- Idempotent: unique `(recipient_user_id, dedupe_key)`.
- A failing notification never blocks a submission, grade, assignment or
  link request (each trigger catches its own errors).

## Client behaviour

- First page of 20 + exact unread count; older pages with
  "โหลดการแจ้งเตือนก่อนหน้า" (keyset pagination on `created_at, id`).
- Realtime `INSERT`/`UPDATE` on the user's own rows. After a dropped
  connection, when the browser comes back online, or when the tab is shown
  again after a minute, the newest page and count are re-read, so nothing
  missed while offline is lost. Rows are merged by id (no duplicates).
- While Realtime is offline the bell re-reads once a minute; it never polls
  while live. Subscriptions and timers are removed on unmount/logout.
- Badge shows "99+" above 99. Clicking an item marks it read and opens its
  page (submission → assignment review page with that student's
  submission open; request → นักเรียน → คำขอเชื่อมบัญชี).
- Demo Mode uses an in-memory feed built from the demo data.

Code: `src/features/notifications/`, `src/services/app-notification-service.ts`.
