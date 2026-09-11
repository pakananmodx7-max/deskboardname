import { ExternalLink, FileText, Link2, Loader2, Plus, Type, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/toast'
import { toFriendlyErrorMessage } from '@/lib/errors'
import {
  addSubmissionFileResource,
  addSubmissionLinkResource,
  addSubmissionTextResource,
  computeNextSubmissionResourceSortOrder,
  computeSubmissionStatusOnSubmit,
  deriveStudentFacingStatus,
  finalizeSubmission,
  getMySubmission,
  getOrCreateMySubmission,
  getSubmissionResourceSignedUrl,
  getSubmissionResources,
  removeSubmissionResource,
  STUDENT_SUBMISSION_STATUS_BADGE_VARIANT,
  STUDENT_SUBMISSION_STATUS_LABEL,
  submissionResourceTypeLabel,
  validateSubmissionResourceFile,
  validateSubmissionResourceTitle,
  validateSubmissionResourceUrl,
  validateSubmissionTextContent,
} from '@/services/submission-service'
import type { AssignmentSubmission } from '@/types/assignment'
import type { SubmissionResource } from '@/types/submission'

interface MySubmissionSectionProps {
  assignmentId: string
  subjectId: string
  classroomId: string
  teacherId: string
  studentId: string
  dueDate: string | null
  maxScore: number
}

const RESOURCE_ICON = { file: FileText, link: Link2, text: Type } as const

type AddFormKind = 'link' | 'text' | null

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('th-TH', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function displayFileName(resource: SubmissionResource): string {
  return resource.originalFilename ?? resource.title ?? 'ไฟล์'
}

/**
 * "ส่งงานออนไลน์" — the student's own submission manager, embedded in
 * StudentAssignmentDetailPage. Supports both required submission kinds
 * (file upload, URL/link — plus a bonus free-text answer), unrestricted
 * resubmission (the only rule the current schema enforces is that a
 * student can never touch score/note/reviewed_at themselves — see
 * 0016's enforce_submission_field_ownership trigger; resubmitting after
 * being reviewed is otherwise always allowed, matching Section 7's
 * "current assignment rules"), and strict error isolation (Section 10):
 * attaching a resource NEVER marks the assignment as submitted by
 * itself — only the explicit "ส่งงาน" button (finalizeSubmission) does
 * that, so a failed upload can never produce a false "ส่งแล้ว" state.
 * The status badge shows a distinct "ตรวจแล้ว" once a teacher has
 * scored it (deriveStudentFacingStatus), never just the raw submitted/
 * late/missing status. The submission row itself is created lazily, the
 * moment the student attaches their FIRST resource (see
 * ensureSubmission) — merely viewing this page never creates a row.
 */
export function MySubmissionSection({
  assignmentId,
  subjectId,
  classroomId,
  teacherId,
  studentId,
  dueDate,
  maxScore,
}: MySubmissionSectionProps) {
  const { toast } = useToast()

  const [submission, setSubmission] = useState<AssignmentSubmission | null>(null)
  const [submissionLoading, setSubmissionLoading] = useState(true)
  const [submissionError, setSubmissionError] = useState<string | null>(null)

  const [resources, setResources] = useState<SubmissionResource[]>([])
  const [resourcesLoading, setResourcesLoading] = useState(false)
  const [resourcesError, setResourcesError] = useState<string | null>(null)

  const [ensuring, setEnsuring] = useState(false)
  const [addForm, setAddForm] = useState<AddFormKind>(null)
  const [linkTitle, setLinkTitle] = useState('')
  const [linkUrl, setLinkUrl] = useState('')
  const [textTitle, setTextTitle] = useState('')
  const [textBody, setTextBody] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [formSubmitting, setFormSubmitting] = useState(false)

  const [uploadError, setUploadError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [rowError, setRowError] = useState<string | null>(null)
  const [busyResourceId, setBusyResourceId] = useState<string | null>(null)
  const [openingId, setOpeningId] = useState<string | null>(null)
  const [finalizing, setFinalizing] = useState(false)

  const loadResources = useCallback((submissionId: string) => {
    setResourcesLoading(true)
    setResourcesError(null)
    return getSubmissionResources(submissionId)
      .then(setResources)
      .catch((err: unknown) => setResourcesError(toFriendlyErrorMessage(err)))
      .finally(() => setResourcesLoading(false))
  }, [])

  useEffect(() => {
    let active = true
    setSubmissionLoading(true)
    setSubmissionError(null)
    getMySubmission(assignmentId)
      .then((row) => {
        if (!active) return
        setSubmission(row)
        if (row?.id) loadResources(row.id)
      })
      .catch((err: unknown) => {
        if (active) setSubmissionError(toFriendlyErrorMessage(err))
      })
      .finally(() => {
        if (active) setSubmissionLoading(false)
      })
    return () => {
      active = false
    }
  }, [assignmentId, loadResources])

  /** Lazily creates the submission row on the student's FIRST real
   * action (attaching a resource) — never on mere page view. Returns the
   * real submission id, or throws (never marks anything as submitted on
   * failure — "no partial successful state", Section 10). */
  async function ensureSubmission(): Promise<string> {
    if (submission?.id) return submission.id
    setEnsuring(true)
    try {
      const created = await getOrCreateMySubmission(assignmentId)
      setSubmission(created)
      return created.id as string
    } finally {
      setEnsuring(false)
    }
  }

  function openLinkForm() {
    setLinkTitle('')
    setLinkUrl('')
    setFormError(null)
    setAddForm('link')
  }

  function openTextForm() {
    setTextTitle('')
    setTextBody('')
    setFormError(null)
    setAddForm('text')
  }

  async function handleFileButtonClick() {
    setUploadError(null)
    fileInputRef.current?.click()
  }

  async function handleFileSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    const fileValidationError = validateSubmissionResourceFile(file)
    if (fileValidationError) {
      setUploadError(fileValidationError)
      return
    }

    setUploading(true)
    setUploadError(null)
    setUploadProgress(10)
    const ramp = window.setInterval(() => {
      setUploadProgress((p) => (p < 85 ? p + 15 : p))
    }, 250)

    try {
      const submissionId = await ensureSubmission()
      const created = await addSubmissionFileResource(
        { submissionId, file },
        teacherId,
        subjectId,
        classroomId,
        assignmentId,
        studentId,
        computeNextSubmissionResourceSortOrder(resources),
      )
      setResources((prev) => [...prev, created])
      setUploadProgress(100)
      toast('แนบไฟล์แล้ว')
    } catch (err) {
      setUploadError(toFriendlyErrorMessage(err, 'ไม่สามารถอัปโหลดไฟล์ได้'))
    } finally {
      window.clearInterval(ramp)
      setUploading(false)
      window.setTimeout(() => setUploadProgress(0), 600)
    }
  }

  async function handleAddLink() {
    const titleError = validateSubmissionResourceTitle(linkTitle)
    if (titleError) {
      setFormError(titleError)
      return
    }
    const urlError = validateSubmissionResourceUrl(linkUrl)
    if (urlError) {
      setFormError(urlError)
      return
    }
    setFormSubmitting(true)
    setFormError(null)
    try {
      const submissionId = await ensureSubmission()
      const created = await addSubmissionLinkResource(
        { submissionId, title: linkTitle, url: linkUrl },
        computeNextSubmissionResourceSortOrder(resources),
      )
      setResources((prev) => [...prev, created])
      setAddForm(null)
      toast('แนบลิงก์แล้ว')
    } catch (err) {
      setFormError(toFriendlyErrorMessage(err, 'ไม่สามารถแนบลิงก์ได้'))
    } finally {
      setFormSubmitting(false)
    }
  }

  async function handleAddText() {
    const textError = validateSubmissionTextContent(textBody)
    if (textError) {
      setFormError(textError)
      return
    }
    setFormSubmitting(true)
    setFormError(null)
    try {
      const submissionId = await ensureSubmission()
      const created = await addSubmissionTextResource(
        { submissionId, title: textTitle || null, text: textBody },
        computeNextSubmissionResourceSortOrder(resources),
      )
      setResources((prev) => [...prev, created])
      setAddForm(null)
      toast('แนบคำตอบแล้ว')
    } catch (err) {
      setFormError(toFriendlyErrorMessage(err, 'ไม่สามารถแนบคำตอบได้'))
    } finally {
      setFormSubmitting(false)
    }
  }

  async function handleRemove(resource: SubmissionResource) {
    setRowError(null)
    setBusyResourceId(resource.id)
    try {
      await removeSubmissionResource(resource)
      setResources((prev) => prev.filter((r) => r.id !== resource.id))
    } catch (err) {
      setRowError(toFriendlyErrorMessage(err, 'ไม่สามารถลบสื่อที่แนบได้'))
    } finally {
      setBusyResourceId(null)
    }
  }

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

  async function handleFinalize() {
    setFinalizing(true)
    setRowError(null)
    try {
      const submissionId = await ensureSubmission()
      const updated = await finalizeSubmission(submissionId, dueDate)
      setSubmission(updated)
      const willBeLate = computeSubmissionStatusOnSubmit(dueDate, new Date()) === 'late'
      toast(willBeLate ? 'ส่งงานแล้ว (ส่งช้ากว่ากำหนด)' : 'ส่งงานสำเร็จ')
    } catch (err) {
      toast(toFriendlyErrorMessage(err, 'ไม่สามารถส่งงานได้ กรุณาลองใหม่'))
    } finally {
      setFinalizing(false)
    }
  }

  const status = deriveStudentFacingStatus(submission)
  const hasSubmittedBefore = Boolean(submission?.submittedAt)
  const canFinalize = resources.length > 0 && !finalizing && !ensuring

  return (
    <div className="space-y-4 rounded-lg border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold">ส่งงานออนไลน์</p>
          <Badge variant={STUDENT_SUBMISSION_STATUS_BADGE_VARIANT[status]}>{STUDENT_SUBMISSION_STATUS_LABEL[status]}</Badge>
        </div>
        <Button type="button" size="sm" onClick={handleFinalize} disabled={!canFinalize}>
          {finalizing ? 'กำลังส่ง...' : hasSubmittedBefore ? 'ส่งงานอีกครั้ง' : 'ส่งงาน'}
        </Button>
      </div>

      {submissionLoading ? (
        <p className="text-sm text-muted-foreground">กำลังโหลด...</p>
      ) : submissionError ? (
        <p className="text-sm text-destructive">{submissionError}</p>
      ) : (
        <>
          {submission?.submittedAt && (
            <p className="text-xs text-muted-foreground">ส่งล่าสุดเมื่อ {formatDateTime(submission.submittedAt)}</p>
          )}
          {resources.length === 0 && !submissionLoading && (
            <p className="text-xs text-muted-foreground">แนบไฟล์ ลิงก์ หรือคำตอบอย่างน้อย 1 อย่าง แล้วกด &quot;ส่งงาน&quot;</p>
          )}

          {(submission?.score !== null && submission?.score !== undefined) && (
            <div className="rounded-md border bg-muted/30 p-3 text-sm">
              <p className="font-medium">
                คะแนนของฉัน: {submission.score} / {maxScore}
              </p>
              {submission.note && <p className="mt-1 text-xs text-muted-foreground">ความคิดเห็นจากครู: {submission.note}</p>}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={handleFileButtonClick} disabled={uploading}>
              <Plus className="size-3.5" />
              เพิ่มไฟล์
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={openLinkForm}>
              <Plus className="size-3.5" />
              เพิ่มลิงก์
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={openTextForm}>
              <Plus className="size-3.5" />
              เพิ่มคำตอบข้อความ
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept=".pdf,.docx,.pptx,.xlsx,.jpg,.jpeg,.png,.webp,.zip"
              onChange={handleFileSelected}
            />
          </div>

          {uploading && (
            <div className="space-y-1">
              <Progress value={uploadProgress} />
              <p className="text-xs text-muted-foreground">กำลังอัปโหลด...</p>
            </div>
          )}
          {uploadError && <p className="text-sm text-destructive">{uploadError}</p>}
          {rowError && <p className="text-sm text-destructive">{rowError}</p>}

          {addForm === 'link' && (
            <div className="space-y-2 rounded-md border bg-muted/30 p-3">
              {formError && <p className="text-sm text-destructive">{formError}</p>}
              <div className="space-y-1.5">
                <Label htmlFor="submission-link-title">ชื่อที่แสดง</Label>
                <Input id="submission-link-title" value={linkTitle} onChange={(e) => setLinkTitle(e.target.value)} placeholder="เช่น งานของฉันใน Google Docs" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="submission-link-url">ลิงก์ (https://)</Label>
                <Input id="submission-link-url" value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="https://..." />
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={() => setAddForm(null)}>
                  ยกเลิก
                </Button>
                <Button type="button" size="sm" onClick={handleAddLink} disabled={formSubmitting}>
                  {formSubmitting ? 'กำลังบันทึก...' : 'แนบลิงก์'}
                </Button>
              </div>
            </div>
          )}

          {addForm === 'text' && (
            <div className="space-y-2 rounded-md border bg-muted/30 p-3">
              {formError && <p className="text-sm text-destructive">{formError}</p>}
              <div className="space-y-1.5">
                <Label htmlFor="submission-text-title">หัวข้อ (ถ้ามี)</Label>
                <Input id="submission-text-title" value={textTitle} onChange={(e) => setTextTitle(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="submission-text-body">คำตอบ</Label>
                <Textarea id="submission-text-body" value={textBody} onChange={(e) => setTextBody(e.target.value)} rows={5} />
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={() => setAddForm(null)}>
                  ยกเลิก
                </Button>
                <Button type="button" size="sm" onClick={handleAddText} disabled={formSubmitting}>
                  {formSubmitting ? 'กำลังบันทึก...' : 'แนบคำตอบ'}
                </Button>
              </div>
            </div>
          )}

          {resourcesLoading ? (
            <p className="text-sm text-muted-foreground">กำลังโหลดรายการที่แนบ...</p>
          ) : resourcesError ? (
            <p className="text-sm text-destructive">{resourcesError}</p>
          ) : resources.length > 0 ? (
            <ul className="space-y-1.5">
              {resources.map((resource) => {
                const Icon = RESOURCE_ICON[resource.resourceType]
                const cleaned = Boolean(resource.deletedAt)
                return (
                  <li key={resource.id} className="flex items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm">
                    <Icon className="size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{resource.title || displayFileName(resource)}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {submissionResourceTypeLabel(resource.resourceType)}
                        {cleaned ? ' · ไฟล์ถูกล้างโดยครูแล้ว' : ''}
                        {resource.resourceType === 'text' && !cleaned ? ` · ${resource.textContent}` : ''}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {resource.resourceType !== 'text' && !cleaned && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          onClick={() => handleOpen(resource)}
                          disabled={openingId === resource.id}
                          aria-label="เปิด"
                        >
                          {openingId === resource.id ? <Loader2 className="size-3.5 animate-spin" /> : <ExternalLink className="size-3.5" />}
                        </Button>
                      )}
                      {!cleaned && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-7 text-destructive"
                          disabled={busyResourceId === resource.id}
                          onClick={() => handleRemove(resource)}
                          aria-label="ลบ"
                        >
                          {busyResourceId === resource.id ? <Loader2 className="size-3.5 animate-spin" /> : <X className="size-3.5" />}
                        </Button>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          ) : null}
        </>
      )}
    </div>
  )
}
