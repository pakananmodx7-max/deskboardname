import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'

import { buildInitialActivity } from '@/demo/activity'
import { buildInitialAssignments } from '@/demo/assignments'
import { buildInitialAttendance } from '@/demo/attendance'
import { ALL_CLASSROOM_STUDENTS, buildInitialClassrooms } from '@/demo/classrooms'
import { buildInitialGrades } from '@/demo/grades'
import {
  computeAtRiskStudents,
  computeAttendanceSummary,
  computeGradeStats,
  computeMissingCountByStudent,
  countStudentsWithMissingWork,
} from '@/demo/selectors'
import { DEMO_CLASSROOM_NAME, DEMO_STUDENTS } from '@/demo/students'
import { getStudentIdsForClassrooms } from '@/demo/subject-selectors'
import { buildInitialSubjectAssignments, buildInitialSubjects, buildInitialTopics } from '@/demo/subjects'
import type {
  DemoAssignment,
  DemoAttendanceStatus,
  DemoClassroomInfo,
  DemoGradeScores,
  DemoStudent,
  DemoSubject,
  DemoSubjectAssignment,
  DemoSubjectAttendance,
  DemoSubmission,
  DemoTopic,
  SubjectAssignmentType,
  SubmissionStatus,
} from '@/demo/types'

export interface NewStudentInput {
  firstName: string
  lastName: string
  nickname?: string
  studentCode?: string
  number?: number
}

export interface NewSubjectInput {
  name: string
  code: string
  academicYear: string
  semester: string
  description: string
  classroomIds: string[]
}

export interface NewTopicInput {
  title: string
  description: string
  order: number
  taughtDate: string
}

export interface NewSubjectAssignmentInput {
  topicId: string | null
  title: string
  type: SubjectAssignmentType
  maxScore: number
  dueDate: string
  description: string
}

interface DemoClassroomState {
  classroomName: string
  students: DemoStudent[]
  attendance: Record<string, DemoAttendanceStatus>
  assignments: DemoAssignment[]
  grades: Record<string, DemoGradeScores>
  activity: { id: string; timeLabel: string; message: string }[]

  classrooms: DemoClassroomInfo[]
  allStudents: DemoStudent[]
  subjects: DemoSubject[]
  topics: DemoTopic[]
  subjectAssignments: DemoSubjectAssignment[]
  subjectAttendance: DemoSubjectAttendance
}

function buildInitialState(): DemoClassroomState {
  const classrooms = buildInitialClassrooms()
  const studentIdsForClassrooms = (classroomIds: string[]) =>
    getStudentIdsForClassrooms(classroomIds, classrooms)

  return {
    classroomName: DEMO_CLASSROOM_NAME,
    students: DEMO_STUDENTS,
    attendance: buildInitialAttendance(),
    assignments: buildInitialAssignments(),
    grades: buildInitialGrades(),
    activity: buildInitialActivity(),

    classrooms,
    allStudents: ALL_CLASSROOM_STUDENTS,
    subjects: buildInitialSubjects(),
    topics: buildInitialTopics(),
    subjectAssignments: buildInitialSubjectAssignments(studentIdsForClassrooms),
    subjectAttendance: {},
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

  addSubject: (input: NewSubjectInput) => DemoSubject
  addTopic: (subjectId: string, input: NewTopicInput) => void
  updateTopic: (topicId: string, patch: Partial<Omit<DemoTopic, 'id' | 'subjectId'>>) => void
  deleteTopic: (topicId: string) => void
  addSubjectAssignment: (subjectId: string, input: NewSubjectAssignmentInput) => DemoSubjectAssignment
  updateSubjectAssignment: (
    assignmentId: string,
    patch: Partial<Omit<DemoSubjectAssignment, 'id' | 'subjectId' | 'submissions'>>,
  ) => void
  setSubmissionStatus: (assignmentId: string, studentId: string, status: SubmissionStatus) => void
  bulkSetSubmissionStatus: (assignmentId: string, studentIds: string[], status: SubmissionStatus) => void
  setSubmissionScore: (assignmentId: string, studentId: string, score: number | null) => void
  setSubmissionNote: (assignmentId: string, studentId: string, note: string) => void
  setSubjectAttendanceStatus: (
    subjectId: string,
    date: string,
    studentId: string,
    status: DemoAttendanceStatus,
  ) => void
  saveSubjectAttendance: (subjectId: string, date: string) => void
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

  // ---- Subject workspace actions ----

  function addSubject(input: NewSubjectInput): DemoSubject {
    const subject: DemoSubject = {
      id: `demo-subject-${Date.now()}`,
      name: input.name,
      code: input.code,
      academicYear: input.academicYear,
      semester: input.semester,
      description: input.description,
      classroomIds: input.classroomIds,
    }
    setState((prev) => ({ ...prev, subjects: [...prev.subjects, subject] }))
    logActivity(`สร้างรายวิชาใหม่: ${subject.name}`)
    return subject
  }

  function addTopic(subjectId: string, input: NewTopicInput) {
    const topic: DemoTopic = {
      id: `demo-topic-${Date.now()}`,
      subjectId,
      title: input.title,
      description: input.description,
      order: input.order,
      taughtDate: input.taughtDate,
    }
    setState((prev) => ({ ...prev, topics: [...prev.topics, topic] }))
    logActivity(`เพิ่มหัวข้อใหม่: ${topic.title}`)
  }

  function updateTopic(topicId: string, patch: Partial<Omit<DemoTopic, 'id' | 'subjectId'>>) {
    setState((prev) => ({
      ...prev,
      topics: prev.topics.map((t) => (t.id === topicId ? { ...t, ...patch } : t)),
    }))
  }

  function deleteTopic(topicId: string) {
    setState((prev) => ({
      ...prev,
      topics: prev.topics.filter((t) => t.id !== topicId),
      subjectAssignments: prev.subjectAssignments.map((a) =>
        a.topicId === topicId ? { ...a, topicId: null } : a,
      ),
    }))
  }

  function addSubjectAssignment(subjectId: string, input: NewSubjectAssignmentInput): DemoSubjectAssignment {
    const subject = state.subjects.find((s) => s.id === subjectId)
    const studentIds = subject ? getStudentIdsForClassrooms(subject.classroomIds, state.classrooms) : []

    const submissions: Record<string, DemoSubmission> = Object.fromEntries(
      studentIds.map((id) => [id, { status: 'not_submitted' as SubmissionStatus, score: null, note: '' }]),
    )

    const assignment: DemoSubjectAssignment = {
      id: `demo-subject-assignment-${Date.now()}`,
      subjectId,
      topicId: input.topicId,
      title: input.title,
      type: input.type,
      maxScore: input.maxScore,
      dueDate: input.dueDate,
      description: input.description,
      submissions,
    }

    setState((prev) => ({ ...prev, subjectAssignments: [...prev.subjectAssignments, assignment] }))
    logActivity(`สร้างงานใหม่ในรายวิชา: ${assignment.title}`)
    return assignment
  }

  function updateSubjectAssignment(
    assignmentId: string,
    patch: Partial<Omit<DemoSubjectAssignment, 'id' | 'subjectId' | 'submissions'>>,
  ) {
    setState((prev) => ({
      ...prev,
      subjectAssignments: prev.subjectAssignments.map((a) =>
        a.id === assignmentId ? { ...a, ...patch } : a,
      ),
    }))
  }

  function setSubmissionStatus(assignmentId: string, studentId: string, status: SubmissionStatus) {
    setState((prev) => ({
      ...prev,
      subjectAssignments: prev.subjectAssignments.map((a) => {
        if (a.id !== assignmentId) return a
        const existing = a.submissions[studentId] ?? { status: 'not_submitted', score: null, note: '' }
        return { ...a, submissions: { ...a.submissions, [studentId]: { ...existing, status } } }
      }),
    }))
  }

  function bulkSetSubmissionStatus(assignmentId: string, studentIds: string[], status: SubmissionStatus) {
    const idSet = new Set(studentIds)
    setState((prev) => ({
      ...prev,
      subjectAssignments: prev.subjectAssignments.map((a) => {
        if (a.id !== assignmentId) return a
        const submissions = { ...a.submissions }
        for (const studentId of idSet) {
          const existing = submissions[studentId] ?? { status: 'not_submitted', score: null, note: '' }
          submissions[studentId] = { ...existing, status }
        }
        return { ...a, submissions }
      }),
    }))
  }

  function setSubmissionScore(assignmentId: string, studentId: string, score: number | null) {
    setState((prev) => ({
      ...prev,
      subjectAssignments: prev.subjectAssignments.map((a) => {
        if (a.id !== assignmentId) return a
        const existing = a.submissions[studentId] ?? { status: 'not_submitted', score: null, note: '' }
        const clamped = score === null ? null : Math.max(0, Math.min(a.maxScore, score))
        return { ...a, submissions: { ...a.submissions, [studentId]: { ...existing, score: clamped } } }
      }),
    }))
  }

  function setSubmissionNote(assignmentId: string, studentId: string, note: string) {
    setState((prev) => ({
      ...prev,
      subjectAssignments: prev.subjectAssignments.map((a) => {
        if (a.id !== assignmentId) return a
        const existing = a.submissions[studentId] ?? { status: 'not_submitted', score: null, note: '' }
        return { ...a, submissions: { ...a.submissions, [studentId]: { ...existing, note } } }
      }),
    }))
  }

  function setSubjectAttendanceStatus(
    subjectId: string,
    date: string,
    studentId: string,
    status: DemoAttendanceStatus,
  ) {
    setState((prev) => {
      const bySubject = prev.subjectAttendance[subjectId] ?? {}
      const byDate = bySubject[date] ?? {}
      return {
        ...prev,
        subjectAttendance: {
          ...prev.subjectAttendance,
          [subjectId]: { ...bySubject, [date]: { ...byDate, [studentId]: status } },
        },
      }
    })
  }

  function saveSubjectAttendance(subjectId: string, date: string) {
    const subject = state.subjects.find((s) => s.id === subjectId)
    logActivity(`บันทึกการเช็คชื่อวิชา${subject ? ` ${subject.name}` : ''} วันที่ ${date} แล้ว`)
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
    addSubject,
    addTopic,
    updateTopic,
    deleteTopic,
    addSubjectAssignment,
    updateSubjectAssignment,
    setSubmissionStatus,
    bulkSetSubmissionStatus,
    setSubmissionScore,
    setSubmissionNote,
    setSubjectAttendanceStatus,
    saveSubjectAttendance,
  }

  return <DemoClassroomContext.Provider value={value}>{children}</DemoClassroomContext.Provider>
}

export function useDemoClassroom(): DemoClassroomContextValue {
  const ctx = useContext(DemoClassroomContext)
  if (!ctx) throw new Error('useDemoClassroom must be used within DemoClassroomProvider')
  return ctx
}
