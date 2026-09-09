import type { ExportTable } from '@/lib/export/export-table'
import type {
  AttendanceSummaryRow,
  FollowUpRow,
  GradeSummaryGroup,
  MissingAssignmentRow,
  ReportFilters,
} from '@/types/report'

function formatDateThai(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' })
}

/** Pure — the human-readable "which filters produced this" line shown
 * under every report's title and every export's subtitle, so a
 * downloaded file is never ambiguous about what it covers. */
export function buildFilterSubtitle(
  filters: ReportFilters,
  classroomName: string | null,
  subjectName: string | null,
): string {
  const classroomPart = classroomName ?? 'ทุกห้องเรียน'
  const subjectPart = subjectName ?? 'ทุกวิชา'
  return `${classroomPart} · ${subjectPart} · วันที่ ${formatDateThai(filters.startDate)} - ${formatDateThai(filters.endDate)}`
}

export function buildAttendanceExportTable(rows: AttendanceSummaryRow[], subtitle: string): ExportTable {
  return {
    title: 'รายงานสรุปการเข้าเรียน (Attendance Summary)',
    subtitle,
    headers: ['เลขที่', 'ชื่อ-นามสกุล', 'รหัสนักเรียน', 'ห้องเรียน', 'มา', 'สาย', 'ลา', 'ขาด', 'รวม', 'เปอร์เซ็นต์การเข้าเรียน'],
    rows: rows.map((r) => [
      r.number ?? '-',
      `${r.firstName} ${r.lastName}`,
      r.studentCode ?? '-',
      r.classroomName,
      r.present,
      r.late,
      r.leave,
      r.absent,
      r.total,
      r.attendanceRate !== null ? `${r.attendanceRate.toFixed(1)}%` : '-',
    ]),
  }
}

/** Long/"tidy" format — one row per (student, assignment) — chosen over
 * a wide student-by-assignment matrix because a Grade Summary can span
 * many subject+classroom groups, each with its own different set of
 * assignment columns; a single flat table can't represent that as a
 * wide matrix without ragged columns, but a long table always can. */
export function buildGradeExportTable(groups: GradeSummaryGroup[], subtitle: string): ExportTable {
  const rows: (string | number)[][] = []
  for (const group of groups) {
    for (const student of group.students) {
      for (const assignment of group.assignments) {
        const score = student.scoresByAssignment[assignment.assignmentId]
        rows.push([
          group.subjectName,
          group.classroomName,
          student.number ?? '-',
          `${student.firstName} ${student.lastName}`,
          assignment.title,
          assignment.maxScore,
          score ?? '-',
          student.totalEarned,
          student.totalPossible,
          student.percentage !== null ? `${student.percentage.toFixed(1)}%` : '-',
        ])
      }
    }
  }
  return {
    title: 'รายงานสรุปคะแนน (Grade Summary)',
    subtitle,
    headers: [
      'วิชา',
      'ห้องเรียน',
      'เลขที่',
      'ชื่อ-นามสกุล',
      'งาน',
      'คะแนนเต็ม',
      'คะแนนที่ได้',
      'คะแนนรวมที่ได้ (ทุกงาน)',
      'คะแนนรวมเต็ม (ทุกงาน)',
      'เปอร์เซ็นต์รวม',
    ],
    rows,
  }
}

export function buildMissingAssignmentExportTable(rows: MissingAssignmentRow[], subtitle: string): ExportTable {
  const statusLabel: Record<string, string> = {
    not_submitted: 'ยังไม่ส่ง',
    late: 'ส่งช้า',
    missing: 'ขาดส่ง',
  }
  return {
    title: 'รายงานงานที่ค้างส่ง (Missing Assignment Report)',
    subtitle,
    headers: ['เลขที่', 'ชื่อ-นามสกุล', 'ห้องเรียน', 'วิชา', 'งาน', 'กำหนดส่ง', 'สถานะ'],
    rows: rows.map((r) => [
      r.number ?? '-',
      `${r.firstName} ${r.lastName}`,
      r.classroomName,
      r.subjectName,
      r.assignmentTitle,
      r.dueDate ? formatDateThai(r.dueDate) : 'ไม่มีกำหนดส่ง',
      statusLabel[r.status] ?? r.status,
    ]),
  }
}

export function buildFollowUpExportTable(rows: FollowUpRow[], subtitle: string): ExportTable {
  return {
    title: 'รายงานนักเรียนที่ควรติดตาม (Student Follow-up Report)',
    subtitle,
    headers: ['เลขที่', 'ชื่อ-นามสกุล', 'ห้องเรียน', 'จำนวนเหตุผล', 'เหตุผล'],
    rows: rows.map((r) => [
      r.number ?? '-',
      `${r.firstName} ${r.lastName}`,
      r.classroomName,
      r.reasons.length,
      r.reasons.map((reason) => reason.label).join(' | '),
    ]),
  }
}
