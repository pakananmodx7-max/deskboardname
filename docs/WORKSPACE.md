# พื้นที่ทำงานของฉัน (My Workspace)

เมนู **พื้นที่ทำงาน** (`/teacher/workspace`) คือพื้นที่ส่วนตัวของครูแต่ละคน รวมบันทึก ลิงก์โปรด และงานส่วนตัวไว้ในหน้าเดียว
มี 6 แท็บ: ภาพรวม · บันทึก · ลิงก์โปรด · งานของฉัน · ปฏิทิน · กระดานงาน (Kanban)

- เห็นได้เฉพาะเจ้าของบัญชี ครูคนอื่นและนักเรียนเข้าไม่ได้ ระบบตรวจที่ฐานข้อมูลด้วย RLS ไม่ได้พึ่งแค่หน้าเว็บ
- ข้อมูลทั้งหมดเก็บใน Supabase เปิดจากเครื่องไหนก็เห็นเหมือนกัน
- ต้องติดตั้ง migration `0033_teacher_workspace.sql` ก่อนใช้งานจริง ถ้ายังไม่ได้ติดตั้ง หน้านี้จะแจ้งว่า
  “ยังไม่ได้ติดตั้งฐานข้อมูลของพื้นที่ทำงาน” ส่วนหน้าอื่นของระบบยังทำงานตามปกติ

## สำหรับครู

**ภาพรวม** — แสดงงานค้าง งานสำคัญสูง งานใกล้ครบกำหนด (ภายใน 3 วัน) และงานที่เสร็จแล้ว ตัวเลขทั้งหมดนับจากข้อมูลจริง
ถ้ามีงานเลยกำหนดหรือครบกำหนดวันนี้ จะมีแถบแจ้งเตือนอยู่ด้านบน ส่วนอื่นในหน้านี้:
- งานที่ต้องจัดการวันนี้ (ติ๊กให้เสร็จได้ทันที)
- เมทริกซ์จัดลำดับความสำคัญ
- บันทึกล่าสุด
- ลิงก์โปรด
- ปฏิทินย่อ (กดวันที่เพื่อดูงานของวันนั้น)

**บันทึก**
- **บันทึกอัตโนมัติ:** ระบบบันทึกเองระหว่างพิมพ์ ดูสถานะได้ที่มุมซ้ายบน (กำลังบันทึก… / บันทึกแล้ว / ออฟไลน์)
- **จัดระเบียบ:** ปักหมุด เก็บถาวร กู้คืน คัดลอก ลบ (มีให้ยืนยันก่อน) ใส่หมวดหมู่และแท็กได้
- **ค้นหาและเรียง:** ค้นหาได้ เรียงตามแก้ไขล่าสุด เก่าสุด หรือชื่อ
- **ลิงก์ในบันทึก:** ลิงก์ http(s) ที่พิมพ์ไว้จะแสดงเป็นปุ่มเปิดใต้บันทึก
- **ไม่มีข้อความหาย:**
  - เน็ตหลุด: ข้อความยังอยู่ในเครื่องและส่งเองเมื่อออนไลน์
  - ปิดแท็บก่อนบันทึกเสร็จ: ครั้งหน้าระบบจะเสนอให้กู้คืน
  - แก้บันทึกเดียวกันจากอีกเครื่องพร้อมกัน: ระบบไม่เขียนทับ แต่ถามว่าจะใช้ฉบับไหน

**ลิงก์โปรด**
- **ข้อมูลลิงก์:** เพิ่ม แก้ไข ลบ ปักหมุด คัดลอก ใส่หมวดหมู่ได้ (มีหมวดตั้งต้น และพิมพ์หมวดใหม่ได้เอง)
- **ค้นหาและเรียง:** ค้นหาได้ เรียงตามใช้ล่าสุด ใช้บ่อย ชื่อ หรือเพิ่มล่าสุด
- **ความปลอดภัย:** รับเฉพาะลิงก์ `http://` หรือ `https://` ถ้าพิมพ์ `www.example.com` ระบบเติม `https://` ให้
  - ลิงก์ที่ปฏิเสธ: `javascript:`, `data:`, `file:` และลิงก์ที่มีชื่อผู้ใช้หรือรหัสผ่านอยู่ข้างใน
  - การเปิด: เปิดในแท็บใหม่ด้วย `noopener noreferrer`

**งานของฉัน**
- **ข้อมูลงาน:** ชื่อ รายละเอียด สถานะ ระดับความสำคัญ (สูง/ปานกลาง/ต่ำ) วันเริ่ม วันครบกำหนด หมวดหมู่ และธง “สำคัญ” / “เร่งด่วน”
- **เพิ่มด่วน:** พิมพ์แล้วกด Enter
- **ค้นหาและกรอง:** ค้นหาได้ กรองตามสถานะ ระดับความสำคัญ กำหนดส่ง และหมวดหมู่ เรียงได้ 5 แบบ
- **ทางลัด:** ปุ่ม “เลยกำหนด”, “วันนี้”, “7 วันข้างหน้า”
- **มุมมองเมทริกซ์:**
  - ช่องของงาน: มาจากธงสำคัญ/เร่งด่วน **แยกจากระดับความสำคัญ**
  - ย้ายช่อง: ลากวาง หรือใช้เมนู ⋮ บนมือถือ

**ปฏิทิน**
- **มุมมอง:** ดูรายเดือนหรือรายสัปดาห์ เลื่อนเดือนได้ และมีปุ่ม “วันนี้”
- **สีของงาน:** เลยกำหนด / วันนี้ / ใกล้ครบกำหนด / เสร็จแล้ว
- **ใช้งาน:** กดวันที่เพื่อดูงานของวันนั้น แก้ไขงาน หรือเพิ่มงานที่ครบกำหนดในวันนั้นได้ทันที
- **เวลาไทย:** วันที่ทั้งหมดใช้เวลาไทย (Asia/Bangkok) และวันครบกำหนดเก็บเป็น “วัน” ไม่มีเวลา จึงไม่เลื่อนวันแม้เครื่องตั้งเขตเวลาอื่น

**กระดานงาน (Kanban)** — มี 3 คอลัมน์ ยังไม่เริ่ม / กำลังดำเนินการ / เสร็จแล้ว
- คอมพิวเตอร์: ลากการ์ดข้ามคอลัมน์หรือสลับลำดับได้
- มือถือและคีย์บอร์ด: ใช้ปุ่มลูกศร ↑ ↓ ← → บนการ์ด
- ลำดับการ์ดบันทึกในฐานข้อมูล

ทุกมุมมองใช้งานชุดเดียวกัน (ตาราง `workspace_tasks`) เปลี่ยนที่ไหนก็เห็นทุกที่ทันที

## Technical notes

### Database (0033)

| Object | Purpose |
|---|---|
| `workspace_notes` | title, body, category, tags[], pinned, archived_at, `revision` (bumped by trigger on every update) |
| `workspace_links` | title, url (CHECK: `^https?://`, no whitespace/control chars, ≤ 2048), description, category, pinned, open_count, last_opened_at |
| `workspace_tasks` | title, description, status (todo/in_progress/done), priority (high/medium/low), due_date / start_date (`date`, CHECK start ≤ due), category, important, urgent, sort_order, completed_at |
| `workspace_is_teacher()` | SECURITY DEFINER: caller's profile role is teacher/admin |
| `workspace_guard_owner()` | trigger: INSERT sets owner_id := auth.uid(); UPDATE keeps owner_id/created_at |
| `workspace_tasks_completed_at()` | trigger: done → completed_at set once; reopened → null |
| `workspace_notes_bump_revision()` | trigger: revision + 1 per update |
| `workspace_link_opened(uuid)` | SECURITY INVOKER RPC: bumps open_count of the caller's own link |

Categories are free text; the UI suggests defaults and every category the teacher already used, so no categories table is needed.
There is no separate matrix, calendar or board table. The matrix comes from `important`/`urgent`, the calendar from `due_date`,
and the board from `status` plus `sort_order`.

### RLS

- Each table has select/insert/update/delete policies.
- Every policy requires `owner_id = auth.uid() and workspace_is_teacher()`.
- `anon` has no privileges.
- `owner_id` is never trusted from the client.
- Students and other teachers read nothing and change nothing (verified: `supabase/tests/0033_teacher_workspace.sql`).

### Frontend

- `src/features/workspace/workspace-store.ts` is the single source of truth for all six tabs.
  - **Optimistic writes:** the UI updates immediately, and writes to the same record are queued so they reach the server in order.
  - **Stale responses:** a response is applied only if there is no newer local change.
  - **Failures:** a failed write rolls back to the last server-confirmed row and shows an error toast.
  - **Creates:** a client-generated UUID makes retries and double clicks idempotent; a retry that gets 23505 returns the existing row.
- `note-autosave.ts` handles note saving:
  - **Debounce and order:** 800 ms debounce, single-flight, so saves never overlap or reorder.
  - **Conflicts:** saves use `where revision = n`; a mismatch becomes a conflict prompt instead of an overwrite.
  - **Retries:** failed saves retry with back-off and retry immediately on the `online` event.
  - **Leaving the page:** autosave flushes on leaving a note, on tab hide, and on `beforeunload`.
  - **Local backup:** an unsaved draft is kept in localStorage (per account, per note) only as a recovery backup, never as the database.
  - **PWA updates:** pending saves call `markUnsavedWork()`, so a PWA update never reloads mid-save.
- **Refresh from other devices:** the data is re-read when the tab becomes visible again after 30 s.
- **Dates:** `workspace-dates.ts` handles them. Today is the Asia/Bangkok day, day arithmetic uses UTC midnights, and date-only values are formatted at noon UTC, so no date is ever off by one.
- **Demo Mode** (no Supabase configured) uses an in-memory repository with example data.

### Reminders

Reminders appear only in the workspace UI:
- the overdue / today / soon banner and badges on ภาพรวม;
- the coloured due labels and calendar dots.

The existing notification bell (0029) is server-written for classroom events. This phase adds no push notifications,
scheduled jobs or email, and does not touch the bell or student-approval notifications.

## Production rollout (requires approval)

1. `supabase/checks/0033_precheck.sql` (read-only). Rows 1–7 must be `true`.
2. Apply `supabase/migrations/0033_teacher_workspace.sql` in one transaction: wrap it in `begin; … commit;`, with a guard
   that refuses to run twice.
3. `supabase/checks/0033_postcheck.sql`. P1–P9 must be `true`.
4. Deploy the frontend. The order is flexible: without 0033 the page shows the "not installed" notice and nothing else is affected.
5. Rollback (only if needed): `supabase/checks/0033_rollback.sql`.
   - **Warning:** it drops the three tables, including teachers' personal data, so export first.

### Verification

- `supabase/tests/0033_teacher_workspace.sql` covers ownership, other teacher, student, anon, URL checks, completed_at,
  date ordering, revision, time zones, `link_opened` and admin.
- Unit tests:
  - `src/features/workspace/workspace-model.test.ts`: dates, URLs, notes, tasks, matrix, Kanban.
  - `src/features/workspace/workspace-store.test.ts`: autosave, ordering, rollback, conflicts, drafts.
