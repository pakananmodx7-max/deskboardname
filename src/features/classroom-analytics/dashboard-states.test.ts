import { readFileSync } from 'node:fs'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import { AnalyticsTimeoutError, chunk, fetchAllPages, withTimeout } from '@/services/classroom-analytics-service'

import { ToastProvider } from '@/components/ui/toast'

import { resolveSemesterScope, type AnalyticsAssignmentData, type AnalyticsAttendanceRecord, type AnalyticsContext, type AnalyticsRoster } from './analytics'
import { ClassroomAnalyticsDashboard, type ClassroomAnalyticsDashboardProps } from './components/classroom-analytics-dashboard'
import { classroomIdsKey, idsFromKey } from './use-classroom-analytics'
import { combineResources, LOADING, success, type Resource } from './resource'

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
const ASSIGNMENTS: AnalyticsAssignmentData = { assignments: [], submissions: [] }
const noop = () => {}

function render(overrides: Partial<ClassroomAnalyticsDashboardProps> = {}, semesterKey: string | null = '2569|1'): string {
  const context = overrides.context ?? success(CONTEXT)
  const props: ClassroomAnalyticsDashboardProps = {
    context,
    onRetryContext: noop,
    scope: context.status === 'success' && semesterKey !== null ? resolveSemesterScope(context.data, semesterKey) : null,
    roster: success(ROSTER),
    onRetryRoster: noop,
    attendance: success(RECORDS),
    onRetryAttendance: noop,
    assignments: success(ASSIGNMENTS),
    onRetryAssignments: noop,
    teacherName: 'ครูทดสอบ',
    classroomsEditable: false,
    onClassroomsChanged: noop,
    today: '2026-09-30',
    ...overrides,
  }
  return renderToStaticMarkup(
    createElement(MemoryRouter, null, createElement(ToastProvider, null, createElement(ClassroomAnalyticsDashboard, props))),
  )
}

describe('loading, empty and error states (rendered)', () => {
  it('while requests are pending: skeletons, never an empty state or a 0', () => {
    const html = render({ roster: LOADING, attendance: LOADING, assignments: LOADING })
    expect(html).toContain('data-testid="section-loading"')
    expect(html).not.toContain('ยังไม่มีบันทึกการเช็คชื่อ')
    expect(html).not.toContain('0 คน')
  })

  it('context still loading: greeting stays, semester card and widgets show skeletons', () => {
    const html = render({ context: LOADING }, null)
    expect(html).toContain('สวัสดี, ครูทดสอบ')
    expect(html).toContain('data-testid="section-loading"')
    expect(html).toContain('aria-label="กำลังโหลดห้องเรียน"')
    expect(html).not.toContain('ยังไม่มีห้องเรียน')
  })

  it('an error shows the message and a retry button, and only in the affected sections', () => {
    const html = render({ attendance: { status: 'error', error: 'เครือข่ายขัดข้อง' } })
    expect(html).toContain('เครือข่ายขัดข้อง')
    expect(html).toContain('ลองใหม่')
    // Assignment section still renders its own (empty) state.
    expect(html).toContain('ยังไม่มีงานหรือแบบทดสอบในภาคเรียนนี้')
    // Summary cards still show the roster-based count.
    expect(html).toContain('2 คน')
  })

  it('context failure: page-level error with retry instead of an endless spinner', () => {
    const html = render({ context: { status: 'error', error: 'โหลดข้อมูลนานเกินไป' } }, null)
    expect(html).toContain('โหลดข้อมูลนานเกินไป')
    expect(html).toContain('ลองใหม่')
  })

  it('no attendance records: explicit empty states (overview, trend, rankings)', () => {
    const html = render({ attendance: success([]) })
    expect(html).toContain('ยังไม่มีบันทึกการเช็คชื่อในภาคเรียนนี้')
    expect(html).toContain('ยังไม่มีบันทึกการเช็คชื่อสำหรับแสดงแนวโน้ม')
    expect(html).toContain('ยังไม่มีนักเรียนที่ขาดเรียน')
  })

  it('with data: real numbers, Thai labels, unit derived from the data (subject records -> คาบ)', () => {
    const html = render()
    expect(html).toContain('สวัสดี, ครูทดสอบ')
    expect(html).toContain('ภาคเรียนที่ 1/2569')
    expect(html).toContain('50%') // 1 present of 2 entries
    expect(html).toContain('ขาด 1 คาบ')
    expect(html).toContain('บุญมี ศรีสุข')
  })

  it('a semester with no classrooms explains why the page is empty', () => {
    const html = render({ context: success({ ...CONTEXT, classrooms: [] }) })
    expect(html).toContain('ยังไม่มีห้องเรียนใน')
  })

  it('ranked students link to Student Analytics only when a link builder is given (real mode)', () => {
    expect(render()).not.toContain('/analytics')
    const html = render({ studentLink: (s) => `/teacher/subjects/s1/classrooms/${s.classroomId}/students/${s.studentId}/analytics` })
    expect(html).toContain('/teacher/subjects/s1/classrooms/c1/students/b/analytics')
  })
})

describe('resource helpers', () => {
  it('combineResources: error wins, then loading, then success', () => {
    const err: Resource<number> = { status: 'error', error: 'x' }
    expect(combineResources(success(1), err)).toBe(err)
    expect(combineResources(LOADING as Resource<number>, success(2)).status).toBe('loading')
    expect(combineResources(success(1), success(2))).toEqual({ status: 'success', data: [1, 2] })
  })

  it('classroom id cache keys are order-independent and round-trip', () => {
    expect(classroomIdsKey(['b', 'a'])).toBe(classroomIdsKey(['a', 'b']))
    expect(idsFromKey(classroomIdsKey(['b', 'a']))).toEqual(['a', 'b'])
    expect(idsFromKey(classroomIdsKey([]))).toEqual([])
  })
})

describe('service: batching, paging, timeouts (no N+1, no endless loading)', () => {
  it('fetchAllPages reads every page until a short page', async () => {
    const pages: [number, number][] = []
    const rows = await fetchAllPages(async (from, to) => {
      pages.push([from, to])
      const size = from >= 4 ? 1 : 2
      return { data: Array.from({ length: size }, (_, i) => from + i), error: null }
    }, 2)
    expect(rows).toEqual([0, 1, 2, 3, 4])
    expect(pages).toEqual([
      [0, 1],
      [2, 3],
      [4, 5],
    ])
  })

  it('fetchAllPages surfaces a query error', async () => {
    await expect(fetchAllPages(async () => ({ data: null, error: new Error('rls') }))).rejects.toThrow('rls')
  })

  it('ids are chunked so a request URL never grows with the semester', () => {
    const ids = Array.from({ length: 250 }, (_, i) => `id${i}`)
    expect(chunk(ids).map((c) => c.length)).toEqual([100, 100, 50])
  })

  it('withTimeout rejects a hung request with a clear Thai message', async () => {
    vi.useFakeTimers()
    try {
      const pending = withTimeout(new Promise(() => {}), 1000)
      const assertion = expect(pending).rejects.toBeInstanceOf(AnalyticsTimeoutError)
      vi.advanceTimersByTime(1000)
      await assertion
      await expect(withTimeout(Promise.resolve(7), 1000)).resolves.toBe(7)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('service query shapes', () => {
  const service = readFileSync(new URL('../../services/classroom-analytics-service.ts', import.meta.url), 'utf-8')

  it('attendance is one embedded, paged query per id chunk — never one request per session or student', () => {
    expect(service).toContain("attendance_sessions!inner(classroom_id, subject_id, attendance_date)")
    expect(service).toContain(".in('attendance_sessions.classroom_id', ids)")
    expect(service.match(/\.range\(from, to\)/g)?.length).toBeGreaterThanOrEqual(6)
    expect(service).not.toMatch(/for \([^)]*\) \{[^}]*await supabase/)
  })

  it('every loader is wrapped in withTimeout', () => {
    for (const fn of ['getAnalyticsContext', 'getAnalyticsRoster', 'getAnalyticsAttendance', 'getAnalyticsAssignments']) {
      const body = service.slice(service.indexOf(`export async function ${fn}`))
      expect(body.slice(0, 600)).toContain('withTimeout(')
    }
  })
})
