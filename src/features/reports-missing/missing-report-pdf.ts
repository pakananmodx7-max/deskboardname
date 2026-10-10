import type { Content, TableCell, TDocumentDefinitions } from 'pdfmake/interfaces'

import { a4Document, bodyCell, createPdfBlob, GRID_LAYOUT, headerCell, keepTogether, ruleLine, signatureBlock, th } from '@/lib/export/thai-pdf'

import {
  formatThaiDate,
  obligationStatusText,
  studentDisplayName,
  type MissingReport,
  type MissingReportMeta,
} from './missing-report-model'

/**
 * Real PDF for the missing-assignment report (shared Thai PDF helpers:
 * src/lib/export/thai-pdf.ts): A4 portrait, 20 mm margins, embedded
 * Sarabun, Thai word wrapping, table headers repeat on every page, rows
 * never split, every page numbered.
 */

export { PDF_BODY_SIZE, PDF_FONT, PDF_MARGIN, segmentWords } from '@/lib/export/thai-pdf'

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
    ruleLine(),
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

  content.push(signatureBlock(meta.teacherName))

  return a4Document({ title: meta.title, content })
}

export async function createMissingReportPdfBlob(report: MissingReport, meta: MissingReportMeta): Promise<Blob> {
  return createPdfBlob(buildMissingReportPdfDefinition(report, meta))
}
