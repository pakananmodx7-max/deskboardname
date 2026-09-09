import { getAttendance } from '@/services/attendance-service'
import { getClassrooms } from '@/services/classroom-service'
import { getStudentsByClassroom } from '@/services/student-service'
import { getSupabaseClient } from '@/lib/supabase'
import type { AttendanceSummary } from '@/types/attendance'
import type { Classroom } from '@/types/classroom'

/**
 * Service layer boundary for the teacher /teacher/dashboard overview —
 * every function here reads exclusively through the same RLS-scoped
 * tables/services the rest of the app already uses (classrooms,
 * students, subjects, attendance), so a teacher only ever sees counts
 * and rows for classrooms they actually own. No mock data — this file
 * used to return `mockDashboardStats`/`mockIntegrationStatus` etc; those
 * were never wired to anything real (dashboard-page.tsx rendered
 * useDemoClassroom() directly and never called this file at all), so
 * this is a full rewrite, not an incremental change.
 */

export interface DashboardOverview {
  classroomCount: number
  activeClassroomCount: number
  /** Every student row visible via students_select_via_classroom (0001)
   * — i.e. every distinct student enrolled in at least one of this
   * teacher's classrooms, active or archived. */
  studentCount: number
  subjectCount: number
}

export async function getDashboardOverview(): Promise<DashboardOverview> {
  const supabase = getSupabaseClient()
  const [classroomsResult, studentsResult, subjectsResult] = await Promise.all([
    supabase.from('classrooms').select('id, is_active'),
    supabase.from('students').select('id', { count: 'exact', head: true }),
    supabase.from('subjects').select('id', { count: 'exact', head: true }),
  ])
  if (classroomsResult.error) throw classroomsResult.error
  if (studentsResult.error) throw studentsResult.error
  if (subjectsResult.error) throw subjectsResult.error

  const classrooms = classroomsResult.data as { id: string; is_active: boolean }[]
  return {
    classroomCount: classrooms.length,
    activeClassroomCount: classrooms.filter((c) => c.is_active).length,
    studentCount: studentsResult.count ?? 0,
    subjectCount: subjectsResult.count ?? 0,
  }
}

export interface ClassroomWithStudentCount extends Classroom {
  studentCount: number
}

/**
 * Every active classroom plus its current member count — same
 * per-classroom-count pattern as getSubjectClassroomsWithCounts
 * (subject-service.ts), reused here for the dashboard's classroom list.
 */
export async function getClassroomsWithStudentCounts(): Promise<ClassroomWithStudentCount[]> {
  const classrooms = (await getClassrooms()).filter((c) => c.isActive)
  const counts = await Promise.all(classrooms.map((c) => getStudentsByClassroom(c.id)))
  return classrooms.map((c, i) => ({ ...c, studentCount: counts[i].length }))
}

/**
 * Today's homeroom attendance, summed across every active classroom —
 * reuses getAttendance (attendance-service.ts) exactly as the real
 * Attendance tab does, one call per classroom (subjectId/periodNumber
 * left at their homeroom defaults). A classroom with no session saved
 * for today simply contributes nothing (not zeros-as-absent) — this is
 * "how many of today's roll calls have been taken and what they show,"
 * not an assumption that an unmarked classroom is fully absent.
 */
export async function getTodayAttendanceOverview(classrooms: Classroom[]): Promise<AttendanceSummary> {
  const today = new Date().toISOString().slice(0, 10)
  const results = await Promise.all(classrooms.map((c) => getAttendance(c.id, today)))

  const summary: AttendanceSummary = { present: 0, late: 0, leave: 0, absent: 0, total: 0 }
  for (const result of results) {
    for (const record of Object.values(result.records)) {
      summary[record.status] += 1
      summary.total += 1
    }
  }
  return summary
}
