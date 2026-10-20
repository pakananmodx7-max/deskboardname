# Student QR codes and QR-scanned assignment submission

Teachers record that a student handed in an assignment by scanning the
student's permanent QR card — with a phone camera or a Bluetooth/USB QR
scanner — inside **ตรวจงานและคะแนน**. Scores stay a separate, teacher-only
step.

Nothing in this document has been run against production. Every
deployment step below is a manual step for the project owner.

## How it fits the existing system

| Concern | Reused as-is | Added |
|---|---|---|
| Students | `students`, `classroom_students` | `student_qr_identities` (one active random token per student) |
| Assignments | `assignments` (subject + classroom) | `submission_deadline`, `late_policy`, `accepting_submissions` |
| Submissions | `assignment_submissions` — one row per (assignment, student), `status` separate from `score`, `submitted_at` | status `excused`; `recorded_via`, `recorded_by` |
| Audit | — | `assignment_submission_events` (scans recorded + every correction) |
| Grading UI | ตรวจงานและคะแนน matrix, score editing, bulk tools | "สแกน QR ตรวจงาน" button, "สแกน QR งานนี้" column action |
| Roster UI | classroom → นักเรียน tab, all actions | QR button per student, "พิมพ์ QR ทั้งห้อง" |

There is no second grading table and no copy of the roster. A scan
writes exactly one `assignment_submissions` row — the one for the
**selected assignment** and the **scanned student** — through the same
unique `(assignment_id, student_id)` constraint the app already uses.

```
Camera (jsQR / BarcodeDetector) ─┐
Bluetooth/USB scanner (HID input) ┼─► normalise text ─► queue (one at a time)
Roster "บันทึกว่าส่ง" (manual)  ─┘            │
                                              ▼
                 record_submission_scan / record_submission_manual   (SECURITY DEFINER)
                   1. signed-in teacher/admin          5. student in the assignment's classroom
                   2. owns the assignment's classroom  6. open? deadline? late policy?
                      AND subject                      7. submitted_at = now() (server)
                   3. resolve token → student          8. on time / late from the deadline
                   4. token active (not revoked)       9. insert or lock+update — never twice
                                              │
                                              ▼
                       { outcome, student, submission } → shown only now
```

## QR identity strategy

- **Token:** 64 lowercase hex digits = two `gen_random_uuid()` values
  (244 random bits from the database's strong RNG). The QR text is
  `kcqr1` + token — no name, student code, number or database id.
- **One active identity per student**, enforced by a partial unique index
  (`where status = 'active'`). Issuing is idempotent and safe under
  concurrency (`on conflict … do nothing`).
- **Existing students:** the migration backfills an identity for every
  student. **New students:** an `AFTER INSERT` trigger on `students`
  issues one. `get_classroom_student_qr_codes` also issues any that are
  missing, so a roster always has codes.
- **Stable:** the token belongs to the student, not to a semester,
  classroom or assignment — the same card works for งานที่ 1, 2, 3 …, after
  a semester change or a classroom move.
- **Revocation:** "บัตรหาย? สร้าง QR ใหม่" revokes the active token
  (kept with `revoked_at`/`revoked_by`) and issues a new one atomically;
  the old card is rejected at once (`revoked_qr`).
- **Access:** RLS is on with **no** policies and all client grants are
  revoked — tokens are only returned by the RPCs, only for students in a
  classroom the caller owns. Holding a QR grants nothing: every write
  requires a signed-in teacher who owns the assignment.
- **No separators** in the payload, so a USB/Bluetooth scanner typing into
  a computer set to the **Thai (Kedmanee) keyboard layout** still works:
  the app maps the Thai characters back (`qr-payload.ts`).

## Statuses, deadlines and historical data

| Stored `status` | Shown as | Set by |
|---|---|---|
| `submitted` | **ส่งตรงเวลา** when the assignment has a deadline and `submitted_at` is before it; otherwise **ส่งแล้ว** | scan / manual / existing tools |
| `late` | **ส่งช้า** | scan after the deadline (late policy "accept"), existing tools |
| `not_submitted` / no row | **ยังไม่ส่ง** | default |
| `missing` | **ขาดส่ง** | teacher (existing) |
| `excused` (new) | **ยกเว้น** | teacher only, through the audited correction |

- **Deadline:** `submission_deadline` (exact time). When it is empty, the
  existing `due_date` counts as **23:59:59 of that day, Asia/Bangkok** —
  the same rule student self-submission already uses. No deadline ⇒ a
  scan is never labelled late.
- **Late policy:** `accept_late` (default) records `late`;
  `reject_late` refuses the scan (`deadline_passed`). **Open/closed:**
  `accepting_submissions = false` (or an archived assignment) refuses
  scans (`assignment_closed`). Teachers change these in the scanner's
  "ตั้งค่าการรับงาน".
- **Server time only:** `submitted_at` is the database's `now()`; dates
  are displayed in school time (Asia/Bangkok).
- **Repeated scans** never change the original `submitted_at`
  (`duplicate`). A `not_submitted`/`missing` row is promoted by a scan;
  score and teacher note are kept.
- **Historical records are untouched.** No existing row is rewritten.
  Old `submitted` rows without `submitted_at` read "ส่งแล้ว" (never a
  guessed "on time"); an existing `0/5` remains a score of 0 — it is
  never re-read as "not submitted".
- **Scores:** no function in migration 0030 writes `score`. Scanning
  never awards marks; e.g. "ส่งตรงเวลา — ยังไม่ตรวจคะแนน", "ส่งช้า — 5/5".
- **Excused** is counted as neither submitted nor missing in the matrix,
  the missing-work report, student analytics and dashboard progress.

## Corrections and audit trail

"แก้ไข" in the scanner roster calls `correct_submission_status`
(reason required, 3–500 characters). It can set any status, keeps the
score and note, keeps `submitted_at` for submitted/late and clears it for
not_submitted/missing/excused. Every recorded scan, manual record and
correction is written to `assignment_submission_events` with the
previous and new status/time, the reason and the actor. Teachers can read
the events of their own assignments; nobody can insert, edit or delete
them directly.

The existing per-cell status dialog and bulk tools keep working exactly
as before.

## Scanning behaviour

**Phone camera** — the camera is requested only when the teacher taps
"เปิดกล้อง", the rear camera is preferred, "สลับกล้อง" appears when there
are several cameras. Frames are decoded every ~140 ms (native
`BarcodeDetector` when available, else `jsqr`, loaded on demand). While a
scan is being saved, decoding pauses; a QR kept in view counts once and
counts again only after leaving the frame. All tracks are stopped when
the scanner closes, the component unmounts or the page is hidden.
Denied permission, no camera, a busy camera and non-HTTPS pages get
Thai messages; the Bluetooth/USB mode and "บันทึกว่าส่ง" remain available.

**Bluetooth / USB scanner (HID keyboard mode)** — pair the scanner in the
operating system. The scanner types into a focused input
(`inputMode="none"`, no autocorrect); Enter/Tab never submit a form or
move focus; scanners that send no Enter are picked up after a short
idle. Focus returns after each scan and when the window regains focus;
the input shows "พร้อมรับการสแกน" when it is ready. Rapid scans are
queued and processed one at a time. No Web Bluetooth is used.

**Feedback** — the latest result (name, number, existing photo when there
is one, status, server time) appears only after the server answered,
with optional sound and vibration. Network failures say
"บันทึกไม่สำเร็จ — ยังไม่ได้บันทึก"; nothing is queued offline. An expired
session or a database without migration 0030 stops scanning with a clear
message.

## Verification performed (development only)

- `supabase/tests/0030_student_qr_submissions.sql` — 14 adversarial
  checks on a throwaway Postgres with migrations 0001–0030 (Supabase
  default privileges included): token format/uniqueness, backfill +
  trigger, idempotency, per-assignment scans, on-time/late/no-deadline,
  due-date end of day, reject-late, closed, duplicates keep the first
  timestamp, existing score/note kept, invalid/foreign/revoked QR,
  semester change, regeneration, corrections + audit, excused, student
  self-excuse blocked, other teachers/students/anon rejected, internal
  helpers not callable. The migration was applied twice (re-runnable);
  the 0016 and 0029 tests still pass.
- Two concurrent sessions scanning the same student: one `recorded`, one
  `duplicate`, one row, one audit event.
- Browser end-to-end against that database: roster QR (light/dark), PNG
  download decoded back to the stored payload, single and A4 printing;
  HID scanning (19 checks incl. Thai keyboard layout, rapid scans,
  no-Enter scanners, invalid QR, network failure, manual, correction,
  closed assignment, matrix refresh); camera scanning with Chromium's
  fake camera playing a real QR (decode, single record while in view,
  tracks stopped, denied permission), phone width light/dark.

## Production deployment (manual — owner only)

Nothing below has been run. Order matters.

1. **Review** `supabase/migrations/0030_student_qr_submissions.sql`.
   It needs 0001–0029 (0029 notifications is optional: if it is applied,
   each recorded scan also creates the existing "ส่งงานใหม่ — รอตรวจ"
   notification for the teacher). 0012 (`students.avatar_path`) is also
   optional: without it the scanner shows the student's initials instead
   of a photo. Run `supabase/checks/0030_precheck.sql` (read-only) first.
2. **Back up** the database (Dashboard → Database → Backups).
3. **Apply** the migration in the Supabase SQL Editor (paste the file and
   run it) — not `supabase db push`.
4. **Read-only checks** (SQL Editor):
   ```sql
   select count(*) as students,
          (select count(*) from public.student_qr_identities where status = 'active') as active_qr
   from public.students;                       -- the two numbers match

   select relname, relrowsecurity,
          (select count(*) from pg_policies p where p.tablename = c.relname) as policies
   from pg_class c
   where relname in ('student_qr_identities', 'assignment_submission_events');
   -- student_qr_identities: rls true, 0 policies; events: rls true, 1 policy

   select has_function_privilege('authenticated', 'public.qr_record_submission(public.assignments, uuid, text)', 'execute');  -- false
   select has_function_privilege('authenticated', 'public.record_submission_scan(uuid, text)', 'execute');                  -- true
   ```
5. **Deploy the frontend** (push the branch → Vercel). Until the
   migration is applied, the QR buttons show
   "ระบบ QR ยังไม่พร้อมใช้งาน … (migration 0030)"; everything else works
   as before.
6. **Manual verification** with a real teacher account on
   https://krunameclass.com:
   1. ห้องเรียน → นักเรียน → QR icon: the card shows the student; download
      the PNG and scan it with a phone camera app (the text starts with
      `kcqr1`).
   2. "พิมพ์ QR ทั้งห้อง" → print preview: A4, 12 cards per page.
   3. รายวิชา → ห้อง → ตรวจงานและคะแนน → "สแกน QR ตรวจงาน" → choose งานที่ 1.
   4. Phone: "กล้องโทรศัพท์" → "เปิดกล้อง" → scan a card → "บันทึกแล้ว".
      Scan again → "ส่งแล้วก่อนหน้านี้".
   5. Bluetooth/USB scanner: pair in the OS, choose "เครื่องสแกน",
      scan several cards quickly → all recorded.
   6. Switch to งานที่ 2 and scan the same card → recorded for งานที่ 2 only.
   7. "ตั้งค่าการรับงาน": set a deadline in the past → a new scan is "ส่งช้า".
   8. "แก้ไข" → ยกเว้น with a reason → the matrix shows ยกเว้น after closing.
   9. Scores in the matrix are unchanged; enter a score as usual.
7. **Rollback** (only if needed): the frontend can be reverted alone. The
   migration is additive; to remove it, drop the five RPCs, the trigger
   `students_issue_qr_identity_trigger`, the tables
   `assignment_submission_events` and `student_qr_identities`, and set any
   `excused` rows to `missing` before restoring the old status check.

## Follow-up migration 0031 (requires 0029 + 0030)

`supabase/migrations/0031_qr_submission_followups.sql` — small, additive;
0030 itself is not changed or re-run.

| Behaviour | Before 0031 | After 0031 |
|---|---|---|
| Teacher scans / records / corrects a submission | teacher gets "ส่งงานใหม่ — รอตรวจ" for every student (40 scans → 40 notifications) | no notification — the teacher is the actor |
| Student presses "ส่งงาน" | teacher notified | unchanged |
| Deadline reminders (bell) | excused students reminded and counted as "ยังไม่ส่ง" | excused students left out |
| Excused student presses "ส่งงาน" | becomes ส่งแล้ว/ส่งช้า, no trace of the earlier excuse | same, plus an audit event `student_submitted_after_excused`; teacher notified |

Rules for an excused (ยกเว้น) row: a QR scan or "บันทึกว่าส่ง" by the
teacher does nothing (`excused` outcome — use "แก้ไข" with a reason to
change it); the student may still hand in work, which wins (status
ส่งแล้ว/ส่งช้า, score and note kept). The student page explains this.

Before applying: run `supabase/checks/0031_precheck.sql` (read-only; it
verifies the two 0029 functions are exactly the 0029 versions 0031
replaces). Apply in the SQL Editor wrapped in
`begin; set local lock_timeout = '5s'; … commit;`. Undo:
`supabase/checks/0031_rollback.sql`. Test:
`supabase/tests/0031_qr_submission_followups.sql`.

## Known limitations

- Hermes (the `teacher-agent-tools` Edge Function, unchanged and not
  redeployed) does not know `excused`: it cannot set it, and its
  summaries count an excused student as not submitted.
- A student account can still edit its own submission row as before
  (0016) — including `submitted_at` — except that it can no longer set
  `excused` or the new `recorded_via`/`recorded_by` columns.
- Camera scanning needs HTTPS (production is). iOS has no vibration API.
- Demo Mode has no QR features (they need the database).
