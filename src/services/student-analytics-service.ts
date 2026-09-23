import { getSupabaseClient } from '@/lib/supabase'
import { getAllAttendanceForClassroom } from '@/services/attendance-service'
import { getAssignments, getSubmissionsForAssignments } from '@/services/assignment-service'
import { getStudentsByClassroom } from '@/services/student-service'
import type { Assignment, AssignmentSubmission, SubmissionStatus } from '@/types/assignment'
import type { AttendanceStatus } from '@/types/attendance'
import type {
  CreateStudentFollowUpNoteInput,
  StudentAnalyticsAssignmentSummary,
  StudentAnalyticsAttendanceSummary,
  StudentAnalyticsEvidenceItem,
  StudentAnalyticsMetric,
  StudentAnalyticsSnapshot,
  StudentAnalyticsTrendPoint,
  StudentFollowUpNote,
} from '@/types/student-analytics'
import { STUDENT_ANALYTICS_METRIC_LABELS } from '@/types/student-analytics'
import type { ClassroomStudent } from '@/types/student'

/**
 * วิเคราะห์นักเรียน (Student Analytics) — service layer for a single
 * student's multi-dimensional overview inside one subject+classroom
 * workspace (the same scope Grades/Attendance/SGS already use — see
 * subject-classroom-workspace-page-real.tsx).
 *
 * DIMENSIONS DELIBERATELY DROPPED (do not add these back without new
 * schema support): "คะแนนเก็บ" vs "คะแนนสอบ" — assignments has no
 * category/type column (supabase/migrations/0006_subject_assignments.sql),
 * so there is no way to tell a formative assignment from an exam one;
 * inventing that split would fabricate data. "พฤติกรรม" (behavior) — the
 * only behavior-shaped data anywhere in this app is SGS
 * (sgs_score_columns/sgs_scores, 0023/0025), a teacher-arbitrary-named
 * grade workspace explicitly off-limits to this feature (see the SGS
 * Bridge/Score Calculator's own freeze — this file NEVER imports from
 * sgs-score-workspace-service.ts, sgs-score-calculation-service.ts, or
 * sgs-bridge/, and NEVER reads sgs_score_columns/sgs_scores). Reading it
 * "just for a radar dimension" would silently couple this feature to
 * that system's schema and its own read/write freeze — never done here.
 *
 * The 4 dimensions actually computed, all straight from data this app
 * already has:
 *   - grade       assignment_submissions.score / assignments.max_score,
 *                 over GRADED assignments only (computeGradedScoreTotals)
 *                 — a missing score is never counted as 0
 *   - completion  submitted+late / total assignments
 *   - onTime      submitted (not late) / total assignments
 *   - attendance  present / total attendance_records, scoped to THIS
 *                 subject's sessions (subject_id = the current subject —
 *                 same scoping the subject's own เช็คชื่อ tab uses), never
 *                 homeroom-only or cross-subject.
 *
 * PERFORMANCE: exactly 4 Supabase round trips regardless of roster size
 * or assignment count — getStudentsByClassroom (1), getAssignments (1),
 * one BATCHED assignment_submissions select across every assignment id
 * (1, via assignment-service.ts's getSubmissionsForAssignments — never
 * one request per assignment), and getAllAttendanceForClassroom (2 requests internally:
 * sessions then records, already batched by `.in(...)`). Never fetches
 * another classroom's or another teacher's data — every query is scoped
 * to the given subjectId/classroomId, and RLS further guarantees
 * teacher-ownership regardless.
 */

// ==================================================
// Pure aggregation — submission timeliness
// ==================================================

export interface StudentSubmissionTimelinessRow {
  studentId: string
  totalAssignments: number
  /** status 'submitted' or 'late'. */
  submittedCount: number
  /** status 'submitted' only (not late). */
  onTimeCount: number
  /** status 'late' only. */
  lateCount: number
  /** status 'missing', 'not_submitted', or no submission row at all. */
  missingCount: number
}

/** Pure — one row per student, tallying assignment_submissions.status
 * across every assignment passed in. A student with no submission row
 * for an assignment counts as missing, same "no row = not_submitted"
 * convention as buildDefaultSubmissions (assignment-service.ts). */
export function computeSubmissionTimelinessRows(
  studentIds: string[],
  assignments: Assignment[],
  submissionsByAssignment: Record<string, Record<string, AssignmentSubmission>>,
): StudentSubmissionTimelinessRow[] {
  return studentIds.map((studentId) => {
    let submittedCount = 0
    let onTimeCount = 0
    let lateCount = 0
    let missingCount = 0

    for (const assignment of assignments) {
      const status: SubmissionStatus = submissionsByAssignment[assignment.id]?.[studentId]?.status ?? 'not_submitted'
      if (status === 'submitted') {
        submittedCount += 1
        onTimeCount += 1
      } else if (status === 'late') {
        submittedCount += 1
        lateCount += 1
      } else {
        missingCount += 1
      }
    }

    return { studentId, totalAssignments: assignments.length, submittedCount, onTimeCount, lateCount, missingCount }
  })
}

// ==================================================
// Pure aggregation — attendance
// ==================================================

export interface RawStudentAttendanceRecord {
  studentId: string
  status: AttendanceStatus
}

/** Pure — one StudentAnalyticsAttendanceSummary per student who appears
 * in `records` (a student with zero matching records simply never gets a
 * key here; callers default to a zero summary — see
 * ZERO_ATTENDANCE_SUMMARY below). */
export function aggregateStudentAttendance(
  records: RawStudentAttendanceRecord[],
): Record<string, StudentAnalyticsAttendanceSummary> {
  const byStudent: Record<string, StudentAnalyticsAttendanceSummary> = {}

  for (const record of records) {
    const summary = (byStudent[record.studentId] ??= { present: 0, late: 0, leave: 0, absent: 0, total: 0, attendanceRate: null })
    summary[record.status] += 1
    summary.total += 1
  }

  for (const summary of Object.values(byStudent)) {
    summary.attendanceRate = summary.total > 0 ? (summary.present / summary.total) * 100 : null
  }

  return byStudent
}

export const ZERO_ATTENDANCE_SUMMARY: StudentAnalyticsAttendanceSummary = {
  present: 0,
  late: 0,
  leave: 0,
  absent: 0,
  total: 0,
  attendanceRate: null,
}

// ==================================================
// Pure — normalization + classroom average
// ==================================================

/** Average of only the non-null values — an empty/all-null input returns
 * null rather than 0 or NaN, matching this codebase's "never fabricate a
 * zero where there is no data" convention (e.g. getSubmissionSummary's
 * `average`, computeClassGradeStats). */
export function averageNonNull(values: (number | null)[]): number | null {
  const present = values.filter((v): v is number => v !== null)
  if (present.length === 0) return null
  return present.reduce((a, b) => a + b, 0) / present.length
}

// ==================================================
// Graded-only score totals — a MISSING score is never a zero
// ==================================================

export interface GradedScoreTotals {
  earned: number
  /** Sum of max_score over ONLY the assignments this student has a
   * recorded (non-null) score for. */
  possible: number
  gradedCount: number
}

/** Pure — the grade dimension's input. Unlike assignment-service.ts's
 * computeGradeRows (the Grades tab's "total out of everything assigned",
 * deliberately unchanged), an ungraded / not-submitted assignment is left
 * out of BOTH sides here, so a missing score is never silently counted
 * as 0. Missing work is measured by the separate completion/onTime
 * dimensions instead. A recorded 0 IS counted (`!== null`, never a
 * truthiness test). */
export function computeGradedScoreTotals(
  studentId: string,
  assignments: Assignment[],
  submissionsByAssignment: Record<string, Record<string, AssignmentSubmission>>,
): GradedScoreTotals {
  let earned = 0
  let possible = 0
  let gradedCount = 0
  for (const assignment of assignments) {
    const score = submissionsByAssignment[assignment.id]?.[studentId]?.score
    if (score === null || score === undefined) continue
    earned += score
    possible += assignment.maxScore
    gradedCount += 1
  }
  return { earned, possible, gradedCount }
}

// ==================================================
// Radar/comparison-table metrics
// ==================================================

/** Pure — builds the 4 StudentAnalyticsMetric entries for one student,
 * given already-computed per-student rows for the whole roster used for
 * the classroom average (`rosterIds` — the target student's own id must
 * already be included in it if they should count toward their own
 * classroom's average, matching computeClassGradeStats' own "average of
 * every student" convention elsewhere in this codebase). */
export function buildStudentAnalyticsMetrics(
  studentId: string,
  rosterIds: string[],
  assignments: Assignment[],
  submissionsByAssignment: Record<string, Record<string, AssignmentSubmission>>,
  attendanceByStudent: Record<string, StudentAnalyticsAttendanceSummary>,
): StudentAnalyticsMetric[] {
  const gradeByStudent = new Map(rosterIds.map((id) => [id, computeGradedScoreTotals(id, assignments, submissionsByAssignment)]))

  const timelinessRows = computeSubmissionTimelinessRows(rosterIds, assignments, submissionsByAssignment)
  const timelinessByStudent = new Map(timelinessRows.map((row) => [row.studentId, row]))

  function completionValue(studentId: string): number | null {
    const row = timelinessByStudent.get(studentId)
    if (!row || row.totalAssignments === 0) return null
    return (row.submittedCount / row.totalAssignments) * 100
  }

  function onTimeValue(studentId: string): number | null {
    const row = timelinessByStudent.get(studentId)
    if (!row || row.totalAssignments === 0) return null
    return (row.onTimeCount / row.totalAssignments) * 100
  }

  function gradeValue(studentId: string): number | null {
    const totals = gradeByStudent.get(studentId)
    if (!totals || totals.possible === 0) return null
    return (totals.earned / totals.possible) * 100
  }

  function attendanceValue(studentId: string): number | null {
    return attendanceByStudent[studentId]?.attendanceRate ?? null
  }

  const grade = gradeValue(studentId)
  const gradeRow = gradeByStudent.get(studentId)
  const completion = completionValue(studentId)
  const completionRow = timelinessByStudent.get(studentId)
  const onTime = onTimeValue(studentId)
  const attendance = attendanceValue(studentId)
  const attendanceRow = attendanceByStudent[studentId]

  return [
    {
      key: 'grade',
      label: STUDENT_ANALYTICS_METRIC_LABELS.grade,
      value: grade,
      classroomAverage: averageNonNull(rosterIds.map(gradeValue)),
      rawLabel: gradeRow && grade !== null ? `${gradeRow.earned.toFixed(1)}/${gradeRow.possible.toFixed(1)} คะแนน (${gradeRow.gradedCount} งานที่มีคะแนน)` : null,
    },
    {
      key: 'completion',
      label: STUDENT_ANALYTICS_METRIC_LABELS.completion,
      value: completion,
      classroomAverage: averageNonNull(rosterIds.map(completionValue)),
      rawLabel: completionRow && completion !== null ? `${completionRow.submittedCount}/${completionRow.totalAssignments} ชิ้น` : null,
    },
    {
      key: 'onTime',
      label: STUDENT_ANALYTICS_METRIC_LABELS.onTime,
      value: onTime,
      classroomAverage: averageNonNull(rosterIds.map(onTimeValue)),
      rawLabel: completionRow && onTime !== null ? `${completionRow.onTimeCount}/${completionRow.totalAssignments} ชิ้น` : null,
    },
    {
      key: 'attendance',
      label: STUDENT_ANALYTICS_METRIC_LABELS.attendance,
      value: attendance,
      classroomAverage: averageNonNull(rosterIds.map(attendanceValue)),
      rawLabel: attendanceRow && attendance !== null ? `${attendanceRow.present}/${attendanceRow.total} ครั้ง` : null,
    },
  ]
}

// ==================================================
// Trend series — ordered assignments
// ==================================================

/** Chronological order for the trend line: due_date ascending first
 * (nulls last — an assignment with no due date has no position in a
 * timeline), then created_at ascending as a stable tiebreak. Pure and
 * exported so the exact ordering rule is independently testable. */
export function sortAssignmentsForTrend(assignments: Assignment[]): Assignment[] {
  return [...assignments].sort((a, b) => {
    if (a.dueDate !== b.dueDate) {
      if (a.dueDate === null) return 1
      if (b.dueDate === null) return -1
      return a.dueDate.localeCompare(b.dueDate)
    }
    return a.createdAt.localeCompare(b.createdAt)
  })
}

/** Pure — one point per assignment the target student has a recorded
 * (non-null) score for, in chronological order. An assignment the
 * student has no score for yet is skipped entirely (never plotted as 0)
 * — this is "performance over ordered assessments actually taken," not
 * a padded/zero-filled timeline. */
export function buildTrendSeries(
  studentId: string,
  rosterIds: string[],
  assignments: Assignment[],
  submissionsByAssignment: Record<string, Record<string, AssignmentSubmission>>,
): StudentAnalyticsTrendPoint[] {
  const ordered = sortAssignmentsForTrend(assignments)
  const points: StudentAnalyticsTrendPoint[] = []

  for (const assignment of ordered) {
    const studentScore = submissionsByAssignment[assignment.id]?.[studentId]?.score
    if (studentScore === null || studentScore === undefined) continue

    const classmateScores = rosterIds
      .filter((id) => id !== studentId)
      .map((id) => submissionsByAssignment[assignment.id]?.[id]?.score)
      .filter((score): score is number => score !== null && score !== undefined)
      .map((score) => (score / assignment.maxScore) * 100)

    points.push({
      assignmentId: assignment.id,
      assignmentTitle: assignment.title,
      dueDate: assignment.dueDate,
      studentPercent: (studentScore / assignment.maxScore) * 100,
      classroomAveragePercent: classmateScores.length > 0 ? averageNonNull(classmateScores) : null,
    })
  }

  return points
}

// ==================================================
// Assignment summary card
// ==================================================

export function buildAssignmentSummary(
  studentId: string,
  assignments: Assignment[],
  submissionsByAssignment: Record<string, Record<string, AssignmentSubmission>>,
): StudentAnalyticsAssignmentSummary {
  const [row] = computeSubmissionTimelinessRows([studentId], assignments, submissionsByAssignment)
  return {
    totalAssignments: row.totalAssignments,
    submitted: row.submittedCount,
    onTime: row.onTimeCount,
    late: row.lateCount,
    missing: row.missingCount,
  }
}

// ==================================================
// Evidence-based summary — deterministic, rule-based only (NO AI/ML), same
// discipline as followup-report-service.ts's FOLLOWUP_RULES: every rule is
// a plain named threshold, and every generated statement embeds the real
// computed number(s) it's based on — never a vague qualitative claim with
// nothing behind it.
// ==================================================

export const STUDENT_ANALYTICS_EVIDENCE_RULES = {
  /** A dimension counts as "below classroom average" only when the gap is
   * at least this many percentage points — a 1-point gap is noise, not a
   * finding. */
  BELOW_AVERAGE_MARGIN: 5,
  /** Matches followup-report-service.ts's ABSENCE_THRESHOLD exactly —
   * the two features flag the same real-world situation and must never
   * disagree on the number that means "this needs attention." */
  ABSENCE_THRESHOLD: 3,
  /** Minimum graded assignments before a first-half/second-half trend
   * comparison means anything — 2 points (1 "before", 1 "after") would
   * call any single up-or-down move a "trend." */
  TREND_MIN_POINTS: 4,
  /** Minimum percentage-point gap between the first and second half's
   * average to call it improving/declining, rather than noise. */
  TREND_MARGIN: 5,
} as const

/** Pure — every generated item names real, already-computed numbers.
 * Returns an empty array when nothing meets any rule's threshold (a
 * student who is unremarkable on every dimension gets no evidence at
 * all, same "match zero rules -> not flagged" ethos as
 * computeFollowUpReport) — this is never treated as an error state by
 * the UI, only as "nothing stood out yet." */
export function buildEvidenceSummary(
  metrics: StudentAnalyticsMetric[],
  trend: StudentAnalyticsTrendPoint[],
  assignmentSummary: StudentAnalyticsAssignmentSummary,
  attendanceSummary: StudentAnalyticsAttendanceSummary,
): StudentAnalyticsEvidenceItem[] {
  const items: StudentAnalyticsEvidenceItem[] = []
  const rules = STUDENT_ANALYTICS_EVIDENCE_RULES

  const scored = metrics.filter((m) => m.value !== null) as (StudentAnalyticsMetric & { value: number })[]
  if (scored.length > 0) {
    const strongest = scored.reduce((best, m) => (m.value > best.value ? m : best))
    items.push({
      kind: 'strongest_dimension',
      label: `จุดแข็ง: ${strongest.label} (${strongest.value.toFixed(0)}%)`,
    })
  }

  for (const metric of metrics) {
    if (metric.value === null || metric.classroomAverage === null) continue
    if (metric.classroomAverage - metric.value >= rules.BELOW_AVERAGE_MARGIN) {
      items.push({
        kind: 'below_classroom_average',
        label: `${metric.label} ต่ำกว่าค่าเฉลี่ยห้อง (${metric.value.toFixed(0)}% เทียบกับค่าเฉลี่ยห้อง ${metric.classroomAverage.toFixed(0)}%)`,
      })
    }
  }

  if (assignmentSummary.missing > 0) {
    items.push({
      kind: 'missing_assignments',
      label: `มีงานค้าง ${assignmentSummary.missing} ชิ้น จากทั้งหมด ${assignmentSummary.totalAssignments} ชิ้น`,
    })
  }

  if (attendanceSummary.absent >= rules.ABSENCE_THRESHOLD) {
    items.push({
      kind: 'attendance_issue',
      label: `ขาดเรียน ${attendanceSummary.absent} ครั้ง (เกณฑ์ ${rules.ABSENCE_THRESHOLD} ครั้งขึ้นไป)`,
    })
  }

  if (trend.length >= rules.TREND_MIN_POINTS) {
    const mid = Math.floor(trend.length / 2)
    const firstHalfAvg = averageNonNull(trend.slice(0, mid).map((p) => p.studentPercent))!
    const secondHalfAvg = averageNonNull(trend.slice(mid).map((p) => p.studentPercent))!

    if (secondHalfAvg - firstHalfAvg >= rules.TREND_MARGIN) {
      items.push({
        kind: 'trend_improving',
        label: `แนวโน้มคะแนนดีขึ้น (จากเฉลี่ย ${firstHalfAvg.toFixed(0)}% เป็น ${secondHalfAvg.toFixed(0)}%)`,
      })
    } else if (firstHalfAvg - secondHalfAvg >= rules.TREND_MARGIN) {
      items.push({
        kind: 'trend_declining',
        label: `แนวโน้มคะแนนลดลง (จากเฉลี่ย ${firstHalfAvg.toFixed(0)}% เหลือ ${secondHalfAvg.toFixed(0)}%)`,
      })
    }
  }

  return items
}

// ==================================================
// Prev/next student navigation — same pattern as assignment-service.ts's
// filterActiveAssignmentsForSwitcher/getPreviousAssignment/getNextAssignment.
// ==================================================

/** Active-only, in the SAME order getStudentsByClassroom already returns
 * them (number ascending) — never re-sorted. */
export function filterActiveStudentsForSwitcher(students: ClassroomStudent[]): ClassroomStudent[] {
  return students.filter((s) => s.status === 'active')
}

export function findStudentSwitcherIndex(activeStudents: ClassroomStudent[], currentStudentId: string): number {
  return activeStudents.findIndex((s) => s.id === currentStudentId)
}

export function getPreviousStudent(activeStudents: ClassroomStudent[], currentStudentId: string): ClassroomStudent | null {
  const index = findStudentSwitcherIndex(activeStudents, currentStudentId)
  return index > 0 ? activeStudents[index - 1] : null
}

export function getNextStudent(activeStudents: ClassroomStudent[], currentStudentId: string): ClassroomStudent | null {
  const index = findStudentSwitcherIndex(activeStudents, currentStudentId)
  return index !== -1 && index < activeStudents.length - 1 ? activeStudents[index + 1] : null
}

// ==================================================
// Orchestration — the one I/O entry point the page calls
// ==================================================

/**
 * Fetches everything the Student Analytics page needs for one
 * (subjectId, classroomId, studentId) and computes the full snapshot.
 * `studentId` need not currently be an ACTIVE classroom member (a
 * teacher can still open analytics for a since-archived student via a
 * direct link) — only the classroom-average roster is filtered to active
 * members; the target student's own metrics are always computed from
 * whatever submission/attendance history already exists for them,
 * regardless of current status.
 */
export async function getStudentAnalyticsSnapshot(
  subjectId: string,
  classroomId: string,
  studentId: string,
): Promise<StudentAnalyticsSnapshot> {
  const [roster, assignments, attendanceData] = await Promise.all([
    getStudentsByClassroom(classroomId),
    getAssignments(subjectId, classroomId),
    getAllAttendanceForClassroom(classroomId, subjectId),
  ])

  const submissionsByAssignment = await getSubmissionsForAssignments(assignments.map((a) => a.id))

  const activeRosterIds = roster.filter((s) => s.status === 'active').map((s) => s.id)
  // The target student always counts toward their own comparisons, even
  // if they've since become inactive — matches getPreviousAssignment's
  // own "the current item need not be in the active-only list" allowance.
  const calcRosterIds = activeRosterIds.includes(studentId) ? activeRosterIds : [...activeRosterIds, studentId]

  const attendanceByStudent = aggregateStudentAttendance(
    attendanceData.records.map((r) => ({ studentId: r.studentId, status: r.status })),
  )

  const metrics = buildStudentAnalyticsMetrics(studentId, calcRosterIds, assignments, submissionsByAssignment, attendanceByStudent)
  const trend = buildTrendSeries(studentId, calcRosterIds, assignments, submissionsByAssignment)
  const assignmentSummary = buildAssignmentSummary(studentId, assignments, submissionsByAssignment)
  const attendanceSummary = attendanceByStudent[studentId] ?? ZERO_ATTENDANCE_SUMMARY
  const evidence = buildEvidenceSummary(metrics, trend, assignmentSummary, attendanceSummary)

  return {
    metrics,
    trend,
    attendance: attendanceSummary,
    assignments: assignmentSummary,
    evidence,
    classroomSize: calcRosterIds.length,
  }
}

// ==================================================
// บันทึกติดตาม (follow-up notes) —
// supabase/migrations/0026_student_followup_notes.sql
// ==================================================

interface StudentFollowUpNoteRow {
  id: string
  student_id: string
  classroom_id: string
  subject_id: string
  body: string
  created_by: string | null
  created_at: string
  updated_at: string
}

function mapFollowUpNote(row: StudentFollowUpNoteRow): StudentFollowUpNote {
  return {
    id: row.id,
    studentId: row.student_id,
    classroomId: row.classroom_id,
    subjectId: row.subject_id,
    body: row.body,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/** Every note for this exact (student, classroom, subject) triple —
 * newest first, matching a scratchpad's natural reading order. */
export async function getStudentFollowUpNotes(
  studentId: string,
  classroomId: string,
  subjectId: string,
): Promise<StudentFollowUpNote[]> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('student_followup_notes')
    .select('*')
    .eq('student_id', studentId)
    .eq('classroom_id', classroomId)
    .eq('subject_id', subjectId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return (data as StudentFollowUpNoteRow[]).map(mapFollowUpNote)
}

async function requireTeacherId(): Promise<string> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase.auth.getUser()
  if (error || !data.user) {
    throw new Error('กรุณาเข้าสู่ระบบก่อนใช้งาน')
  }
  return data.user.id
}

export async function createStudentFollowUpNote(input: CreateStudentFollowUpNoteInput): Promise<StudentFollowUpNote> {
  const supabase = getSupabaseClient()
  const teacherId = await requireTeacherId()

  const { data, error } = await supabase
    .from('student_followup_notes')
    .insert({
      student_id: input.studentId,
      classroom_id: input.classroomId,
      subject_id: input.subjectId,
      body: input.body.trim(),
      created_by: teacherId,
    })
    .select('*')
    .single()

  if (error) throw error
  return mapFollowUpNote(data as StudentFollowUpNoteRow)
}

export async function updateStudentFollowUpNote(noteId: string, body: string): Promise<StudentFollowUpNote> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('student_followup_notes')
    .update({ body: body.trim() })
    .eq('id', noteId)
    .select('*')
    .single()

  if (error) throw error
  return mapFollowUpNote(data as StudentFollowUpNoteRow)
}

export async function deleteStudentFollowUpNote(noteId: string): Promise<void> {
  const supabase = getSupabaseClient()
  const { error } = await supabase.from('student_followup_notes').delete().eq('id', noteId)
  if (error) throw error
}
