import { readFileSync } from 'node:fs'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import { ToastProvider } from '@/components/ui/toast'

import { resolveSemesterScope, type AnalyticsAttendanceRecord, type AnalyticsContext, type AnalyticsRoster } from './analytics'
import { ClassroomAnalyticsDashboard, type ClassroomAnalyticsDashboardProps } from './components/classroom-analytics-dashboard'
import { LOADING, success } from './resource'

const CONTEXT: AnalyticsContext = {
  classrooms: [{ id: 'c1', name: 'ม.1/1', academicYear: '2569', semester: '1', isActive: true }],
  subjects: [{ id: 's1', name: 'ภาษาไทย', academicYear: '2569', semester: '1' }],
  links: [{ subjectId: 's1', classroomId: 'c1' }],
}
const ROSTER: AnalyticsRoster = {
  memberships: [
    { studentId: 'a', classroomId: 'c1' },
    { studentId: 'b', classroomId: 'c1' },
  ],
  students: [
    { id: 'a', firstName: 'อนันต์', lastName: 'ใจดี', studentCode: '1', number: 1, status: 'active' },
    { id: 'b', firstName: 'บุญมี', lastName: 'ศรีสุข', studentCode: '2', number: 2, status: 'active' },
  ],
}
const RECORDS: AnalyticsAttendanceRecord[] = [
  { sessionId: 'x', classroomId: 'c1', subjectId: 's1', date: '2026-08-03', studentId: 'a', status: 'present' },
  { sessionId: 'x', classroomId: 'c1', subjectId: 's1', date: '2026-08-03', studentId: 'b', status: 'absent' },
]
const noop = () => {}

function render(overrides: Partial<ClassroomAnalyticsDashboardProps> = {}): string {
  const props: ClassroomAnalyticsDashboardProps = {
    context: success(CONTEXT),
    onRetryContext: noop,
    scope: resolveSemesterScope(CONTEXT, '2569|1'),
    roster: success(ROSTER),
    onRetryRoster: noop,
    attendance: success(RECORDS),
    onRetryAttendance: noop,
    assignments: success({ assignments: [], submissions: [] }),
    onRetryAssignments: noop,
    teacherName: 'ครูทดสอบ',
    classroomsEditable: false,
    onClassroomsChanged: noop,
    today: '2026-09-30',
    ...overrides,
  }
  return renderToStaticMarkup(createElement(MemoryRouter, null, createElement(ToastProvider, null, createElement(ClassroomAnalyticsDashboard, props))))
}

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf-8')

describe('dashboard redesign — real data only', () => {
  it('greeting, semester card and the four stat cards show the real values', () => {
    const html = render()
    expect(html).toContain('สวัสดี, ครูทดสอบ')
    expect(html).toContain('ภาคเรียนที่ 1/2569')
    expect(html).toContain('1 ห้องเรียน · 1 รายวิชา')
    expect(html).toContain('เช็คชื่อ 3 ส.ค. 2569 – 3 ส.ค. 2569')
    expect(html).toContain('เปลี่ยนภาคเรียน')
    for (const label of ['นักเรียนทั้งหมด', 'ห้องเรียนทั้งหมด', 'รายวิชาที่สอน', 'งาน/แบบทดสอบ']) expect(html).toContain(label)
    expect(html).toContain('2 คน')
    expect(html).toContain('1 ห้อง')
    expect(html).toContain('1 วิชา')
    expect(html).toContain('0 รายการ')
  })

  it('stat cards never show a number while loading', () => {
    const html = render({ roster: LOADING })
    expect(html).not.toContain('>0 คน')
    expect(html).toContain('aria-label="กำลังโหลด"')
  })

  it('decorations are hidden from assistive technology and carry no text', () => {
    const decor = read('./components/dashboard-decor.tsx')
    const svgs = decor.match(/<svg\b[^>]*>/g) ?? []
    expect(svgs.length).toBeGreaterThanOrEqual(5)
    for (const svg of svgs) expect(svg).toContain('aria-hidden="true"')
    expect(decor).not.toMatch(/<text\b/)
    // No people, avatars or invented counts in the artwork.
    expect(decor).not.toMatch(/avatar|\+\d|teacher|student/i)
  })
})

describe('attendance empty states', () => {
  it('no records: illustrated empty state with a link to the real attendance workflow', () => {
    const html = render({ attendance: success([]) })
    expect(html).toContain('ยังไม่มีบันทึกการเช็คชื่อในภาคเรียนนี้')
    expect(html).toContain('ยังไม่มีบันทึกการเช็คชื่อสำหรับแสดงแนวโน้ม')
    expect(html).toContain('href="/teacher/subjects"')
    expect(html).toContain('ไปเช็คชื่อในรายวิชา')
    expect(html).toContain('ยังไม่มีบันทึกเช็คชื่อ')
  })

  it('with records: the real chart, no empty-state call to action', () => {
    const html = render()
    expect(html).toContain('50%')
    expect(html).toContain('กราฟอัตรามาเรียนรายสัปดาห์')
    expect(html).not.toContain('ไปเช็คชื่อในรายวิชา')
  })

  it('the call to action targets the route /teacher/attendance redirects to', () => {
    const sections = read('./components/attendance-sections.tsx')
    const redirect = readFileSync(new URL('../../pages/teacher/attendance/attendance-redirect.ts', import.meta.url), 'utf-8')
    expect(sections).toContain("const ATTENDANCE_WORKFLOW_PATH = '/teacher/subjects'")
    expect(redirect).toContain("export const ATTENDANCE_REDIRECT_TARGET = '/teacher/subjects'")
  })
})

describe('theme, motion and styling rules', () => {
  const css = read('../../index.css')

  it('tone tokens exist for light and dark themes', () => {
    for (const token of ['--tone-blue', '--tone-lavender', '--tone-mint', '--tone-orange']) {
      expect(css.match(new RegExp(`${token}:`, 'g'))?.length).toBe(2)
    }
  })

  it('mixes colors in oklab (an oklch mix with white swings the hue through pink)', () => {
    expect(css).toContain('color-mix(in oklab')
    expect(css).not.toContain('color-mix(in oklch')
  })

  it('the hover lift only moves cards when motion is allowed', () => {
    const lift = css.slice(css.indexOf('.kc-lift {'), css.indexOf('.kc-nav-active'))
    const guard = lift.indexOf('@media (prefers-reduced-motion: no-preference)')
    expect(guard).toBeGreaterThan(0)
    expect(lift.indexOf('translateY')).toBeGreaterThan(guard)
  })

  it('no Tailwind dark: variants in the redesigned files', () => {
    for (const path of ['./components/dashboard-decor.tsx', './components/summary-cards.tsx', './components/classroom-analytics-dashboard.tsx', './components/analytics-card.tsx', './components/attendance-sections.tsx']) {
      expect(read(path)).not.toMatch(/\bdark:/)
    }
  })
})
