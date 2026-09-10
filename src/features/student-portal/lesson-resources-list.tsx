import { ExternalLink, FileText, Link2, Loader2, Presentation, Video } from 'lucide-react'
import { useEffect, useState } from 'react'

import { toFriendlyErrorMessage } from '@/lib/errors'
import {
  detectResourceProvider,
  getGoogleSlidesEmbedUrl,
  PROVIDER_ICON,
  PROVIDER_LABEL,
  PROVIDER_OPEN_LABEL,
} from '@/lib/resource-provider'
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
 * Google Drive Integration, Section 4: a Google Slides preview is
 * ALWAYS optional (click-to-reveal), unlike the YouTube video preview
 * below (which is automatic) — the student explicitly chooses to load
 * Google's own embed iframe. `embedUrl` is Google's OWN public embed
 * endpoint (see getGoogleSlidesEmbedUrl's doc comment) — showing it is
 * not a permissions bypass: if the presentation isn't shared as "anyone
 * with the link", Google renders its own access-denied page inside the
 * iframe, and the caption below says as much. The plain "[เปิดใน Google
 * Slides]" open-in-new-tab link (rendered by the caller, outside this
 * component) is always present regardless of whether the preview is
 * shown — never replaced by it.
 */
function GoogleSlidesPreview({ title, embedUrl }: { title: string; embedUrl: string }) {
  const [showPreview, setShowPreview] = useState(false)

  return (
    <div className="space-y-1.5">
      <button
        type="button"
        onClick={() => setShowPreview((v) => !v)}
        className="text-xs font-medium text-muted-foreground hover:text-foreground hover:underline"
      >
        {showPreview ? 'ซ่อนตัวอย่างสไลด์' : 'แสดงตัวอย่างสไลด์'}
      </button>
      {showPreview && (
        <>
          <div className="aspect-video w-full max-w-md overflow-hidden rounded-md border">
            <iframe
              src={embedUrl}
              title={title}
              className="size-full"
              loading="lazy"
              allowFullScreen
              sandbox="allow-scripts allow-same-origin allow-presentation"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            การแสดงตัวอย่างขึ้นอยู่กับการตั้งค่าสิทธิ์การแชร์ไฟล์ใน Google Slides —
            หากไม่สามารถดูตัวอย่างได้ ให้ลองเปิดในแท็บใหม่แทน
          </p>
        </>
      )}
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
 *
 * GOOGLE PROVIDER UX (Google Drive Integration, Section 3/4/6): every
 * link resource shows its provider (Google Drive/Docs/Sheets/Slides/
 * YouTube/Canva/generic link) via the ONE shared detectResourceProvider
 * (never a second, locally-reimplemented parser) — the label AND the
 * open button's text always come from that detection, never from
 * resource_type or anything the teacher picked while adding it. A
 * recognized Google Slides link additionally gets the optional preview
 * above.
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
        const provider = resource.url ? detectResourceProvider(resource.url) : null
        const Icon = provider ? PROVIDER_ICON[provider] : RESOURCE_ICON[resource.resourceType]
        const youtubeEmbedUrl = resource.resourceType === 'video' && resource.url ? getYoutubeEmbedUrl(resource.url) : null
        const slidesEmbedUrl = provider === 'google_slides' && resource.url ? getGoogleSlidesEmbedUrl(resource.url) : null
        const openLabel = provider ? PROVIDER_OPEN_LABEL[provider] : OPEN_LABEL[resource.resourceType]

        return (
          <div key={resource.id} className="space-y-1.5">
            <div className="flex items-center gap-1.5 text-sm">
              <Icon className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="font-medium">{resource.title}</span>
              {provider && <span className="text-xs text-muted-foreground">· {PROVIDER_LABEL[provider]}</span>}
            </div>

            {youtubeEmbedUrl && (
              <div className="aspect-video w-full max-w-md overflow-hidden rounded-md border">
                <iframe
                  src={youtubeEmbedUrl}
                  title={resource.title}
                  className="size-full"
                  loading="lazy"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                  sandbox="allow-scripts allow-same-origin allow-presentation"
                />
              </div>
            )}

            {slidesEmbedUrl && <GoogleSlidesPreview title={resource.title} embedUrl={slidesEmbedUrl} />}

            {resource.filePath ? (
              <OpenFileButton resource={resource} />
            ) : (
              <a
                href={resource.url ?? undefined}
                target="_blank"
                rel="noopener noreferrer"
                className="flex w-fit items-center gap-1 text-xs font-medium text-primary hover:underline"
              >
                <ExternalLink className="size-3" />[{openLabel}]
              </a>
            )}
          </div>
        )
      })}
    </div>
  )
}
