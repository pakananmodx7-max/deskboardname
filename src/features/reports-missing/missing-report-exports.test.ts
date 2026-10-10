import { fileURLToPath } from 'node:url'

import { Packer } from 'docx'
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'

import type { AnalyticsAssignmentData, AnalyticsRoster } from '@/features/classroom-analytics/analytics'

import { ASSIGNMENTS, CONTEXT, filters, ROSTER, SCOPE, TODAY } from './missing-report.fixtures'
import { buildMissingReportDocument } from './missing-report-docx'
import { buildMissingReport, buildReportMeta } from './missing-report-model'
import { buildMissingReportPdfDefinition, PDF_FONT, PDF_MARGIN, segmentWords } from './missing-report-pdf'

const meta = buildReportMeta({ context: CONTEXT, scope: SCOPE, filters: filters(), teacherName: 'ครูทดสอบ ใจดี', today: TODAY })
const report = buildMissingReport({ context: CONTEXT, scope: SCOPE, roster: ROSTER, assignments: ASSIGNMENTS, filters: filters(), today: TODAY })

/** A large class: 45 students × 12 assignments, all overdue — several pages. */
function bigReport() {
  const roster: AnalyticsRoster = { memberships: [], students: [] }
  for (let i = 1; i <= 45; i++) {
    roster.students.push({ id: `b${i}`, firstName: `นักเรียนทดสอบลำดับที่${i}`, lastName: 'นามสกุลยาวมากสำหรับทดสอบการตัดคำภาษาไทย', studentCode: `B${i}`, number: i, status: 'active' })
    roster.memberships.push({ studentId: `b${i}`, classroomId: i % 2 ? 'c1' : 'c2' })
  }
  const assignments: AnalyticsAssignmentData = { assignments: [], submissions: [] }
  for (let a = 1; a <= 12; a++) {
    for (const c of ['c1', 'c2']) assignments.assignments.push({ id: `${c}-a${a}`, classroomId: c, subjectId: 'hist', title: `ใบงานที่ ${a} เรื่องประวัติศาสตร์ไทยสมัยสุโขทัยและอยุธยา`, dueDate: '2026-09-01' })
  }
  return buildMissingReport({ context: CONTEXT, scope: SCOPE, roster, assignments, filters: filters(), today: TODAY })
}

async function renderPdf(definition: ReturnType<typeof buildMissingReportPdfDefinition>): Promise<string> {
  const pdfmake = (await import('pdfmake')).default as unknown as {
    addFonts: (f: unknown) => void
    setLocalAccessPolicy: (cb: (path: string) => boolean) => void
    setUrlAccessPolicy: (cb: (url: string) => boolean) => void
    createPdf: (d: unknown) => { getBuffer: () => Promise<Buffer> }
  }
  const fontDir = fileURLToPath(new URL('../../assets/fonts/sarabun/', import.meta.url))
  pdfmake.setLocalAccessPolicy((path) => path.startsWith(fontDir))
  pdfmake.setUrlAccessPolicy(() => false)
  pdfmake.addFonts({ [PDF_FONT]: { normal: `${fontDir}Sarabun-Regular.ttf`, bold: `${fontDir}Sarabun-Bold.ttf`, italics: `${fontDir}Sarabun-Regular.ttf`, bolditalics: `${fontDir}Sarabun-Bold.ttf` } })
  const buffer = await pdfmake.createPdf(definition).getBuffer()
  return buffer.toString('latin1')
}

describe('PDF export (real PDF via pdfmake, embedded Sarabun)', () => {
  it('definition: A4 portrait, 20 mm margins, page numbers, repeating table header, rows never split', () => {
    const def = buildMissingReportPdfDefinition(report, meta)
    expect(def.pageSize).toBe('A4')
    expect(def.pageOrientation).toBe('portrait')
    expect(def.pageMargins).toEqual([PDF_MARGIN, PDF_MARGIN, PDF_MARGIN, PDF_MARGIN])
    expect(Math.round(PDF_MARGIN * 100) / 100).toBe(56.69)
    expect(def.defaultStyle).toMatchObject({ font: 'Sarabun' })
    expect(JSON.stringify((def.footer as (p: number, n: number) => unknown)(2, 5))).toContain('หน้า 2 / 5')
    const json = JSON.stringify(def.content)
    expect(json).toContain('"headerRows":1')
    expect(json).toContain('"dontBreakRows":true')
    expect(json).toContain('"unbreakable":true')
  })

  it('definition uses the same numbers and details as the report; signature uses the teacher name', () => {
    const json = JSON.stringify(buildMissingReportPdfDefinition(report, meta).content)
    const plain = json.replace(/"\},\{"text":"/g, '') // join segmented Thai words
    expect(plain).toContain(`${report.summary.totalStudents} คน`)
    expect(plain).toContain(`${report.summary.overdue} รายการ`)
    expect(plain).toContain('ใบงานที่ 1 ยุคหิน')
    expect(plain).toContain('(ครูทดสอบ ใจดี)')
    expect(plain).toContain('ผู้รายงาน')
  })

  it('Thai text is split into words so lines can wrap (every character kept)', () => {
    const text = 'ใบงานที่ 3 ปัจจัยการเกิดรัฐไทย'
    const parts = segmentWords(text)
    expect(parts.length).toBeGreaterThan(3)
    expect(parts.join('')).toBe(text)
    expect(segmentWords('ABC 123')).toEqual(['ABC 123'])
    // Dates use non-breaking spaces and are never split.
    const dated = 'กำหนดส่ง 13\u00A0ก.ย.\u00A02569'
    expect(segmentWords(dated).some((p) => p.includes('13\u00A0ก.ย.\u00A02569'))).toBe(true)
  })

  it('renders a valid A4 PDF with the Thai font embedded and text mapped (selectable/searchable)', async () => {
    const pdf = await renderPdf(buildMissingReportPdfDefinition(report, meta))
    expect(pdf.startsWith('%PDF-')).toBe(true)
    expect(pdf).toMatch(/\/MediaBox \[0 0 595\.2[0-9]* 841\.8[0-9]*\]/)
    expect(pdf).toContain('Sarabun')
    expect(pdf).toContain('/FontFile2')
    expect(pdf).toContain('/ToUnicode')
  }, 30_000)

  it('a long report spans several pages', async () => {
    const big = bigReport()
    expect(big.students).toHaveLength(45)
    const pdf = await renderPdf(buildMissingReportPdfDefinition(big, meta))
    const pages = pdf.match(/\/Type \/Page\b/g)?.length ?? 0
    expect(pages).toBeGreaterThan(3)
  }, 60_000)

  it('empty report still renders (header, summary, signature)', async () => {
    const empty = buildMissingReport({ context: CONTEXT, scope: SCOPE, roster: ROSTER, assignments: { assignments: [], submissions: [] }, filters: filters(), today: TODAY })
    expect(JSON.stringify(buildMissingReportPdfDefinition(empty, meta).content).replace(/"\},\{"text":"/g, '')).toContain('ไม่มีงานค้างส่งตามเงื่อนไขที่เลือก')
    expect((await renderPdf(buildMissingReportPdfDefinition(empty, meta))).startsWith('%PDF-')).toBe(true)
  }, 30_000)
})

describe('Word export (.docx with real tables)', () => {
  async function documentXml(r = report) {
    const buffer = await Packer.toBuffer(buildMissingReportDocument(r, meta))
    const zip = await JSZip.loadAsync(buffer)
    return { xml: await zip.file('word/document.xml')!.async('string'), zip }
  }

  it('is a valid docx: A4 portrait, 20 mm margins, TH Sarabun New 16 pt, page-number footer', async () => {
    const { xml, zip } = await documentXml()
    expect(xml).toContain('w:w="11906"')
    expect(xml).toContain('w:h="16838"')
    expect(xml).toMatch(/w:top="1134"[^>]*w:right="1134"[^>]*w:bottom="1134"[^>]*w:left="1134"|w:left="1134"/)
    expect(xml).toContain('TH Sarabun New')
    const styles = await zip.file('word/styles.xml')!.async('string')
    expect(styles).toContain('w:val="32"')
    const footers = Object.keys(zip.files).filter((f) => f.startsWith('word/footer'))
    expect(footers.length).toBeGreaterThan(0)
    expect(await zip.file(footers[0])!.async('string')).toContain('PAGE')
  })

  it('contains title, metadata, summary, a real student table with a repeating header, details and the signature', async () => {
    const { xml } = await documentXml()
    for (const text of ['รายงานติดตามการส่งงานของนักเรียน', 'ระบบ KrunameClass', 'ครูผู้สอน ครูทดสอบ ใจดี', 'นักเรียนที่มีงานค้าง', 'ตารางสรุปนักเรียนที่มีงานค้างส่ง', 'กัลยวรรณ ทองคำ', 'ใบงานที่ 1 ยุคหิน', 'ขาดส่ง (เลยกำหนด 39 วัน)', 'ผู้รายงาน', 'ตำแหน่ง ครูผู้สอน']) {
      expect(xml).toContain(text)
    }
    expect(xml).toContain('<w:tbl>')
    expect(xml).toContain('<w:tblHeader/>')
    expect(xml).toContain('<w:cantSplit/>')
    // Two classrooms → classroom headings and subtotals.
    expect(xml).toContain('รวมห้อง ม.1/1')
  })

  it('no teacher name → blank signature line, never a fabricated name', async () => {
    const anonymous = buildMissingReportDocument(report, { ...meta, teacherName: null })
    const xml = await (await JSZip.loadAsync(await Packer.toBuffer(anonymous))).file('word/document.xml')!.async('string')
    expect(xml).toContain('(................................................)')
    expect(xml).not.toContain('ครูผู้สอน ครูทดสอบ')
  })
})
