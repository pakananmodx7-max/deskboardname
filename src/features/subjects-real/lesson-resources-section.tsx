import { ChevronDown, ChevronUp, FileText, Link2, Loader2, Plus, Presentation, Video, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { NativeSelect } from '@/components/ui/select'
import { toFriendlyErrorMessage } from '@/lib/errors'
import {
  addLessonFileResource,
  addLessonLinkResource,
  computeNextResourceSortOrder,
  getLessonResources,
  lessonResourceTypeLabel,
  removeLessonResource,
  reorderLessonResources,
  reorderLessonResourcesLocally,
  validateLessonResourceFile,
  validateLessonResourceTitle,
  validateLessonResourceUrl,
} from '@/services/lesson-service'
import type { LessonResource, LessonResourceType } from '@/types/lesson'

interface LessonResourcesSectionProps {
  lessonId: string
  subjectId: string
  classroomId: string
}

const RESOURCE_ICON: Record<LessonResourceType, typeof FileText> = {
  slide: Presentation,
  video: Video,
  document: FileText,
  link: Link2,
}

/** 'video' is deliberately excluded — a video resource can never be an
 * upload, only a link (see 0015's video-no-upload constraint). */
const UPLOADABLE_TYPES: Extract<LessonResourceType, 'slide' | 'document'>[] = ['slide', 'document']
const LINKABLE_TYPES: LessonResourceType[] = ['slide', 'video', 'document', 'link']

function displayFileName(resource: LessonResource): string {
  if (!resource.filePath) return resource.title
  const parts = resource.filePath.split('/')
  return parts[parts.length - 1]
}

/**
 * "สื่อการสอน" — the teacher-facing resource manager embedded in a
 * lesson. Supports all four resource types (สไลด์/วิดีโอ/เอกสาร/ลิงก์):
 * a slide or document can be either an uploaded file or an external
 * link; a video or a plain link resource is always an external link
 * (there is no video upload path anywhere in this UI, matching the
 * migration's storage-strategy decision — see Section 4/7 of the
 * feature spec). Every action here persists immediately, same "no
 * separate save step" design as AssignmentResourcesSection.
 */
export function LessonResourcesSection({ lessonId, subjectId, classroomId }: LessonResourcesSectionProps) {
  const [resources, setResources] = useState<LessonResource[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [linkFormOpen, setLinkFormOpen] = useState(false)
  const [linkType, setLinkType] = useState<LessonResourceType>('link')
  const [linkTitle, setLinkTitle] = useState('')
  const [linkUrl, setLinkUrl] = useState('')
  const [linkError, setLinkError] = useState<string | null>(null)
  const [linkSubmitting, setLinkSubmitting] = useState(false)

  const [uploadType, setUploadType] = useState<(typeof UPLOADABLE_TYPES)[number]>('slide')
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [rowError, setRowError] = useState<string | null>(null)
  const [busyResourceId, setBusyResourceId] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    setLoadError(null)
    return getLessonResources(lessonId)
      .then(setResources)
      .catch((err: unknown) => setLoadError(toFriendlyErrorMessage(err)))
      .finally(() => setLoading(false))
  }, [lessonId])

  useEffect(() => {
    load()
  }, [load])

  function handleFileButtonClick(type: (typeof UPLOADABLE_TYPES)[number]) {
    setUploadType(type)
    setUploadError(null)
    fileInputRef.current?.click()
  }

  async function handleFileSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    const fileValidationError = validateLessonResourceFile(file)
    if (fileValidationError) {
      setUploadError(fileValidationError)
      return
    }

    setUploading(true)
    setUploadError(null)
    setUploadProgress(10)

    // supabase-js's storage upload() has no native byte-progress callback
    // — reassuring "still working" ramp only, same as AssignmentResourcesSection.
    const ramp = window.setInterval(() => {
      setUploadProgress((p) => (p < 85 ? p + 15 : p))
    }, 250)

    try {
      const created = await addLessonFileResource(
        { lessonId, resourceType: uploadType, title: file.name.replace(/\.[^/.]+$/, ''), file },
        subjectId,
        classroomId,
        computeNextResourceSortOrder(resources),
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

  function openLinkForm(type: LessonResourceType) {
    setLinkType(type)
    setLinkTitle('')
    setLinkUrl('')
    setLinkError(null)
    setLinkFormOpen(true)
  }

  async function handleAddLink() {
    const titleError = validateLessonResourceTitle(linkTitle)
    if (titleError) {
      setLinkError(titleError)
      return
    }
    const urlError = validateLessonResourceUrl(linkUrl)
    if (urlError) {
      setLinkError(urlError)
      return
    }

    setLinkSubmitting(true)
    setLinkError(null)
    try {
      const created = await addLessonLinkResource(
        { lessonId, resourceType: linkType, title: linkTitle, url: linkUrl },
        computeNextResourceSortOrder(resources),
      )
      setResources((prev) => [...prev, created])
      setLinkFormOpen(false)
    } catch (err) {
      setLinkError(toFriendlyErrorMessage(err, 'ไม่สามารถเพิ่มลิงก์ได้'))
    } finally {
      setLinkSubmitting(false)
    }
  }

  async function handleRemove(resource: LessonResource) {
    setRowError(null)
    setBusyResourceId(resource.id)
    try {
      await removeLessonResource(resource)
      setResources((prev) => prev.filter((r) => r.id !== resource.id))
    } catch (err) {
      setRowError(toFriendlyErrorMessage(err, 'ไม่สามารถลบสื่อการสอนได้'))
    } finally {
      setBusyResourceId(null)
    }
  }

  async function handleMove(index: number, direction: -1 | 1) {
    const targetIndex = index + direction
    if (targetIndex < 0 || targetIndex >= resources.length) return

    const reordered = reorderLessonResourcesLocally(resources, index, targetIndex)
    setResources(reordered)
    setRowError(null)
    try {
      await reorderLessonResources(reordered.map((r) => ({ id: r.id, sortOrder: r.sortOrder })))
    } catch (err) {
      setRowError(toFriendlyErrorMessage(err, 'ไม่สามารถจัดลำดับใหม่ได้'))
      load()
    }
  }

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">สื่อการสอน</p>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => handleFileButtonClick('slide')} disabled={uploading}>
            <Plus className="size-3.5" />
            เพิ่มสไลด์
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => openLinkForm('video')}>
            <Plus className="size-3.5" />
            เพิ่มวิดีโอ
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => handleFileButtonClick('document')} disabled={uploading}>
            <Plus className="size-3.5" />
            เพิ่มเอกสาร
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => openLinkForm('link')}>
            <Plus className="size-3.5" />
            เพิ่มลิงก์
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept=".pdf,.pptx,.docx,.jpg,.jpeg,.png,.webp"
            onChange={handleFileSelected}
          />
        </div>
      </div>

      {loadError && <p className="text-sm text-destructive">{loadError}</p>}
      {rowError && <p className="text-sm text-destructive">{rowError}</p>}

      {uploading && (
        <div className="space-y-1">
          <Progress value={uploadProgress} />
          <p className="text-xs text-muted-foreground">กำลังอัปโหลด{lessonResourceTypeLabel(uploadType)}...</p>
        </div>
      )}
      {uploadError && <p className="text-sm text-destructive">{uploadError}</p>}

      {linkFormOpen && (
        <div className="space-y-2 rounded-md border bg-muted/30 p-3">
          {linkError && <p className="text-sm text-destructive">{linkError}</p>}
          <div className="space-y-1.5">
            <Label htmlFor="lesson-resource-type">ประเภทสื่อ</Label>
            <NativeSelect
              id="lesson-resource-type"
              value={linkType}
              onChange={(e) => setLinkType(e.target.value as LessonResourceType)}
            >
              {LINKABLE_TYPES.map((type) => (
                <option key={type} value={type}>
                  {lessonResourceTypeLabel(type)}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lesson-resource-link-title">ชื่อที่แสดง</Label>
            <Input
              id="lesson-resource-link-title"
              value={linkTitle}
              onChange={(e) => setLinkTitle(e.target.value)}
              placeholder="เช่น คลิปการสอนบทที่ 1"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lesson-resource-link-url">ลิงก์ (https://) — YouTube, Google Drive, Google Slides, Canva ฯลฯ</Label>
            <Input
              id="lesson-resource-link-url"
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
        <p className="text-sm text-muted-foreground">ยังไม่มีสื่อการสอนสำหรับบทเรียนนี้</p>
      ) : (
        <ul className="space-y-1.5">
          {resources.map((resource, index) => {
            const Icon = RESOURCE_ICON[resource.resourceType]
            return (
              <li key={resource.id} className="flex items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm">
                <Icon className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{resource.title}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {lessonResourceTypeLabel(resource.resourceType)} ·{' '}
                    {resource.resourceType !== 'video' && resource.filePath ? displayFileName(resource) : resource.url}
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
            )
          })}
        </ul>
      )}
    </div>
  )
}
