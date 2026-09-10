import { Cloud, FileText, Link2, Palette, Presentation, Table2, Video, type LucideIcon } from 'lucide-react'

/**
 * Google Drive Integration — Phase 1 (external URL provider only).
 *
 * Every external resource "provider" this app recognizes, derived
 * PURELY from a validated `https://` URL's hostname (+ path, for
 * docs.google.com) — see detectResourceProvider. This is the ONE shared
 * place that parsing happens: Lessons, Assignments, and the Student
 * Portal all call this same module instead of each re-implementing
 * their own Google/YouTube/Canva URL sniffing (see the feature spec's
 * "avoid separate Google URL parsing implementations" requirement).
 *
 * 'link' is the generic fallback for any other https:// URL — including
 * a Google host this app doesn't specifically recognize (e.g.
 * docs.google.com/forms), a malformed URL, or a non-https URL.
 *
 * PHASE 1 SCOPE: this is validated-URL detection only. No Google OAuth,
 * no Google Drive/Sheets API calls, no server-side fetch of any
 * external URL, no copying Google-hosted files into Supabase Storage.
 * A resource of any provider here is stored exactly like any other
 * link resource always has been — `resource_type = 'link'` (or, for
 * lessons, whichever of slide/video/document/link best matches — see
 * RESOURCE_ADD_KINDS below) plus the plain `url` column. There is no
 * "provider" column anywhere and Phase 1 adds none — see Section 11 of
 * the feature spec ("no migration required, existing external_url/
 * resource_type fields are sufficient").
 *
 * Adding a future provider (Google Drive API, OneDrive, Dropbox, ...)
 * means adding one branch to detectResourceProvider and one entry to
 * each Record below — the academic data model never has to change.
 */
export type ResourceProvider =
  | 'google_drive'
  | 'google_docs'
  | 'google_sheets'
  | 'google_slides'
  | 'youtube'
  | 'canva'
  | 'link'

const GOOGLE_DRIVE_HOST = 'drive.google.com'
const GOOGLE_DOCS_HOST = 'docs.google.com'
const YOUTUBE_HOSTS = new Set(['youtube.com', 'youtu.be', 'm.youtube.com'])
const CANVA_HOST = 'canva.com'

function stripWww(hostname: string): string {
  return hostname.startsWith('www.') ? hostname.slice(4) : hostname
}

/**
 * Pure — derives the provider from the URL's protocol + hostname (+
 * path, for docs.google.com) ONLY, never from any caller-supplied label.
 * Returns 'link' for anything unrecognized, including a malformed URL, a
 * non-https URL, or a deceptive lookalike hostname such as
 * "drive.google.com.attacker.example" — every hostname check below is
 * EXACT equality (after stripping at most one leading "www."), never a
 * substring/suffix/`.includes()` check, so a lookalike domain that merely
 * contains or ends with a real Google hostname can never match. HTTPS is
 * required — an `http://` (or any other scheme) URL always returns
 * 'link', it is never treated as a recognized provider.
 */
export function detectResourceProvider(rawUrl: string): ResourceProvider {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return 'link'
  }
  if (parsed.protocol !== 'https:') return 'link'

  const host = stripWww(parsed.hostname.toLowerCase())

  if (host === GOOGLE_DRIVE_HOST) return 'google_drive'
  if (host === GOOGLE_DOCS_HOST) {
    if (parsed.pathname.startsWith('/document')) return 'google_docs'
    if (parsed.pathname.startsWith('/spreadsheets')) return 'google_sheets'
    if (parsed.pathname.startsWith('/presentation')) return 'google_slides'
    return 'link'
  }
  if (YOUTUBE_HOSTS.has(host)) return 'youtube'
  if (host === CANVA_HOST) return 'canva'
  return 'link'
}

/** True for any of the four Google Workspace providers — used to decide
 * when to show the Google Drive sharing-permissions reminder (Section 5
 * of the feature spec). */
export function isGoogleProvider(provider: ResourceProvider): boolean {
  return provider === 'google_drive' || provider === 'google_docs' || provider === 'google_sheets' || provider === 'google_slides'
}

export const PROVIDER_LABEL: Record<ResourceProvider, string> = {
  google_drive: 'Google Drive',
  google_docs: 'Google Docs',
  google_sheets: 'Google Sheets',
  google_slides: 'Google Slides',
  youtube: 'YouTube',
  canva: 'Canva',
  link: 'ลิงก์',
}

/** The open-button/link text for a resource of this provider.
 * 'เปิดใน Google Slides' is the literal fallback text the feature spec
 * requires always be retained next to (or in place of) a Slides
 * preview. */
export const PROVIDER_OPEN_LABEL: Record<ResourceProvider, string> = {
  google_drive: 'เปิดใน Google Drive',
  google_docs: 'เปิด Google Docs',
  google_sheets: 'เปิด Google Sheets',
  google_slides: 'เปิดใน Google Slides',
  youtube: 'ดูวิดีโอ',
  canva: 'เปิดใน Canva',
  link: 'เปิดลิงก์',
}

export const PROVIDER_ICON: Record<ResourceProvider, LucideIcon> = {
  google_drive: Cloud,
  google_docs: FileText,
  google_sheets: Table2,
  google_slides: Presentation,
  youtube: Video,
  canva: Palette,
  link: Link2,
}

/**
 * The provider "kind" choices offered when a teacher ADDS a link
 * resource (Section 1 of the feature spec). 'google_sheets' is
 * deliberately not offered here — a teacher never explicitly picks
 * "this is a spreadsheet" when attaching a resource — but a
 * docs.google.com/spreadsheets URL pasted under any other kind (or
 * already saved from before this feature shipped) is still correctly
 * DETECTED and DISPLAYED as Google Sheets by detectResourceProvider,
 * which always wins over whatever kind was picked at add time. This
 * list is only ever a UX hint (placeholder text, the Google permissions
 * reminder) — it is never persisted; there is no "kind"/"provider"
 * column on assignment_resources or lesson_resources.
 */
export const RESOURCE_ADD_KINDS: { kind: ResourceProvider; label: string }[] = [
  { kind: 'google_drive', label: 'Google Drive' },
  { kind: 'google_docs', label: 'Google Docs' },
  { kind: 'google_slides', label: 'Google Slides' },
  { kind: 'youtube', label: 'YouTube' },
  { kind: 'canva', label: 'Canva' },
  { kind: 'link', label: 'ลิงก์อื่น' },
]

export const RESOURCE_ADD_KIND_PLACEHOLDER: Record<ResourceProvider, string> = {
  google_drive: 'https://drive.google.com/...',
  google_docs: 'https://docs.google.com/document/...',
  google_sheets: 'https://docs.google.com/spreadsheets/...',
  google_slides: 'https://docs.google.com/presentation/...',
  youtube: 'https://www.youtube.com/watch?v=...',
  canva: 'https://www.canva.com/design/...',
  link: 'https://...',
}

/**
 * Section 5's exact required reminder text — shown whenever a teacher is
 * adding (or has added) a Google-provider resource. AI Classroom never
 * reads or changes the file's actual Google Drive sharing settings, and
 * never makes a file public automatically; this is purely informational.
 */
export const GOOGLE_PERMISSIONS_HELPER_TEXT =
  'ตรวจสอบว่าได้ตั้งค่าสิทธิ์ไฟล์ใน Google Drive ให้นักเรียนที่เกี่ยวข้องสามารถเปิดดูได้'

/**
 * Returns Google's OWN public embed URL
 * (https://docs.google.com/presentation/d/<id>/embed) for a recognized
 * Google Slides link, or null for anything else. Deriving this URL is
 * not a permissions bypass: it is reached with no credentials or
 * cookies this app controls, so if the presentation is not shared as
 * "anyone with the link" (or published to the web), Google itself
 * renders its own access-denied page inside the iframe — exactly what a
 * direct visit to that URL would show. The caller (the resource list
 * components) always keeps the plain "เปิดใน Google Slides" open-in-
 * new-tab link/button alongside any preview — the preview is additional
 * and optional, never a replacement.
 */
export function getGoogleSlidesEmbedUrl(rawUrl: string): string | null {
  if (detectResourceProvider(rawUrl) !== 'google_slides') return null

  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return null
  }
  const match = parsed.pathname.match(/^\/presentation\/d\/([a-zA-Z0-9_-]+)/)
  if (!match) return null
  return `https://docs.google.com/presentation/d/${match[1]}/embed`
}

/**
 * Returns a `https://www.youtube.com/embed/<id>` URL for a recognized
 * youtube.com/youtu.be watch/share/embed/shorts link, or null for
 * anything else (including a malformed YouTube-looking URL with no
 * extractable video id) — null always means "fall back to the plain
 * open-in-new-tab button," never an error. Relocated here from
 * lesson-service.ts (which still re-exports it for backward
 * compatibility) as part of consolidating every external-link "safe
 * preview" derivation into this one shared module, alongside
 * getGoogleSlidesEmbedUrl above — same shape, same "derive, never
 * proxy" rule.
 */
export function getYoutubeEmbedUrl(rawUrl: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:') return null

  const host = stripWww(parsed.hostname.toLowerCase())
  let videoId: string | null = null

  if (host === 'youtu.be') {
    videoId = parsed.pathname.slice(1).split('/')[0] || null
  } else if (host === 'youtube.com' || host === 'm.youtube.com') {
    if (parsed.pathname === '/watch') {
      videoId = parsed.searchParams.get('v')
    } else if (parsed.pathname.startsWith('/embed/')) {
      videoId = parsed.pathname.slice('/embed/'.length).split('/')[0] || null
    } else if (parsed.pathname.startsWith('/shorts/')) {
      videoId = parsed.pathname.slice('/shorts/'.length).split('/')[0] || null
    }
  }

  if (!videoId || !/^[\w-]{6,}$/.test(videoId)) return null
  return `https://www.youtube.com/embed/${videoId}`
}
