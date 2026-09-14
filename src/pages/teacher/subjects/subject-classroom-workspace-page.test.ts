import { describe, expect, it } from 'vitest'

import { TABS as REAL_TABS } from '@/pages/teacher/subjects/subject-classroom-workspace-page-real'
import { TABS as DEMO_TABS } from '@/pages/teacher/subjects/subject-classroom-workspace-page-demo'

describe('Subject-Classroom workspace tabs — Topics removed, real and demo in sync', () => {
  const expectedDemoKeys = ['overview', 'students', 'attendance', 'lessons', 'assignments', 'grades']
  const expectedRealKeys = ['overview', 'students', 'attendance', 'lessons', 'assignments', 'submissionCheck', 'grades']

  it('real workspace has no Topics ("หัวข้อ") tab', () => {
    expect(REAL_TABS.some((tab) => (tab.key as string) === 'topics')).toBe(false)
    expect(REAL_TABS.some((tab) => tab.label === 'หัวข้อ')).toBe(false)
  })

  it('demo workspace has no Topics ("หัวข้อ") tab', () => {
    expect(DEMO_TABS.some((tab) => (tab.key as string) === 'topics')).toBe(false)
    expect(DEMO_TABS.some((tab) => tab.label === 'หัวข้อ')).toBe(false)
  })

  it('real workspace is exactly ภาพรวม/นักเรียน/เช็กชื่อ/บทเรียน/งาน/ตรวจสอบงาน/คะแนน, in that order', () => {
    expect(REAL_TABS.map((tab) => tab.key)).toEqual(expectedRealKeys)
  })

  it('ตรวจสอบงาน sits directly between งาน and คะแนน', () => {
    const keys = REAL_TABS.map((tab) => tab.key)
    expect(keys.indexOf('submissionCheck')).toBe(keys.indexOf('assignments') + 1)
    expect(keys.indexOf('grades')).toBe(keys.indexOf('submissionCheck') + 1)
  })

  it('demo workspace matches the real workspace’s tab set MINUS ตรวจสอบงาน — that tab is real-data-only (submission checking/grading on actual assignment_submissions rows), never backed by demo/mock data', () => {
    expect(DEMO_TABS.map((tab) => tab.key)).toEqual(expectedDemoKeys)
    expect(DEMO_TABS.some((tab) => (tab.key as string) === 'submissionCheck')).toBe(false)
    // every OTHER tab still matches real exactly, in the same relative order
    const realWithoutSubmissionCheck = REAL_TABS.filter((tab) => tab.key !== 'submissionCheck')
    expect(DEMO_TABS.map((tab) => tab.key)).toEqual(realWithoutSubmissionCheck.map((tab) => tab.key))
    expect(DEMO_TABS.map((tab) => tab.label)).toEqual(realWithoutSubmissionCheck.map((tab) => tab.label))
  })

  it('attendance is spelled "เช็กชื่อ" — the same spelling the Classroom Workspace tab uses, never "เช็คชื่อ"', () => {
    const attendanceTab = REAL_TABS.find((tab) => tab.key === 'attendance')
    expect(attendanceTab?.label).toBe('เช็กชื่อ')
  })
})
