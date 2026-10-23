# การเก็บถาวรและการลบห้องเรียน (Classroom lifecycle)

KrunameClass มีสองวิธีนำห้องเรียนออก และตั้งใจแยกกันชัดเจน

| | เก็บถาวร / นำออกจากรายการห้องเรียน | ลบห้องเรียนถาวร |
|---|---|---|
| ข้อมูล | **ไม่ลบอะไรเลย** | ลบข้อมูลของห้องนี้ (ดูรายการด้านล่าง) |
| ย้อนกลับ | กด **กู้คืนห้องเรียน** ได้ทุกเมื่อ | **ย้อนกลับไม่ได้** |
| ขั้นตอน | ยืนยัน 1 ครั้ง | ต้องเก็บถาวรก่อน → ดูรายการที่จะถูกลบ → พิมพ์ชื่อห้องให้ตรงทุกตัวอักษร → ยืนยันครั้งสุดท้าย |
| ใครทำได้ | เจ้าของห้อง หรือผู้ดูแลระบบ (role = admin) | เจ้าของห้อง หรือผู้ดูแลระบบ |

ทั้งสองอย่างตรวจสิทธิ์ที่ฐานข้อมูล (migration `0032_classroom_archive_and_delete.sql`) ไม่ได้พึ่งแค่หน้าเว็บ

## สำหรับครู

**เก็บถาวร** — เมนู ⋮ ของห้องเรียน (แดชบอร์ด → ห้องเรียนของฉัน) หรือปุ่ม “เก็บถาวร” ในหน้าห้องเรียน
- ห้องจะหายจากรายการ “กำลังสอน” และจะไม่ถูกเสนอให้เลือกในงานประจำวัน
  เช่น เลือกห้องในรายวิชา, มอบหมาย/คัดลอกงานไปห้องอื่น, ย้ายนักเรียน, สร้างรายวิชา
- ดูห้องที่เก็บถาวรได้จากตัวกรอง **“เก็บถาวร”** — เปิดดูนักเรียน การเช็คชื่อ และคะแนนย้อนหลังได้ครบ
- นักเรียน, QR ประจำตัว, การเช็คชื่อ, งาน, การส่งงาน และคะแนน **อยู่ครบทุกอย่าง**

**ลบห้องเรียนถาวร** — มีเฉพาะห้องที่เก็บถาวรแล้ว (เมนู ⋮ หรือปุ่มในหน้าห้องเรียน)
1. ระบบดึงจำนวนข้อมูลจริงจากเซิร์ฟเวอร์ แสดงสามกลุ่ม: **จะถูกลบถาวร**, **เก็บไว้ ไม่ถูกลบ**, **ไฟล์**
2. พิมพ์ชื่อห้องให้ตรงทุกตัวอักษร (เว้นวรรคเกินก็ไม่ผ่าน) แล้วกด “ถัดไป”
3. หน้ายืนยันครั้งสุดท้าย → “ลบห้องเรียนถาวร”
4. ข้อความ “ลบแล้ว” จะขึ้นเมื่อเซิร์ฟเวอร์ยืนยันแล้วเท่านั้น หากระหว่างนั้นมีคนบันทึกข้อมูลเพิ่มในห้องนี้
   (เช่น เช็คชื่อ/สแกนส่งงาน) ระบบจะ**ไม่ลบ** และแสดงจำนวนใหม่ให้ตรวจสอบอีกครั้ง

## ขอบเขตการลบ (retention policy)

**ถูกลบ** — ข้อมูลที่เป็นของห้องนี้เท่านั้น
- ตัวห้องเรียน, รายชื่อนักเรียนในห้อง (การลงทะเบียน), การเชื่อมกับรายวิชา
- รอบการเช็คชื่อและบันทึกการเช็คชื่อรายคนของห้องนี้ (ทั้งรายวิชาและโฮมรูม)
- งาน, ไฟล์แนบ/ลิงก์ของงาน (รายการอ้างอิง), การส่งงาน, คะแนนงาน, ไฟล์ที่นักเรียนส่ง (รายการอ้างอิง),
  ประวัติการสแกน QR / แก้สถานะ
- บทเรียนและสื่อการสอน (รายการอ้างอิง), ช่องคะแนน SGS และคะแนน SGS, บันทึกติดตามนักเรียน
- การแจ้งเตือนที่อ้างถึงห้องนี้ (เฉพาะเมื่อติดตั้ง 0029 แล้ว)

**ไม่ถูกลบ**
- บัญชีนักเรียนทุกคน (รวมคนที่ไม่มีห้องอื่นแล้ว), บัญชีนักเรียนที่เชื่อมแล้ว, คำขอเชื่อมบัญชี
- **QR ประจำตัวนักเรียน** (เป็นของนักเรียน ใช้ต่อได้ทุกห้อง/ทุกภาคเรียน)
- รายวิชาและหัวข้อ (ลบเฉพาะการเชื่อมกับห้องนี้)
- ข้อมูลของห้องอื่นทั้งหมด รวมถึงการเช็คชื่อ/การส่งงานของนักเรียนกลุ่มเดียวกันในห้องอื่น
- **ไฟล์ทุกไฟล์** — ทั้งใน Supabase Storage และ Google Drive (ดูหัวข้อถัดไป)

**ลบไม่ได้ (ระบบบล็อก)** เมื่อ
- ห้องยังไม่ถูกเก็บถาวร
- ห้องมีข้อมูลที่อยู่ในรายวิชาของครูคนอื่น — ยืนยันความเป็นเจ้าของข้อมูลไม่ได้ จึงไม่ลบ (ติดต่อผู้ดูแลระบบ)

## ไฟล์และ Google Drive

การลบห้อง**ไม่ลบไฟล์ใด ๆ** โดยอัตโนมัติ ในธุรกรรมเดียวกับการลบ ระบบคัดลอกรายการไฟล์ทุกไฟล์ที่ข้อมูลของห้องอ้างถึง
ลงตาราง `classroom_file_cleanup_queue` (สถานะ `pending_review`) พร้อมบอกว่าไฟล์นั้น **ห้องอื่นยังใช้อยู่หรือไม่**
(`referenced_elsewhere`) — ไฟล์ Drive ที่คัดลอกงานไปหลายห้องจะใช้ file id เดียวกัน

ขั้นตอนลบไฟล์ (แยกจากการลบห้อง, ต้องได้รับอนุมัติ, ทำโดยผู้ดูแลระบบด้วย service role):
1. ดูรายการ: `select * from classroom_file_cleanup_queue where status = 'pending_review' order by created_at;`
2. ตรวจทีละรายการ — ห้ามลบรายการที่ `referenced_elsewhere = true` และตรวจซ้ำ ณ เวลาที่จะลบว่ายังไม่มีแถวใดอ้างถึงไฟล์นั้น
3. บันทึกการอนุมัติ: `update classroom_file_cleanup_queue set status = 'approved', reviewed_by = '<admin profile id>', reviewed_at = now() where id = ...;`
   หรือ `status = 'kept'` ถ้าตัดสินใจเก็บไว้
4. ลบไฟล์:
   - Supabase Storage: ลบ object ตาม `bucket` + `object_path` (Dashboard → Storage หรือ Storage API ด้วย service role)
   - Google Drive: **ห้ามลบเงียบ ๆ** — แจ้งครูเจ้าของไฟล์ (`classroom_owner_id`) ให้ย้ายไฟล์ไปถังขยะใน Drive เอง
     (KrunameClass ใช้ scope `drive.file` และการลบใน Document Center คือย้ายไปถังขยะ กู้คืนได้ 30 วัน)
5. บันทึกผล: `status = 'deleted'` (หรือ `failed` + `note`), `completed_at = now()`

ลูกค้า (เบราว์เซอร์) อ่านคิวได้เฉพาะของห้องตัวเองและเขียนไม่ได้เลย การเปลี่ยนสถานะทำได้ด้วย service role เท่านั้น

## Audit trail

ทุกการเก็บถาวร / กู้คืน / ลบ บันทึกใน `classroom_lifecycle_events` (ใคร, บทบาท owner/admin, เมื่อไร, ชื่อและภาคเรียนของห้อง
และสำหรับการลบ: จำนวนข้อมูลแต่ละประเภทที่ถูกลบ) ตารางนี้**ไม่มี foreign key ไปยัง classrooms** จึงอยู่ต่อหลังห้องถูกลบ
ครูอ่านได้เฉพาะของห้องตัวเอง ผู้ดูแลระบบอ่านได้ทั้งหมด ไม่มีใครแก้ไข/ลบผ่านแอปได้

---

## Technical notes (English)

### Dependency graph (audited from 0001–0031)

```
classrooms
├─ classroom_students.classroom_id      CASCADE (membership only; students untouched)
├─ subject_classrooms.classroom_id      CASCADE (link only; subjects untouched)
├─ attendance_sessions.classroom_id     CASCADE ─ attendance_records CASCADE
├─ assignments.classroom_id             CASCADE ─ assignment_resources, assignment_submissions
│                                                 (─ assignment_submission_resources),
│                                                 assignment_submission_events  (all CASCADE)
├─ lessons.classroom_id                 CASCADE ─ lesson_resources CASCADE
├─ sgs_score_columns.classroom_id       CASCADE ─ sgs_scores CASCADE
└─ student_followup_notes.classroom_id  CASCADE
```
Students are referenced with `ON DELETE RESTRICT` by attendance_records, assignment_submissions,
sgs_scores and student_followup_notes, and nothing on the cascade path can reach `students` or
`student_qr_identities`. The SGS delete guard (0023/0024) only blocks *direct* deletes
(`pg_trigger_depth() <= 1`); the classroom cascade runs at depth 2. 0029 notifications have no
FK (metadata only) and are deleted explicitly when the table exists.

Before 0032 the `classrooms_delete_own` policy (0001) let an owner run a raw `DELETE FROM classrooms`
through the REST API, silently cascading through all of the above with no preview or audit. The
app never used it; 0032 drops it, so `delete_classroom_permanently` is the only delete path. No
FK action was changed and no `ON DELETE CASCADE` was added.

### Database objects (0032)

| Object | Purpose |
|---|---|
| `classrooms.archived_at`, `archived_by` + trigger `classrooms_track_archive_state` | kept in sync with `is_active` on every update path; not client-writable |
| `set_classroom_archived(id, archived)` | owner/admin; row lock; KC005/KC006 on duplicates; audit row |
| `get_classroom_deletion_preview(id)` | owner/admin; live counts, blockers, fingerprint |
| `delete_classroom_permanently(id, typed_name, fingerprint)` | one transaction: lock classroom + direct children, re-authorize, require archived (KC001), exact name (KC002), unchanged fingerprint (KC003), no blockers (KC004); audit row; queue file refs; delete |
| `classroom_lifecycle_events` | append-only audit, survives deletion (no FK to classrooms) |
| `classroom_file_cleanup_queue` | file references awaiting a separately approved cleanup |
| internal helpers (`classroom_lifecycle_authorize`, `classroom_deletion_counts`, `…_fingerprint`, `…_blockers`) | no client EXECUTE |

### Deploying

1. Run `supabase/checks/0032_precheck.sql` (read-only). Every `ok` must be true/null. Keep row N.
2. Apply `supabase/migrations/0032_classroom_archive_and_delete.sql` (one transaction, e.g. wrapped
   in `begin; set local lock_timeout = '5s'; … commit;`).
3. Run `supabase/checks/0032_postcheck.sql`. P1–P9 true; P10 identical to precheck row N.
4. Deploy the frontend. Order is flexible: until 0032 exists the app archives with the previous
   plain update and the delete dialog explains the feature is not installed yet.
5. Rollback (only if needed): `supabase/checks/0032_rollback.sql` — removes the RPCs/trigger and
   restores `classrooms_delete_own`; keeps the audit tables and columns (no data loss).

### Tests

- `supabase/tests/0032_classroom_archive_and_delete.sql` — archive/restore, duplicates, permissions
  (other teacher, student, anon, no session, admin), empty and full deletes, exact counts,
  stale confirmation, simulated mid-delete failure (full rollback), shared students/QR,
  other-classroom preservation, Drive/Storage queueing, foreign-subject blocking, audit visibility.
- `supabase/tests/0032_classroom_delete_concurrency.sh` — two simultaneous deletes, a submission
  written during a delete, attendance saved before the recount.
- `src/services/classroom-lifecycle-service.test.ts`, `src/features/classroom-management/classroom-deletion-model.test.ts`.
