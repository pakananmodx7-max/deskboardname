import { ArrowLeft } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { useDemoClassroom } from '@/demo/demo-context'
import { computeAssignmentSummary, getStudentsForClassrooms } from '@/demo/subject-selectors'
import {
  SUBJECT_ASSIGNMENT_TYPE_LABEL,
  SUBMISSION_STATUS_LABEL,
  SUBMISSION_STATUS_ORDER,
  type SubmissionStatus,
} from '@/demo/types'
import { cn } from '@/lib/utils'

const statusButtonStyle: Record<SubmissionStatus, string> = {
  submitted: 'data-[active=true]:bg-success data-[active=true]:text-success-foreground',
  not_submitted: 'data-[active=true]:bg-secondary data-[active=true]:text-secondary-foreground data-[active=true]:border-foreground/30',
  late: 'data-[active=true]:bg-warning data-[active=true]:text-warning-foreground',
  missing: 'data-[active=true]:bg-destructive data-[active=true]:text-destructive-foreground',
}

export function SubjectAssignmentDetailPage() {
  const { subjectId, assignmentId } = useParams<{ subjectId: string; assignmentId: string }>()
  const navigate = useNavigate()
  const { toast } = useToast()
  const {
    subjects,
    classrooms,
    allStudents,
    subjectAssignments,
    setSubmissionStatus,
    bulkSetSubmissionStatus,
    setSubmissionScore,
    setSubmissionNote,
  } = useDemoClassroom()

  const [selectedIds, setSelectedIds] = useState<string[]>([])

  const subject = subjects.find((s) => s.id === subjectId)
  const assignment = subjectAssignments.find((a) => a.id === assignmentId && a.subjectId === subjectId)

  const students = useMemo(
    () =>
      subject
        ? getStudentsForClassrooms(subject.classroomIds, classrooms, allStudents).sort((a, b) => a.number - b.number)
        : [],
    [subject, classrooms, allStudents],
  )

  if (!subject || !assignment) {
    return <Navigate to="/teacher/subjects" replace />
  }

  // Re-bind to a fresh const so nested function declarations below (which
  // TypeScript can't narrow through due to hoisting) still see a
  // guaranteed-defined assignment instead of the original possibly-undefined type.
  const currentAssignment = assignment

  const summary = computeAssignmentSummary(currentAssignment)
  const allSelected = selectedIds.length > 0 && selectedIds.length === students.length

  function toggleSelectAll() {
    setSelectedIds(allSelected ? [] : students.map((s) => s.id))
  }

  function toggleSelect(studentId: string) {
    setSelectedIds((prev) => (prev.includes(studentId) ? prev.filter((id) => id !== studentId) : [...prev, studentId]))
  }

  function handleBulkStatus(status: SubmissionStatus) {
    if (selectedIds.length === 0) return
    bulkSetSubmissionStatus(currentAssignment.id, selectedIds, status)
    toast(`ทำเครื่องหมาย "${SUBMISSION_STATUS_LABEL[status]}" ให้ ${selectedIds.length} คนแล้ว`)
    setSelectedIds([])
  }

  function handleScoreChange(studentId: string, raw: string) {
    if (raw === '') {
      setSubmissionScore(currentAssignment.id, studentId, null)
      return
    }
    const parsed = Number(raw)
    if (Number.isNaN(parsed)) return
    setSubmissionScore(currentAssignment.id, studentId, parsed)
  }

  return (
    <div className="space-y-6">
      <div>
        <button
          type="button"
          onClick={() => navigate(`/teacher/subjects/${subject.id}`)}
          className="mb-2 flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          กลับไปที่ {subject.name}
        </button>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight">{assignment.title}</h1>
          <Badge variant="outline">{SUBJECT_ASSIGNMENT_TYPE_LABEL[assignment.type]}</Badge>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {assignment.maxScore} คะแนนเต็ม · Due {assignment.dueDate}
        </p>
        {assignment.description && <p className="mt-1 text-sm text-muted-foreground">{assignment.description}</p>}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">สรุปการส่งงาน</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">ส่งแล้ว</span>
            <span className="font-semibold">{summary.submitted}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">ยังไม่ส่ง</span>
            <span className="font-semibold">{summary.notSubmitted}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">ส่งช้า</span>
            <span className="font-semibold">{summary.late}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">ขาดส่ง</span>
            <span className="font-semibold">{summary.missing}</span>
          </div>
          <div className="ml-auto flex items-center gap-2 border-l border-border pl-6">
            <span className="text-muted-foreground">คะแนนเฉลี่ย</span>
            <span className="font-semibold">
              {summary.average !== null ? summary.average.toFixed(1) : '-'}/{assignment.maxScore}
            </span>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} className="size-4 rounded border-input" />
          เลือกทั้งหมด
        </label>
        <span className="text-xs text-muted-foreground">{selectedIds.length > 0 && `เลือก ${selectedIds.length} คน`}</span>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button variant="outline" size="sm" disabled={selectedIds.length === 0} onClick={() => handleBulkStatus('submitted')}>
            ทำเครื่องหมาย &ldquo;ส่งแล้ว&rdquo;
          </Button>
          <Button variant="outline" size="sm" disabled={selectedIds.length === 0} onClick={() => handleBulkStatus('not_submitted')}>
            ทำเครื่องหมาย &ldquo;ยังไม่ส่ง&rdquo;
          </Button>
          <Button variant="outline" size="sm" disabled={selectedIds.length === 0} onClick={() => handleBulkStatus('late')}>
            ทำเครื่องหมาย &ldquo;ส่งช้า&rdquo;
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="px-4 py-3"></th>
                  <th className="px-3 py-3 font-medium">เลขที่</th>
                  <th className="px-3 py-3 font-medium">ชื่อ</th>
                  <th className="px-3 py-3 font-medium">ห้อง</th>
                  <th className="px-3 py-3 font-medium">สถานะ</th>
                  <th className="px-3 py-3 font-medium">คะแนน</th>
                  <th className="px-3 py-3 font-medium">หมายเหตุ</th>
                </tr>
              </thead>
              <tbody>
                {students.map((student) => {
                  const submission = assignment.submissions[student.id] ?? {
                    status: 'not_submitted' as SubmissionStatus,
                    score: null,
                    note: '',
                  }
                  return (
                    <tr key={student.id} className="border-b border-border last:border-0">
                      <td className="px-4 py-2">
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(student.id)}
                          onChange={() => toggleSelect(student.id)}
                          className="size-4 rounded border-input"
                        />
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{student.number}</td>
                      <td className="px-3 py-2 font-medium">
                        {student.firstName} {student.lastName}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{student.classroom}</td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1.5">
                          {SUBMISSION_STATUS_ORDER.map((status) => (
                            <button
                              key={status}
                              type="button"
                              data-active={submission.status === status}
                              onClick={() => setSubmissionStatus(assignment.id, student.id, status)}
                              className={cn(
                                'rounded-md border border-border px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent',
                                statusButtonStyle[status],
                              )}
                            >
                              {SUBMISSION_STATUS_LABEL[status]}
                            </button>
                          ))}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Input
                            type="number"
                            min={0}
                            max={assignment.maxScore}
                            value={submission.score ?? ''}
                            onChange={(e) => handleScoreChange(student.id, e.target.value)}
                            className="h-8 w-16 text-center"
                          />
                          <span>/ {assignment.maxScore}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          value={submission.note}
                          onChange={(e) => setSubmissionNote(assignment.id, student.id, e.target.value)}
                          placeholder="หมายเหตุ"
                          className="h-8 w-36"
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
