import { ATTENDANCE_STATUS_LABEL } from '@/features/attendance/attendance-status'
import type { ExportTable } from '@/lib/export/export-table'
import type { AttendanceRecordWithSession } from '@/services/attendance-service'
import type { Assignment, AssignmentSubmission } from '@/types/assignment'
import type { AttendanceSession } from '@/types/attendance'
import type { ClassroomStudent } from '@/types/student'

/**
 * Google Sheets Integration, Section 2/9: a teacher-readable CSV of every
 * (student, assignment) score in this one subject+classroom, ready to
 * open in Excel or Google Sheets. Long/"tidy" format (one row per
 * student per assignment) — the same shape report-export-builders.ts
 * chose for its own Grade Summary export, for the same reason: a wide
 * student-by-assignment matrix can't represent a variable assignment
 * count as a flat table without ragged columns, but a long table always
 * can. `percentage` here is PER ASSIGNMENT (score/max_score), not the
 * student's overall total — this export is meant to be pasted/analyzed
 * per assignment in a spreadsheet, unlike the on-screen Grades tab's own
 * running total column.
 */
export function buildClassroomGradesExportTable(
  subjectName: string,
  classroomName: string,
  assignments: Assignment[],
  roster: ClassroomStudent[],
  submissionsByAssignment: Record<string, Record<string, AssignmentSubmission>>,
): ExportTable {
  const rows: (string | number)[][] = []

  for (const student of roster) {
    for (const assignment of assignments) {
      const score = submissionsByAssignment[assignment.id]?.[student.id]?.score ?? null
      const percentage = score !== null && assignment.maxScore > 0 ? `${((score / assignment.maxScore) * 100).toFixed(1)}%` : '-'
      rows.push([
        classroomName,
        student.number ?? '-',
        student.studentCode ?? '-',
        `${student.firstName} ${student.lastName}`,
        assignment.title,
        score ?? '-',
        assignment.maxScore,
        percentage,
      ])
    }
  }

  return {
    title: `คะแนน — ${subjectName}`,
    subtitle: `ห้องเรียน: ${classroomName} · วิชา: ${subjectName}`,
    headers: ['ห้องเรียน', 'เลขที่', 'รหัสนักเรียน', 'ชื่อ-นามสกุล', 'ชื่องาน', 'คะแนนที่ได้', 'คะแนนเต็ม', 'เปอร์เซ็นต์'],
    rows,
  }
}

/**
 * Google Sheets Integration, Section 3/9: every saved attendance record
 * for this one subject+classroom (across every date/คาบ, not just the
 * date currently shown on screen), one row per (session, student) — the
 * caller is expected to have fetched `sessions`/`records` already scoped
 * to this subject via getAllAttendanceForClassroom(classroomId,
 * subject.id), so this function itself does no further filtering; it
 * only joins session -> attendance date and student -> number/code/name
 * for display, the same join shape as the whole-account backup export's
 * readable/attendance.csv (backup-service.ts), just scoped to one
 * subject+classroom instead of every classroom a teacher has.
 */
export function buildClassroomAttendanceExportTable(
  subjectName: string,
  classroomName: string,
  sessions: AttendanceSession[],
  records: AttendanceRecordWithSession[],
  students: ClassroomStudent[],
): ExportTable {
  const sessionById = new Map(sessions.map((s) => [s.id, s]))
  const studentById = new Map(students.map((s) => [s.id, s]))

  const rows: (string | number)[][] = records.map((record) => {
    const session = sessionById.get(record.sessionId)
    const student = studentById.get(record.studentId)
    return [
      session?.attendanceDate ?? '-',
      classroomName,
      subjectName,
      student?.number ?? '-',
      student?.studentCode ?? '-',
      student ? `${student.firstName} ${student.lastName}` : '-',
      ATTENDANCE_STATUS_LABEL[record.status],
      record.note ?? '',
    ]
  })

  rows.sort((a, b) => String(a[0]).localeCompare(String(b[0])))

  return {
    title: `การเช็คชื่อ — ${subjectName}`,
    subtitle: `ห้องเรียน: ${classroomName} · วิชา: ${subjectName}`,
    headers: ['วันที่', 'ห้องเรียน', 'วิชา', 'เลขที่', 'รหัสนักเรียน', 'ชื่อ-นามสกุล', 'สถานะ', 'หมายเหตุ'],
    rows,
  }
}
