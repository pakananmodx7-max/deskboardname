import { readFileSync } from 'node:fs'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

// No DOM here: <Navigate> only fires in an effect, so render its target.
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return { ...actual, Navigate: ({ to, replace }: { to: string; replace?: boolean }) => createElement('a', { 'data-to': to, 'data-replace': String(Boolean(replace)) }) }
})

import { ATTENDANCE_REDIRECT_TARGET, resolveAttendanceRedirect } from '@/pages/teacher/attendance/attendance-redirect'
import { AttendanceRedirectPage } from '@/pages/teacher/attendance/attendance-redirect-page'

const SUBJECT = '0f4c2d9e-1a2b-4c3d-8e9f-001122334455'
const CLASSROOM = 'a1b2c3d4-e5f6-4a7b-8c9d-aabbccddeeff'

function landing(url: string): string {
  const html = renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: [url] }, createElement(AttendanceRedirectPage)))
  expect(html).toContain('data-replace="true"')
  return /data-to="([^"]*)"/.exec(html)![1].replace(/&amp;/g, '&')
}

describe('old /teacher/attendance URLs — redirect only', () => {
  it('without a subject + classroom goes to the subject list', () => {
    expect(ATTENDANCE_REDIRECT_TARGET).toBe('/teacher/subjects')
    expect(resolveAttendanceRedirect('')).toBe('/teacher/subjects')
    expect(resolveAttendanceRedirect(`?subjectId=${SUBJECT}`)).toBe('/teacher/subjects')
    expect(resolveAttendanceRedirect(`?classroomId=${CLASSROOM}`)).toBe('/teacher/subjects')
  })

  it('a bookmark with valid subject + classroom ids opens that workspace’s เช็คชื่อ tab', () => {
    const target = `/teacher/subjects/${SUBJECT}/classrooms/${CLASSROOM}?tab=attendance`
    expect(resolveAttendanceRedirect(`?subjectId=${SUBJECT}&classroomId=${CLASSROOM}`)).toBe(target)
    expect(resolveAttendanceRedirect(`?subject_id=${SUBJECT}&classroom_id=${CLASSROOM}`)).toBe(target)
    expect(resolveAttendanceRedirect(`?subject=${SUBJECT}&classroom=${CLASSROOM}&date=2026-10-01`)).toBe(target)
    // Demo ids
    expect(resolveAttendanceRedirect('?subjectId=subject-1&classroomId=classroom-2')).toBe('/teacher/subjects/subject-1/classrooms/classroom-2?tab=attendance')
  })

  it('ids that are not plain ids never become part of the path', () => {
    for (const bad of ['../../admin', 'a/b', 'x?y', '%2F', 'a b', 'x'.repeat(65)]) {
      expect(resolveAttendanceRedirect(`?subjectId=${encodeURIComponent(bad)}&classroomId=${CLASSROOM}`)).toBe('/teacher/subjects')
      expect(resolveAttendanceRedirect(`?subjectId=${SUBJECT}&classroomId=${encodeURIComponent(bad)}`)).toBe('/teacher/subjects')
    }
  })

  it('rendered: replaces the URL — no standalone page, no "เลือกรายวิชาก่อน" card', () => {
    expect(landing('/teacher/attendance')).toBe('/teacher/subjects')
    expect(landing('/teacher/attendance/anything')).toBe('/teacher/subjects')
    expect(landing(`/teacher/attendance?subjectId=${SUBJECT}&classroomId=${CLASSROOM}`)).toBe(`/teacher/subjects/${SUBJECT}/classrooms/${CLASSROOM}?tab=attendance`)
    const source = readFileSync(new URL('./attendance-redirect-page.tsx', import.meta.url), 'utf-8')
    expect(source).not.toContain('กรุณาเลือกรายวิชาและห้องเรียนก่อน')
    expect(source).toContain('<Navigate')
  })

  it('router keeps both redirect routes; subject attendance routes are untouched', () => {
    const router = readFileSync(new URL('../../../app/router.tsx', import.meta.url), 'utf-8')
    expect(router).toContain("{ path: 'attendance', element: <AttendanceRedirectPage /> }")
    expect(router).toContain("{ path: 'attendance/*', element: <AttendanceRedirectPage /> }")
    expect(router).toContain("path: 'subjects/:subjectId/classrooms/:classroomId'")
    expect(router).toContain("path: '/teacher/reports/attendance/print'")
  })

  it('demo subject workspace honours ?tab=attendance like the real one', () => {
    const demo = readFileSync(new URL('../subjects/subject-classroom-workspace-page-demo.tsx', import.meta.url), 'utf-8')
    expect(demo).toContain("initialDemoTab(searchParams.get('tab'))")
  })
})
