// deno-lint-ignore-file no-explicit-any
import { NotFoundError } from '../../_shared/agent-context.ts'
import type { AgentContext } from '../../_shared/agent-context.ts'
import type { AgentTool } from '../types.ts'
import {
  getClassroomRoster,
  requireOwnedAssignment,
  requireOwnedClassroom,
  requireOwnedSubject,
  studentDisplayName,
  SUBMITTED_STATUSES,
  type StudentRow,
} from './shared.ts'

// ==================================================
// 1. list_classrooms
// ==================================================

interface ListClassroomsArgs {
  subjectId?: string
}

async function listClassrooms(ctx: AgentContext, args: ListClassroomsArgs) {
  const { client } = ctx

  interface ClassroomRow {
    id: string
    name: string
    grade_level: string | null
    section: string | null
    is_active: boolean
  }

  let classroomRows: ClassroomRow[]
  const subjectsByClassroom = new Map<string, { subjectId: string; subjectName: string }[]>()

  if (args.subjectId) {
    const subject = await requireOwnedSubject(client, args.subjectId)

    const { data: links, error: linksError } = await client
      .from('subject_classrooms')
      .select('classroom_id, classrooms(id, name, grade_level, section, is_active)')
      .eq('subject_id', args.subjectId)
    if (linksError) throw linksError

    classroomRows = ((links ?? []) as any[])
      .map((link) => link.classrooms)
      .filter((c): c is ClassroomRow => Boolean(c))
    for (const row of classroomRows) {
      subjectsByClassroom.set(row.id, [{ subjectId: subject.id, subjectName: subject.name }])
    }
  } else {
    const { data, error } = await client
      .from('classrooms')
      .select('id, name, grade_level, section, is_active')
      .order('name')
    if (error) throw error
    classroomRows = (data ?? []) as ClassroomRow[]

    const classroomIds = classroomRows.map((c) => c.id)
    if (classroomIds.length > 0) {
      const { data: links, error: linksError } = await client
        .from('subject_classrooms')
        .select('classroom_id, subjects(id, name)')
        .in('classroom_id', classroomIds)
      if (linksError) throw linksError
      for (const link of (links ?? []) as any[]) {
        if (!link.subjects) continue
        const list = subjectsByClassroom.get(link.classroom_id) ?? []
        list.push({ subjectId: link.subjects.id, subjectName: link.subjects.name })
        subjectsByClassroom.set(link.classroom_id, list)
      }
    }
  }

  const classroomIds = classroomRows.map((c) => c.id)
  const studentCounts = new Map<string, number>()
  if (classroomIds.length > 0) {
    const { data: memberships, error: membershipError } = await client
      .from('classroom_students')
      .select('classroom_id')
      .in('classroom_id', classroomIds)
    if (membershipError) throw membershipError
    for (const m of (memberships ?? []) as { classroom_id: string }[]) {
      studentCounts.set(m.classroom_id, (studentCounts.get(m.classroom_id) ?? 0) + 1)
    }
  }

  return {
    classrooms: classroomRows.map((row) => ({
      classroomId: row.id,
      classroomName: row.name,
      gradeLevel: row.grade_level,
      section: row.section,
      isActive: row.is_active,
      subjects: subjectsByClassroom.get(row.id) ?? [],
      studentCount: studentCounts.get(row.id) ?? 0,
    })),
  }
}

export const listClassroomsTool: AgentTool<ListClassroomsArgs> = {
  name: 'list_classrooms',
  description:
    "Lists the calling teacher's own classrooms (optionally filtered to one subject), each with its linked subjects and current student count.",
  inputSchema: {
    type: 'object',
    properties: {
      subjectId: { type: 'string', format: 'uuid', description: 'Only classrooms linked to this subject.' },
    },
  },
  handler: (ctx, args) => listClassrooms(ctx, args ?? {}),
}

// ==================================================
// 2. list_assignments
// ==================================================

const ASSIGNMENT_STATUS_VALUES = ['active', 'archived', 'all'] as const
type AssignmentStatusFilter = (typeof ASSIGNMENT_STATUS_VALUES)[number]

interface ListAssignmentsArgs {
  classroomId: string
  status?: AssignmentStatusFilter
}

async function listAssignments(ctx: AgentContext, args: ListAssignmentsArgs) {
  const { client } = ctx
  await requireOwnedClassroom(client, args.classroomId)

  let query = client
    .from('assignments')
    .select('id, title, due_date, max_score, is_archived')
    .eq('classroom_id', args.classroomId)
    .order('due_date', { ascending: true, nullsFirst: false })

  const status = args.status ?? 'active'
  if (status === 'active') query = query.eq('is_archived', false)
  if (status === 'archived') query = query.eq('is_archived', true)

  const { data: assignments, error } = await query
  if (error) throw error
  const assignmentRows = (assignments ?? []) as {
    id: string
    title: string
    due_date: string | null
    max_score: number
    is_archived: boolean
  }[]

  const roster = await getClassroomRoster(client, args.classroomId)
  const totalStudents = roster.length

  const assignmentIds = assignmentRows.map((a) => a.id)
  const statusByAssignment = new Map<string, Record<string, number>>()
  if (assignmentIds.length > 0) {
    const { data: submissions, error: subError } = await client
      .from('assignment_submissions')
      .select('assignment_id, status')
      .in('assignment_id', assignmentIds)
    if (subError) throw subError
    for (const row of (submissions ?? []) as { assignment_id: string; status: string }[]) {
      const counts = statusByAssignment.get(row.assignment_id) ?? {}
      counts[row.status] = (counts[row.status] ?? 0) + 1
      statusByAssignment.set(row.assignment_id, counts)
    }
  }

  return {
    classroomId: args.classroomId,
    totalStudents,
    assignments: assignmentRows.map((a) => {
      const counts = statusByAssignment.get(a.id) ?? {}
      const submittedCount = (counts.submitted ?? 0) + (counts.late ?? 0)
      const lateCount = counts.late ?? 0
      const explicitlyMissingCount = counts.missing ?? 0
      // A student with no assignment_submissions row at all has never
      // been touched (no submission, no teacher-set status) — still
      // "pending" from the teacher's point of view, exactly like a
      // 'not_submitted' row. See buildDefaultSubmissions' own doc
      // comment (assignment-service.ts) for why a row not existing and
      // a row existing with status='not_submitted' mean the same thing.
      const recordedCount = Object.values(counts).reduce((sum, n) => sum + n, 0)
      const neverTouchedCount = Math.max(0, totalStudents - recordedCount)
      const pendingCount = (counts.not_submitted ?? 0) + neverTouchedCount

      return {
        assignmentId: a.id,
        title: a.title,
        dueDate: a.due_date,
        maxScore: a.max_score,
        isArchived: a.is_archived,
        submittedCount,
        lateCount,
        missingCount: explicitlyMissingCount,
        pendingCount,
      }
    }),
  }
}

export const listAssignmentsTool: AgentTool<ListAssignmentsArgs> = {
  name: 'list_assignments',
  description:
    "Lists a classroom's assignments (default: active only) with submission/pending/late counts derived from that classroom's current roster.",
  inputSchema: {
    type: 'object',
    properties: {
      classroomId: { type: 'string', format: 'uuid' },
      status: { type: 'string', enum: ASSIGNMENT_STATUS_VALUES, description: 'active (default) | archived | all' },
    },
    required: ['classroomId'],
  },
  handler: (ctx, args) => listAssignments(ctx, args),
}

// ==================================================
// 3. get_missing_submissions
// ==================================================

interface GetMissingSubmissionsArgs {
  assignmentId: string
}

async function getMissingSubmissions(ctx: AgentContext, args: GetMissingSubmissionsArgs) {
  const { client } = ctx
  const assignment = await requireOwnedAssignment(client, args.assignmentId)
  const roster = await getClassroomRoster(client, assignment.classroom_id)

  const { data: submissions, error } = await client
    .from('assignment_submissions')
    .select('student_id, status')
    .eq('assignment_id', args.assignmentId)
  if (error) throw error

  const submittedStudentIds = new Set(
    ((submissions ?? []) as { student_id: string; status: string }[])
      .filter((s) => (SUBMITTED_STATUSES as readonly string[]).includes(s.status))
      .map((s) => s.student_id),
  )

  const missing = roster.filter((student) => !submittedStudentIds.has(student.id))

  return {
    assignmentId: assignment.id,
    assignmentTitle: assignment.title,
    classroomId: assignment.classroom_id,
    totalStudents: roster.length,
    missingCount: missing.length,
    students: missing.map((student) => ({
      studentId: student.id,
      studentName: studentDisplayName(student),
      number: student.number,
    })),
  }
}

export const getMissingSubmissionsTool: AgentTool<GetMissingSubmissionsArgs> = {
  name: 'get_missing_submissions',
  description: 'Lists the students in an assignment\'s classroom who have not submitted (or been marked "late") it.',
  inputSchema: {
    type: 'object',
    properties: { assignmentId: { type: 'string', format: 'uuid' } },
    required: ['assignmentId'],
  },
  handler: (ctx, args) => getMissingSubmissions(ctx, args),
}

// ==================================================
// 4. get_student_summary
// ==================================================

interface GetStudentSummaryArgs {
  studentId: string
  classroomId?: string
  subjectId?: string
}

async function resolveStudentClassroomIds(client: any, studentId: string, classroomId?: string): Promise<string[]> {
  if (classroomId) {
    await requireOwnedClassroom(client, classroomId)
    const { data, error } = await client
      .from('classroom_students')
      .select('classroom_id')
      .eq('classroom_id', classroomId)
      .eq('student_id', studentId)
      .maybeSingle()
    if (error) throw error
    if (!data) throw new NotFoundError('ไม่พบนักเรียนคนนี้ในห้องเรียนที่ระบุ')
    return [classroomId]
  }

  // No classroomId given: every classroom THIS teacher owns that the
  // student is currently a member of (classroom_students_select_own
  // already scopes this to the caller — a student in another teacher's
  // classroom is simply invisible here, never an error that leaks
  // whether that other classroom exists).
  const { data, error } = await client.from('classroom_students').select('classroom_id').eq('student_id', studentId)
  if (error) throw error
  const ids = ((data ?? []) as { classroom_id: string }[]).map((r) => r.classroom_id)
  if (ids.length === 0) {
    throw new NotFoundError('ไม่พบนักเรียนคนนี้ในห้องเรียนของคุณ')
  }
  return ids
}

async function getStudentSummary(ctx: AgentContext, args: GetStudentSummaryArgs) {
  const { client } = ctx
  const classroomIds = await resolveStudentClassroomIds(client, args.studentId, args.classroomId)

  const { data: studentRow, error: studentError } = await client
    .from('students')
    .select('id, first_name, last_name, nickname, number')
    .eq('id', args.studentId)
    .maybeSingle()
  if (studentError) throw studentError
  if (!studentRow) throw new NotFoundError('ไม่พบนักเรียนคนนี้')
  const student = studentRow as StudentRow

  let subjectId = args.subjectId
  if (subjectId) await requireOwnedSubject(client, subjectId)

  // ----- Attendance -----
  let sessionQuery = client
    .from('attendance_sessions')
    .select('id')
    .in('classroom_id', classroomIds)
  if (subjectId) sessionQuery = sessionQuery.eq('subject_id', subjectId)
  const { data: sessions, error: sessionsError } = await sessionQuery
  if (sessionsError) throw sessionsError
  const sessionIds = ((sessions ?? []) as { id: string }[]).map((s) => s.id)

  let attendanceRecords: { status: string }[] = []
  if (sessionIds.length > 0) {
    const { data: records, error: recordsError } = await client
      .from('attendance_records')
      .select('status')
      .eq('student_id', args.studentId)
      .in('attendance_session_id', sessionIds)
    if (recordsError) throw recordsError
    attendanceRecords = (records ?? []) as { status: string }[]
  }
  const attendanceTotal = attendanceRecords.length
  const presentCount = attendanceRecords.filter((r) => r.status === 'present' || r.status === 'late').length
  const attendanceRate = attendanceTotal > 0 ? presentCount / attendanceTotal : null

  // ----- Assignments -----
  let assignmentQuery = client
    .from('assignments')
    .select('id, title, max_score, due_date')
    .in('classroom_id', classroomIds)
    .eq('is_archived', false)
  if (subjectId) assignmentQuery = assignmentQuery.eq('subject_id', subjectId)
  const { data: assignments, error: assignmentsError } = await assignmentQuery
  if (assignmentsError) throw assignmentsError
  const assignmentRows = (assignments ?? []) as { id: string; title: string; max_score: number; due_date: string | null }[]

  let submissions: { assignment_id: string; status: string; score: number | null; submitted_at: string | null }[] = []
  if (assignmentRows.length > 0) {
    const { data, error } = await client
      .from('assignment_submissions')
      .select('assignment_id, status, score, submitted_at')
      .eq('student_id', args.studentId)
      .in('assignment_id', assignmentRows.map((a) => a.id))
    if (error) throw error
    submissions = (data ?? []) as typeof submissions
  }
  const submissionByAssignment = new Map(submissions.map((s) => [s.assignment_id, s]))

  const missingAssignments = assignmentRows
    .filter((a) => {
      const submission = submissionByAssignment.get(a.id)
      return !submission || (SUBMITTED_STATUSES as readonly string[]).includes(submission.status) === false
    })
    .map((a) => ({ assignmentId: a.id, title: a.title, dueDate: a.due_date }))

  const gradedScores = submissions.filter((s) => s.score !== null) as { score: number; assignment_id: string }[]
  const averageScorePercent =
    gradedScores.length > 0
      ? Math.round(
          (gradedScores.reduce((sum, s) => {
            const assignment = assignmentRows.find((a) => a.id === s.assignment_id)
            const maxScore = assignment?.max_score ?? 100
            return sum + s.score / maxScore
          }, 0) /
            gradedScores.length) *
            1000,
        ) / 10
      : null

  const recentActivity = submissions
    .filter((s) => s.submitted_at)
    .sort((a, b) => (b.submitted_at as string).localeCompare(a.submitted_at as string))
    .slice(0, 5)
    .map((s) => ({
      assignmentId: s.assignment_id,
      assignmentTitle: assignmentRows.find((a) => a.id === s.assignment_id)?.title ?? '',
      status: s.status,
      submittedAt: s.submitted_at,
    }))

  return {
    studentId: student.id,
    studentName: studentDisplayName(student),
    number: student.number,
    attendance: {
      totalSessions: attendanceTotal,
      presentOrLateCount: presentCount,
      attendanceRatePercent: attendanceRate === null ? null : Math.round(attendanceRate * 1000) / 10,
    },
    assignments: {
      totalAssignments: assignmentRows.length,
      submittedCount: assignmentRows.length - missingAssignments.length,
      missingCount: missingAssignments.length,
      missingAssignments,
      averageScorePercent,
    },
    recentActivity,
  }
}

export const getStudentSummaryTool: AgentTool<GetStudentSummaryArgs> = {
  name: 'get_student_summary',
  description:
    'Concise per-student summary (attendance rate, assignment completion, missing assignments, average score, recent submissions) scoped to classrooms the calling teacher owns.',
  inputSchema: {
    type: 'object',
    properties: {
      studentId: { type: 'string', format: 'uuid' },
      classroomId: { type: 'string', format: 'uuid', description: 'Disambiguates when a student is in more than one of your classrooms.' },
      subjectId: { type: 'string', format: 'uuid', description: 'Scopes attendance/assignments to one subject only.' },
    },
    required: ['studentId'],
  },
  handler: (ctx, args) => getStudentSummary(ctx, args),
}

// ==================================================
// 5. get_classroom_summary
// ==================================================

interface GetClassroomSummaryArgs {
  classroomId: string
  /** Documented, transparent thresholds — see the module doc comment on
   * ATTENTION_RULES below. Both optional, both have a stated default. */
  attendanceThresholdPercent?: number
  missingAssignmentsThreshold?: number
  scoreThresholdPercent?: number
}

const DEFAULT_ATTENDANCE_THRESHOLD_PERCENT = 80
const DEFAULT_MISSING_ASSIGNMENTS_THRESHOLD = 2
const DEFAULT_SCORE_THRESHOLD_PERCENT = 50

async function getClassroomSummary(ctx: AgentContext, args: GetClassroomSummaryArgs) {
  const { client } = ctx
  const classroom = await requireOwnedClassroom(client, args.classroomId)
  const roster = await getClassroomRoster(client, args.classroomId)
  const studentIds = roster.map((s) => s.id)

  const attendanceThreshold = args.attendanceThresholdPercent ?? DEFAULT_ATTENDANCE_THRESHOLD_PERCENT
  const missingThreshold = args.missingAssignmentsThreshold ?? DEFAULT_MISSING_ASSIGNMENTS_THRESHOLD
  const scoreThreshold = args.scoreThresholdPercent ?? DEFAULT_SCORE_THRESHOLD_PERCENT

  // ----- Attendance -----
  const { data: sessions, error: sessionsError } = await client
    .from('attendance_sessions')
    .select('id')
    .eq('classroom_id', args.classroomId)
  if (sessionsError) throw sessionsError
  const sessionIds = ((sessions ?? []) as { id: string }[]).map((s) => s.id)

  const attendanceByStudent = new Map<string, { total: number; present: number }>()
  if (sessionIds.length > 0 && studentIds.length > 0) {
    const { data: records, error: recordsError } = await client
      .from('attendance_records')
      .select('student_id, status')
      .in('attendance_session_id', sessionIds)
      .in('student_id', studentIds)
    if (recordsError) throw recordsError
    for (const row of (records ?? []) as { student_id: string; status: string }[]) {
      const entry = attendanceByStudent.get(row.student_id) ?? { total: 0, present: 0 }
      entry.total += 1
      if (row.status === 'present' || row.status === 'late') entry.present += 1
      attendanceByStudent.set(row.student_id, entry)
    }
  }
  const totalAttendanceRecords = Array.from(attendanceByStudent.values()).reduce((sum, e) => sum + e.total, 0)
  const totalAttendancePresent = Array.from(attendanceByStudent.values()).reduce((sum, e) => sum + e.present, 0)

  // ----- Assignments -----
  const { data: assignments, error: assignmentsError } = await client
    .from('assignments')
    .select('id, title, max_score')
    .eq('classroom_id', args.classroomId)
    .eq('is_archived', false)
  if (assignmentsError) throw assignmentsError
  const assignmentRows = (assignments ?? []) as { id: string; title: string; max_score: number }[]
  const assignmentIds = assignmentRows.map((a) => a.id)

  const submissionsByStudent = new Map<string, { assignment_id: string; status: string; score: number | null }[]>()
  const missingByAssignment = new Map<string, number>()
  let totalScorePercentSum = 0
  let totalScoredCount = 0

  if (assignmentIds.length > 0) {
    const { data: submissions, error: subError } = await client
      .from('assignment_submissions')
      .select('student_id, assignment_id, status, score')
      .in('assignment_id', assignmentIds)
    if (subError) throw subError
    for (const row of (submissions ?? []) as { student_id: string; assignment_id: string; status: string; score: number | null }[]) {
      const list = submissionsByStudent.get(row.student_id) ?? []
      list.push(row)
      submissionsByStudent.set(row.student_id, list)
      if (row.score !== null) {
        const assignment = assignmentRows.find((a) => a.id === row.assignment_id)
        totalScorePercentSum += row.score / (assignment?.max_score ?? 100)
        totalScoredCount += 1
      }
    }
  }

  for (const assignment of assignmentRows) {
    let missing = 0
    for (const student of roster) {
      const submission = submissionsByStudent.get(student.id)?.find((s) => s.assignment_id === assignment.id)
      const submitted = submission && (SUBMITTED_STATUSES as readonly string[]).includes(submission.status)
      if (!submitted) missing += 1
    }
    missingByAssignment.set(assignment.id, missing)
  }
  const totalMissing = Array.from(missingByAssignment.values()).reduce((sum, n) => sum + n, 0)

  // ----- Students needing attention (simple, documented, transparent rules) -----
  const studentsNeedingAttention = roster
    .map((student) => {
      const reasons: string[] = []

      const attendance = attendanceByStudent.get(student.id)
      if (attendance && attendance.total > 0) {
        const rate = (attendance.present / attendance.total) * 100
        if (rate < attendanceThreshold) reasons.push(`attendance_below_${attendanceThreshold}`)
      }

      const studentSubmissions = submissionsByStudent.get(student.id) ?? []
      const missingCount = assignmentRows.filter((a) => {
        const submission = studentSubmissions.find((s) => s.assignment_id === a.id)
        return !submission || !(SUBMITTED_STATUSES as readonly string[]).includes(submission.status)
      }).length
      if (missingCount >= missingThreshold) reasons.push(`missing_assignments_${missingCount}`)

      const graded = studentSubmissions.filter((s) => s.score !== null)
      if (graded.length > 0) {
        const avgPercent =
          (graded.reduce((sum, s) => {
            const assignment = assignmentRows.find((a) => a.id === s.assignment_id)
            return sum + (s.score as number) / (assignment?.max_score ?? 100)
          }, 0) /
            graded.length) *
          100
        if (avgPercent < scoreThreshold) reasons.push(`average_score_below_${scoreThreshold}`)
      }

      return reasons.length > 0
        ? { studentId: student.id, studentName: studentDisplayName(student), reasons }
        : null
    })
    .filter((entry): entry is { studentId: string; studentName: string; reasons: string[] } => entry !== null)

  return {
    classroomId: classroom.id,
    classroomName: classroom.name,
    studentCount: roster.length,
    attendanceSummary: {
      totalRecords: totalAttendanceRecords,
      presentOrLateCount: totalAttendancePresent,
      attendanceRatePercent:
        totalAttendanceRecords > 0 ? Math.round((totalAttendancePresent / totalAttendanceRecords) * 1000) / 10 : null,
    },
    assignmentSummary: {
      totalAssignments: assignmentRows.length,
      totalMissingSubmissions: totalMissing,
      missingByAssignment: assignmentRows.map((a) => ({
        assignmentId: a.id,
        title: a.title,
        missingCount: missingByAssignment.get(a.id) ?? 0,
      })),
    },
    scoreSummary: {
      averageScorePercent: totalScoredCount > 0 ? Math.round((totalScorePercentSum / totalScoredCount) * 1000) / 10 : null,
    },
    studentsNeedingAttention: {
      rulesApplied: {
        attendanceBelowPercent: attendanceThreshold,
        missingAssignmentsAtLeast: missingThreshold,
        averageScoreBelowPercent: scoreThreshold,
      },
      students: studentsNeedingAttention,
    },
  }
}

export const getClassroomSummaryTool: AgentTool<GetClassroomSummaryArgs> = {
  name: 'get_classroom_summary',
  description:
    'Classroom-level dashboard: student count, attendance/assignment/score summaries, and students needing attention under simple, transparent, documented rules (never opaque AI scoring).',
  inputSchema: {
    type: 'object',
    properties: {
      classroomId: { type: 'string', format: 'uuid' },
      attendanceThresholdPercent: { type: 'number', minimum: 0, description: 'Default 80.' },
      missingAssignmentsThreshold: { type: 'integer', minimum: 1, description: 'Default 2.' },
      scoreThresholdPercent: { type: 'number', minimum: 0, description: 'Default 50.' },
    },
    required: ['classroomId'],
  },
  handler: (ctx, args) => getClassroomSummary(ctx, args),
}

export const readTools: AgentTool<any>[] = [
  listClassroomsTool,
  listAssignmentsTool,
  getMissingSubmissionsTool,
  getStudentSummaryTool,
  getClassroomSummaryTool,
]
