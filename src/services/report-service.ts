import { getSupabaseClient } from '@/lib/supabase'
import { computeGradeRows, getSubmissions } from '@/services/assignment-service'
import { getClassrooms } from '@/services/classroom-service'
import { getStudentsByClassroom } from '@/services/student-service'
import { getSubjects } from '@/services/subject-service'
import type { Assignment, AssignmentSubmission, SubmissionStatus } from '@/types/assignment'
import type { AttendanceStatus } from '@/types/attendance'
import type { ClassroomStudent } from '@/types/student'
import type {
  AttendanceSummaryRow,
  GradeSummaryGroup,
  GradeSummaryStudentRow,
  MissingAssignmentRow,
  ReportFilters,
  ReportStudentRef,
} from '@/types/report'

/**
 * Every function in this file reads exclusively through this schema's
 * existing RLS — `attendance_sessions`/`attendance_records`/`assignments`/
 * `assignment_submissions` are already scoped to `teacher_id = auth.uid()`
 * transitively via classroom ownership (see 0004/0005/0006's own
 * `_select_own` policies), and `classrooms`/`subjects`/`students` the
 * same way. A `classroomId`/`subjectId` filter here only ever NARROWS an
 * already-teacher-scoped query — passing another teacher's classroom id
 * simply returns zero rows, it can never widen access. No table is
 * created and no RLS is changed for this feature; see report.ts's
 * doc comment.
 */

function toIso(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/** Default filter window: the last 30 days including today — a
 * reasonable "recent activity" default a teacher can widen or narrow. */
export function getDefaultDateRange(now: Date = new Date()): { startDate: string; endDate: string } {
  const start = new Date(now)
  start.setDate(start.getDate() - 29)
  return { startDate: toIso(start), endDate: toIso(now) }
}

/**
 * The ONE place "no classroom/subject filter, last 30 days" is built —
 * used both by the Reports page's initial filter state and by the
 * Dashboard's "นักเรียนที่ควรติดตาม" widget (dashboard-service.ts's
 * getDashboardFollowUpSummary), so the two surfaces are guaranteed to
 * run the exact same query shape, not just a visually-similar copy of
 * it. Changing the default window only ever requires editing this one
 * function.
 */
export function getDefaultReportFilters(now: Date = new Date()): ReportFilters {
  return { classroomId: null, subjectId: null, ...getDefaultDateRange(now) }
}

export interface ReportFilterOptions {
  classrooms: { id: string; name: string }[]
  subjects: { id: string; name: string }[]
}

/** Populates the filter bar's classroom/subject dropdowns — every
 * classroom/subject the signed-in teacher owns, active or archived (a
 * report should still be able to cover a since-archived classroom). */
export async function getReportFilterOptions(): Promise<ReportFilterOptions> {
  const [classrooms, subjects] = await Promise.all([getClassrooms(), getSubjects()])
  return {
    classrooms: classrooms.map((c) => ({ id: c.id, name: c.name })),
    subjects: subjects.map((s) => ({ id: s.id, name: s.name })),
  }
}

async function fetchNameMaps(): Promise<{ classroomNameById: Map<string, string>; subjectNameById: Map<string, string> }> {
  const { classrooms, subjects } = await getReportFilterOptions()
  return {
    classroomNameById: new Map(classrooms.map((c) => [c.id, c.name])),
    subjectNameById: new Map(subjects.map((s) => [s.id, s.name])),
  }
}

async function fetchRostersByClassroom(classroomIds: string[]): Promise<Map<string, ClassroomStudent[]>> {
  const rosters = await Promise.all(classroomIds.map((id) => getStudentsByClassroom(id)))
  return new Map(classroomIds.map((id, i) => [id, rosters[i]]))
}

// ==================================================
// Attendance Summary
// ==================================================

interface AttendanceSessionRow {
  id: string
  classroom_id: string
  subject_id: string | null
  attendance_date: string
}

interface AttendanceRecordRow {
  attendance_session_id: string
  student_id: string
  status: AttendanceStatus
}

export interface RawAttendanceRecord {
  studentId: string
  classroomId: string
  status: AttendanceStatus
}

/**
 * Pure aggregation: one row per (studentId, classroomId) pair actually
 * present in `records` — a student who moved between classrooms during
 * the selected range gets one row per classroom they had sessions in,
 * never merged, since a single "attendance rate" number across two
 * different rosters would be meaningless. `studentRefByKey` must already
 * contain a `${studentId}:${classroomId}` entry for every pair that
 * appears in `records` (rows with no matching ref are skipped — this
 * only happens if a record references a classroom the caller didn't
 * fetch a roster for, which report-service's own callers never do).
 */
export function aggregateAttendanceSummary(
  records: RawAttendanceRecord[],
  studentRefByKey: Map<string, ReportStudentRef>,
): AttendanceSummaryRow[] {
  const rows = new Map<string, AttendanceSummaryRow>()

  for (const record of records) {
    const key = `${record.studentId}:${record.classroomId}`
    const ref = studentRefByKey.get(key)
    if (!ref) continue

    let row = rows.get(key)
    if (!row) {
      row = { ...ref, present: 0, late: 0, leave: 0, absent: 0, total: 0, attendanceRate: null }
      rows.set(key, row)
    }
    row[record.status] += 1
    row.total += 1
  }

  return [...rows.values()]
    .map((row) => ({ ...row, attendanceRate: row.total > 0 ? (row.present / row.total) * 100 : null }))
    .sort(
      (a, b) =>
        a.classroomName.localeCompare(b.classroomName, 'th') || (a.number ?? Number.MAX_SAFE_INTEGER) - (b.number ?? Number.MAX_SAFE_INTEGER),
    )
}

export async function getAttendanceSummaryReport(filters: ReportFilters): Promise<AttendanceSummaryRow[]> {
  const supabase = getSupabaseClient()

  let query = supabase
    .from('attendance_sessions')
    .select('id, classroom_id, subject_id, attendance_date')
    .gte('attendance_date', filters.startDate)
    .lte('attendance_date', filters.endDate)
  if (filters.classroomId) query = query.eq('classroom_id', filters.classroomId)
  if (filters.subjectId) query = query.eq('subject_id', filters.subjectId)

  const { data: sessionData, error: sessionError } = await query
  if (sessionError) throw sessionError
  const sessions = sessionData as AttendanceSessionRow[]
  if (sessions.length === 0) return []

  const { data: recordData, error: recordError } = await supabase
    .from('attendance_records')
    .select('attendance_session_id, student_id, status')
    .in(
      'attendance_session_id',
      sessions.map((s) => s.id),
    )
  if (recordError) throw recordError

  const sessionById = new Map(sessions.map((s) => [s.id, s]))
  const classroomIds = [...new Set(sessions.map((s) => s.classroom_id))]
  const [{ classroomNameById }, rosterByClassroom] = await Promise.all([
    fetchNameMaps(),
    fetchRostersByClassroom(classroomIds),
  ])

  const studentRefByKey = new Map<string, ReportStudentRef>()
  for (const classroomId of classroomIds) {
    const roster = rosterByClassroom.get(classroomId) ?? []
    const classroomName = classroomNameById.get(classroomId) ?? '-'
    for (const student of roster) {
      studentRefByKey.set(`${student.id}:${classroomId}`, {
        studentId: student.id,
        studentCode: student.studentCode,
        number: student.number,
        firstName: student.firstName,
        lastName: student.lastName,
        classroomId,
        classroomName,
      })
    }
  }

  const records: RawAttendanceRecord[] = (recordData as AttendanceRecordRow[])
    .map((r) => {
      const session = sessionById.get(r.attendance_session_id)
      return session ? { studentId: r.student_id, classroomId: session.classroom_id, status: r.status } : null
    })
    .filter((r): r is RawAttendanceRecord => r !== null)

  return aggregateAttendanceSummary(records, studentRefByKey)
}

// ==================================================
// Shared assignment fetch (Grade Summary + Missing Assignment)
// ==================================================

interface AssignmentQueryRow {
  id: string
  subject_id: string
  classroom_id: string
  topic_id: string | null
  title: string
  description: string | null
  max_score: number
  due_date: string | null
  is_archived: boolean
  created_by: string | null
  created_at: string
  updated_at: string
}

function mapAssignmentRow(row: AssignmentQueryRow): Assignment {
  return {
    id: row.id,
    subjectId: row.subject_id,
    classroomId: row.classroom_id,
    topicId: row.topic_id,
    title: row.title,
    description: row.description,
    maxScore: row.max_score,
    dueDate: row.due_date,
    isArchived: row.is_archived,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/**
 * Date-range rule for both Grade Summary and Missing Assignment (shared,
 * documented once): an assignment is included when its due_date falls
 * within [startDate, endDate], OR it has no due_date at all. An
 * assignment with no due date has nothing to compare against the range,
 * and excluding it outright would silently hide real, currently-relevant
 * grade/submission data — so it is always shown rather than always
 * hidden. Pure, so this exact rule is unit-tested directly.
 */
export function filterAssignmentsByDateRange(
  assignments: Assignment[],
  startDate: string,
  endDate: string,
): Assignment[] {
  return assignments.filter((a) => a.dueDate === null || (a.dueDate >= startDate && a.dueDate <= endDate))
}

async function fetchAssignmentsForReport(filters: ReportFilters): Promise<Assignment[]> {
  const supabase = getSupabaseClient()
  let query = supabase
    .from('assignments')
    .select('id, subject_id, classroom_id, topic_id, title, description, max_score, due_date, is_archived, created_by, created_at, updated_at')
    .eq('is_archived', false)
  if (filters.classroomId) query = query.eq('classroom_id', filters.classroomId)
  if (filters.subjectId) query = query.eq('subject_id', filters.subjectId)

  const { data, error } = await query
  if (error) throw error
  return filterAssignmentsByDateRange((data as AssignmentQueryRow[]).map(mapAssignmentRow), filters.startDate, filters.endDate)
}

/** Pure — groups assignments by their (subjectId, classroomId) pair,
 * the natural grouping key since an assignment always belongs to
 * exactly one of each (0006's scope note). */
export function groupAssignmentsBySubjectClassroom(assignments: Assignment[]): Record<string, Assignment[]> {
  const groups: Record<string, Assignment[]> = {}
  for (const assignment of assignments) {
    const key = `${assignment.subjectId}:${assignment.classroomId}`
    ;(groups[key] ??= []).push(assignment)
  }
  return groups
}

// ==================================================
// Grade Summary
// ==================================================

export async function getGradeSummaryReport(filters: ReportFilters): Promise<GradeSummaryGroup[]> {
  const assignments = await fetchAssignmentsForReport(filters)
  if (assignments.length === 0) return []

  const groups = groupAssignmentsBySubjectClassroom(assignments)
  const [{ classroomNameById, subjectNameById }] = await Promise.all([fetchNameMaps()])

  const result = await Promise.all(
    Object.entries(groups).map(async ([key, groupAssignments]) => {
      const [subjectId, classroomId] = key.split(':')
      const [roster, submissionRows] = await Promise.all([
        getStudentsByClassroom(classroomId),
        Promise.all(groupAssignments.map((a) => getSubmissions(a.id))),
      ])

      const submissionsByAssignment: Record<string, Record<string, AssignmentSubmission>> = {}
      groupAssignments.forEach((a, i) => {
        submissionsByAssignment[a.id] = submissionRows[i]
      })

      const rosterById = new Map(roster.map((s) => [s.id, s]))
      const gradeRows = computeGradeRows(
        roster.map((s) => s.id),
        groupAssignments,
        submissionsByAssignment,
      )

      const students: GradeSummaryStudentRow[] = gradeRows.map((row) => {
        const info = rosterById.get(row.studentId)!
        return {
          studentId: row.studentId,
          studentCode: info.studentCode,
          number: info.number,
          firstName: info.firstName,
          lastName: info.lastName,
          classroomId,
          classroomName: classroomNameById.get(classroomId) ?? '-',
          scoresByAssignment: row.scoresByAssignment,
          totalEarned: row.total,
          totalPossible: row.possible,
          percentage: row.percentage,
        }
      })

      const group: GradeSummaryGroup = {
        subjectId,
        subjectName: subjectNameById.get(subjectId) ?? '-',
        classroomId,
        classroomName: classroomNameById.get(classroomId) ?? '-',
        assignments: groupAssignments.map((a) => ({
          assignmentId: a.id,
          title: a.title,
          maxScore: a.maxScore,
          dueDate: a.dueDate,
        })),
        students,
      }
      return group
    }),
  )

  return result.sort(
    (a, b) => a.subjectName.localeCompare(b.subjectName, 'th') || a.classroomName.localeCompare(b.classroomName, 'th'),
  )
}

// ==================================================
// Missing Assignment
// ==================================================

/**
 * Pure — one row per (student, assignment) whose current status is
 * anything other than 'submitted' (a student with no submission row at
 * all defaults to 'not_submitted', same convention as
 * mergeSubmissionsWithDefaults/computeGradeRows elsewhere in this app).
 * "Missing" here deliberately covers not_submitted/late/missing — every
 * status that still needs the teacher's attention — not just the
 * literal 'missing' status value.
 */
export function buildMissingAssignmentRows(
  assignments: Assignment[],
  submissionsByAssignmentId: Record<string, Record<string, AssignmentSubmission>>,
  rosterByClassroomId: Map<string, ClassroomStudent[]>,
  subjectNameById: Map<string, string>,
  classroomNameById: Map<string, string>,
): MissingAssignmentRow[] {
  const rows: MissingAssignmentRow[] = []

  for (const assignment of assignments) {
    const roster = rosterByClassroomId.get(assignment.classroomId) ?? []
    const submissions = submissionsByAssignmentId[assignment.id] ?? {}

    for (const student of roster) {
      const status: SubmissionStatus = submissions[student.id]?.status ?? 'not_submitted'
      if (status === 'submitted') continue

      rows.push({
        studentId: student.id,
        studentCode: student.studentCode,
        number: student.number,
        firstName: student.firstName,
        lastName: student.lastName,
        classroomId: assignment.classroomId,
        classroomName: classroomNameById.get(assignment.classroomId) ?? '-',
        assignmentId: assignment.id,
        assignmentTitle: assignment.title,
        subjectId: assignment.subjectId,
        subjectName: subjectNameById.get(assignment.subjectId) ?? '-',
        dueDate: assignment.dueDate,
        status,
      })
    }
  }

  return rows.sort((a, b) => {
    const byDate = (a.dueDate ?? '9999-99-99').localeCompare(b.dueDate ?? '9999-99-99')
    if (byDate !== 0) return byDate
    return a.classroomName.localeCompare(b.classroomName, 'th')
  })
}

export async function getMissingAssignmentReport(filters: ReportFilters): Promise<MissingAssignmentRow[]> {
  const assignments = await fetchAssignmentsForReport(filters)
  if (assignments.length === 0) return []

  const classroomIds = [...new Set(assignments.map((a) => a.classroomId))]
  const [{ classroomNameById, subjectNameById }, rosterByClassroomId, submissionRows] = await Promise.all([
    fetchNameMaps(),
    fetchRostersByClassroom(classroomIds),
    Promise.all(assignments.map((a) => getSubmissions(a.id))),
  ])

  const submissionsByAssignmentId: Record<string, Record<string, AssignmentSubmission>> = {}
  assignments.forEach((a, i) => {
    submissionsByAssignmentId[a.id] = submissionRows[i]
  })

  return buildMissingAssignmentRows(assignments, submissionsByAssignmentId, rosterByClassroomId, subjectNameById, classroomNameById)
}
