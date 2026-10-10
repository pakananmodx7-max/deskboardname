import { Packer, Table, TableRow, WidthType, type Document, type Paragraph } from 'docx'

import { formatThaiDate } from '@/features/reports-missing/missing-report-model'
import { a4WordDocument, AlignmentType, cell, para, signatureParagraphs } from '@/lib/export/thai-docx'

import { attendanceMetaLines, BAND_LABEL, formatRate, STATUS_LABEL, type AttendanceReport, type AttendanceReportMeta } from './attendance-report-model'

/**
 * Editable Word version of the attendance report — real Word tables
 * (shared helpers: src/lib/export/thai-docx.ts), A4 portrait, 20 mm
 * margins, TH Sarabun New, repeating header rows, page numbers. Table text
 * is 14 pt so the ten-column student table fits portrait paper.
 */

const TABLE_SIZE = 28

function table(headers: string[], rows: string[][], widths: number[], leftCols: number[] = [1]): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ tableHeader: true, cantSplit: true, children: headers.map((h, i) => cell(h, { header: true, width: widths[i], size: TABLE_SIZE, align: leftCols.includes(i) ? AlignmentType.LEFT : AlignmentType.CENTER })) }),
      ...rows.map((row) => new TableRow({ cantSplit: true, children: row.map((v, i) => cell(v, { width: widths[i], size: TABLE_SIZE, align: leftCols.includes(i) ? AlignmentType.LEFT : AlignmentType.CENTER })) })),
    ],
  })
}

export function buildAttendanceDocument(report: AttendanceReport, meta: AttendanceReportMeta): Document {
  const s = report.summary
  const pct = (n: number) => (s.total > 0 ? ` (${((n / s.total) * 100).toFixed(1)}%)` : '')
  const children: (Paragraph | Table)[] = [
    para(meta.title, { bold: true, size: 40, alignment: AlignmentType.CENTER }),
    para(meta.subtitle, { alignment: AlignmentType.CENTER }),
    ...attendanceMetaLines(meta).map((line) => para(line, { alignment: AlignmentType.CENTER })),
    para('', {}),
    para('สรุปภาพรวม', { bold: true, keepNext: true }),
    table(
      ['นักเรียนทั้งหมด', 'มาเรียน', 'มาสาย', 'ลา', 'ขาดเรียน'],
      [[`${s.uniqueStudents} คน`, `${s.present} ครั้ง${pct(s.present)}`, `${s.late} ครั้ง${pct(s.late)}`, `${s.leave} ครั้ง${pct(s.leave)}`, `${s.absent} ครั้ง${pct(s.absent)}`]],
      [20, 20, 20, 20, 20],
      [],
    ),
    para(`นักเรียนนับเป็นคน (ไม่นับซ้ำ) · สถานะนับเป็นรายการเช็คชื่อ (ครั้ง) · ร้อยละคิดจากรายการเช็คชื่อทั้งหมด ${s.total} รายการ จากการเช็คชื่อ ${s.sessions} ครั้ง · ร้อยละการมาเรียนรวม ${formatRate(s.rate)}`, { size: 24 }),
  ]

  if (report.student) {
    const r = report.student.row
    children.push(
      para('', {}),
      para(`นักเรียน: เลขที่ ${r.number ?? '-'} ${r.firstName} ${r.lastName} · ห้อง ${r.classroomNames.join(', ')}`, { bold: true }),
      para(`มาเรียน ${r.present} · มาสาย ${r.late} · ลา ${r.leave} · ขาดเรียน ${r.absent} · รวม ${r.total} รายการ · ร้อยละการมาเรียน ${formatRate(r.rate)} (${BAND_LABEL[r.band]})`),
      ...(r.followUp ? [para(`ควรติดตาม: ${r.followUpReasons.join(' · ')}`)] : []),
      para('', {}),
      para('ประวัติการเช็คชื่อ', { bold: true, keepNext: true }),
      report.student.history.length
        ? table(
            ['วันที่', 'รายวิชา', 'ห้องเรียน', 'สถานะ'],
            report.student.history.map((h) => [formatThaiDate(h.date), h.subjectName ?? 'เช็คชื่อประจำวัน', h.classroomName, STATUS_LABEL[h.status]]),
            [20, 45, 17, 18],
          )
        : para('ยังไม่มีบันทึกการเช็คชื่อในช่วงที่เลือก', { alignment: AlignmentType.CENTER }),
    )
  } else {
    if (report.classrooms.length > 1 && !report.classroomDetail) {
      children.push(
        para('', {}),
        para('สรุปรายห้องเรียน', { bold: true, keepNext: true }),
        table(
          ['ห้องเรียน', 'นักเรียน', 'ครั้งที่เช็ค', 'รายการเช็คชื่อ', '% มาเรียน', 'ควรติดตาม'],
          report.classrooms.map((c) => [c.classroomName, `${c.students} คน`, String(c.sessions), String(c.total), formatRate(c.rate), `${c.followUpCount} คน`]),
          [30, 14, 14, 14, 14, 14],
          [0],
        ),
      )
    }
    if (report.classroomDetail) {
      const c = report.classroomDetail
      children.push(para(`ห้อง ${c.classroomName}: นักเรียน ${c.students} คน · เช็คชื่อ ${c.sessions} ครั้ง · มาเรียนเฉลี่ย ${formatRate(c.rate)} · ควรติดตาม ${c.followUpCount} คน`))
    }
    children.push(para('', {}), para('ตารางการเข้าเรียนรายนักเรียน', { bold: true, keepNext: true }))
    if (report.students.length === 0) {
      children.push(para('ไม่มีนักเรียนตามเงื่อนไขที่เลือก', { alignment: AlignmentType.CENTER }))
    } else {
      children.push(
        table(
          ['เลขที่', 'ชื่อ–นามสกุล', 'ห้องเรียน', 'มา', 'สาย', 'ลา', 'ขาด', 'รวม', 'ร้อยละ', 'สถานะ'],
          report.students.map((r) => [
            r.number === null ? '-' : String(r.number),
            `${r.firstName} ${r.lastName}${r.followUp ? ' *' : ''}`,
            r.classroomNames.join(', '),
            String(r.present),
            String(r.late),
            String(r.leave),
            String(r.absent),
            String(r.total),
            r.rate === null ? '-' : `${r.rate.toFixed(1)}%`,
            BAND_LABEL[r.band],
          ]),
          [7, 27, 10, 6, 6, 6, 6, 6, 10, 16],
        ),
        para('* นักเรียนที่ควรติดตาม (ตัวบ่งชี้สำหรับครู ไม่ใช่การตัดสินผลการเรียน)', { size: 24 }),
      )
      const flagged = report.students.filter((r) => r.followUp)
      if (flagged.length) {
        children.push(para('', {}), para('นักเรียนที่ควรติดตาม', { bold: true, keepNext: true }))
        for (const r of flagged) children.push(para(`เลขที่ ${r.number ?? '-'} ${r.firstName} ${r.lastName} (${r.classroomNames.join(', ')}) — ${r.followUpReasons.join(' · ')}`, { indent: { left: 360 } }))
      }
    }
  }

  children.push(...signatureParagraphs(meta.teacherName))
  return a4WordDocument({ title: meta.title, children })
}

export async function buildAttendanceDocx(report: AttendanceReport, meta: AttendanceReportMeta): Promise<Blob> {
  return Packer.toBlob(buildAttendanceDocument(report, meta))
}
