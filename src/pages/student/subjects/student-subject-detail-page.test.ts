import { describe, expect, it } from 'vitest'

import { STUDENT_SUBJECT_TABS } from '@/pages/student/subjects/student-subject-detail-page'

describe('/student/subjects/:subjectId tabs', () => {
  it('is exactly ภาพรวม/งาน/คะแนน/การเข้าเรียน, in that order — no student roster/classmates tab', () => {
    expect(STUDENT_SUBJECT_TABS.map((tab) => tab.key)).toEqual(['overview', 'assignments', 'grades', 'attendance'])
    expect(STUDENT_SUBJECT_TABS.map((tab) => tab.label)).toEqual(['ภาพรวม', 'งาน', 'คะแนน', 'การเข้าเรียน'])
  })

  it('has no "students"/roster tab of any kind', () => {
    expect(STUDENT_SUBJECT_TABS.some((tab) => (tab.key as string) === 'students')).toBe(false)
  })
})
