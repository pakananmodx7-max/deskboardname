import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'

import { buildInitialActivity } from '@/demo/activity'
import { buildInitialAssignments } from '@/demo/assignments'
import { buildInitialAttendance } from '@/demo/attendance'
import { buildInitialGrades } from '@/demo/grades'
import {
  computeAtRiskStudents,
  computeAttendanceSummary,
  computeGradeStats,
  computeMissingCountByStudent,
  countStudentsWithMissingWork,
} from '@/demo/selectors'
import { DEMO_CLASSROOM_NAME, DEMO_STUDENTS } from '@/demo/students'
import type {
  DemoAssignment,
  DemoAttendanceStatus,
  DemoGradeScores,
  DemoStudent,
} from '@/demo/types'

export interface NewStudentInput {
  firstName: string
  lastName: string
  nickname?: string
  studentCode?: string
  number?: number
}

interface DemoClassroomState {
  classroomName: string
  students: DemoStudent[]
  attendance: Record<string, DemoAttendanceStatus>
  assignments: DemoAssignment[]
  grades: Record<string, DemoGradeScores>
  activity: { id: string; timeLabel: string; message: string }[]
}

function buildInitialState(): DemoClassroomState {
  return {
    classroomName: DEMO_CLASSROOM_NAME,
    students: DEMO_STUDENTS,
    attendance: buildInitialAttendance(),
    assignments: buildInitialAssignments(),
    grades: buildInitialGrades(),
    activity: buildInitialActivity(),
  }
}

function nowLabel(): string {
  return new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })
}

interface DemoClassroomContextValue extends DemoClassroomState {
  missingByStudent: Record<string, number>
  studentsWithMissingWork: number
  attendanceSummary: ReturnType<typeof computeAttendanceSummary>
  atRiskStudents: ReturnType<typeof computeAtRiskStudents>
  gradeStats: ReturnType<typeof computeGradeStats>

  setAttendanceStatus: (studentId: string, status: DemoAttendanceStatus) => void
  saveAttendance: () => void
  addStudent: (input: NewStudentInput) => DemoStudent
  updateStudent: (studentId: string, patch: Partial<Omit<DemoStudent, 'id'>>) => void
  importStudents: (rows: NewStudentInput[]) => number
  addAssignment: (title: string, dueDate: string) => void
  setSubmission: (assignmentId: string, studentId: string, submitted: boolean) => void
  updateGradeScore: (studentId: string, key: keyof DemoGradeScores, value: number) => void
  logActivity: (message: string) => void
  resetDemo: () => void
}

const DemoClassroomContext = createContext<DemoClassroomContextValue | null>(null)

export function DemoClassroomProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DemoClassroomState>(buildInitialState)

  function logActivity(message: string) {
    setState((prev) => ({
      ...prev,
      activity: [{ id: `activity-${Date.now()}-${Math.random()}`, timeLabel: nowLabel(), message }, ...prev.activity],
    }))
  }

  function setAttendanceStatus(studentId: string, status: DemoAttendanceStatus) {
    setState((prev) => ({ ...prev, attendance: { ...prev.attendance, [studentId]: status } }))
  }

  function saveAttendance() {
    logActivity('บันทึกการเช็คชื่อประจำวันแล้ว')
  }

  function addStudent(input: NewStudentInput): DemoStudent {
    const student: DemoStudent = {
      id: `demo-student-${Date.now()}`,
      number: input.number ?? state.students.length + 1,
      studentCode: input.studentCode || `NEW${state.students.length + 1}`,
      firstName: input.firstName,
      lastName: input.lastName,
      nickname: input.nickname || '',
      classroom: state.classroomName,
      status: 'active',
    }
    setState((prev) => ({ ...prev, students: [...prev.students, student] }))
    logActivity(`เพิ่มนักเรียนใหม่: ${student.firstName} ${student.lastName}`)
    return student
  }

  function updateStudent(studentId: string, patch: Partial<Omit<DemoStudent, 'id'>>) {
    setState((prev) => ({
      ...prev,
      students: prev.students.map((s) => (s.id === studentId ? { ...s, ...patch } : s)),
    }))
  }

  function importStudents(rows: NewStudentInput[]): number {
    const startNumber = state.students.length + 1
    const newStudents: DemoStudent[] = rows.map((row, index) => ({
      id: `demo-student-import-${Date.now()}-${index}`,
      number: row.number ?? startNumber + index,
      studentCode: row.studentCode || `IMP${startNumber + index}`,
      firstName: row.firstName,
      lastName: row.lastName,
      nickname: row.nickname || '',
      classroom: state.classroomName,
      status: 'active',
    }))
    setState((prev) => ({ ...prev, students: [...prev.students, ...newStudents] }))
    logActivity(`นำเข้านักเรียนใหม่ ${newStudents.length} คนจากไฟล์ตัวอย่าง`)
    return newStudents.length
  }

  function addAssignment(title: string, dueDate: string) {
    const assignment: DemoAssignment = {
      id: `demo-assignment-${Date.now()}`,
      title,
      dueDate,
      submissions: Object.fromEntries(state.students.map((s) => [s.id, false])),
    }
    setState((prev) => ({ ...prev, assignments: [...prev.assignments, assignment] }))
    logActivity(`สร้างงานใหม่: ${title}`)
  }

  function setSubmission(assignmentId: string, studentId: string, submitted: boolean) {
    setState((prev) => ({
      ...prev,
      assignments: prev.assignments.map((a) =>
        a.id === assignmentId ? { ...a, submissions: { ...a.submissions, [studentId]: submitted } } : a,
      ),
    }))
  }

  function updateGradeScore(studentId: string, key: keyof DemoGradeScores, value: number) {
    setState((prev) => ({
      ...prev,
      grades: { ...prev.grades, [studentId]: { ...prev.grades[studentId], [key]: value } },
    }))
  }

  function resetDemo() {
    setState(buildInitialState())
  }

  const missingByStudent = useMemo(
    () => computeMissingCountByStudent(state.assignments),
    [state.assignments],
  )
  const studentsWithMissingWork = useMemo(
    () => countStudentsWithMissingWork(missingByStudent),
    [missingByStudent],
  )
  const attendanceSummary = useMemo(() => computeAttendanceSummary(state.attendance), [state.attendance])
  const atRiskStudents = useMemo(
    () => computeAtRiskStudents(state.students, missingByStudent, state.grades, state.attendance),
    [state.students, missingByStudent, state.grades, state.attendance],
  )
  const gradeStats = useMemo(() => computeGradeStats(state.students, state.grades), [state.students, state.grades])

  const value: DemoClassroomContextValue = {
    ...state,
    missingByStudent,
    studentsWithMissingWork,
    attendanceSummary,
    atRiskStudents,
    gradeStats,
    setAttendanceStatus,
    saveAttendance,
    addStudent,
    updateStudent,
    importStudents,
    addAssignment,
    setSubmission,
    updateGradeScore,
    logActivity,
    resetDemo,
  }

  return <DemoClassroomContext.Provider value={value}>{children}</DemoClassroomContext.Provider>
}

export function useDemoClassroom(): DemoClassroomContextValue {
  const ctx = useContext(DemoClassroomContext)
  if (!ctx) throw new Error('useDemoClassroom must be used within DemoClassroomProvider')
  return ctx
}
