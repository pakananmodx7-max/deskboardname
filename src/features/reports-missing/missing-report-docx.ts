import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Packer,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type IParagraphOptions,
} from 'docx'

import {
  formatThaiDate,
  obligationStatusText,
  studentDisplayName,
  type MissingReport,
  type MissingReportMeta,
} from './missing-report-model'

/**
 * Editable Word version of the A4 report — real Word tables and text,
 * never an image. Same report object as the screen and the PDF.
 *
 * Layout: A4 portrait (11906 × 16838 twips), 20 mm margins (1134 twips),
 * TH Sarabun New 16 pt (the standard Thai school-document font; Word
 * substitutes another Thai font if it is not installed — the text itself
 * is plain Unicode, never lossy). Table header rows repeat on every page
 * and rows never split across pages.
 */

export const DOCX_FONT = 'TH Sarabun New'
const SIZE = 32 // half-points → 16 pt
const MM_20 = 1134
const FONT = { ascii: DOCX_FONT, hAnsi: DOCX_FONT, cs: DOCX_FONT, eastAsia: DOCX_FONT }

function run(text: string, opts: { bold?: boolean; size?: number } = {}): TextRun {
  return new TextRun({ text, bold: opts.bold, boldComplexScript: opts.bold, font: FONT, size: opts.size ?? SIZE, sizeComplexScript: opts.size ?? SIZE })
}

function para(text: string, opts: Omit<IParagraphOptions, 'children' | 'text'> & { bold?: boolean; size?: number } = {}): Paragraph {
  const { bold, size, ...rest } = opts
  return new Paragraph({ spacing: { after: 0 }, ...rest, children: [run(text, { bold, size })] })
}

const THIN = { style: BorderStyle.SINGLE, size: 4, color: '000000' }
const BORDERS = { top: THIN, bottom: THIN, left: THIN, right: THIN }

function cell(text: string, opts: { bold?: boolean; header?: boolean; align?: (typeof AlignmentType)[keyof typeof AlignmentType]; width?: number; span?: number } = {}): TableCell {
  return new TableCell({
    borders: BORDERS,
    columnSpan: opts.span,
    width: opts.width ? { size: opts.width, type: WidthType.PERCENTAGE } : undefined,
    shading: opts.header ? { type: ShadingType.CLEAR, color: 'auto', fill: 'E7E7E7' } : undefined,
    margins: { left: 80, right: 80, top: 20, bottom: 20 },
    children: [para(text, { bold: opts.bold || opts.header, alignment: opts.align ?? AlignmentType.LEFT })],
  })
}

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

  children.push(
    para('', {}),
    para('', {}),
    para('ลงชื่อ ................................................ ผู้รายงาน', { alignment: AlignmentType.RIGHT, keepNext: true, keepLines: true }),
    para(meta.teacherName ? `(${meta.teacherName})` : '(................................................)', { alignment: AlignmentType.RIGHT, keepNext: true, keepLines: true }),
    para('ตำแหน่ง ครูผู้สอน', { alignment: AlignmentType.RIGHT }),
  )

  return new Document({
    creator: 'KrunameClass',
    title: meta.title,
    styles: { default: { document: { run: { font: FONT, size: SIZE, sizeComplexScript: SIZE } } } },
    sections: [
      {
        properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: MM_20, bottom: MM_20, left: MM_20, right: MM_20, footer: 567 } } },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [new TextRun({ font: FONT, size: 28, sizeComplexScript: 28, children: ['หน้า ', PageNumber.CURRENT, ' / ', PageNumber.TOTAL_PAGES] })],
              }),
            ],
          }),
        },
        children,
      },
    ],
  })
}

export async function buildMissingReportDocx(report: MissingReport, meta: MissingReportMeta): Promise<Blob> {
  return Packer.toBlob(buildMissingReportDocument(report, meta))
}
