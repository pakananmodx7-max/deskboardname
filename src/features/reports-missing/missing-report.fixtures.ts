import { resolveSemesterScope, type AnalyticsAssignmentData, type AnalyticsContext, type AnalyticsRoster } from '@/features/classroom-analytics/analytics'

import { DEFAULT_MISSING_FILTERS, type MissingReportFilters } from './missing-report-model'

/** Shared test fixture (not imported by app code). TODAY = 10 ต.ค. 2569. */
export const TODAY = '2026-10-10'

export const CONTEXT: AnalyticsContext = {
  classrooms: [
    { id: 'c1', name: 'ม.1/1', academicYear: '2569', semester: '1', isActive: true },
    { id: 'c2', name: 'ม.1/2', academicYear: '2569', semester: '1', isActive: true },
    { id: 'old', name: 'ม.1/1', academicYear: '2568', semester: '2', isActive: true },
  ],
  subjects: [
    { id: 'hist', name: 'ประวัติศาสตร์ไทย', academicYear: '2569', semester: '1' },
    { id: 'sci', name: 'วิทยาศาสตร์', academicYear: '2569', semester: '1' },
    { id: 'oldsub', name: 'สังคมศึกษา', academicYear: '2568', semester: '2' },
  ],
  links: [
    { subjectId: 'hist', classroomId: 'c1' },
    { subjectId: 'hist', classroomId: 'c2' },
    { subjectId: 'sci', classroomId: 'c1' },
    { subjectId: 'oldsub', classroomId: 'old' },
  ],
}

function student(id: string, number: number, firstName: string, lastName: string, status: 'active' | 'inactive' = 'active') {
  return { id, firstName, lastName, studentCode: `S${id}`, number, status }
}

export const ROSTER: AnalyticsRoster = {
  memberships: [
    { studentId: 's1', classroomId: 'c1' },
    { studentId: 's2', classroomId: 'c1' },
    { studentId: 's3', classroomId: 'c1' },
    { studentId: 's4', classroomId: 'c2', joinedAt: '2026-05-01T08:00:00Z' },
    { studentId: 's5', classroomId: 'c2', joinedAt: '2026-09-20T08:00:00Z' },
    { studentId: 's6', classroomId: 'old' },
  ],
  students: [
    student('s1', 1, 'กฤษกร', 'สีราเลา'),
    student('s2', 2, 'กัลยวรรณ', 'ทองคำ'),
    student('s3', 3, 'จักรพงศ์', 'ด่วนชะเอม', 'inactive'),
    student('s4', 1, 'ชิษณุพงศ์', 'จันทร์แจ้ง'),
    student('s5', 2, 'ฐิติพงศ์', 'จุลไชย'),
    student('s6', 1, 'ภาคิน', 'สุขสวัสดิ์'),
  ],
}

export const ASSIGNMENTS: AnalyticsAssignmentData = {
  assignments: [
    { id: 'a1', classroomId: 'c1', subjectId: 'hist', title: 'ใบงานที่ 1 ยุคหิน', dueDate: '2026-09-01' },
    { id: 'a2', classroomId: 'c1', subjectId: 'hist', title: 'ใบงานที่ 2 รัฐโบราณ', dueDate: '2026-10-20' },
    { id: 'a3', classroomId: 'c1', subjectId: 'sci', title: 'รายงานการทดลอง', dueDate: null },
    { id: 'a4', classroomId: 'c2', subjectId: 'hist', title: 'ใบงานที่ 3 ปัจจัยการเกิดรัฐไทย', dueDate: '2026-09-10' },
    { id: 'a5', classroomId: 'old', subjectId: 'oldsub', title: 'งานภาคเรียนก่อน', dueDate: '2026-01-10' },
  ],
  submissions: [
    { assignmentId: 'a1', studentId: 's1', status: 'submitted' },
    { assignmentId: 'a2', studentId: 's1', status: 'late' },
    { assignmentId: 'a3', studentId: 's2', status: 'missing' },
  ],
}

export const SCOPE = resolveSemesterScope(CONTEXT, '2569|1')

export function filters(patch: Partial<MissingReportFilters> = {}): MissingReportFilters {
  return { ...DEFAULT_MISSING_FILTERS, ...patch }
}
