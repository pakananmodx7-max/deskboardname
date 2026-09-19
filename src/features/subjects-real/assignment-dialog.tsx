import { useEffect, useState, type FormEvent } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/toast'
import { AssignmentResourcesSection } from '@/features/subjects-real/assignment-resources-section'
import { toFriendlyErrorMessage } from '@/lib/errors'
import { copyAssignmentToClassrooms, createAssignment, updateAssignment } from '@/services/assignment-service'
import { getSubjectById, getSubjectClassrooms } from '@/services/subject-service'
import type { Assignment, AssignmentCopyTarget } from '@/types/assignment'
import type { SubjectClassroom } from '@/types/subject'

interface AssignmentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  subjectId: string
  classroomId: string
  /** Present = editing this assignment; absent = creating a new one. */
  assignment?: Assignment | null
  onSaved: () => void
  /** Skip rendering the "สื่อและใบงาน" section — for a caller (the
   * assignment detail page) that already shows its own standalone
   * resource manager on the page itself, so this dialog only needs to
   * handle title/description/due date/max score and never duplicates the
   * resource UI in a second place. Defaults to false (show it), which
   * keeps the create flow's "create then continue" step — where this
   * dialog IS the only place to add a resource — unaffected. */
  hideResourcesSection?: boolean
  /** Locks the max-score field and shows a pointer to where it's
   * actually editable — the assignment detail page's own inline max-
   * score input, which (unlike this dialog) checks a lowered max score
   * against every already-recorded submission score first
   * (validateMaxScoreChange) before allowing the change. Keeping that the
   * single place max score can change avoids silently truncating a
   * recorded score out of range through this dialog's plain `maxScore >
   * 0` check. Defaults to false (editable here) for every other caller. */
  disableMaxScoreEdit?: boolean
}

function emptyForm() {
  return { title: '', maxScore: '100', dueDate: '', description: '' }
}

/**
 * Real, Supabase-backed create/edit assignment dialog — subjectId and
 * classroomId are fixed by the workspace this dialog is opened from
 * (never user-editable fields here), so every assignment it creates is
 * scoped to exactly that subject+classroom pair. See
 * subjects-real/tabs/assignments-tab.tsx for where this is opened.
 *
 * No topic field here on purpose — the Topics tab was removed from the
 * workspace to simplify the UI (see subject-classroom-workspace-page-real.tsx).
 * The `topic_id` column on `assignments` is untouched: an existing
 * assignment's topicId is preserved as-is on edit (never cleared by this
 * dialog), and a newly created assignment simply has no topic.
 */
export function AssignmentDialog({
  open,
  onOpenChange,
  subjectId,
  classroomId,
  assignment,
  onSaved,
  hideResourcesSection = false,
  disableMaxScoreEdit = false,
}: AssignmentDialogProps) {
  const { toast } = useToast()
  const [form, setForm] = useState(emptyForm)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const isEditing = Boolean(assignment)

  // Present once a real assignment id exists to attach resources to —
  // either from the start (editing an existing assignment) or set the
  // moment createAssignment() succeeds below ("create then continue": an
  // assignment_resources row has a NOT NULL FK to assignments.id, so
  // there is no way to let a teacher attach a file/link before the
  // assignment itself is persisted).
  const [currentAssignmentId, setCurrentAssignmentId] = useState<string | null>(null)
  // The full just-created record — needed (not just its id) to pass as
  // `source` to copyAssignmentToClassrooms on the finish step below.
  const [createdAssignment, setCreatedAssignment] = useState<Assignment | null>(null)
  // True once a brand-new assignment has been created but the dialog
  // hasn't been explicitly finished yet — the top fields lock (already
  // saved) and the primary button becomes "เสร็จสิ้น".
  const isCreateFlowFinishStep = !isEditing && Boolean(currentAssignmentId)

  // "ห้องที่ใช้" — every OTHER classroom this same subject is linked to,
  // fetched via the exact same getSubjectClassrooms already used by
  // getAssignmentCopyTargets (assignment-service.ts) — never a second,
  // differently-scoped classroom query. subjectName is fetched here too
  // (via the existing getSubjectById) purely to label targets — deliberately
  // NOT a new required prop, so every existing call site's exact JSX stays
  // untouched. Only ever loaded for the CREATE flow (never editing — an
  // already-created assignment's own copy is "คัดลอกไปห้องอื่น" on its row
  // menu, a fully separate, explicit action).
  const [subjectName, setSubjectName] = useState<string | null>(null)
  const [classroomTargets, setClassroomTargets] = useState<SubjectClassroom[]>([])
  const [selectedExtraClassroomIds, setSelectedExtraClassroomIds] = useState<Set<string>>(new Set())
  const otherClassroomTargets = classroomTargets.filter((c) => c.classroomId !== classroomId)
  const showClassroomPicker = !isEditing && Boolean(subjectName) && otherClassroomTargets.length > 0

  useEffect(() => {
    if (!open) return
    setForm(
      assignment
        ? {
            title: assignment.title,
            maxScore: String(assignment.maxScore),
            dueDate: assignment.dueDate ?? '',
            description: assignment.description ?? '',
          }
        : emptyForm(),
    )
    setCurrentAssignmentId(assignment?.id ?? null)
    setCreatedAssignment(null)
    setSelectedExtraClassroomIds(new Set())
    setError(null)

    if (!assignment) {
      getSubjectById(subjectId)
        .then((subject) => setSubjectName(subject?.name ?? null))
        .catch(() => setSubjectName(null))
      getSubjectClassrooms(subjectId)
        .then(setClassroomTargets)
        .catch(() => setClassroomTargets([]))
    } else {
      setSubjectName(null)
      setClassroomTargets([])
    }
  }, [open, assignment, subjectId])

  function toggleExtraClassroom(classroomIdToToggle: string) {
    setSelectedExtraClassroomIds((prev) => {
      const next = new Set(prev)
      if (next.has(classroomIdToToggle)) next.delete(classroomIdToToggle)
      else next.add(classroomIdToToggle)
      return next
    })
  }

  function selectAllExtraClassrooms() {
    setSelectedExtraClassroomIds(new Set(otherClassroomTargets.map((c) => c.classroomId)))
  }

  /**
   * Closing the dialog at all (the "เสร็จสิ้น" button, the X button,
   * Escape, or a backdrop click) must refresh the caller's list once a
   * NEW assignment was actually created during this session — even if
   * the teacher never clicks "เสร็จสิ้น" itself, e.g. they add a couple
   * of resources then just hit Escape. onSaved() is never called for the
   * create flow's first step (the assignment isn't ready to show yet),
   * only once, right here, on whichever path the dialog actually closes.
   */
  function handleOpenChange(next: boolean) {
    if (!next && !isEditing && currentAssignmentId) {
      onSaved()
    }
    onOpenChange(next)
  }

  /**
   * Runs on the explicit "เสร็จสิ้น" click only (not on Escape/backdrop-
   * close) — by then the teacher has had the chance to attach resources
   * to the source assignment first, so copyAssignmentToClassrooms (via
   * getAssignmentResources at call time) carries those resources over to
   * every selected extra classroom too, exactly matching "คัดลอกไปห้อง
   * อื่น"'s own existing behavior. Never a new copy implementation — the
   * exact same production function, just invoked from this dialog too.
   */
  async function copyToExtraClassroomsThenClose() {
    if (createdAssignment && selectedExtraClassroomIds.size > 0 && subjectName) {
      const targets: AssignmentCopyTarget[] = otherClassroomTargets
        .filter((c) => selectedExtraClassroomIds.has(c.classroomId))
        .map((c) => ({
          subjectId,
          subjectName,
          classroomId: c.classroomId,
          classroomName: c.classroomName ?? '',
        }))
      setSubmitting(true)
      try {
        const outcomes = await copyAssignmentToClassrooms(createdAssignment, targets)
        const failed = outcomes.filter((o) => !o.ok).length
        if (failed === 0) toast(`เพิ่มงานไปยังอีก ${outcomes.length} ห้องแล้ว`)
        else toast(`เพิ่มงานสำเร็จ ${outcomes.length - failed}/${outcomes.length} ห้อง — ไม่สำเร็จ ${failed} ห้อง`)
      } catch (err) {
        toast(toFriendlyErrorMessage(err, 'ไม่สามารถเพิ่มงานไปยังห้องอื่นได้'))
      } finally {
        setSubmitting(false)
      }
    }
    handleOpenChange(false)
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()

    if (isCreateFlowFinishStep) {
      await copyToExtraClassroomsThenClose()
      return
    }

    const maxScore = Number(form.maxScore)
    if (!form.title.trim()) {
      setError('กรุณากรอกชื่อเรื่อง')
      return
    }
    if (!Number.isFinite(maxScore) || maxScore <= 0) {
      setError('กรุณากรอกคะแนนเต็มให้ถูกต้อง')
      return
    }

    setSubmitting(true)
    setError(null)
    try {
      if (isEditing && assignment) {
        await updateAssignment(assignment.id, {
          title: form.title.trim(),
          maxScore,
          dueDate: form.dueDate || null,
          description: form.description.trim() || null,
        })
        toast('บันทึกงานแล้ว')
        // Direct onOpenChange + onSaved, not handleOpenChange — that
        // helper's auto-onSaved-on-close logic only covers the create
        // flow (where the assignment might already exist from step one
        // but onSaved hasn't fired yet); an edit always calls onSaved
        // itself, right here, the moment the update actually succeeds.
        onOpenChange(false)
        onSaved()
      } else {
        const created = await createAssignment({
          subjectId,
          classroomId,
          title: form.title.trim(),
          maxScore,
          dueDate: form.dueDate || null,
          description: form.description.trim() || null,
        })
        toast('เพิ่มงานใหม่แล้ว — เพิ่มสื่อและใบงานได้เลย')
        setCurrentAssignmentId(created.id)
        setCreatedAssignment(created)
      }
    } catch (err) {
      setError(toFriendlyErrorMessage(err, 'ไม่สามารถบันทึกงานได้'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEditing ? 'แก้ไขงาน' : isCreateFlowFinishStep ? 'เพิ่มสื่อและใบงาน' : 'เพิ่มงาน'}</DialogTitle>
          <DialogDescription>
            {isEditing
              ? 'แก้ไขรายละเอียดงานนี้'
              : isCreateFlowFinishStep
                ? 'เพิ่มไฟล์หรือลิงก์ให้นักเรียน แล้วกด "เสร็จสิ้น" เมื่อเรียบร้อย'
                : 'เพิ่มงานหรือแบบทดสอบใหม่ในห้องเรียนนี้'}
          </DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={handleSubmit}>
          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="space-y-1.5">
            <Label htmlFor="real-assignment-title">ชื่อเรื่อง *</Label>
            <Input
              id="real-assignment-title"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              disabled={isCreateFlowFinishStep}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="real-assignment-max-score">คะแนนเต็ม *</Label>
              <Input
                id="real-assignment-max-score"
                type="number"
                min={1}
                value={form.maxScore}
                onChange={(e) => setForm((f) => ({ ...f, maxScore: e.target.value }))}
                disabled={isCreateFlowFinishStep || disableMaxScoreEdit}
                required
              />
              {disableMaxScoreEdit && <p className="text-xs text-muted-foreground">แก้ไขคะแนนเต็มได้ที่หน้ารายละเอียดงาน</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="real-assignment-due">กำหนดส่ง</Label>
              <Input
                id="real-assignment-due"
                type="date"
                value={form.dueDate}
                onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))}
                disabled={isCreateFlowFinishStep}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="real-assignment-description">รายละเอียด</Label>
            <Textarea
              id="real-assignment-description"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              disabled={isCreateFlowFinishStep}
            />
          </div>

          {showClassroomPicker && !isCreateFlowFinishStep && (
            <div className="space-y-1.5 rounded-lg border border-border p-3">
              <div className="flex items-center justify-between">
                <Label>ห้องที่ใช้</Label>
                <Button type="button" variant="ghost" size="sm" onClick={selectAllExtraClassrooms} disabled={submitting}>
                  เลือกทั้งหมด
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                เพิ่มงานนี้ไปยังห้องอื่นในรายวิชา "{subjectName}" ด้วย — แต่ละห้องจะได้งานที่เป็นอิสระต่อกัน (ไม่ใช้คะแนน/สถานะการส่งงานร่วมกัน)
              </p>
              <div className="max-h-40 space-y-1 overflow-y-auto">
                <label className="flex cursor-not-allowed items-center gap-2 rounded-md px-2 py-1.5 text-sm opacity-70">
                  <input type="checkbox" checked disabled className="size-4 rounded border-input" />
                  ห้องปัจจุบัน{' '}
                  {classroomTargets.find((c) => c.classroomId === classroomId)?.classroomName ?? ''}
                </label>
                {otherClassroomTargets.map((c) => (
                  <label
                    key={c.classroomId}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent"
                  >
                    <input
                      type="checkbox"
                      checked={selectedExtraClassroomIds.has(c.classroomId)}
                      onChange={() => toggleExtraClassroom(c.classroomId)}
                      disabled={submitting}
                      className="size-4 rounded border-input"
                    />
                    {c.classroomName}
                  </label>
                ))}
              </div>
            </div>
          )}

          {isCreateFlowFinishStep && selectedExtraClassroomIds.size > 0 && (
            <p className="text-xs text-muted-foreground">
              กด "เสร็จสิ้น" เพื่อเพิ่มงานนี้ไปยังอีก {selectedExtraClassroomIds.size} ห้องที่เลือกไว้ด้วย
            </p>
          )}

          {currentAssignmentId && !hideResourcesSection && (
            <AssignmentResourcesSection
              assignmentId={currentAssignmentId}
              subjectId={subjectId}
              classroomId={classroomId}
            />
          )}

          <DialogFooter>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'กำลังบันทึก...' : isCreateFlowFinishStep ? 'เสร็จสิ้น' : isEditing ? 'บันทึก' : 'เพิ่มงาน'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
