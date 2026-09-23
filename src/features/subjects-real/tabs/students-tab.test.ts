import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { buildStudentAnalyticsPath } from '@/features/subjects-shared/subject-classroom-nav'

function readSource(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), 'utf-8')
}

const tab = readSource('./students-tab.tsx')
const drawer = readSource('../subject-student-drawer.tsx')
const router = readSource('../../../app/router.tsx')

describe('วิเคราะห์รายบุคคล — two entry points into the EXISTING Student Analytics page', () => {
  it('builds the existing analytics route with the subject, classroom and student ids in the right slots', () => {
    expect(buildStudentAnalyticsPath('subj-1', 'room-2', 'stu-3')).toBe('/teacher/subjects/subj-1/classrooms/room-2/students/stu-3/analytics')
    // The route the path points at is the one StudentAnalyticsPage is mounted on — no new route.
    expect(router).toContain("path: 'subjects/:subjectId/classrooms/:classroomId/students/:studentId/analytics'")
    expect(router.match(/element: <StudentAnalyticsPage \/>/g)).toHaveLength(1)
  })

  it('subject-student-drawer has a "วิเคราะห์รายบุคคล" button that navigates via buildStudentAnalyticsPath', () => {
    expect(drawer).toContain('วิเคราะห์รายบุคคล')
    expect(drawer).toContain('onClick={() => navigate(buildStudentAnalyticsPath(subjectId, classroomId, student.id))}')
  })

  it('Students tab ⋮ menu offers ดูรายละเอียด and วิเคราะห์รายบุคคล for each student', () => {
    const menu = tab.slice(tab.indexOf('<RowActionsMenu'), tab.indexOf('/>', tab.indexOf('<RowActionsMenu')))
    expect(menu).toContain("{ key: 'view', label: 'ดูรายละเอียด', onSelect: () => setViewingStudent(student) }")
    expect(menu).toContain("label: 'วิเคราะห์รายบุคคล'")
    expect(menu).toContain('onSelect: () => navigate(buildStudentAnalyticsPath(subjectId, classroomId, student.id))')
  })

  it('reuses the existing analytics system — no new analytics service/page is imported here', () => {
    for (const source of [tab, drawer]) {
      expect(source).not.toMatch(/student-analytics-service|getStudentAnalytics|StudentAnalyticsPage/)
    }
  })

  it('existing behavior is kept: clicking a row still opens the drawer, and the drawer keeps ส่งข้อความ', () => {
    expect(tab).toContain('onClick={() => setViewingStudent(student)}')
    expect(tab).toContain('<SubjectStudentDrawer')
    expect(drawer).toContain('ส่งข้อความ')
    // Empty/loading rows still span the whole table (now 4 columns with ⋮).
    expect(tab.match(/colSpan=\{4\}/g)).toHaveLength(2)
    expect(tab).not.toContain('colSpan={3}')
  })
})
