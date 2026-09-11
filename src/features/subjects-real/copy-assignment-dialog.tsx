import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { toFriendlyErrorMessage } from '@/lib/errors'
import { copyAssignmentToClassrooms, getAssignmentCopyTargets } from '@/services/assignment-service'
import type { Assignment, AssignmentCopyOutcome, AssignmentCopyTarget } from '@/types/assignment'

interface CopyAssignmentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  assignment: Assignment
  /** Called once the copy attempt finishes (even a partial failure) so the
   * caller can toast a summary and refresh whichever classroom's list is
   * currently open — copying INTO the currently-open classroom is
   * excluded by construction (see getAssignmentCopyTargets), so refresh
   * is only ever a courtesy for a teacher who copies then navigates
   * there, never required for the current view to stay correct. */
  onCopied: (outcomes: AssignmentCopyOutcome[]) => void
}

/**
 * "คัดลอกไปห้องอื่น" — lets a teacher duplicate one assignment (title,
 * description, max score, due date, and every resource) into any other
 * (subject, classroom) pair they own. Never touches submissions/scores/
 * status/reviewed state — see copyAssignmentToClassrooms's own doc
 * comment for why each copy is a fully independent new assignment.
 */
export function CopyAssignmentDialog({ open, onOpenChange, assignment, onCopied }: CopyAssignmentDialogProps) {
  const [targets, setTargets] = useState<AssignmentCopyTarget[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setSelected(new Set())
    setSubmitError(null)
    setLoading(true)
    setLoadError(null)
    getAssignmentCopyTargets(assignment.subjectId, assignment.classroomId)
      .then(setTargets)
      .catch((err: unknown) => setLoadError(toFriendlyErrorMessage(err, 'ไม่สามารถโหลดรายชื่อห้องเรียนได้')))
      .finally(() => setLoading(false))
  }, [open, assignment.subjectId, assignment.classroomId])

  function targetKey(target: AssignmentCopyTarget): string {
    return `${target.subjectId}:${target.classroomId}`
  }

  function toggle(target: AssignmentCopyTarget) {
    const key = targetKey(target)
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function selectAll() {
    setSelected(new Set(targets.map(targetKey)))
  }

  function clearSelection() {
    setSelected(new Set())
  }

  async function handleConfirm() {
    const chosen = targets.filter((target) => selected.has(targetKey(target)))
    if (chosen.length === 0) return

    setSubmitting(true)
    setSubmitError(null)
    try {
      const outcomes = await copyAssignmentToClassrooms(assignment, chosen)
      onOpenChange(false)
      onCopied(outcomes)
    } catch (err) {
      setSubmitError(toFriendlyErrorMessage(err, 'ไม่สามารถคัดลอกงานได้'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !submitting && onOpenChange(next)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>คัดลอกไปห้องอื่น</DialogTitle>
          <DialogDescription>เลือกห้องเรียนที่ต้องการคัดลอก "{assignment.title}" ไปวาง</DialogDescription>
        </DialogHeader>

        {loading && <p className="text-sm text-muted-foreground">กำลังโหลดรายชื่อห้องเรียน...</p>}
        {loadError && <p className="text-sm text-destructive">{loadError}</p>}

        {!loading && !loadError && targets.length === 0 && (
          <p className="text-sm text-muted-foreground">ไม่มีห้องเรียนอื่นให้คัดลอกไปวาง</p>
        )}

        {!loading && !loadError && targets.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">{selected.size} จาก {targets.length} ห้องที่เลือก</p>
              <div className="flex gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={selectAll} disabled={submitting}>
                  เลือกทั้งหมด
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={clearSelection} disabled={submitting}>
                  ล้างการเลือก
                </Button>
              </div>
            </div>

            <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border border-border p-2">
              {targets.map((target) => {
                const key = targetKey(target)
                return (
                  <label
                    key={key}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-accent"
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(key)}
                      onChange={() => toggle(target)}
                      disabled={submitting}
                      className="size-4 rounded border-input"
                    />
                    <span>
                      {target.subjectName} · {target.classroomName}
                    </span>
                  </label>
                )
              })}
            </div>
          </div>
        )}

        {submitError && <p className="text-sm text-destructive">{submitError}</p>}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            ยกเลิก
          </Button>
          <Button type="button" onClick={handleConfirm} disabled={submitting || selected.size === 0}>
            {submitting ? 'กำลังคัดลอก...' : 'คัดลอกงาน'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
