import { ArrowLeft } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { AssignmentResourcesDisclosure } from '@/features/student-portal/assignment-resources-disclosure'
import { MySubmissionSection } from '@/features/student-portal/my-submission-section'
import { toFriendlyErrorMessage } from '@/lib/errors'
import { getClassroomById } from '@/services/classroom-service'
import { getMyAssignments, getMyStudentProfile, getMySubjects } from '@/services/student-portal-service'
import type { Classroom } from '@/types/classroom'
import type { MyAssignment, MyStudentProfile, MySubject } from '@/types/student-portal'

function formatDate(date: string): string {
  return new Date(date).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' })
}

/**
 * /student/subjects/:subjectId/assignments/:assignmentId — a single
 * assignment's detail, from the signed-in student's own point of view:
 * title/subject/classroom/due date/max score/description (all read-only,
 * same row every classmate sees), any teacher-attached resources
 * (AssignmentResourcesDisclosure, reused from 0013), and — new in this
 * feature — "ส่งงานของฉัน" (MySubmissionSection), the student's own
 * submission.
 *
 * PAGE ERROR ISOLATION: subject identity, the assignment itself, and the
 * two small pieces of context MySubmissionSection needs to build a
 * storage path (the classroom's owning teacherId, and the student's own
 * id) each load independently. A failure resolving teacherId/studentId
 * only disables "ส่งงานของฉัน" specifically — title/description/due
 * date/max score/resources still render normally, matching Section 10's
 * "no single query may blank the whole page" requirement carried over
 * from the Subject Workspace.
 */
export function StudentAssignmentDetailPage() {
  const { subjectId, assignmentId } = useParams<{ subjectId: string; assignmentId: string }>()
  const navigate = useNavigate()

  const [subject, setSubject] = useState<MySubject | null | undefined>(undefined)
  const [subjectLoading, setSubjectLoading] = useState(true)
  const [subjectError, setSubjectError] = useState<string | null>(null)

  const [assignment, setAssignment] = useState<MyAssignment | null | undefined>(undefined)
  const [assignmentLoading, setAssignmentLoading] = useState(true)
  const [assignmentError, setAssignmentError] = useState<string | null>(null)

  const [classroom, setClassroom] = useState<Classroom | null>(null)
  const [classroomError, setClassroomError] = useState<string | null>(null)

  const [profile, setProfile] = useState<MyStudentProfile | null>(null)
  const [profileError, setProfileError] = useState<string | null>(null)

  useEffect(() => {
    if (!subjectId) return
    let active = true
    setSubjectLoading(true)
    setSubjectError(null)
    getMySubjects()
      .then((subjects) => {
        if (active) setSubject(subjects.find((s) => s.id === subjectId) ?? null)
      })
      .catch((err: unknown) => {
        if (active) setSubjectError(toFriendlyErrorMessage(err))
      })
      .finally(() => {
        if (active) setSubjectLoading(false)
      })
    return () => {
      active = false
    }
  }, [subjectId])

  useEffect(() => {
    if (!subject || !assignmentId) return
    let active = true
    setAssignmentLoading(true)
    setAssignmentError(null)
    getMyAssignments(subject.id, subject.classroomId)
      .then((rows) => {
        if (active) setAssignment(rows.find((a) => a.id === assignmentId) ?? null)
      })
      .catch((err: unknown) => {
        if (active) setAssignmentError(toFriendlyErrorMessage(err))
      })
      .finally(() => {
        if (active) setAssignmentLoading(false)
      })
    return () => {
      active = false
    }
  }, [subject, assignmentId])

  useEffect(() => {
    if (!subject) return
    let active = true
    getClassroomById(subject.classroomId)
      .then((row) => {
        if (active) setClassroom(row)
      })
      .catch((err: unknown) => {
        if (active) setClassroomError(toFriendlyErrorMessage(err))
      })
    return () => {
      active = false
    }
  }, [subject])

  useEffect(() => {
    let active = true
    getMyStudentProfile()
      .then((row) => {
        if (active) setProfile(row)
      })
      .catch((err: unknown) => {
        if (active) setProfileError(toFriendlyErrorMessage(err))
      })
    return () => {
      active = false
    }
  }, [])

  if (!subjectId || !assignmentId) return <Navigate to="/student/subjects" replace />
  if (subject === undefined || subjectLoading) {
    return <p className="text-sm text-muted-foreground">กำลังโหลด...</p>
  }
  if (subjectError) return <p className="text-sm text-destructive">{subjectError}</p>
  if (subject === null) return <Navigate to="/student/subjects" replace />

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={() => navigate(`/student/subjects/${subjectId}`)}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        กลับไปที่วิชา
      </button>

      {assignmentLoading ? (
        <p className="text-sm text-muted-foreground">กำลังโหลด...</p>
      ) : assignmentError ? (
        <p className="text-sm text-destructive">{assignmentError}</p>
      ) : !assignment ? (
        <p className="text-sm text-muted-foreground">ไม่พบงานนี้ หรืองานนี้ไม่ได้อยู่ในวิชานี้</p>
      ) : (
        <>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight">{assignment.title}</h1>
              <Badge variant={assignment.status === 'submitted' ? 'success' : assignment.status === 'not_submitted' ? 'outline' : 'warning'}>
                {assignment.status === 'not_submitted' && 'ยังไม่ส่ง'}
                {assignment.status === 'submitted' && 'ส่งแล้ว'}
                {assignment.status === 'late' && 'ส่งช้า'}
                {assignment.status === 'missing' && 'ขาดส่ง'}
              </Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {subject.name} · {subject.classroomName}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              กำหนดส่ง {assignment.dueDate ? formatDate(assignment.dueDate) : 'ไม่มีกำหนดส่ง'} · คะแนนเต็ม {assignment.maxScore}
            </p>
            {assignment.description && <p className="mt-2 text-sm">{assignment.description}</p>}
          </div>

          <AssignmentResourcesDisclosure assignmentId={assignment.id} />

          {classroomError || profileError ? (
            <p className="text-sm text-destructive">
              {classroomError ?? profileError ?? 'ไม่สามารถโหลดข้อมูลสำหรับส่งงานได้ในขณะนี้'}
            </p>
          ) : !classroom || !profile ? (
            <p className="text-sm text-muted-foreground">กำลังโหลดส่วนส่งงาน...</p>
          ) : (
            <MySubmissionSection
              assignmentId={assignment.id}
              subjectId={subject.id}
              classroomId={subject.classroomId}
              teacherId={classroom.teacherId}
              studentId={profile.id}
              dueDate={assignment.dueDate}
              maxScore={assignment.maxScore}
            />
          )}
        </>
      )}
    </div>
  )
}
