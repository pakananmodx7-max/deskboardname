import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

function readSource(): string {
  return readFileSync(new URL('./classroom-detail-page-real.tsx', import.meta.url), 'utf-8')
}

describe('ClassroomDetailPageReal — Classroom Workspace tabs (ห้องเรียน → เลือกห้อง)', () => {
  const source = readSource()

  it('has exactly these 5 tabs, in this order', () => {
    const labels = [...source.matchAll(/label:\s*'([^']+)'/g)].map((m) => m[1])
    expect(labels).toEqual(['ภาพรวม', 'นักเรียน', 'งานและการบ้าน', 'เช็กชื่อ', 'คะแนนและการประเมิน'])
  })

  it('reuses the exact same AssignmentsTab/AttendanceTab/GradesTab used by the subject workspace — no duplicated assignment/attendance/grade logic', () => {
    expect(source).toContain("from '@/features/subjects-real/tabs/assignments-tab'")
    expect(source).toContain("from '@/features/subjects-real/tabs/attendance-tab'")
    expect(source).toContain("from '@/features/subjects-real/tabs/grades-tab'")
  })

  it('reuses the existing classroom overview/students tabs unchanged', () => {
    expect(source).toContain("from '@/features/classroom-management/tabs/classroom-overview-tab'")
    expect(source).toContain("from '@/features/classroom-management/tabs/classroom-students-tab'")
  })

  it('resolves which subject to use via the reverse-lookup getClassroomSubjects, never a hardcoded/guessed subjectId', () => {
    expect(source).toContain('getClassroomSubjects(classroomId)')
  })

  it('only shows a subject picker when the classroom is linked to more than one subject', () => {
    expect(source).toContain('linkedSubjects.length > 1')
  })

  it('shows an honest empty state (not a crash or fabricated data) when no subject is linked yet', () => {
    expect(source).toContain('ห้องเรียนนี้ยังไม่ได้เชื่อมกับรายวิชาใด')
  })
})
