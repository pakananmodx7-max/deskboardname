import type { Content, TableCell, TDocumentDefinitions } from 'pdfmake/interfaces'

import sarabunBoldUrl from '@/assets/fonts/sarabun/Sarabun-Bold.ttf?url'
import sarabunRegularUrl from '@/assets/fonts/sarabun/Sarabun-Regular.ttf?url'

import {
  formatThaiDate,
  obligationStatusText,
  studentDisplayName,
  type MissingReport,
  type MissingReportMeta,
} from './missing-report-model'

/**
 * Real PDF for the missing-assignment report (not a screenshot): text is
 * selectable and searchable, the Thai font is embedded, pages are A4
 * portrait with 20 mm margins, table headers repeat on every page, rows
 * never split, and every page is numbered.
 *
 * Font: Sarabun (SIL Open Font License, see src/assets/fonts/sarabun/
 * OFL.txt) — the open release of the TH Sarabun design, freely
 * embeddable. Sarabun is drawn larger than TH Sarabun New, so 12 pt here
 * reads like TH Sarabun New 16 pt (the Word export uses TH Sarabun New
 * 16 pt itself).
 *
 * Thai has no spaces between words, so text is split into words with
 * Intl.Segmenter and handed to pdfmake as separate pieces — that is what
 * lets long Thai lines wrap at word boundaries instead of overflowing.
 */

export const PDF_FONT = 'Sarabun'
export const PDF_BODY_SIZE = 12
/** 20 mm in PDF points. */
export const PDF_MARGIN = (20 / 25.4) * 72

const wordSegmenter: Intl.Segmenter | null = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter('th', { granularity: 'word' }) : null

/** Splits text into word pieces (keeps every character, in order). */
export function segmentWords(text: string): string[] {
  if (!wordSegmenter || !/[฀-๿]/.test(text)) return [text]
  const parts: string[] = []
  for (const { segment, isWordLike } of wordSegmenter.segment(text)) {
    const prev = parts[parts.length - 1]
    // Spaces/punctuation stay attached to the word before them (no line
    // may start with "." or a space), and nothing breaks after a
    // non-breaking space — so "13 ก.ย. 2569" stays whole.
    if (prev !== undefined && (!isWordLike || prev.endsWith('\u00A0'))) parts[parts.length - 1] = prev + segment
    else parts.push(segment)
  }
  return parts
}

/** Non-breaking spaces so a date ("13 ก.ย. 2569") never wraps mid-way. */
function keepTogether(text: string): string {
  return text.replace(/ /g, '\u00A0')
}

function th(text: string, style: Record<string, unknown> = {}): Content {
  const parts = segmentWords(text)
  return parts.length === 1 ? { text, ...style } : { text: parts.map((p) => ({ text: p })), ...style }
}

function headerCell(text: string, alignment: 'left' | 'center' = 'center'): TableCell {
  return { ...(th(text) as object), bold: true, fillColor: '#E7E7E7', alignment } as TableCell
}

function bodyCell(text: string, opts: { alignment?: 'left' | 'center'; bold?: boolean; colSpan?: number } = {}): TableCell {
  return { ...(th(text) as object), alignment: opts.alignment ?? 'left', bold: opts.bold, colSpan: opts.colSpan } as TableCell
}

/** Black-and-white friendly grid. */
const GRID_LAYOUT = {
  hLineWidth: () => 0.6,
  vLineWidth: () => 0.6,
  hLineColor: () => '#000000',
  vLineColor: () => '#000000',
  paddingLeft: () => 4,
  paddingRight: () => 4,
  paddingTop: () => 2,
  paddingBottom: () => 2,
}

function metaLines(meta: MissingReportMeta): string[] {
  return [
    meta.schoolName,
    meta.teacherName ? `ครูผู้สอน ${meta.teacherName}` : null,
    `ห้องเรียน ${meta.classroomLabel} | รายวิชา ${meta.subjectLabel}`,
    `${meta.semesterLabel} | ${meta.periodLabel}`,
    meta.statusLabel !== 'งานค้างทั้งหมด' || meta.searchLabel ? [meta.statusLabel, meta.searchLabel].filter(Boolean).join(' | ') : null,
    `วันที่จัดทำรายงาน ${formatThaiDate(meta.generatedOn, 'long')}`,
  ].filter((line): line is string => Boolean(line))
}

function studentTableBody(report: MissingReport): TableCell[][] {
  const multi = report.groups.length > 1
  const body: TableCell[][] = [['เลขที่', 'ชื่อ–นามสกุล', 'ห้องเรียน', 'ยังไม่ส่ง', 'ขาดส่ง', 'รวม'].map((h, i) => headerCell(h, i === 1 ? 'left' : 'center'))]
  for (const group of report.groups) {
    if (multi) body.push([bodyCell(`ห้อง ${group.classroomName}`, { bold: true, colSpan: 6 }), {}, {}, {}, {}, {}])
    for (const s of group.students) {
      body.push([
        bodyCell(s.number === null ? '-' : String(s.number), { alignment: 'center' }),
        bodyCell(studentDisplayName(s)),
        bodyCell(group.classroomName, { alignment: 'center' }),
        bodyCell(String(s.pending), { alignment: 'center' }),
        bodyCell(String(s.overdue), { alignment: 'center' }),
        bodyCell(String(s.total), { alignment: 'center', bold: true }),
      ])
    }
    if (multi) {
      body.push([
        bodyCell(`รวมห้อง ${group.classroomName} (${group.subtotal.students} คน)`, { bold: true, colSpan: 3 }),
        {},
        {},
        bodyCell(String(group.subtotal.pending), { alignment: 'center', bold: true }),
        bodyCell(String(group.subtotal.overdue), { alignment: 'center', bold: true }),
        bodyCell(String(group.subtotal.total), { alignment: 'center', bold: true }),
      ])
    }
  }
  const s = report.summary
  body.push([
    bodyCell(`รวมทั้งหมด (${s.studentsWithMissing} คน)`, { bold: true, colSpan: 3 }),
    {},
    {},
    bodyCell(String(s.pending), { alignment: 'center', bold: true }),
    bodyCell(String(s.overdue), { alignment: 'center', bold: true }),
    bodyCell(String(s.totalObligations), { alignment: 'center', bold: true }),
  ])
  return body
}

/** A student's block is kept on one page when it fits (a very long block
 * may still break rather than be cut off). */
const MAX_UNBREAKABLE_ITEMS = 25

function detailBlocks(report: MissingReport): Content[] {
  const multi = report.groups.length > 1
  const blocks: Content[] = []
  for (const group of report.groups) {
    for (const s of group.students) {
      blocks.push({
        unbreakable: s.obligations.length <= MAX_UNBREAKABLE_ITEMS,
        margin: [0, 6, 0, 0],
        stack: [
          th(`เลขที่ ${s.number ?? '-'} — ${studentDisplayName(s)}${multi ? ` (ห้อง ${group.classroomName})` : ''}`, { bold: true }),
          ...s.obligations.map((o, i) =>
            th(`${i + 1}. ${o.assignmentTitle} (${o.subjectName}) — ${obligationStatusText(o)}${o.status === 'no_due' ? '' : o.dueDate ? ` · กำหนดส่ง ${keepTogether(formatThaiDate(o.dueDate))}` : ''}`, { margin: [14, 0, 0, 0] }),
          ),
        ],
      })
    }
  }
  return blocks
}

export function buildMissingReportPdfDefinition(report: MissingReport, meta: MissingReportMeta): TDocumentDefinitions {
  const s = report.summary
  const summary: Content = {
    table: {
      widths: ['*', '*', '*', '*'],
      body: [
        ['นักเรียนทั้งหมด', 'นักเรียนที่มีงานค้าง', 'งานที่ยังไม่ส่ง', 'งานที่ขาดส่ง'].map((h) => headerCell(h)),
        [`${s.totalStudents} คน`, `${s.studentsWithMissing} คน`, `${s.pending} รายการ`, `${s.overdue} รายการ`].map((v) => bodyCell(v, { alignment: 'center', bold: true })),
      ],
    },
    layout: GRID_LAYOUT,
  }

  const content: Content[] = [
    th(meta.title, { fontSize: 16, bold: true, alignment: 'center' }),
    th(meta.subtitle, { alignment: 'center' }),
    ...metaLines(meta).map((line) => th(line, { alignment: 'center' })),
    { canvas: [{ type: 'line', x1: 0, y1: 6, x2: 595.28 - PDF_MARGIN * 2, y2: 6, lineWidth: 0.6 }], margin: [0, 0, 0, 10] },
    th('สรุปภาพรวม', { bold: true, margin: [0, 0, 0, 4] }),
    summary,
    th('หมายเหตุ: นักเรียนนับเป็นคน งานนับเป็นรายการ (นักเรียน × งาน) · “ส่งช้า” นับว่าส่งแล้ว', { fontSize: 10, margin: [0, 2, 0, 10] }),
  ]

  if (report.students.length === 0) {
    content.push(th('ไม่มีงานค้างส่งตามเงื่อนไขที่เลือก', { alignment: 'center', margin: [0, 10, 0, 10] }))
  } else {
    content.push(
      th('ตารางสรุปนักเรียนที่มีงานค้างส่ง', { bold: true, margin: [0, 0, 0, 4] }),
      {
        table: { headerRows: 1, dontBreakRows: true, keepWithHeaderRows: 1, widths: [34, '*', 70, 50, 50, 40], body: studentTableBody(report) },
        layout: GRID_LAYOUT,
      },
      th('รายละเอียดงานค้างส่ง', { bold: true, margin: [0, 14, 0, 0] }),
      ...detailBlocks(report),
    )
  }

  content.push({
    unbreakable: true,
    margin: [0, 36, 0, 0],
    columns: [
      { width: '*', text: '' },
      {
        width: 'auto',
        alignment: 'center',
        stack: [
          th('ลงชื่อ ................................................ ผู้รายงาน'),
          th(meta.teacherName ? `(${meta.teacherName})` : '(................................................)', { margin: [0, 6, 0, 0] }),
          th('ตำแหน่ง ครูผู้สอน', { margin: [0, 6, 0, 0] }),
        ],
      },
    ],
  })

  return {
    pageSize: 'A4',
    pageOrientation: 'portrait',
    pageMargins: [PDF_MARGIN, PDF_MARGIN, PDF_MARGIN, PDF_MARGIN],
    info: { title: meta.title, creator: 'KrunameClass', producer: 'KrunameClass' },
    defaultStyle: { font: PDF_FONT, fontSize: PDF_BODY_SIZE, lineHeight: 1.15 },
    footer: (currentPage: number, pageCount: number) => ({ text: `หน้า ${currentPage} / ${pageCount}`, alignment: 'center', fontSize: 10, margin: [0, 24, 0, 0] }),
    content,
  }
}

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  return btoa(binary)
}

async function fetchFont(url: string): Promise<string> {
  const response = await fetch(url)
  if (!response.ok) throw new Error('โหลดฟอนต์สำหรับ PDF ไม่สำเร็จ')
  return toBase64(await response.arrayBuffer())
}

interface PdfMakeApi {
  addVirtualFileSystem: (vfs: Record<string, string>) => void
  addFonts: (fonts: Record<string, Record<string, string>>) => void
  setUrlAccessPolicy: (callback: (url: string) => boolean) => void
  createPdf: (definition: TDocumentDefinitions) => { getBlob: () => Promise<Blob> }
}

let pdfMakeReady: Promise<PdfMakeApi> | null = null

async function loadPdfMake(): Promise<PdfMakeApi> {
  pdfMakeReady ??= (async () => {
    const mod = (await import('pdfmake/build/pdfmake')) as unknown as { default?: { default?: PdfMakeApi } & PdfMakeApi } & PdfMakeApi
    const pdfMake = (mod.default?.default ?? mod.default ?? mod) as PdfMakeApi
    const [regular, bold] = await Promise.all([fetchFont(sarabunRegularUrl), fetchFont(sarabunBoldUrl)])
    pdfMake.addVirtualFileSystem({ 'Sarabun-Regular.ttf': regular, 'Sarabun-Bold.ttf': bold })
    pdfMake.addFonts({ [PDF_FONT]: { normal: 'Sarabun-Regular.ttf', bold: 'Sarabun-Bold.ttf', italics: 'Sarabun-Regular.ttf', bolditalics: 'Sarabun-Bold.ttf' } })
    // The report never loads remote resources (no images/URLs).
    pdfMake.setUrlAccessPolicy(() => false)
    return pdfMake
  })().catch((err: unknown) => {
    pdfMakeReady = null
    throw err
  })
  return pdfMakeReady
}

export async function createMissingReportPdfBlob(report: MissingReport, meta: MissingReportMeta): Promise<Blob> {
  const pdfMake = await loadPdfMake()
  return pdfMake.createPdf(buildMissingReportPdfDefinition(report, meta)).getBlob()
}
