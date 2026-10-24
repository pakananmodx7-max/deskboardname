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
    expect(svgs.length).toBeGreaterThanOrEqual(2)
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

  it('blue & white palette: the requested light tokens, defined again for dark mode', () => {
    const light = css.slice(css.indexOf(':root {'), css.indexOf(":root[data-theme='dark']"))
    for (const [token, value] of [
      ['--primary', '#3b82c4'],
      ['--primary-hover', '#2d6da8'],
      ['--primary-light', '#eaf3fc'],
      ['--background', '#f5f8fc'],
      ['--sidebar', '#f8fafd'],
      ['--card', '#ffffff'],
      ['--foreground', '#172b4d'],
      ['--muted-foreground', '#64748b'],
      ['--border', '#e2eaf3'],
      ['--accent', '#edf4fb'],
    ])
      expect(light).toContain(`${token}: ${value};`)
    for (const token of ['--primary-hover', '--primary-light', '--tone-blue', '--class-n-ink', '--class-n-accent']) {
      expect(css.match(new RegExp(`${token}:`, 'g'))?.length).toBe(2)
    }
    // No second accent hue any more.
    expect(css).not.toMatch(/--tone-(lavender|mint|orange)/)
  })

  it('dashboard: one style for all four stat cards, blue icons, no off-palette Tailwind hues', () => {
    const cards = read('./components/summary-cards.tsx')
    expect(cards).toContain('bg-card')
    expect(cards).toContain('bg-primary-light text-primary')
    expect(cards).not.toMatch(/tone=|kc-pastel|kc-tone-/)
    for (const path of ['./components/summary-cards.tsx', './components/analytics-card.tsx', './components/classroom-section.tsx', './components/attendance-sections.tsx', './components/assignment-insights.tsx', './components/dashboard-decor.tsx']) {
      expect(read(path)).not.toMatch(/\b(?:bg|text|from|to|stroke|ring)-(?:violet|purple|orange|amber|emerald|sky|teal|indigo|pink|fuchsia)-\d/)
    }
  })

  it('status colours stay for status: present green, late yellow, absent red', () => {
    const sections = read('./components/attendance-sections.tsx')
    expect(sections).toContain("{ key: 'present', label: 'มาเรียน', value: b.present, stroke: 'stroke-success', dot: 'bg-success' }")
    expect(sections).toContain("{ key: 'late', label: 'มาสาย', value: b.late, stroke: 'stroke-warning', dot: 'bg-warning' }")
    expect(sections).toContain("{ key: 'absent', label: 'ขาดเรียน', value: b.absent, stroke: 'stroke-destructive', dot: 'bg-destructive' }")
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
    for (const path of ['./components/dashboard-decor.tsx', './components/summary-cards.tsx', './components/classroom-analytics-dashboard.tsx', './components/analytics-card.tsx', './components/attendance-sections.tsx', './components/hero-class-n.tsx']) {
      expect(read(path)).not.toMatch(/\bdark:/)
    }
  })
})

describe('greeting banner: interactive "Class N" (React Bits TechText)', () => {
  it('replaces the old artwork on the right; the greeting stays complete', () => {
    const html = render()
    expect(html).toContain('สวัสดี, ครูทดสอบ')
    expect(html).toContain('data-testid="hero-class-n"')
    expect(html).toContain('role="img" aria-label="Class N"')
    expect(read('./components/dashboard-decor.tsx')).not.toContain('HeroDecoration')
  })

  it('beside the greeting (flex sibling, not overlaid), 34–38% wide, left out on phones', () => {
    const hero = read('./components/hero-class-n.tsx')
    expect(hero).toContain('className="hidden h-28 w-[34%] shrink-0 text-[var(--class-n-ink)] md:-my-4 md:block lg:-my-5 lg:h-32 lg:w-[38%]"')
    expect(read('./components/classroom-analytics-dashboard.tsx')).toMatch(/<div className="min-w-0 flex-1">[\s\S]*?<\/div>\s*<HeroClassN \/>/)
  })

  it('uses the requested TechText settings (shared Class N mark), colours from theme tokens', () => {
    const css = read('../../index.css')
    expect(read('./components/hero-class-n.tsx')).toContain('<ClassNMark />')
    const hero = readFileSync(new URL('../../components/brand/class-n-mark.tsx', import.meta.url), 'utf-8')
    for (const prop of ['text="Class N"', 'fontWeight={700}', 'fontSize={100}', 'reveal="letter"', 'dashLength={4}', 'dashGap={2}', 'specks={12}', 'intro="none"', 'introDuration={2}', 'clickKick', 'guides={false}', 'fontFamily=""', 'letterSpacing={-0.05}', 'reach={150}', 'softness={0.7}', 'lineStyle="dashed"', 'strokeWidth={1.5}', 'speed={1}', 'bounce={0.4}', 'selection', 'labels', 'align="center"', 'draggable', 'sweep'])
      expect(hero).toContain(prop)
    expect(hero).toContain('color="var(--class-n-ink)"')
    expect(hero).toContain('accentColor="var(--class-n-accent)"')
    const light = css.slice(css.indexOf(':root {'), css.indexOf(":root[data-theme='dark']"))
    expect(light).toContain('--class-n-ink: #285a99;')
    expect(light).toContain('--class-n-accent: #5685c2;')
  })

  it('the TechText port keeps reduced motion, off-screen pause and full cleanup', () => {
    const src = readFileSync(new URL('../../components/brand/tech-text.tsx', import.meta.url), 'utf-8')
    expect(src).toContain("window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches")
    expect(src).toContain('const sweeping = !introducing && s.sweep && !reducedMotion && !pointer.inside && dragging < 0')
    expect(src).toContain('new IntersectionObserver(')
    expect(src).toContain('new ResizeObserver(resize)')
    for (const call of ['resizeObserver.disconnect()', 'intersectionObserver.disconnect()', 'themeObserver.disconnect()', "container.removeEventListener('pointerdown', onDown)"]) expect(src).toContain(call)
    expect(src).toContain('const token = /^var\\((--[\\w-]+)\\)$/.exec(value.trim())')
  })
})
