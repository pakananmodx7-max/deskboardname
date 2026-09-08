import { describe, expect, it } from 'vitest'

import {
  buildArchiveStudentMessage,
  buildMoveClassroomMessage,
  buildRemoveFromClassroomMessage,
} from '@/features/classroom-management/student-confirm-messages'

describe('buildRemoveFromClassroomMessage', () => {
  it('names the student and classroom, and states the student record is kept', () => {
    const message = buildRemoveFromClassroomMessage('สมชาย ใจดี', 'ม.5/1')
    expect(message).toBe('นำ สมชาย ใจดี ออกจากห้อง ม.5/1?\nข้อมูลนักเรียนจะยังคงอยู่ในระบบ')
  })
})

describe('buildMoveClassroomMessage', () => {
  it('names the student and both classrooms', () => {
    const message = buildMoveClassroomMessage('กิตติ พรชัย', 'ม.5/1', 'ม.5/2')
    expect(message).toBe('ย้าย กิตติ พรชัย จากห้อง ม.5/1 ไปห้อง ม.5/2?')
  })
})

describe('buildArchiveStudentMessage', () => {
  it('never claims a permanent delete — the wording says status changes to inactive', () => {
    const message = buildArchiveStudentMessage('สมชาย ใจดี')
    expect(message).toContain('สมชาย ใจดี')
    expect(message).toContain('ไม่ได้ใช้งาน')
    expect(message).not.toContain('ลบถาวร')
  })

  it('explains that classroom/grade/attendance history is preserved', () => {
    const message = buildArchiveStudentMessage('กิตติ พรชัย')
    expect(message).toContain('ห้องเรียน')
    expect(message).toContain('คะแนน')
    expect(message).toContain('การเข้าเรียน')
  })
})
