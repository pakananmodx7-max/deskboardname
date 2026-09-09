import { ExternalLink, FileText, Link2, Loader2, Type } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { toFriendlyErrorMessage } from '@/lib/errors'
import {
  cleanupSubmissionResourceFile,
  getSubmissionResourceSignedUrl,
  getSubmissionResources,
  submissionResourceTypeLabel,
} from '@/services/submission-service'
import type { AssignmentSubmission, SubmissionStatus } from '@/types/assignment'
import type { SubmissionResource } from '@/types/submission'

interface SubmissionViewerDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  studentName: string
  submission: AssignmentSubmission | null
  maxScore: number
}

const STATUS_LABEL: Record<SubmissionStatus, string> = {
  not_submitted: 'ยังไม่ส่ง',
  submitted: 'ส่งแล้ว (ตรงเวลา)',
  late: 'ส่งช้า',
  missing: 'ขาดส่ง',
}

const RESOURCE_ICON = { file: FileText, link: Link2, text: Type } as const

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('th-TH', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function displayFileName(resource: SubmissionResource): string {
  return resource.originalFilename ?? resource.title ?? 'ไฟล์'
}

/**
 * The teacher-facing "งานออนไลน์" viewer — opened from the roster
 * table's "[เปิดดู]"/"N ไฟล์" cell. Shows submitted_at, late/on-time
 * (derived from the submission's own `status`, never recomputed here),
 * every file/link/text resource, and the manual "ล้างไฟล์งานที่ตรวจแล้ว"
 * cleanup action per file (Section 9) — explicit confirmation required,
 * never a bulk/blanket clear. Cleanup only ever removes the stored file
 * (see cleanupSubmissionResourceFile) — it can never touch score/status/
 * submitted_at, which this drawer keeps showing from the SAME
 * `submission` prop the caller already loaded, completely independent
 * of whether the resource list itself loads successfully (Section 10:
 * "teacher must still see student/status/score" even if resource
 * loading fails).
 */
export function SubmissionViewerDrawer({ open, onOpenChange, studentName, submission, maxScore }: SubmissionViewerDrawerProps) {
  const [resources, setResources] = useState<SubmissionResource[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [openingId, setOpeningId] = useState<string | null>(null)
  const [rowError, setRowError] = useState<string | null>(null)
  const [cleaningId, setCleaningId] = useState<string | null>(null)
  const [confirmCleanupResource, setConfirmCleanupResource] = useState<SubmissionResource | null>(null)

  const submissionId = submission?.id
  const load = useCallback(() => {
    if (!submissionId) return undefined
    setLoading(true)
    setLoadError(null)
    return getSubmissionResources(submissionId)
      .then(setResources)
      .catch((err: unknown) => setLoadError(toFriendlyErrorMessage(err)))
      .finally(() => setLoading(false))
  }, [submissionId])

  useEffect(() => {
    if (open) load()
  }, [open, load])

  async function handleOpen(resource: SubmissionResource) {
    if (resource.resourceType === 'link') {
      window.open(resource.externalUrl ?? undefined, '_blank', 'noopener,noreferrer')
      return
    }
    if (resource.resourceType === 'file' && resource.storagePath) {
      setOpeningId(resource.id)
      setRowError(null)
      try {
        const signedUrl = await getSubmissionResourceSignedUrl(resource.storagePath)
        window.open(signedUrl, '_blank', 'noopener,noreferrer')
      } catch (err) {
        setRowError(toFriendlyErrorMessage(err, 'ไม่สามารถเปิดไฟล์ได้'))
      } finally {
        setOpeningId(null)
      }
    }
  }

  async function handleConfirmCleanup() {
    if (!confirmCleanupResource) return
    setCleaningId(confirmCleanupResource.id)
    setRowError(null)
    try {
      const updated = await cleanupSubmissionResourceFile(confirmCleanupResource)
      setResources((prev) => prev.map((r) => (r.id === updated.id ? updated : r)))
      setConfirmCleanupResource(null)
    } catch (err) {
      setRowError(toFriendlyErrorMessage(err, 'ไม่สามารถล้างไฟล์ได้'))
    } finally {
      setCleaningId(null)
    }
  }

  if (!submission) return null

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {open && (
        <SheetContent>
          <SheetHeader>
            <SheetTitle>งานออนไลน์ — {studentName}</SheetTitle>
            <SheetDescription>
              <Badge variant={submission.status === 'submitted' ? 'success' : submission.status === 'not_submitted' ? 'outline' : 'warning'}>
                {STATUS_LABEL[submission.status]}
              </Badge>
            </SheetDescription>
          </SheetHeader>

          <div className="space-y-1 text-sm">
            {submission.submittedAt ? (
              <p className="text-muted-foreground">ส่งล่าสุดเมื่อ {formatDateTime(submission.submittedAt)}</p>
            ) : (
              <p className="text-muted-foreground">ยังไม่มีการส่งงาน</p>
            )}
            <p className="text-muted-foreground">
              คะแนน: {submission.score !== null && submission.score !== undefined ? `${submission.score} / ${maxScore}` : 'ยังไม่ให้คะแนน'}
            </p>
            {submission.note && <p className="text-muted-foreground">หมายเหตุ: {submission.note}</p>}
          </div>

          {rowError && <p className="text-sm text-destructive">{rowError}</p>}

          <div className="space-y-1.5">
            {loading ? (
              <p className="text-sm text-muted-foreground">กำลังโหลด...</p>
            ) : loadError ? (
              <p className="text-sm text-destructive">{loadError}</p>
            ) : resources.length === 0 ? (
              <p className="text-sm text-muted-foreground">ยังไม่มีสิ่งที่แนบส่งมา</p>
            ) : (
              resources.map((resource) => {
                const Icon = RESOURCE_ICON[resource.resourceType]
                const cleaned = Boolean(resource.deletedAt)
                return (
                  <div key={resource.id} className="rounded-md border bg-background p-3 text-sm">
                    <div className="flex items-start gap-2">
                      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">
                          {resource.title || displayFileName(resource)}
                          {cleaned && <span className="ml-1.5 text-xs text-muted-foreground">(ล้างไฟล์แล้ว)</span>}
                        </p>
                        <p className="text-xs text-muted-foreground">{submissionResourceTypeLabel(resource.resourceType)}</p>
                        {resource.resourceType === 'text' && <p className="mt-1 whitespace-pre-wrap text-sm">{resource.textContent}</p>}
                      </div>
                    </div>
                    {resource.resourceType !== 'text' && (
                      <div className="mt-2 flex items-center gap-2">
                        {!cleaned && (
                          <Button type="button" variant="outline" size="sm" onClick={() => handleOpen(resource)} disabled={openingId === resource.id}>
                            {openingId === resource.id ? <Loader2 className="size-3.5 animate-spin" /> : <ExternalLink className="size-3.5" />}
                            เปิดดู
                          </Button>
                        )}
                        {resource.resourceType === 'file' && !cleaned && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="text-destructive"
                            disabled={cleaningId === resource.id}
                            onClick={() => setConfirmCleanupResource(resource)}
                          >
                            ล้างไฟล์งานที่ตรวจแล้ว
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </div>
        </SheetContent>
      )}

      <ConfirmDialog
        open={Boolean(confirmCleanupResource)}
        onOpenChange={(next) => !next && setConfirmCleanupResource(null)}
        title="ล้างไฟล์งานที่ตรวจแล้ว"
        description={`ลบไฟล์ "${confirmCleanupResource ? displayFileName(confirmCleanupResource) : ''}" ออกจากพื้นที่จัดเก็บ?\nคะแนน สถานะ วันที่ส่ง และชื่อไฟล์เดิมจะยังคงอยู่ในระบบเพื่อการตรวจสอบย้อนหลัง แต่จะไม่สามารถเปิดไฟล์นี้ได้อีก`}
        confirmLabel="ล้างไฟล์"
        destructive
        onConfirm={handleConfirmCleanup}
      />
    </Sheet>
  )
}
