import { ClipboardList, Plus } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Progress } from '@/components/ui/progress'
import { RowActionsMenu } from '@/components/ui/row-actions-menu'
import { useToast } from '@/components/ui/toast'
import { AssignmentDialog } from '@/features/subjects-real/assignment-dialog'
import { CopyAssignmentDialog } from '@/features/subjects-real/copy-assignment-dialog'
import { buildAssignmentDetailPath } from '@/features/subjects-shared/subject-classroom-nav'
import { toFriendlyErrorMessage } from '@/lib/errors'
import {
  archiveAssignment,
  deleteAssignmentPermanently,
  getAssignments,
  getSubmissionSummary,
  getSubmissions,
  hasAssignmentSubmissions,
} from '@/services/assignment-service'
import type { Assignment, AssignmentCopyOutcome } from '@/types/assignment'
import type { Subject } from '@/types/subject'

interface AssignmentsTabProps {
  subject: Subject
  classroomId: string
}

/**
 * Real, Supabase-backed assignments list — strictly scoped to
 * subjectId+classroomId (assignment-service.ts's getAssignments never
 * merges another linked classroom's assignments, even ones with a
 * matching title). The primary place assignments are created, edited,
 * copied to another classroom, archived, or permanently deleted — both
 * "เก็บถาวร" (reversible) and "ลบงาน" (permanent, allowed even with
 * existing submissions/scores — see deleteAssignmentPermanently) are
 * always available side by side, never one forced in place of the other.
 */
export function AssignmentsTab({ subject, classroomId }: AssignmentsTabProps) {
  const { toast } = useToast()
  const navigate = useNavigate()

  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [summaries, setSummaries] = useState<Record<string, { submitted: number; total: number }>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [createOpen, setCreateOpen] = useState(false)
  const [editingAssignment, setEditingAssignment] = useState<Assignment | null>(null)
  const [archivingAssignment, setArchivingAssignment] = useState<Assignment | null>(null)
  const [copyingAssignment, setCopyingAssignment] = useState<Assignment | null>(null)
  const [checkingDeleteId, setCheckingDeleteId] = useState<string | null>(null)
  const [deletingAssignment, setDeletingAssignment] = useState<{ assignment: Assignment; hasSubmissions: boolean } | null>(null)

  const refresh = useCallback(() => {
    setLoading(true)
    setError(null)
    return getAssignments(subject.id, classroomId)
      .then(async (rows) => {
        setAssignments(rows)
        const submissionRows = await Promise.all(rows.map((a) => getSubmissions(a.id)))
        const nextSummaries: Record<string, { submitted: number; total: number }> = {}
        rows.forEach((a, i) => {
          const summary = getSubmissionSummary(submissionRows[i])
          nextSummaries[a.id] = { submitted: summary.submitted, total: summary.total }
        })
        setSummaries(nextSummaries)
      })
      .catch((err: unknown) => setError(toFriendlyErrorMessage(err)))
      .finally(() => setLoading(false))
  }, [subject.id, classroomId])

  useEffect(() => {
    refresh()
  }, [refresh])

  async function handleArchive() {
    if (!archivingAssignment) return
    try {
      await archiveAssignment(archivingAssignment.id)
      toast(`เก็บถาวรงาน "${archivingAssignment.title}" แล้ว`)
      setArchivingAssignment(null)
      refresh()
    } catch (err) {
      toast(toFriendlyErrorMessage(err, 'ไม่สามารถเก็บถาวรงานได้'))
    }
  }

  function handleCopied(outcomes: AssignmentCopyOutcome[]) {
    const succeeded = outcomes.filter((o) => o.ok).length
    const failed = outcomes.length - succeeded
    if (succeeded > 0 && failed === 0) {
      toast(`คัดลอกงานไป ${succeeded} ห้องแล้ว`)
    } else if (succeeded > 0 && failed > 0) {
      toast(`คัดลอกงานไป ${succeeded} ห้องสำเร็จ, ${failed} ห้องไม่สำเร็จ`)
    } else {
      toast('ไม่สามารถคัดลอกงานไปห้องที่เลือกได้')
    }
    refresh()
  }

  /**
   * "ลบงาน" always permanently deletes once confirmed — deletion is never
   * blocked by existing submissions/scores (see assignment-service.ts's
   * deleteAssignmentPermanently). This only checks whether the assignment
   * has any dependent student data so the RIGHT confirmation copy shows:
   * a plain "ลบงานนี้?" when there's nothing to lose, or the stronger
   * "ลบงานและข้อมูลนักเรียน?" warning (naming submissions/scores/status/
   * files) when there is. "เก็บถาวร" stays a fully separate, optional
   * action — never forced as an alternative to deleting.
   */
  async function handleDeleteMenuClick(assignment: Assignment) {
    setCheckingDeleteId(assignment.id)
    try {
      const hasSubmissions = await hasAssignmentSubmissions(assignment.id)
      setDeletingAssignment({ assignment, hasSubmissions })
    } catch (err) {
      toast(toFriendlyErrorMessage(err, 'ไม่สามารถตรวจสอบข้อมูลงานได้'))
    } finally {
      setCheckingDeleteId(null)
    }
  }

  async function handleDeletePermanently() {
    if (!deletingAssignment) return
    const { assignment } = deletingAssignment
    try {
      await deleteAssignmentPermanently(assignment.id)
      toast(`ลบงาน "${assignment.title}" แล้ว`)
      setDeletingAssignment(null)
      refresh()
    } catch (err) {
      toast(toFriendlyErrorMessage(err, 'ไม่สามารถลบงานนี้ได้'))
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{loading ? 'กำลังโหลด...' : `${assignments.length} งาน`}</p>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="size-4" />
          เพิ่มงาน
        </Button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {!loading && assignments.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <ClipboardList className="size-6" />
            </div>
            <p className="text-sm font-medium">ยังไม่มีงานในห้องเรียนนี้</p>
            <Button onClick={() => setCreateOpen(true)}>เพิ่มงาน</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {assignments.map((assignment) => {
            const summary = summaries[assignment.id] ?? { submitted: 0, total: 0 }
            const percent = summary.total > 0 ? Math.round((summary.submitted / summary.total) * 100) : 0

            return (
              <Card
                key={assignment.id}
                className="cursor-pointer transition-shadow hover:shadow-md"
                onClick={() => navigate(buildAssignmentDetailPath(subject.id, classroomId, assignment.id))}
              >
                <CardContent className="space-y-3 pt-5">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-semibold">{assignment.title}</p>
                    <div className="flex items-center gap-1">
                      {assignment.isArchived && <Badge variant="outline">เก็บถาวร</Badge>}
                      <RowActionsMenu
                        actions={[
                          { key: 'edit', label: 'แก้ไขงาน', onSelect: () => setEditingAssignment(assignment) },
                          { key: 'copy', label: 'คัดลอกไปห้องอื่น', onSelect: () => setCopyingAssignment(assignment) },
                          {
                            key: 'archive',
                            label: 'เก็บถาวร',
                            onSelect: () => setArchivingAssignment(assignment),
                            disabled: assignment.isArchived,
                          },
                          {
                            key: 'delete',
                            label: 'ลบงาน',
                            destructive: true,
                            separatorBefore: true,
                            disabled: checkingDeleteId === assignment.id,
                            onSelect: () => handleDeleteMenuClick(assignment),
                          },
                        ]}
                      />
                    </div>
                  </div>
                  <Progress value={percent} />
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                      {summary.submitted}/{summary.total} ส่งแล้ว
                    </span>
                    <span>{assignment.dueDate ? `กำหนดส่ง ${assignment.dueDate}` : 'ไม่มีกำหนดส่ง'}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">{assignment.maxScore} คะแนนเต็ม</p>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      <AssignmentDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        subjectId={subject.id}
        classroomId={classroomId}
        onSaved={refresh}
      />

      {editingAssignment && (
        <AssignmentDialog
          open={Boolean(editingAssignment)}
          onOpenChange={(open) => !open && setEditingAssignment(null)}
          subjectId={subject.id}
          classroomId={classroomId}
          assignment={editingAssignment}
          onSaved={() => {
            setEditingAssignment(null)
            refresh()
          }}
        />
      )}

      {archivingAssignment && (
        <ConfirmDialog
          open={Boolean(archivingAssignment)}
          onOpenChange={(open) => !open && setArchivingAssignment(null)}
          title="เก็บถาวรงาน"
          description={`เก็บถาวร "${archivingAssignment.title}"?\nงานและคะแนนของนักเรียนจะยังคงอยู่ในระบบ`}
          confirmLabel="เก็บถาวร"
          onConfirm={handleArchive}
        />
      )}

      {copyingAssignment && (
        <CopyAssignmentDialog
          open={Boolean(copyingAssignment)}
          onOpenChange={(open) => !open && setCopyingAssignment(null)}
          assignment={copyingAssignment}
          onCopied={handleCopied}
        />
      )}

      {deletingAssignment && (
        <ConfirmDialog
          open={Boolean(deletingAssignment)}
          onOpenChange={(open) => !open && setDeletingAssignment(null)}
          title={deletingAssignment.hasSubmissions ? 'ลบงานและข้อมูลนักเรียน?' : 'ลบงานนี้?'}
          description={
            deletingAssignment.hasSubmissions
              ? 'งานนี้มีข้อมูลการส่งงานหรือคะแนนของนักเรียน\nหากลบงาน ข้อมูลการส่งงาน คะแนน สถานะ และไฟล์งานที่เกี่ยวข้องจะถูกลบด้วย\nและไม่สามารถกู้คืนได้'
              : 'เมื่อลบแล้วจะไม่สามารถกู้คืนได้'
          }
          confirmLabel={deletingAssignment.hasSubmissions ? 'ลบงานและข้อมูลทั้งหมด' : 'ลบงาน'}
          destructive
          onConfirm={handleDeletePermanently}
        />
      )}
    </div>
  )
}
