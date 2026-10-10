import { readFileSync } from 'node:fs'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import { ToastProvider } from '@/components/ui/toast'
import { listSemesterOptions, type AnalyticsAssignmentData, type AnalyticsRoster } from '@/features/classroom-analytics/analytics'
import { LOADING, success, type Resource } from '@/features/classroom-analytics/resource'
import { SemesterContext, type SemesterContextValue } from '@/features/semester/semester-store'

import { MissingAssignmentsReport } from './missing-assignments-report'
import { MissingReportDocument } from './missing-report-document'
import { ASSIGNMENTS, CONTEXT, filters, ROSTER, SCOPE, TODAY } from './missing-report.fixtures'
import { buildMissingReport, buildReportMeta } from './missing-report-model'

const noop = () => {}

function semester(overrides: Partial<SemesterContextValue> = {}): SemesterContextValue {
  return {
    context: success(CONTEXT),
    retryContext: noop,
    refreshContext: noop,
    options: listSemesterOptions(CONTEXT),
    semesterKey: SCOPE.key,
    scope: SCOPE,
    setSemester: noop,
    ...overrides,
  }
}

function render(data: Resource<[AnalyticsRoster, AnalyticsAssignmentData]>, url = '/teacher/reports?tab=missing', sem = semester()): string {
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      { initialEntries: [url] },
      createElement(ToastProvider, null, createElement(SemesterContext.Provider, { value: sem }, createElement(MissingAssignmentsReport, { useData: () => ({ data, refresh: noop }), teacherName: 'ครูทดสอบ' }))),
    ),
  )
}

function readSource(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf-8')
}

describe('งานค้างส่ง tab (rendered)', () => {
  it('loading: skeletons, never "no data" and never a 0', () => {
    const html = render(LOADING)
    expect(html).toContain('data-testid="missing-report-loading"')
    expect(html).not.toContain('ไม่มีงานค้างส่ง')
    expect(html).not.toMatch(/>0 <span/)
  })

  it('error: message and a retry button instead of endless loading', () => {
    const html = render({ status: 'error', error: 'โหลดข้อมูลนานเกินไป' })
    expect(html).toContain('role="alert"')
    expect(html).toContain('โหลดข้อมูลนานเกินไป')
    expect(html).toContain('ลองใหม่')
  })

  it('with data: four summary cards, one row per student, details collapsed by default', () => {
    const html = render(success([ROSTER, ASSIGNMENTS]))
    for (const label of ['นักเรียนทั้งหมด', 'นักเรียนที่มีงานค้าง', 'งานที่ยังไม่ส่ง', 'งานที่ขาดส่ง', 'รวมงานค้าง', 'ดูรายละเอียด']) expect(html).toContain(label)
    expect(html).toContain('นักเรียนที่มีงานค้างส่ง (3 คน)')
    expect(html.match(/กัลยวรรณ ทองคำ/g)).toHaveLength(1)
    expect(html).not.toContain('id="missing-detail-')
    expect(html).toContain('aria-expanded="false"')
  })

  it('filters come from the URL (and feed the print link)', () => {
    const html = render(success([ROSTER, ASSIGNMENTS]), '/teacher/reports?tab=missing&mc=c2&st=overdue')
    expect(html).toContain('นักเรียนที่มีงานค้างส่ง (1 คน)')
    expect(html).toContain('href="/teacher/reports/missing/print?mc=c2&amp;st=overdue"')
  })

  it('empty states distinguish "no missing work" from "no students match"', () => {
    expect(render(success([ROSTER, { assignments: [], submissions: [] }]))).toContain('ไม่มีงานค้างส่งตามตัวกรองที่เลือก')
    expect(render(success([ROSTER, ASSIGNMENTS]), '/teacher/reports?tab=missing&q=zzz')).toContain('ไม่พบนักเรียนตามตัวกรองที่เลือก')
  })

  it('a semester without classrooms says so', () => {
    const empty = { ...SCOPE, classrooms: [], classroomIds: new Set<string>(), subjects: [] }
    expect(render(success([ROSTER, ASSIGNMENTS]), undefined, semester({ scope: empty }))).toContain(`ยังไม่มีห้องเรียนใน${SCOPE.label}`)
  })
})

describe('A4 document (rendered)', () => {
  const report = buildMissingReport({ context: CONTEXT, scope: SCOPE, roster: ROSTER, assignments: ASSIGNMENTS, filters: filters(), today: TODAY })
  const meta = buildReportMeta({ context: CONTEXT, scope: SCOPE, filters: filters(), teacherName: 'ครูทดสอบ', today: TODAY })
  const html = renderToStaticMarkup(createElement(MissingReportDocument, { report, meta }))

  it('title, subtitle, metadata, summary, grouped table with subtotals, details and signature', () => {
    for (const text of ['รายงานติดตามการส่งงานของนักเรียน', 'ระบบ KrunameClass', 'ครูผู้สอน ครูทดสอบ', 'วันที่จัดทำรายงาน 10 ตุลาคม 2569', 'ตารางสรุปนักเรียนที่มีงานค้างส่ง', 'ห้อง ม.1/1', 'รวมห้อง ม.1/1', 'รวมทั้งหมด', 'รายละเอียดงานค้างส่ง', 'ใบงานที่ 1 ยุคหิน', 'ผู้รายงาน', '(ครูทดสอบ)', 'ตำแหน่ง ครูผู้สอน']) {
      expect(html).toContain(text)
    }
    expect(html).toContain('<thead>')
  })

  it('print CSS: A4 portrait, 20 mm margins, page numbers, repeated headers, no split rows/blocks, UI hidden', () => {
    const css = readSource('./missing-report-document-css.ts')
    expect(css).toContain('@page { size: A4 portrait; margin: 20mm;')
    expect(css).toContain("counter(page) ' / ' counter(pages)")
    expect(css).toContain('display: table-header-group')
    expect(css).toContain('.kc-doc tr { break-inside: avoid;')
    expect(css).toContain('.kc-doc .kc-student { break-inside: avoid;')
    expect(css).toContain('.kc-no-print { display: none !important; }')
  })
})

describe('wiring, security and modes (source checks)', () => {
  const router = readSource('../../app/router.tsx')
  const realPage = readSource('../../pages/teacher/reports/reports-page-real.tsx')
  const demoPage = readSource('../../pages/teacher/reports/reports-page-demo.tsx')
  const printPage = readSource('../../pages/teacher/reports/missing-report-print-page.tsx')
  const dataHook = readSource('./use-missing-report-data.ts')
  const sources = ['./missing-report-model.ts', './missing-report-pdf.ts', './missing-report-docx.ts', './missing-report-exports.ts', './use-missing-report-data.ts', './missing-assignments-report.tsx'].map(readSource)

  it('the existing Reports tabs are kept; งานค้างส่ง renders the redesigned report', () => {
    for (const label of ['สรุปการเข้าเรียน', 'สรุปคะแนน', 'งานค้างส่ง', 'นักเรียนที่ควรติดตาม']) expect(realPage).toContain(`label: '${label}'`)
    expect(realPage).toContain('<MissingAssignmentsReport useData={useMissingReportData}')
    expect(demoPage).toContain('<MissingAssignmentsReport useData={useMissingReportData}')
  })

  it('print preview is a teacher-only route (ProtectedRoute) outside the app layout', () => {
    const block = router.slice(router.indexOf("path: '/teacher/reports/missing/print'"), router.indexOf("path: '/teacher',"))
    expect(block).toContain('<ProtectedRoute>')
    expect(block).toContain('<MissingReportPrintPage />')
    expect(block).not.toContain('TeacherLayout')
    for (const action of ['กลับไปรายงาน', 'พิมพ์', 'ดาวน์โหลด PDF', 'ดาวน์โหลด Word', 'ดาวน์โหลด CSV']) expect(printPage).toContain(action)
  })

  it('real data goes through the batched, RLS-scoped analytics loaders — no per-assignment requests', () => {
    expect(dataHook).toContain('supabaseAnalyticsLoaders.roster(')
    expect(dataHook).toContain('supabaseAnalyticsLoaders.assignments(')
    expect(dataHook).not.toMatch(/getSubmissions|getStudentsByClassroom/)
  })

  it('no service-role key, no uploads of exported reports, no logging of student data', () => {
    for (const source of sources) {
      expect(source).not.toMatch(/service_role|SERVICE_ROLE/)
      expect(source).not.toMatch(/\.upload\(|storage\.from/)
      expect(source).not.toMatch(/console\.(log|info|debug)/)
    }
  })

  it('Demo Mode never touches Supabase', () => {
    const demoHook = dataHook.slice(dataHook.indexOf('export function useMissingReportDataDemo'))
    expect(demoHook).toContain('buildDemoAnalyticsDataset(')
    expect(demoHook).not.toMatch(/supabase/i)
  })

  it('the PDF font is the bundled OFL Sarabun (license shipped alongside)', () => {
    expect(readFileSync(new URL('../../assets/fonts/sarabun/OFL.txt', import.meta.url), 'utf-8')).toContain('SIL Open Font License')
  })
})
