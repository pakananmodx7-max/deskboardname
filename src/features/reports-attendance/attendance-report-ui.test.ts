import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { Packer } from 'docx'
import JSZip from 'jszip'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import { ToastProvider } from '@/components/ui/toast'
import { listSemesterOptions, type AnalyticsAttendanceRecord, type AnalyticsRoster } from '@/features/classroom-analytics/analytics'
import { LOADING, success, type Resource } from '@/features/classroom-analytics/resource'
import { CONTEXT, ROSTER, SCOPE, TODAY } from '@/features/reports-missing/missing-report.fixtures'
import { SemesterContext, type SemesterContextValue } from '@/features/semester/semester-store'
import { PDF_FONT } from '@/lib/export/thai-pdf'

import { AttendanceReport } from './attendance-report'
import { buildAttendanceDocument } from './attendance-report-docx'
import { AttendanceReportDocument } from './attendance-report-document'
import { buildAttendanceMeta, buildAttendanceReport, DEFAULT_ATTENDANCE_FILTERS, type AttendanceReportFilters } from './attendance-report-model'
import { buildAttendancePdfDefinition } from './attendance-report-pdf'

const RECORDS: AnalyticsAttendanceRecord[] = [
  { sessionId: 'A', classroomId: 'c1', subjectId: 'hist', date: '2026-10-01', studentId: 's1', status: 'present' },
  { sessionId: 'A', classroomId: 'c1', subjectId: 'hist', date: '2026-10-01', studentId: 's2', status: 'absent' },
  { sessionId: 'B', classroomId: 'c1', subjectId: null, date: '2026-10-02', studentId: 's2', status: 'absent' },
  { sessionId: 'C', classroomId: 'c1', subjectId: null, date: '2026-10-03', studentId: 's2', status: 'absent' },
  { sessionId: 'D', classroomId: 'c2', subjectId: 'hist', date: '2026-10-05', studentId: 's4', status: 'late' },
]
const noop = () => {}

function semester(): SemesterContextValue {
  return { context: success(CONTEXT), retryContext: noop, refreshContext: noop, options: listSemesterOptions(CONTEXT), semesterKey: SCOPE.key, scope: SCOPE, setSemester: noop }
}

function render(data: Resource<[AnalyticsRoster, AnalyticsAttendanceRecord[]]>, url = '/teacher/reports?tab=attendance'): string {
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      { initialEntries: [url] },
      createElement(ToastProvider, null, createElement(SemesterContext.Provider, { value: semester() }, createElement(AttendanceReport, { useData: () => ({ data, refresh: noop }), teacherName: 'ครูทดสอบ' }))),
    ),
  )
}

function readSource(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf-8')
}

function report(patch: Partial<AttendanceReportFilters> = {}) {
  const filters = { ...DEFAULT_ATTENDANCE_FILTERS, preset: 'semester' as const, ...patch }
  const r = buildAttendanceReport({ context: CONTEXT, scope: SCOPE, roster: ROSTER, records: RECORDS, filters, today: TODAY })
  const meta = buildAttendanceMeta({ context: CONTEXT, scope: SCOPE, filters, report: r, teacherName: 'ครูทดสอบ ใจดี', today: TODAY })
  return { r, meta }
}

describe('สรุปการเข้าเรียน tab (rendered)', () => {
  it('header, actions, the four internal views and five summary cards', () => {
    const html = render(success([ROSTER, RECORDS]), '/teacher/reports?tab=attendance&ap=semester')
    for (const text of ['สรุปการเข้าเรียน', 'รายงานสถิติการเข้าเรียนของนักเรียน', 'รีเฟรชข้อมูล', 'CSV', 'Word (.docx)', 'PDF', 'พิมพ์ (A4)', 'สรุปภาพรวม', 'รายห้องเรียน', 'รายวิชา', 'รายนักเรียน']) expect(html).toContain(text)
    expect(html).toContain('role="tablist"')
    // People in คน, entries in ครั้ง, with the denominator stated.
    expect(html).toContain('4 คน')
    expect(html).toContain('3 ครั้ง')
    expect(html).toContain('ร้อยละคิดจากรายการเช็คชื่อทั้งหมด 5 รายการ')
  })

  it('student table: sortable headers, progress bar, follow-up flag, pagination sizes', () => {
    const html = render(success([ROSTER, RECORDS]), '/teacher/reports?tab=attendance&ap=semester')
    expect(html).toContain('aria-sort="ascending"')
    expect(html).toContain('role="progressbar"')
    expect(html).toContain('ควรติดตาม')
    for (const n of ['10', '20', '50', '100']) expect(html).toContain(`<option value="${n}"`)
    expect(html).toContain('ยังไม่มีข้อมูล')
  })

  it('classroom view: classroom panel inside the content (no extra app sidebar) with details', () => {
    const html = render(success([ROSTER, RECORDS]), '/teacher/reports?tab=attendance&av=classroom&ac=c1&ap=semester')
    expect(html).toContain('aria-label="เลือกห้องเรียน"')
    expect(html).toContain('ทุกห้องเรียน')
    expect(html).toContain('aria-pressed="true"')
    expect(html).toContain('นักเรียนในห้อง')
    expect(html).not.toContain('<aside')
  })

  it('subject view asks for a subject; student view shows history and trend', () => {
    expect(render(success([ROSTER, RECORDS]), '/teacher/reports?tab=attendance&av=subject')).toContain('เลือกรายวิชาเพื่อดูสถิติการเข้าเรียนรายวิชา')
    const html = render(success([ROSTER, RECORDS]), '/teacher/reports?tab=attendance&av=student&astu=s2&ap=semester')
    expect(html).toContain('ประวัติการเช็คชื่อ (3 รายการ)')
    expect(html).toContain('แนวโน้มรายสัปดาห์')
  })

  it('loading: skeleton, never "no data"; error: message + retry', () => {
    const loading = render(LOADING)
    expect(loading).toContain('data-testid="attendance-report-loading"')
    expect(loading).not.toContain('ไม่พบนักเรียน')
    const error = render({ status: 'error', error: 'โหลดข้อมูลนานเกินไป' })
    expect(error).toContain('role="alert"')
    expect(error).toContain('ลองใหม่')
  })

  it('zero records: "ยังไม่มีข้อมูล", never 0% or 100%', () => {
    const html = render(success([ROSTER, []]))
    expect(html).toContain('ยังไม่มีข้อมูลการเช็คชื่อในช่วงที่เลือก')
    expect(html).not.toContain('100.0%')
  })
})

describe('A4 document, PDF and Word (same report object)', () => {
  it('HTML document: title, metadata, summary, classroom summary, student table, follow-up list, signature', () => {
    const { r, meta } = report()
    const html = renderToStaticMarkup(createElement(AttendanceReportDocument, { report: r, meta }))
    for (const text of ['รายงานสรุปการเข้าเรียนของนักเรียน', 'ครูผู้สอน ครูทดสอบ ใจดี', 'สรุปภาพรวม', 'สรุปรายห้องเรียน', 'ตารางการเข้าเรียนรายนักเรียน', 'นักเรียนที่ควรติดตาม', 'ผู้รายงาน', '(ครูทดสอบ ใจดี)', 'ตำแหน่ง ครูผู้สอน']) {
      expect(html).toContain(text)
    }
    expect(html).toContain('<thead>')
  })

  it('PDF definition: A4, embedded Thai font, repeating headers, rows not split, page numbers', () => {
    const { r, meta } = report()
    const def = buildAttendancePdfDefinition(r, meta)
    expect(def).toMatchObject({ pageSize: 'A4', pageOrientation: 'portrait', defaultStyle: { font: PDF_FONT } })
    const json = JSON.stringify(def.content)
    expect(json).toContain('"headerRows":1')
    expect(json).toContain('"dontBreakRows":true')
    expect(JSON.stringify((def.footer as (p: number, n: number) => unknown)(1, 2))).toContain('หน้า 1 / 2')
  })

  it('renders a real PDF with the Thai font embedded and text mapped', async () => {
    const { r, meta } = report()
    const pdfmake = (await import('pdfmake')).default as unknown as {
      addFonts: (f: unknown) => void
      setLocalAccessPolicy: (cb: (p: string) => boolean) => void
      setUrlAccessPolicy: (cb: (u: string) => boolean) => void
      createPdf: (d: unknown) => { getBuffer: () => Promise<Buffer> }
    }
    const fontDir = fileURLToPath(new URL('../../assets/fonts/sarabun/', import.meta.url))
    pdfmake.setLocalAccessPolicy((path) => path.startsWith(fontDir))
    pdfmake.setUrlAccessPolicy(() => false)
    pdfmake.addFonts({ [PDF_FONT]: { normal: `${fontDir}Sarabun-Regular.ttf`, bold: `${fontDir}Sarabun-Bold.ttf`, italics: `${fontDir}Sarabun-Regular.ttf`, bolditalics: `${fontDir}Sarabun-Bold.ttf` } })
    const pdf = (await pdfmake.createPdf(buildAttendancePdfDefinition(r, meta)).getBuffer()).toString('latin1')
    expect(pdf.startsWith('%PDF-')).toBe(true)
    expect(pdf).toContain('Sarabun')
    expect(pdf).toContain('/FontFile2')
    expect(pdf).toContain('/ToUnicode')
  }, 30_000)

  it('Word: real tables with repeating header rows, TH Sarabun New, A4, signature; student focus document', async () => {
    const { r, meta } = report()
    const xml = await (await JSZip.loadAsync(await Packer.toBuffer(buildAttendanceDocument(r, meta)))).file('word/document.xml')!.async('string')
    for (const text of ['รายงานสรุปการเข้าเรียนของนักเรียน', 'ตารางการเข้าเรียนรายนักเรียน', 'กัลยวรรณ ทองคำ', 'ผู้รายงาน']) expect(xml).toContain(text)
    expect(xml).toContain('<w:tblHeader/>')
    expect(xml).toContain('TH Sarabun New')
    expect(xml).toContain('w:w="11906"')
    const focus = report({ view: 'student', studentId: 's2' })
    const focusXml = await (await JSZip.loadAsync(await Packer.toBuffer(buildAttendanceDocument(focus.r, focus.meta)))).file('word/document.xml')!.async('string')
    expect(focusXml).toContain('ประวัติการเช็คชื่อ')
    expect(focusXml).not.toContain('ตารางการเข้าเรียนรายนักเรียน')
  })
})

describe('Reports page structure, routes and safety (source checks)', () => {
  const realPage = readSource('../../pages/teacher/reports/reports-page-real.tsx')
  const router = readSource('../../app/router.tsx')
  const sources = ['./attendance-report-model.ts', './attendance-report.tsx', './attendance-report-pdf.ts', './attendance-report-docx.ts', './attendance-report-exports.ts', './use-attendance-report-data.ts'].map(readSource)

  it('all four original tabs remain, in order, with their labels', () => {
    const labels = [...realPage.matchAll(/\{ key: '(\w+)', label: '([^']+)' \}/g)].map((m) => [m[1], m[2]])
    expect(labels).toEqual([
      ['attendance', 'สรุปการเข้าเรียน'],
      ['grades', 'สรุปคะแนน'],
      ['missing', 'งานค้างส่ง'],
      ['followup', 'นักเรียนที่ควรติดตาม'],
    ])
    expect(realPage).toContain('<AttendanceReport useData={useAttendanceReportData}')
    expect(realPage).toContain('<GradeSummaryReport filters={filters}')
    expect(realPage).toContain('<MissingAssignmentsReport useData={useMissingReportData}')
    expect(realPage).toContain('<FollowUpReport filters={filters}')
  })

  it('the grade summary keeps the shared filter bar and its own calculations', () => {
    expect(realPage).toContain("(activeTab === 'grades' || activeTab === 'followup') && <ReportFiltersBar")
    expect(readSource('../reports-real/grade-summary-report.tsx')).toContain('getGradeSummaryReport')
  })

  it('the follow-up tab shows its configurable criteria', () => {
    const followup = readSource('../reports-real/followup-report.tsx')
    expect(followup).toContain('FOLLOWUP_RULES.ABSENCE_THRESHOLD')
    expect(followup).toContain('FOLLOWUP_RULES.LOW_GRADE_PERCENTAGE_THRESHOLD')
  })

  it('print previews are teacher-only routes outside the app layout', () => {
    const block = router.slice(router.indexOf("path: '/teacher/reports/attendance/print'"), router.indexOf("path: '/teacher/reports/missing/print'"))
    expect(block).toContain('<ProtectedRoute>')
    expect(block).toContain('<AttendanceReportPrintPage />')
    expect(block).not.toContain('TeacherLayout')
  })

  it('batched RLS-scoped loaders, no service role, no uploads, no logging of student data; demo never touches Supabase', () => {
    const hook = readSource('./use-attendance-report-data.ts')
    expect(hook).toContain('supabaseAnalyticsLoaders.attendance(')
    expect(hook.slice(hook.indexOf('export function useAttendanceReportDataDemo'), hook.indexOf('/** Decided once'))).not.toMatch(/supabase/i)
    for (const source of sources) {
      expect(source).not.toMatch(/service_role|SERVICE_ROLE/)
      expect(source).not.toMatch(/\.upload\(|storage\.from/)
      expect(source).not.toMatch(/console\.(log|info|debug)/)
    }
  })
})
