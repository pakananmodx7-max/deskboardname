import { semesterKey, semesterLabel } from '@/features/classroom-analytics/analytics'

/**
 * Document Center (ระบบเอกสาร) — Phase 1 data model.
 *
 * There is no document store yet. The only real teacher documents in the
 * system are the files and links attached to assignments
 * (assignment_resources, 0013) and lessons (lesson_resources, 0015),
 * including files picked from Google Drive (drive_file_id, 0018). Those
 * are what this page lists — nothing is invented. Shared files, drafts,
 * folders and storage quota have no data source in Phase 1 and are shown
 * as unavailable, never as numbers.
 */

export type DocumentSource = 'assignment' | 'lesson'

export type DocumentKind =
  | 'word'
  | 'pdf'
  | 'excel'
  | 'powerpoint'
  | 'image'
  | 'video'
  | 'google_doc'
  | 'google_sheet'
  | 'google_slide'
  | 'drive_file'
  | 'link'
  | 'other'

/** Folder/category structure. Only `academic` has a data source today
 * (assignment and lesson materials); the rest are Phase 2 categories. */
export type DocumentCategory = 'academic' | 'homeroom' | 'reports' | 'personal'

export interface DocumentItem {
  /** `${source}:${resourceId}` — unique across both tables. */
  id: string
  source: DocumentSource
  resourceId: string
  title: string
  kind: DocumentKind
  /** Storage object path (private bucket) — files only. */
  filePath: string | null
  /** External https URL — links only. */
  url: string | null
  mimeType: string | null
  driveFileId: string | null
  /** From Google Drive (picked file or a Drive/Docs URL). */
  inDrive: boolean
  category: DocumentCategory
  /** The assignment or lesson the document is attached to. */
  parentId: string
  parentTitle: string
  subjectId: string | null
  subjectName: string | null
  classroomId: string | null
  classroomName: string | null
  semesterKey: string | null
  semesterLabel: string | null
  createdBy: string | null
  createdAt: string
  updatedAt: string
  /** Not stored by the resource tables — always null in Phase 1. */
  sizeBytes: number | null
}

// ==================================================
// Kinds
// ==================================================

export const KIND_LABEL: Record<DocumentKind, string> = {
  word: 'Word',
  pdf: 'PDF',
  excel: 'Excel',
  powerpoint: 'PowerPoint',
  image: 'รูปภาพ',
  video: 'วิดีโอ',
  google_doc: 'Google Docs',
  google_sheet: 'Google Sheets',
  google_slide: 'Google Slides',
  drive_file: 'Google Drive',
  link: 'ลิงก์',
  other: 'ไฟล์อื่น ๆ',
}

/** Groups offered in the ประเภทไฟล์ filter. */
export type KindFilter = 'all' | 'word' | 'pdf' | 'excel' | 'powerpoint' | 'image' | 'video' | 'google' | 'link' | 'other'

export const KIND_FILTER_LABEL: Record<KindFilter, string> = {
  all: 'ทุกประเภท',
  word: 'Word',
  pdf: 'PDF',
  excel: 'Excel',
  powerpoint: 'PowerPoint',
  image: 'รูปภาพ',
  video: 'วิดีโอ',
  google: 'Google Docs / Sheets / Slides / Drive',
  link: 'ลิงก์เว็บไซต์',
  other: 'อื่น ๆ',
}

function kindGroup(kind: DocumentKind): Exclude<KindFilter, 'all'> {
  if (kind === 'google_doc' || kind === 'google_sheet' || kind === 'google_slide' || kind === 'drive_file') return 'google'
  return kind
}

const EXTENSION_KIND: Record<string, DocumentKind> = {
  doc: 'word',
  docx: 'word',
  odt: 'word',
  rtf: 'word',
  pdf: 'pdf',
  xls: 'excel',
  xlsx: 'excel',
  csv: 'excel',
  ods: 'excel',
  ppt: 'powerpoint',
  pptx: 'powerpoint',
  odp: 'powerpoint',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image',
  mp4: 'video',
  mov: 'video',
  webm: 'video',
}

function extensionOf(value: string | null): string | null {
  if (!value) return null
  const clean = value.split(/[?#]/)[0]
  const match = /\.([a-z0-9]{2,5})$/i.exec(clean)
  return match ? match[1].toLowerCase() : null
}

export function isDriveUrl(url: string | null): boolean {
  if (!url) return false
  try {
    const host = new URL(url).hostname
    return host === 'drive.google.com' || host === 'docs.google.com'
  } catch {
    return false
  }
}

/** Best guess of the document type from what the resource row stores. */
export function detectDocumentKind(input: { mimeType: string | null; url: string | null; filePath: string | null; driveFileId: string | null }): DocumentKind {
  const mime = (input.mimeType ?? '').toLowerCase()
  if (mime === 'application/vnd.google-apps.document') return 'google_doc'
  if (mime === 'application/vnd.google-apps.spreadsheet') return 'google_sheet'
  if (mime === 'application/vnd.google-apps.presentation') return 'google_slide'
  if (mime === 'application/pdf') return 'pdf'
  if (mime.includes('wordprocessingml') || mime === 'application/msword' || mime.includes('opendocument.text')) return 'word'
  if (mime.includes('spreadsheetml') || mime === 'application/vnd.ms-excel' || mime === 'text/csv' || mime.includes('opendocument.spreadsheet')) return 'excel'
  if (mime.includes('presentationml') || mime === 'application/vnd.ms-powerpoint' || mime.includes('opendocument.presentation')) return 'powerpoint'
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'

  if (input.url) {
    try {
      const u = new URL(input.url)
      if (u.hostname === 'docs.google.com') {
        if (u.pathname.startsWith('/document')) return 'google_doc'
        if (u.pathname.startsWith('/spreadsheets')) return 'google_sheet'
        if (u.pathname.startsWith('/presentation')) return 'google_slide'
        return 'drive_file'
      }
      if (u.hostname === 'drive.google.com') return 'drive_file'
      if (u.hostname.endsWith('youtube.com') || u.hostname === 'youtu.be') return 'video'
    } catch {
      // not a URL — fall through
    }
  }
  const ext = extensionOf(input.filePath) ?? extensionOf(input.url)
  if (ext && EXTENSION_KIND[ext]) return EXTENSION_KIND[ext]
  if (input.driveFileId) return 'drive_file'
  return input.url ? 'link' : 'other'
}

// ==================================================
// Categories / folders
// ==================================================

export interface CategoryInfo {
  key: DocumentCategory
  label: string
  /** True when documents of this category exist in the system today. */
  supported: boolean
}

export const DOCUMENT_CATEGORIES: CategoryInfo[] = [
  { key: 'academic', label: 'งานวิชาการ', supported: true },
  { key: 'homeroom', label: 'เอกสารประจำชั้น', supported: false },
  { key: 'reports', label: 'รายงานและประเมินผล', supported: false },
  { key: 'personal', label: 'เอกสารส่วนตัว', supported: false },
]

export const CATEGORY_LABEL: Record<DocumentCategory, string> = Object.fromEntries(DOCUMENT_CATEGORIES.map((c) => [c.key, c.label])) as Record<DocumentCategory, string>

export const SOURCE_LABEL: Record<DocumentSource, string> = {
  assignment: 'ไฟล์แนบงาน',
  lesson: 'สื่อการสอน',
}

// ==================================================
// Row building (used by the service; pure for tests)
// ==================================================

export interface ResourceRowInput {
  source: DocumentSource
  id: string
  title: string
  filePath: string | null
  url: string | null
  mimeType: string | null
  driveFileId: string | null
  createdBy: string | null
  createdAt: string
  updatedAt: string
  parent: {
    id: string
    title: string
    subjectId: string | null
    subjectName: string | null
    classroomId: string | null
    classroomName: string | null
    academicYear: string | null
    semester: string | null
  }
}

export function toDocumentItem(row: ResourceRowInput): DocumentItem {
  const kind = detectDocumentKind(row)
  const hasTerm = Boolean(row.parent.academicYear?.trim() || row.parent.semester?.trim())
  return {
    id: `${row.source}:${row.id}`,
    source: row.source,
    resourceId: row.id,
    title: row.title,
    kind,
    filePath: row.filePath,
    url: row.url,
    mimeType: row.mimeType,
    driveFileId: row.driveFileId,
    inDrive: Boolean(row.driveFileId) || isDriveUrl(row.url),
    category: 'academic',
    parentId: row.parent.id,
    parentTitle: row.parent.title,
    subjectId: row.parent.subjectId,
    subjectName: row.parent.subjectName,
    classroomId: row.parent.classroomId,
    classroomName: row.parent.classroomName,
    semesterKey: hasTerm ? semesterKey(row.parent.academicYear, row.parent.semester) : null,
    semesterLabel: hasTerm ? semesterLabel(row.parent.academicYear, row.parent.semester) : null,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    sizeBytes: null,
  }
}

// ==================================================
// Tabs, filters, sorting
// ==================================================

export type DocumentTab = 'all' | 'mine' | 'shared' | 'drive' | 'favorites'

export const DOCUMENT_TABS: { key: DocumentTab; label: string }[] = [
  { key: 'all', label: 'ทั้งหมด' },
  { key: 'mine', label: 'เอกสารของฉัน' },
  { key: 'shared', label: 'แชร์กับฉัน' },
  { key: 'drive', label: 'ใน Google Drive' },
  { key: 'favorites', label: 'รายการโปรด' },
]

export type DocumentSort = 'updated_desc' | 'name_asc' | 'name_desc' | 'oldest'

export const SORT_LABEL: Record<DocumentSort, string> = {
  updated_desc: 'แก้ไขล่าสุด',
  name_asc: 'ชื่อ A–Z',
  name_desc: 'ชื่อ Z–A',
  oldest: 'เก่าสุด',
}

export type DocumentView = 'list' | 'grid'

export interface DocumentFilters {
  tab: DocumentTab
  query: string
  kind: KindFilter
  category: DocumentCategory | 'all'
  semester: string | 'all'
  sort: DocumentSort
}

export const DEFAULT_DOCUMENT_FILTERS: DocumentFilters = {
  tab: 'all',
  query: '',
  kind: 'all',
  category: 'all',
  semester: 'all',
  sort: 'updated_desc',
}

export function hasActiveFilters(f: DocumentFilters): boolean {
  return f.query.trim() !== '' || f.kind !== 'all' || f.category !== 'all' || f.semester !== 'all'
}

function normalise(text: string): string {
  return text.toLocaleLowerCase('th').replace(/\s+/g, ' ').trim()
}

/** Search covers the name, the assignment/lesson it belongs to, subject,
 * classroom, type and category ("แท็ก"). */
export function matchesQuery(item: DocumentItem, query: string): boolean {
  const q = normalise(query)
  if (!q) return true
  const haystack = normalise(
    [item.title, item.parentTitle, item.subjectName, item.classroomName, KIND_LABEL[item.kind], CATEGORY_LABEL[item.category], SOURCE_LABEL[item.source]].filter(Boolean).join(' '),
  )
  return q.split(' ').every((part) => haystack.includes(part))
}

export function filterDocuments(items: DocumentItem[], f: DocumentFilters, ctx: { userId: string | null; favorites: ReadonlySet<string> }): DocumentItem[] {
  return items.filter((item) => {
    if (f.tab === 'mine' && (!ctx.userId || item.createdBy !== ctx.userId)) return false
    // No sharing between teachers exists yet — nothing is "shared with me".
    if (f.tab === 'shared') return false
    if (f.tab === 'drive' && !item.inDrive) return false
    if (f.tab === 'favorites' && !ctx.favorites.has(item.id)) return false
    if (f.kind !== 'all' && kindGroup(item.kind) !== f.kind) return false
    if (f.category !== 'all' && item.category !== f.category) return false
    if (f.semester !== 'all' && item.semesterKey !== f.semester) return false
    return matchesQuery(item, f.query)
  })
}

export function sortDocuments(items: DocumentItem[], sort: DocumentSort): DocumentItem[] {
  const byName = (a: DocumentItem, b: DocumentItem) => a.title.localeCompare(b.title, 'th', { numeric: true, sensitivity: 'base' })
  const copy = [...items]
  switch (sort) {
    case 'name_asc':
      return copy.sort((a, b) => byName(a, b) || a.id.localeCompare(b.id))
    case 'name_desc':
      return copy.sort((a, b) => byName(b, a) || a.id.localeCompare(b.id))
    case 'oldest':
      return copy.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
    case 'updated_desc':
      return copy.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id))
  }
}

export interface SemesterFilterOption {
  key: string
  label: string
}

export function semesterOptions(items: DocumentItem[]): SemesterFilterOption[] {
  const byKey = new Map<string, string>()
  for (const item of items) if (item.semesterKey && item.semesterLabel) byKey.set(item.semesterKey, item.semesterLabel)
  return [...byKey.entries()].map(([key, label]) => ({ key, label })).sort((a, b) => b.key.localeCompare(a.key, 'th', { numeric: true }))
}

// ==================================================
// Stats + activity (only from real rows)
// ==================================================

export interface DocumentStatsData {
  total: number
  addedThisMonth: number
  inDrive: number
  /** Real count per supported category; null = no data source yet. */
  byCategory: Record<DocumentCategory, number | null>
}

export function computeDocumentStats(items: DocumentItem[], now: Date): DocumentStatsData {
  const monthPrefix = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', timeZone: 'Asia/Bangkok' }).format(now)
  const monthOf = (iso: string) => new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', timeZone: 'Asia/Bangkok' }).format(new Date(iso))
  const byCategory = Object.fromEntries(DOCUMENT_CATEGORIES.map((c) => [c.key, c.supported ? 0 : null])) as Record<DocumentCategory, number | null>
  for (const item of items) {
    const current = byCategory[item.category]
    if (current !== null) byCategory[item.category] = current + 1
  }
  return {
    total: items.length,
    addedThisMonth: items.filter((i) => monthOf(i.createdAt) === monthPrefix).length,
    inDrive: items.filter((i) => i.inDrive).length,
    byCategory,
  }
}

export interface DocumentActivity {
  id: string
  kind: 'upload_file' | 'add_link' | 'add_drive'
  label: string
  documentTitle: string
  context: string
  at: string
}

/** Activity derived only from real records: when each file/link was
 * added (created_at). No edit/share/delete history exists yet. */
export function deriveActivity(items: DocumentItem[], limit = 6): DocumentActivity[] {
  return [...items]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit)
    .map((item) => {
      const kind: DocumentActivity['kind'] = item.inDrive ? 'add_drive' : item.filePath ? 'upload_file' : 'add_link'
      return {
        id: item.id,
        kind,
        label: kind === 'upload_file' ? 'อัปโหลดไฟล์' : kind === 'add_drive' ? 'เพิ่มไฟล์จาก Google Drive' : 'เพิ่มลิงก์',
        documentTitle: item.title,
        context: [SOURCE_LABEL[item.source], item.classroomName].filter(Boolean).join(' · '),
        at: item.createdAt,
      }
    })
}

// ==================================================
// Formatting
// ==================================================

const TIME = new Intl.DateTimeFormat('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' })
const DATE = new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Bangkok' })
const DAY = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Bangkok' })

/** "วันนี้ 14:32", "เมื่อวาน 16:20", "8 ต.ค. 2569". */
export function formatDocumentDate(iso: string, now: Date = new Date()): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  const day = DAY.format(date)
  if (day === DAY.format(now)) return `วันนี้ ${TIME.format(date)}`
  const yesterday = new Date(now.getTime() - 86_400_000)
  if (day === DAY.format(yesterday)) return `เมื่อวาน ${TIME.format(date)}`
  return DATE.format(date)
}

export function formatSize(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes)) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** "ม.1/1 · วิทยาศาสตร์" or "—". */
export function placeLabel(item: DocumentItem): string {
  return [item.classroomName, item.subjectName].filter(Boolean).join(' · ') || '—'
}

/** Where the document lives in the app (to manage it there). */
export function sourcePath(item: DocumentItem): string | null {
  if (!item.subjectId || !item.classroomId) return null
  const base = `/teacher/subjects/${item.subjectId}/classrooms/${item.classroomId}`
  return item.source === 'assignment' ? `${base}/assignments/${item.parentId}` : `${base}?tab=lessons`
}

// ==================================================
// Favourites — stored on this device only (no table exists yet)
// ==================================================

interface KeyValueStorage {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
}

export function favoritesKey(userId: string | null): string {
  return `kc-document-favorites:${userId ?? 'demo'}`
}

export function readFavorites(storage: KeyValueStorage | null, userId: string | null): Set<string> {
  try {
    const raw = storage?.getItem(favoritesKey(userId))
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return new Set(Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [])
  } catch {
    return new Set()
  }
}

export function writeFavorites(storage: KeyValueStorage | null, userId: string | null, favorites: ReadonlySet<string>): void {
  try {
    storage?.setItem(favoritesKey(userId), JSON.stringify([...favorites]))
  } catch {
    // storage unavailable (private mode) — favourites last for this visit
  }
}

export function toggleFavorite(favorites: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(favorites)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}

/** File name for a download: the title, with the stored file's extension. */
export function downloadName(item: DocumentItem): string {
  const ext = extensionOf(item.filePath)
  const base = item.title.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'เอกสาร'
  return ext && !base.toLowerCase().endsWith(`.${ext}`) ? `${base}.${ext}` : base
}
