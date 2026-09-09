import { ExternalLink, FileText, Link2, Loader2, Presentation, Video } from 'lucide-react'
import { useEffect, useState } from 'react'

import { toFriendlyErrorMessage } from '@/lib/errors'
import { getLessonResourceSignedUrl, getLessonResources, getYoutubeEmbedUrl } from '@/services/lesson-service'
import type { LessonResource, LessonResourceType } from '@/types/lesson'

interface LessonResourcesListProps {
  lessonId: string
}

const RESOURCE_ICON: Record<LessonResourceType, typeof FileText> = {
  slide: Presentation,
  video: Video,
  document: FileText,
  link: Link2,
}

const OPEN_LABEL: Record<LessonResourceType, string> = {
  slide: 'เปิดสไลด์',
  video: 'ดูวิดีโอ',
  document: 'เปิดเอกสาร',
  link: 'เปิดลิงก์',
}

function OpenFileButton({ resource }: { resource: LessonResource }) {
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleOpen() {
    if (!resource.filePath) return
    setOpening(true)
    setError(null)
    try {
      const signedUrl = await getLessonResourceSignedUrl(resource.filePath)
      window.open(signedUrl, '_blank', 'noopener,noreferrer')
    } catch (err) {
      setError(toFriendlyErrorMessage(err, 'ไม่สามารถเปิดไฟล์ได้'))
    } finally {
      setOpening(false)
    }
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={handleOpen}
        disabled={opening}
        className="flex items-center gap-1 text-xs font-medium text-primary hover:underline disabled:opacity-50"
      >
        {opening ? <Loader2 className="size-3 animate-spin" /> : <ExternalLink className="size-3" />}[{OPEN_LABEL[resource.resourceType]}]
      </button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}

/**
 * One lesson's resources, rendered inline (no click-to-expand — Section
 * 6 of the feature spec shows every resource directly under its
 * lesson). Fetched independently PER LESSON — a resource-fetch failure
 * for one lesson never blanks another lesson's card, nor the lessons
 * list itself (Section 10's error isolation requirement, same pattern
 * as this page's other independently-loaded sections).
 *
 * VIDEO UX (Section 7): a recognized YouTube link gets an inline
 * <iframe> preview; every other provider (Google Drive, etc.) falls
 * back to the plain "[ดูวิดีโอ]" open-in-new-tab button — never a
 * download/proxy through Supabase either way. A file resource
 * (slide/document) is never linked to its raw storage path directly —
 * opening one always goes through getLessonResourceSignedUrl() first,
 * the same short-lived-signed-URL pattern as AssignmentResourcesDisclosure.
 */
export function LessonResourcesList({ lessonId }: LessonResourcesListProps) {
  const [resources, setResources] = useState<LessonResource[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    getLessonResources(lessonId)
      .then((rows) => {
        if (active) setResources(rows)
      })
      .catch((err: unknown) => {
        if (active) setError(toFriendlyErrorMessage(err))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [lessonId])

  if (loading) return <p className="text-xs text-muted-foreground">กำลังโหลดสื่อการสอน...</p>
  if (error) return <p className="text-xs text-destructive">{error}</p>
  if (!resources || resources.length === 0) return <p className="text-xs text-muted-foreground">ยังไม่มีสื่อการสอนสำหรับบทเรียนนี้</p>

  return (
    <div className="space-y-3">
      {resources.map((resource) => {
        const Icon = RESOURCE_ICON[resource.resourceType]
        const embedUrl = resource.resourceType === 'video' && resource.url ? getYoutubeEmbedUrl(resource.url) : null

        return (
          <div key={resource.id} className="space-y-1.5">
            <div className="flex items-center gap-1.5 text-sm">
              <Icon className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="font-medium">{resource.title}</span>
            </div>

            {embedUrl && (
              <div className="aspect-video w-full max-w-md overflow-hidden rounded-md border">
                <iframe
                  src={embedUrl}
                  title={resource.title}
                  className="size-full"
                  loading="lazy"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                  sandbox="allow-scripts allow-same-origin allow-presentation"
                />
              </div>
            )}

            {resource.filePath ? (
              <OpenFileButton resource={resource} />
            ) : (
              <a
                href={resource.url ?? undefined}
                target="_blank"
                rel="noopener noreferrer"
                className="flex w-fit items-center gap-1 text-xs font-medium text-primary hover:underline"
              >
                <ExternalLink className="size-3" />[{OPEN_LABEL[resource.resourceType]}]
              </a>
            )}
          </div>
        )
      })}
    </div>
  )
}
