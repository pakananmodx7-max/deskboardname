import { ChevronDown, ChevronUp, FileText, Link2, Loader2, Plus, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { toFriendlyErrorMessage } from '@/lib/errors'
import {
  addFileResource,
  addLinkResource,
  computeNextSortOrder,
  getAssignmentResources,
  removeResource,
  reorderResources,
  reorderResourcesLocally,
  validateResourceFile,
  validateResourceTitle,
  validateResourceUrl,
} from '@/services/assignment-resource-service'
import type { AssignmentResource } from '@/types/assignment-resource'

interface AssignmentResourcesSectionProps {
  assignmentId: string
  subjectId: string
  classroomId: string
}

/** Filename portion of a storage path, for display only — the raw path
 * itself is never shown (see the section header's own note in the JSX
 * below and the migration's "students must never see raw internal
 * storage paths" requirement, which applies just as much to a teacher's
 * own editing view — there is no reason to expose the generated path
 * anywhere in this UI). */
function displayFileName(resource: AssignmentResource): string {
  if (!resource.filePath) return resource.title
  const parts = resource.filePath.split('/')
  return parts[parts.length - 1]
}

/**
 * "สื่อและใบงาน" — the teacher-facing resource manager embedded in
 * AssignmentDialog. Every action here (add file, add link, remove,
 * reorder) persists immediately to Supabase the moment it happens —
 * unlike the dialog's own title/description/due-date fields, there is no
 * separate "save" step for resources, matching the spec's "create then
 * continue" design: this section only ever renders once a real
 * assignment id exists (see AssignmentDialog), so every resource added
 * here is already attached to a real, persisted assignment.
 */
export function AssignmentResourcesSection({ assignmentId, subjectId, classroomId }: AssignmentResourcesSectionProps) {
  const [resources, setResources] = useState<AssignmentResource[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [linkFormOpen, setLinkFormOpen] = useState(false)
  const [linkTitle, setLinkTitle] = useState('')
  const [linkUrl, setLinkUrl] = useState('')
  const [linkError, setLinkError] = useState<string | null>(null)
  const [linkSubmitting, setLinkSubmitting] = useState(false)

  const [uploadError, setUploadError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [rowError, setRowError] = useState<string | null>(null)
  const [busyResourceId, setBusyResourceId] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    setLoadError(null)
    return getAssignmentResources(assignmentId)
      .then(setResources)
      .catch((err: unknown) => setLoadError(toFriendlyErrorMessage(err)))
      .finally(() => setLoading(false))
  }, [assignmentId])

  useEffect(() => {
    load()
  }, [load])

  function handleFileButtonClick() {
    setUploadError(null)
    fileInputRef.current?.click()
  }

  async function handleFileSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    const fileValidationError = validateResourceFile(file)
    if (fileValidationError) {
      setUploadError(fileValidationError)
      return
    }

    setUploading(true)
    setUploadError(null)
    setUploadProgress(10)

    // supabase-js's storage upload() has no native byte-progress callback
    // — this ramp is a reassuring "still working" indicator, not a real
    // byte count, and always resolves to 100% (or stops on error) rather
    // than claiming a precision it doesn't have.
    const ramp = window.setInterval(() => {
      setUploadProgress((p) => (p < 85 ? p + 15 : p))
    }, 250)

    try {
      const created = await addFileResource(
        { assignmentId, title: file.name.replace(/\.[^/.]+$/, ''), file },
        subjectId,
        classroomId,
        computeNextSortOrder(resources),
      )
      setResources((prev) => [...prev, created])
      setUploadProgress(100)
    } catch (err) {
      setUploadError(toFriendlyErrorMessage(err, 'ไม่สามารถอัปโหลดไฟล์ได้'))
    } finally {
      window.clearInterval(ramp)
      setUploading(false)
      window.setTimeout(() => setUploadProgress(0), 600)
    }
  }

  function openLinkForm() {
    setLinkTitle('')
    setLinkUrl('')
    setLinkError(null)
    setLinkFormOpen(true)
  }

  async function handleAddLink() {
    const titleError = validateResourceTitle(linkTitle)
    if (titleError) {
      setLinkError(titleError)
      return
    }
    const urlError = validateResourceUrl(linkUrl)
    if (urlError) {
      setLinkError(urlError)
      return
    }

    setLinkSubmitting(true)
    setLinkError(null)
    try {
      const created = await addLinkResource({ assignmentId, title: linkTitle, url: linkUrl }, computeNextSortOrder(resources))
      setResources((prev) => [...prev, created])
      setLinkFormOpen(false)
    } catch (err) {
      setLinkError(toFriendlyErrorMessage(err, 'ไม่สามารถเพิ่มลิงก์ได้'))
    } finally {
      setLinkSubmitting(false)
    }
  }

  async function handleRemove(resource: AssignmentResource) {
    setRowError(null)
    setBusyResourceId(resource.id)
    try {
      await removeResource(resource)
      setResources((prev) => prev.filter((r) => r.id !== resource.id))
    } catch (err) {
      setRowError(toFriendlyErrorMessage(err, 'ไม่สามารถลบสื่อ/ใบงานได้'))
    } finally {
      setBusyResourceId(null)
    }
  }

  async function handleMove(index: number, direction: -1 | 1) {
    const targetIndex = index + direction
    if (targetIndex < 0 || targetIndex >= resources.length) return

    const reordered = reorderResourcesLocally(resources, index, targetIndex)
    setResources(reordered)
    setRowError(null)
    try {
      await reorderResources(reordered.map((r) => ({ id: r.id, sortOrder: r.sortOrder })))
    } catch (err) {
      setRowError(toFriendlyErrorMessage(err, 'ไม่สามารถจัดลำดับใหม่ได้'))
      load()
    }
  }

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">สื่อและใบงาน</p>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={handleFileButtonClick} disabled={uploading}>
            <Plus className="size-3.5" />
            เพิ่มไฟล์
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={openLinkForm}>
            <Plus className="size-3.5" />
            เพิ่มลิงก์
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept=".pdf,.docx,.xlsx,.jpg,.jpeg,.png,.webp"
            onChange={handleFileSelected}
          />
        </div>
      </div>

      {loadError && <p className="text-sm text-destructive">{loadError}</p>}
      {rowError && <p className="text-sm text-destructive">{rowError}</p>}

      {uploading && (
        <div className="space-y-1">
          <Progress value={uploadProgress} />
          <p className="text-xs text-muted-foreground">กำลังอัปโหลด...</p>
        </div>
      )}
      {uploadError && <p className="text-sm text-destructive">{uploadError}</p>}

      {linkFormOpen && (
        <div className="space-y-2 rounded-md border bg-muted/30 p-3">
          {linkError && <p className="text-sm text-destructive">{linkError}</p>}
          <div className="space-y-1.5">
            <Label htmlFor="resource-link-title">ชื่อที่แสดง</Label>
            <Input
              id="resource-link-title"
              value={linkTitle}
              onChange={(e) => setLinkTitle(e.target.value)}
              placeholder="เช่น แบบทดสอบ Google Form"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="resource-link-url">ลิงก์ (https://)</Label>
            <Input
              id="resource-link-url"
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              placeholder="https://..."
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setLinkFormOpen(false)}>
              ยกเลิก
            </Button>
            <Button type="button" size="sm" onClick={handleAddLink} disabled={linkSubmitting}>
              {linkSubmitting ? 'กำลังบันทึก...' : 'เพิ่มลิงก์'}
            </Button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">กำลังโหลด...</p>
      ) : resources.length === 0 && !linkFormOpen ? (
        <p className="text-sm text-muted-foreground">ยังไม่มีสื่อหรือใบงานสำหรับงานนี้</p>
      ) : (
        <ul className="space-y-1.5">
          {resources.map((resource, index) => (
            <li key={resource.id} className="flex items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm">
              {resource.resourceType === 'file' ? (
                <FileText className="size-4 shrink-0 text-muted-foreground" />
              ) : (
                <Link2 className="size-4 shrink-0 text-muted-foreground" />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{resource.title}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {resource.resourceType === 'file' ? displayFileName(resource) : resource.url}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-0.5">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  disabled={index === 0}
                  onClick={() => handleMove(index, -1)}
                  aria-label="เลื่อนขึ้น"
                >
                  <ChevronUp className="size-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  disabled={index === resources.length - 1}
                  onClick={() => handleMove(index, 1)}
                  aria-label="เลื่อนลง"
                >
                  <ChevronDown className="size-3.5" />
                </Button>
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
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
