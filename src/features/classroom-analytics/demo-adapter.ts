import type {
  AnalyticsAssignmentData,
  AnalyticsAttendanceRecord,
  AnalyticsContext,
  AnalyticsRoster,
  AttendanceStatus,
} from '@/features/classroom-analytics/analytics'
import type {
  DemoAttendanceStatus,
  DemoClassroomInfo,
  DemoStudent,
  DemoSubject,
  DemoSubjectAssignment,
  DemoSubjectAttendance,
} from '@/demo/types'

/**
 * Demo Mode -> the same AnalyticsDataset shapes the real service returns,
 * so the demo dashboard runs through exactly the same calculations. Only
 * attendance the demo actually holds is used (subject roll calls the
 * teacher recorded in the demo, plus today's homeroom check-in of the
 * demo's main classroom) — nothing is fabricated.
 */
export interface DemoAnalyticsSource {
  classroomName: string
  classrooms: DemoClassroomInfo[]
  allStudents: DemoStudent[]
  subjects: DemoSubject[]
  subjectAssignments: DemoSubjectAssignment[]
  subjectAttendance: DemoSubjectAttendance
  /** Today's homeroom check-in of the demo's main classroom. */
  attendance: Record<string, DemoAttendanceStatus>
}

export interface DemoAnalyticsDataset {
  context: AnalyticsContext
  roster: AnalyticsRoster
  attendance: AnalyticsAttendanceRecord[]
  assignments: AnalyticsAssignmentData
}

export function buildDemoAnalyticsDataset(source: DemoAnalyticsSource, today: string): DemoAnalyticsDataset {
  const subjectByClassroom = new Map<string, DemoSubject>()
  for (const subject of source.subjects) {
    for (const classroomId of subject.classroomIds) if (!subjectByClassroom.has(classroomId)) subjectByClassroom.set(classroomId, subject)
  }

  const context: AnalyticsContext = {
    // Demo classrooms carry no semester of their own — they take the
    // semester of the first subject linked to them.
    classrooms: source.classrooms.map((c) => ({
      id: c.id,
      name: c.name,
      academicYear: subjectByClassroom.get(c.id)?.academicYear ?? null,
      semester: subjectByClassroom.get(c.id)?.semester ?? null,
      isActive: true,
    })),
    subjects: source.subjects.map((s) => ({ id: s.id, name: s.name, academicYear: s.academicYear || null, semester: s.semester || null })),
    links: source.subjects.flatMap((s) => s.classroomIds.map((classroomId) => ({ subjectId: s.id, classroomId }))),
  }

  const roster: AnalyticsRoster = {
    memberships: source.classrooms.flatMap((c) => c.studentIds.map((studentId) => ({ studentId, classroomId: c.id }))),
    students: source.allStudents.map((s) => ({
      id: s.id,
      firstName: s.firstName,
      lastName: s.lastName,
      studentCode: s.studentCode || null,
      number: s.number,
      status: s.status,
    })),
  }

  const attendance: AnalyticsAttendanceRecord[] = []
  for (const [subjectId, byClassroom] of Object.entries(source.subjectAttendance)) {
    for (const [classroomId, byDate] of Object.entries(byClassroom)) {
      for (const [date, byStudent] of Object.entries(byDate)) {
        for (const [studentId, status] of Object.entries(byStudent)) {
          attendance.push({ sessionId: `${subjectId}:${classroomId}:${date}`, classroomId, subjectId, date, studentId, status: status as AttendanceStatus })
        }
      }
    }
  }
  const mainClassroom = source.classrooms.find((c) => c.name === source.classroomName)
  if (mainClassroom) {
    for (const [studentId, status] of Object.entries(source.attendance)) {
      attendance.push({ sessionId: `homeroom:${mainClassroom.id}:${today}`, classroomId: mainClassroom.id, subjectId: null, date: today, studentId, status })
    }
  }

  const live = source.subjectAssignments.filter((a) => !a.isArchived)
  const assignments: AnalyticsAssignmentData = {
    assignments: live.map((a) => ({ id: a.id, classroomId: a.classroomId, subjectId: a.subjectId, title: a.title, dueDate: a.dueDate || null })),
    submissions: live.flatMap((a) => Object.entries(a.submissions).map(([studentId, s]) => ({ assignmentId: a.id, studentId, status: s.status }))),
  }

  return { context, roster, attendance, assignments }
}
