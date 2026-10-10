import type { DemoClassroomInfo, DemoStudent, DemoSubject, DemoSubjectAssignment } from '@/demo/types'

import { compareNotifications, NOTIFICATION_PAGE_SIZE, type AppNotification } from './notification-model'
import type { NotificationSource } from './notification-feed-controller'

interface DemoNotificationInput {
  subjects: DemoSubject[]
  classrooms: DemoClassroomInfo[]
  allStudents: DemoStudent[]
  subjectAssignments: DemoSubjectAssignment[]
}

const MINUTE = 60_000

/**
 * Demo Mode teacher feed, built from the demo store's own subjects,
 * classrooms, students and submissions (so every notification opens a
 * real demo page). In memory only — never touches Supabase.
 */
export function buildDemoTeacherNotifications({ subjects, classrooms, allStudents, subjectAssignments }: DemoNotificationInput, now: Date): AppNotification[] {
  const subjectName = new Map(subjects.map((s) => [s.id, s.name]))
  const classroomName = new Map(classrooms.map((c) => [c.id, c.name]))
  const studentById = new Map(allStudents.map((s) => [s.id, s]))
  const at = (minutesAgo: number) => new Date(now.getTime() - minutesAgo * MINUTE).toISOString()
  const out: AppNotification[] = []

  // Ungraded submissions first (those are the ones waiting for review).
  const submitted: { assignment: DemoSubjectAssignment; student: DemoStudent; late: boolean; graded: boolean }[] = []
  for (const assignment of subjectAssignments) {
    if (assignment.isArchived) continue
    for (const [studentId, submission] of Object.entries(assignment.submissions)) {
      const student = studentById.get(studentId)
      if (student && (submission.status === 'submitted' || submission.status === 'late')) {
        submitted.push({ assignment, student, late: submission.status === 'late', graded: submission.score !== null })
      }
    }
  }
  submitted.sort((a, b) => Number(a.graded) - Number(b.graded))

  submitted.slice(0, 6).forEach(({ assignment, student, late, graded }, i) => {
    const resubmission = i === 2
    const minutesAgo = [3, 26, 95, 240, 1500, 4400][i]
    out.push({
      id: `demo-submission-${assignment.id}-${student.id}`,
      type: resubmission ? 'assignment_resubmitted' : 'assignment_submitted',
      title: resubmission ? 'ส่งงานแก้ไขใหม่ — รอตรวจ' : 'ส่งงานใหม่ — รอตรวจ',
      body: null,
      entityType: 'assignment_submission',
      entityId: null,
      metadata: {
        student_id: student.id,
        student_name: `${student.firstName} ${student.lastName}`,
        assignment_id: assignment.id,
        assignment_title: assignment.title,
        subject_id: assignment.subjectId,
        subject_name: subjectName.get(assignment.subjectId) ?? '',
        classroom_id: assignment.classroomId,
        classroom_name: classroomName.get(assignment.classroomId) ?? '',
        submitted_at: at(minutesAgo),
        late,
        resubmission,
      },
      readAt: i < 3 && !graded ? null : at(minutesAgo - 1),
      createdAt: at(minutesAgo),
      origin: 'demo',
    })
  })

  const requester = allStudents.find((s) => s.status === 'active' && classrooms[0]?.studentIds.includes(s.id))
  if (requester && classrooms[0]) {
    out.push({
      id: `demo-link-request-${requester.id}`,
      type: 'link_request',
      title: 'คำขอเชื่อมบัญชีนักเรียน',
      body: null,
      entityType: 'student_link_request',
      entityId: null,
      metadata: { student_id: requester.id, student_name: `${requester.firstName} ${requester.lastName}`, classroom_names: classrooms[0].name, status: 'pending', requested_at: at(48) },
      readAt: null,
      createdAt: at(48),
      origin: 'demo',
    })
  }

  const upcoming = subjectAssignments
    .filter((a) => !a.isArchived && a.dueDate)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .find((a) => a.dueDate >= now.toISOString().slice(0, 10))
  if (upcoming) {
    const pending = Object.values(upcoming.submissions).filter((s) => s.status === 'not_submitted' || s.status === 'missing').length
    out.push({
      id: `demo-deadline-${upcoming.id}`,
      type: 'deadline_teacher',
      title: 'งานใกล้ครบกำหนด',
      body: null,
      entityType: 'assignment',
      entityId: null,
      metadata: {
        assignment_id: upcoming.id,
        assignment_title: upcoming.title,
        subject_id: upcoming.subjectId,
        subject_name: subjectName.get(upcoming.subjectId) ?? '',
        classroom_id: upcoming.classroomId,
        classroom_name: classroomName.get(upcoming.classroomId) ?? '',
        due_date: upcoming.dueDate,
        pending_count: pending,
      },
      readAt: at(600),
      createdAt: at(720),
      origin: 'demo',
    })
  }

  return out.sort(compareNotifications)
}

/** In-memory source with the same paging/read contract as Supabase. */
export function createDemoNotificationSource(seed: AppNotification[]): NotificationSource {
  let rows = [...seed].sort(compareNotifications)
  return {
    key: 'demo',
    loadPage: async (cursor) => {
      const start = cursor ? rows.findIndex((n) => compareNotifications(n, { ...n, createdAt: cursor.createdAt, id: cursor.id }) > 0) : 0
      const from = start < 0 ? rows.length : start
      const page = rows.slice(from, from + NOTIFICATION_PAGE_SIZE)
      return { items: page, hasMore: from + NOTIFICATION_PAGE_SIZE < rows.length }
    },
    countUnread: async () => rows.filter((n) => n.readAt === null).length,
    markRead: async (ids) => {
      const set = new Set(ids)
      const at = new Date().toISOString()
      rows = rows.map((n) => (set.has(n.id) && n.readAt === null ? { ...n, readAt: at } : n))
    },
    markAllRead: async () => {
      const at = new Date().toISOString()
      rows = rows.map((n) => (n.readAt === null ? { ...n, readAt: at } : n))
    },
  }
}
