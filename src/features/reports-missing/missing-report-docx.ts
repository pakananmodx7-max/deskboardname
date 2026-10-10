import { Packer, Table, TableRow, WidthType, type Document, type Paragraph } from 'docx'

import { a4WordDocument, AlignmentType, cell, para, signatureParagraphs } from '@/lib/export/thai-docx'

import {
  formatThaiDate,
  obligationStatusText,
  studentDisplayName,
  type MissingReport,
  type MissingReportMeta,
} from './missing-report-model'

/**
 * Editable Word version of the A4 missing-assignment report — real Word
 * tables and text (shared helpers: src/lib/export/thai-docx.ts). Table
 * header rows repeat on every page and rows never split across pages.
 */

export { DOCX_FONT } from '@/lib/export/thai-docx'

const COLS = [10, 38, 16, 12, 12, 12]

function summaryTable(report: MissingReport): Table {
  const s = report.summary
  const items: [string, string][] = [
    ['นักเรียนทั้งหมด', `${s.totalStudents} คน`],
    ['นักเรียนที่มีงานค้าง', `${s.studentsWithMissing} คน`],
    ['งานที่ยังไม่ส่ง', `${s.pending} รายการ`],
    ['งานที่ขาดส่ง', `${s.overdue} รายการ`],
  ]
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ cantSplit: true, children: items.map(([label]) => cell(label, { header: true, align: AlignmentType.CENTER, width: 25 })) }),
      new TableRow({ cantSplit: true, children: items.map(([, value]) => cell(value, { bold: true, align: AlignmentType.CENTER, width: 25 })) }),
    ],
  })
}

function studentTable(report: MissingReport): Table {
  const multi = report.groups.length > 1
  const header = new TableRow({
    tableHeader: true,
    cantSplit: true,
    children: ['เลขที่', 'ชื่อ–นามสกุล', 'ห้องเรียน', 'ยังไม่ส่ง', 'ขาดส่ง', 'รวม'].map((h, i) => cell(h, { header: true, align: i === 1 ? AlignmentType.LEFT : AlignmentType.CENTER, width: COLS[i] })),
  })
  const rows: TableRow[] = [header]
  for (const group of report.groups) {
    if (multi) rows.push(new TableRow({ cantSplit: true, children: [cell(`ห้อง ${group.classroomName}`, { bold: true, span: 6 })] }))
    for (const s of group.students) {
      rows.push(
        new TableRow({
          cantSplit: true,
          children: [
            cell(s.number === null ? '-' : String(s.number), { align: AlignmentType.CENTER }),
            cell(studentDisplayName(s)),
            cell(group.classroomName, { align: AlignmentType.CENTER }),
            cell(String(s.pending), { align: AlignmentType.CENTER }),
            cell(String(s.overdue), { align: AlignmentType.CENTER }),
            cell(String(s.total), { align: AlignmentType.CENTER, bold: true }),
          ],
        }),
      )
    }
    if (multi) {
      rows.push(
        new TableRow({
          cantSplit: true,
          children: [
            cell(`รวมห้อง ${group.classroomName} (${group.subtotal.students} คน)`, { bold: true, span: 3 }),
            cell(String(group.subtotal.pending), { bold: true, align: AlignmentType.CENTER }),
            cell(String(group.subtotal.overdue), { bold: true, align: AlignmentType.CENTER }),
            cell(String(group.subtotal.total), { bold: true, align: AlignmentType.CENTER }),
          ],
        }),
      )
    }
  }
  const s = report.summary
  rows.push(
    new TableRow({
      cantSplit: true,
      children: [
        cell(`รวมทั้งหมด (${s.studentsWithMissing} คน)`, { bold: true, span: 3 }),
        cell(String(s.pending), { bold: true, align: AlignmentType.CENTER }),
        cell(String(s.overdue), { bold: true, align: AlignmentType.CENTER }),
        cell(String(s.totalObligations), { bold: true, align: AlignmentType.CENTER }),
      ],
    }),
  )
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows })
}

function detailParagraphs(report: MissingReport): Paragraph[] {
  const out: Paragraph[] = []
  const multi = report.groups.length > 1
  for (const group of report.groups) {
    for (const s of group.students) {
      // keepNext chains the heading and all items so a student's block
      // stays on one page where possible.
      out.push(para(`เลขที่ ${s.number ?? '-'} — ${studentDisplayName(s)}${multi ? ` (ห้อง ${group.classroomName})` : ''}`, { bold: true, keepNext: true, keepLines: true, spacing: { before: 120, after: 0 } }))
      s.obligations.forEach((o, i) => {
        const due = o.dueDate ? ` · กำหนดส่ง ${formatThaiDate(o.dueDate)}` : ' · ไม่มีกำหนดส่ง'
        out.push(
          para(`${i + 1}. ${o.assignmentTitle} (${o.subjectName}) — ${obligationStatusText(o)}${o.status === 'no_due' ? '' : due}`, {
            indent: { left: 360 },
            keepNext: i < s.obligations.length - 1,
            keepLines: true,
          }),
        )
      })
    }
  }
  return out
}

export function buildMissingReportDocument(report: MissingReport, meta: MissingReportMeta): Document {
  const metaLines = [
    meta.schoolName,
    meta.teacherName ? `ครูผู้สอน ${meta.teacherName}` : null,
    `ห้องเรียน ${meta.classroomLabel} | รายวิชา ${meta.subjectLabel}`,
    `${meta.semesterLabel} | ${meta.periodLabel}`,
    meta.statusLabel !== 'งานค้างทั้งหมด' || meta.searchLabel ? [meta.statusLabel, meta.searchLabel].filter(Boolean).join(' | ') : null,
    `วันที่จัดทำรายงาน ${formatThaiDate(meta.generatedOn, 'long')}`,
  ].filter((line): line is string => Boolean(line))

  const children: (Paragraph | Table)[] = [
    para(meta.title, { bold: true, size: 40, alignment: AlignmentType.CENTER }),
    para(meta.subtitle, { alignment: AlignmentType.CENTER }),
    ...metaLines.map((line) => para(line, { alignment: AlignmentType.CENTER })),
    para('', {}),
    para('สรุปภาพรวม', { bold: true, keepNext: true }),
    summaryTable(report),
    para('หมายเหตุ: นักเรียนนับเป็นคน งานนับเป็นรายการ (นักเรียน × งาน) · “ส่งช้า” นับว่าส่งแล้ว', { size: 26 }),
    para('', {}),
  ]

  if (report.students.length === 0) {
    children.push(para('ไม่มีงานค้างส่งตามเงื่อนไขที่เลือก', { alignment: AlignmentType.CENTER }))
  } else {
    children.push(para('ตารางสรุปนักเรียนที่มีงานค้างส่ง', { bold: true, keepNext: true }), studentTable(report), para('', {}))
    children.push(para('รายละเอียดงานค้างส่ง', { bold: true, keepNext: true }), ...detailParagraphs(report))
  }

  children.push(...signatureParagraphs(meta.teacherName))

  return a4WordDocument({ title: meta.title, children })
}

export async function buildMissingReportDocx(report: MissingReport, meta: MissingReportMeta): Promise<Blob> {
  return Packer.toBlob(buildMissingReportDocument(report, meta))
}
