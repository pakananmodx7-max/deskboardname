import type { Content, TableCell, TDocumentDefinitions } from 'pdfmake/interfaces'

import { formatThaiDate } from '@/features/reports-missing/missing-report-model'
import { a4Document, bodyCell, createPdfBlob, GRID_LAYOUT, headerCell, ruleLine, signatureBlock, th } from '@/lib/export/thai-pdf'

import { attendanceMetaLines, BAND_LABEL, formatRate, STATUS_LABEL, type AttendanceReport, type AttendanceReportMeta, type StudentAttendanceRow } from './attendance-report-model'

/**
 * Real PDF of the attendance report (shared Thai PDF helpers): A4 portrait,
 * 20 mm margins, embedded Sarabun, Thai word wrapping, repeating table
 * headers, rows never split, page numbers. 11 pt keeps the ten-column
 * student table readable on portrait paper (≈ TH Sarabun New 15 pt).
 */

const BODY_SIZE = 11

function summaryTable(report: AttendanceReport): Content {
  const s = report.summary
  const pct = (n: number) => (s.total > 0 ? ` (${((n / s.total) * 100).toFixed(1)}%)` : '')
  return {
    table: {
      widths: ['*', '*', '*', '*', '*'],
      body: [
        ['นักเรียนทั้งหมด', 'มาเรียน', 'มาสาย', 'ลา', 'ขาดเรียน'].map((h) => headerCell(h)),
        [`${s.uniqueStudents} คน`, `${s.present} ครั้ง${pct(s.present)}`, `${s.late} ครั้ง${pct(s.late)}`, `${s.leave} ครั้ง${pct(s.leave)}`, `${s.absent} ครั้ง${pct(s.absent)}`].map((v) =>
          bodyCell(v, { alignment: 'center', bold: true }),
        ),
      ],
    },
    layout: GRID_LAYOUT,
  }
}

const STUDENT_HEADERS = ['เลขที่', 'ชื่อ–นามสกุล', 'ห้องเรียน', 'มา', 'สาย', 'ลา', 'ขาด', 'รวม', 'ร้อยละ', 'สถานะ']

function studentRow(r: StudentAttendanceRow): TableCell[] {
  return [
    bodyCell(r.number === null ? '-' : String(r.number), { alignment: 'center' }),
    bodyCell(`${r.firstName} ${r.lastName}${r.followUp ? ' *' : ''}`),
    bodyCell(r.classroomNames.join(', '), { alignment: 'center' }),
    bodyCell(String(r.present), { alignment: 'center' }),
    bodyCell(String(r.late), { alignment: 'center' }),
    bodyCell(String(r.leave), { alignment: 'center' }),
    bodyCell(String(r.absent), { alignment: 'center' }),
    bodyCell(String(r.total), { alignment: 'center', bold: true }),
    bodyCell(r.rate === null ? '-' : `${r.rate.toFixed(1)}%`, { alignment: 'center' }),
    bodyCell(BAND_LABEL[r.band], { alignment: 'center' }),
  ]
}

function fullReportContent(report: AttendanceReport): Content[] {
  const content: Content[] = []
  if (report.classrooms.length > 1 && !report.classroomDetail) {
    content.push(th('สรุปรายห้องเรียน', { bold: true, margin: [0, 10, 0, 4] }), {
      table: {
        headerRows: 1,
        dontBreakRows: true,
        widths: ['*', 50, 50, 60, 60, 60],
        body: [
          ['ห้องเรียน', 'นักเรียน', 'ครั้งที่เช็ค', 'รายการเช็คชื่อ', '% มาเรียน', 'ควรติดตาม'].map((h, i) => headerCell(h, i === 0 ? 'left' : 'center')),
          ...report.classrooms.map((c) => [
            bodyCell(c.classroomName),
            bodyCell(`${c.students} คน`, { alignment: 'center' }),
            bodyCell(String(c.sessions), { alignment: 'center' }),
            bodyCell(String(c.total), { alignment: 'center' }),
            bodyCell(formatRate(c.rate), { alignment: 'center' }),
            bodyCell(`${c.followUpCount} คน`, { alignment: 'center' }),
          ]),
        ],
      },
      layout: GRID_LAYOUT,
    })
  }
  if (report.classroomDetail) {
    const c = report.classroomDetail
    content.push(
      th(`ห้อง ${c.classroomName}: นักเรียน ${c.students} คน · เช็คชื่อ ${c.sessions} ครั้ง · มาเรียนเฉลี่ย ${formatRate(c.rate)} · ควรติดตาม ${c.followUpCount} คน`, { margin: [0, 8, 0, 0] }),
    )
  }
  content.push(th('ตารางการเข้าเรียนรายนักเรียน', { bold: true, margin: [0, 12, 0, 4] }))
  if (report.students.length === 0) {
    content.push(th('ไม่มีนักเรียนตามเงื่อนไขที่เลือก', { alignment: 'center', margin: [0, 8, 0, 8] }))
  } else {
    content.push({
      table: {
        headerRows: 1,
        dontBreakRows: true,
        keepWithHeaderRows: 1,
        widths: [26, '*', 44, 24, 24, 24, 24, 26, 40, 62],
        body: [STUDENT_HEADERS.map((h, i) => headerCell(h, i === 1 ? 'left' : 'center')), ...report.students.map(studentRow)],
      },
      layout: GRID_LAYOUT,
    })
    const flagged = report.students.filter((r) => r.followUp)
    content.push(th('* นักเรียนที่ควรติดตาม (ตัวบ่งชี้สำหรับครู ไม่ใช่การตัดสินผลการเรียน)', { fontSize: 9, margin: [0, 2, 0, 0] }))
    if (flagged.length) {
      content.push(th('นักเรียนที่ควรติดตาม', { bold: true, margin: [0, 12, 0, 2] }))
      for (const r of flagged) content.push(th(`เลขที่ ${r.number ?? '-'} ${r.firstName} ${r.lastName} (${r.classroomNames.join(', ')}) — ${r.followUpReasons.join(' · ')}`, { margin: [10, 0, 0, 0] }))
    }
  }
  return content
}

function studentFocusContent(report: AttendanceReport): Content[] {
  const detail = report.student!
  const r = detail.row
  return [
    th(`นักเรียน: เลขที่ ${r.number ?? '-'} ${r.firstName} ${r.lastName} · ห้อง ${r.classroomNames.join(', ')}`, { bold: true, margin: [0, 10, 0, 2] }),
    th(`มาเรียน ${r.present} · มาสาย ${r.late} · ลา ${r.leave} · ขาดเรียน ${r.absent} · รวม ${r.total} รายการ · ร้อยละการมาเรียน ${formatRate(r.rate)} (${BAND_LABEL[r.band]})`),
    ...(r.followUp ? [th(`ควรติดตาม: ${r.followUpReasons.join(' · ')}`)] : []),
    th('ประวัติการเช็คชื่อ', { bold: true, margin: [0, 12, 0, 4] }),
    detail.history.length === 0
      ? th('ยังไม่มีบันทึกการเช็คชื่อในช่วงที่เลือก', { alignment: 'center' })
      : {
          table: {
            headerRows: 1,
            dontBreakRows: true,
            widths: [90, '*', 80, 70],
            body: [
              ['วันที่', 'รายวิชา', 'ห้องเรียน', 'สถานะ'].map((h, i) => headerCell(h, i === 1 ? 'left' : 'center')),
              ...detail.history.map((h) => [
                bodyCell(formatThaiDate(h.date), { alignment: 'center' }),
                bodyCell(h.subjectName ?? 'เช็คชื่อประจำวัน'),
                bodyCell(h.classroomName, { alignment: 'center' }),
                bodyCell(STATUS_LABEL[h.status], { alignment: 'center' }),
              ]),
            ],
          },
          layout: GRID_LAYOUT,
        },
  ]
}

export function buildAttendancePdfDefinition(report: AttendanceReport, meta: AttendanceReportMeta): TDocumentDefinitions {
  const s = report.summary
  const content: Content[] = [
    th(meta.title, { fontSize: 16, bold: true, alignment: 'center' }),
    th(meta.subtitle, { alignment: 'center' }),
    ...attendanceMetaLines(meta).map((line) => th(line, { alignment: 'center' })),
    ruleLine(),
    th('สรุปภาพรวม', { bold: true, margin: [0, 0, 0, 4] }),
    summaryTable(report),
    th(
      `นักเรียนนับเป็นคน (ไม่นับซ้ำ) · สถานะนับเป็นรายการเช็คชื่อ (ครั้ง) · ร้อยละคิดจากรายการเช็คชื่อทั้งหมด ${s.total} รายการ จากการเช็คชื่อ ${s.sessions} ครั้ง · ร้อยละการมาเรียนรวม ${formatRate(s.rate)}`,
      { fontSize: 9, margin: [0, 2, 0, 0] },
    ),
    ...(report.student ? studentFocusContent(report) : fullReportContent(report)),
    signatureBlock(meta.teacherName),
  ]
  return a4Document({ title: meta.title, fontSize: BODY_SIZE, content })
}

export async function createAttendancePdfBlob(report: AttendanceReport, meta: AttendanceReportMeta): Promise<Blob> {
  return createPdfBlob(buildAttendancePdfDefinition(report, meta))
}
