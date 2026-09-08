/**
 * Pure confirmation-copy builders, extracted so the exact wording (and the
 * decision of what each action does and doesn't affect) is unit-testable
 * without needing a rendered dialog or a Supabase client.
 */

export function buildRemoveFromClassroomMessage(studentName: string, classroomName: string): string {
  return `นำ ${studentName} ออกจากห้อง ${classroomName}?\nข้อมูลนักเรียนจะยังคงอยู่ในระบบ`
}

export function buildMoveClassroomMessage(
  studentName: string,
  fromClassroomName: string,
  toClassroomName: string,
): string {
  return `ย้าย ${studentName} จากห้อง ${fromClassroomName} ไปห้อง ${toClassroomName}?`
}

/**
 * "ลบนักเรียน" never performs a real database delete — students has no
 * DELETE RLS policy at all (see supabase/migrations/0001_init.sql,
 * docs/DATABASE.md "Orphan student strategy"), by original design: a
 * teacher accidentally destroying a student's attendance/grade/enrollment
 * history is exactly the failure mode that policy exists to prevent. This
 * action archives the student (status -> 'inactive') instead — the same,
 * already-real, already-reversible action archiveStudent() performs
 * elsewhere in the app — and the confirmation copy says so explicitly
 * rather than implying a permanent erasure that can't actually happen.
 */
export function buildArchiveStudentMessage(studentName: string): string {
  return (
    `ลบนักเรียน ${studentName} ออกจากระบบ?\n\n` +
    'การลบจะเปลี่ยนสถานะนักเรียนเป็น "ไม่ได้ใช้งาน" เท่านั้น ' +
    'ประวัติห้องเรียน คะแนน และการเข้าเรียนของนักเรียนจะยังคงอยู่ในระบบ ' +
    'ระบบไม่รองรับการลบข้อมูลนักเรียนแบบถาวร เพื่อป้องกันข้อมูลย้อนหลังสูญหาย'
  )
}
