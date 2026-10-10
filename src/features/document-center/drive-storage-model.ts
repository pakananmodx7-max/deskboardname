import type { DriveOverview, DriveStorageErrorCode, DriveStorageItem } from '@/services/drive-storage-service'

import { categoryForFolderName, detectDocumentKind, type DocumentItem } from './document-center-model'

/**
 * Document Center Phase 2 — the teacher's KrunameClass folder on Google
 * Drive, as seen by the page. Pure (tested without a DOM or network).
 */

export const ROOT_LABEL = 'KrunameClass'

export type StorageState =
  /** Demo Mode — needs the real backend. */
  | { status: 'unsupported' }
  /** Waiting for the Google connection status. */
  | { status: 'checking' }
  | { status: 'not_connected' }
  | { status: 'loading' }
  /** Set-up problem the teacher (or project owner) must fix. */
  | { status: 'unavailable'; code: DriveStorageErrorCode; message: string }
  | { status: 'error'; message: string }
  | { status: 'ready'; overview: DriveOverview }

/** Codes that mean "storage can't be used until something is set up". */
const SETUP_CODES: ReadonlySet<DriveStorageErrorCode> = new Set(['not_deployed', 'not_configured', 'not_connected', 'scope_missing', 'reauth_required', 'forbidden', 'unauthorized'])

export function storageStateFromError(error: { code?: string; message?: string } | null | undefined): StorageState {
  const code = (error?.code ?? 'drive_unavailable') as DriveStorageErrorCode
  const message = error?.message || 'ติดต่อ Google Drive ไม่สำเร็จ'
  if (code === 'not_connected') return { status: 'not_connected' }
  return SETUP_CODES.has(code) ? { status: 'unavailable', code, message } : { status: 'error', message }
}

/** What the teacher can do about a set-up problem. */
export function unavailableHelp(code: DriveStorageErrorCode): { title: string; hint: string; reconnect: boolean } {
  switch (code) {
    case 'scope_missing':
      return { title: 'สิทธิ์ Google Drive ไม่ครบ', hint: 'เชื่อมต่อ Google ใหม่ และอนุญาต “ดู แก้ไข สร้าง และลบไฟล์ Google ไดรฟ์ที่ใช้กับแอปนี้”', reconnect: true }
    case 'reauth_required':
      return { title: 'การเชื่อมต่อ Google หมดอายุ', hint: 'กรุณาเชื่อมต่อ Google Drive ใหม่อีกครั้ง', reconnect: true }
    case 'not_deployed':
    case 'not_configured':
      return { title: 'ระบบจัดเก็บบน Google Drive ยังไม่พร้อม', hint: 'ผู้ดูแลระบบต้องติดตั้งและตั้งค่าฟังก์ชัน google-drive-files บนเซิร์ฟเวอร์ก่อน (ดู docs/DOCUMENT_STORAGE.md)', reconnect: false }
    case 'forbidden':
      return { title: 'บัญชีนี้ไม่มีสิทธิ์ใช้พื้นที่จัดเก็บ', hint: 'ใช้ได้เฉพาะบัญชีครู', reconnect: false }
    default:
      return { title: 'ใช้งานพื้นที่จัดเก็บไม่ได้ในขณะนี้', hint: 'กรุณาลองใหม่อีกครั้ง', reconnect: false }
  }
}

// ==================================================
// Folder tree
// ==================================================

export interface FolderCrumb {
  /** null = the KrunameClass root. */
  id: string | null
  name: string
}

export function folderMap(overview: DriveOverview): Map<string, DriveStorageItem> {
  return new Map(overview.items.filter((i) => i.isFolder).map((i) => [i.id, i]))
}

/** Normalise a parent id: the root folder (or an unknown parent) → null. */
function parentKey(item: DriveStorageItem, overview: DriveOverview, folders: Map<string, DriveStorageItem>): string | null {
  if (!item.parentId || item.parentId === overview.root?.id || !folders.has(item.parentId)) return null
  return item.parentId
}

export function breadcrumbs(overview: DriveOverview, folderId: string | null): FolderCrumb[] {
  const folders = folderMap(overview)
  const trail: FolderCrumb[] = []
  const seen = new Set<string>()
  let current = folderId ? folders.get(folderId) : undefined
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    trail.unshift({ id: current.id, name: current.name })
    const parent = parentKey(current, overview, folders)
    current = parent ? folders.get(parent) : undefined
  }
  return [{ id: null, name: ROOT_LABEL }, ...trail]
}

export function folderPathLabel(overview: DriveOverview, folderId: string | null): string {
  return breadcrumbs(overview, folderId)
    .map((c) => c.name)
    .join(' / ')
}

const byName = (a: DriveStorageItem, b: DriveStorageItem) => a.name.localeCompare(b.name, 'th', { numeric: true, sensitivity: 'base' })

/** Direct children of a folder (null = root): folders, then files. */
export function childrenOf(overview: DriveOverview, folderId: string | null): { folders: DriveStorageItem[]; files: DriveStorageItem[] } {
  const folders = folderMap(overview)
  const kids = overview.items.filter((i) => parentKey(i, overview, folders) === folderId)
  return { folders: kids.filter((i) => i.isFolder).sort(byName), files: kids.filter((i) => !i.isFolder).sort(byName) }
}

/** Top-level folder an item lives under (for categories). */
export function topLevelFolder(overview: DriveOverview, item: DriveStorageItem): DriveStorageItem | null {
  const crumbs = breadcrumbs(overview, item.isFolder ? item.id : parentKey(item, overview, folderMap(overview)))
  const top = crumbs[1]
  return top?.id ? (folderMap(overview).get(top.id) ?? null) : null
}

/** All files and folders inside a folder, at any depth. */
export function countInside(overview: DriveOverview, folderId: string): { files: number; folders: number } {
  const folders = folderMap(overview)
  let files = 0
  let subfolders = 0
  for (const item of overview.items) {
    let parent = parentKey(item, overview, folders)
    const seen = new Set<string>()
    while (parent && !seen.has(parent)) {
      if (parent === folderId) {
        if (item.isFolder) subfolders += 1
        else files += 1
        break
      }
      seen.add(parent)
      const next = folders.get(parent)
      parent = next ? parentKey(next, overview, folders) : null
    }
  }
  return { files, folders: subfolders }
}

export function storageCounts(overview: DriveOverview): { files: number; folders: number } {
  return { files: overview.items.filter((i) => !i.isFolder).length, folders: overview.items.filter((i) => i.isFolder).length }
}

/** A Drive file as a Document Center document (search, filters, table). */
export function driveItemToDocument(item: DriveStorageItem, overview: DriveOverview, teacherId: string | null): DocumentItem {
  const folders = folderMap(overview)
  const parent = parentKey(item, overview, folders)
  const top = topLevelFolder(overview, item)
  return {
    id: `drive:${item.id}`,
    source: 'drive',
    resourceId: item.id,
    title: item.name,
    kind: detectDocumentKind({ mimeType: item.mimeType, url: null, filePath: item.name, driveFileId: item.id }),
    filePath: null,
    url: null,
    mimeType: item.mimeType,
    driveFileId: item.id,
    inDrive: true,
    category: categoryForFolderName(top?.name ?? null),
    parentId: parent ?? overview.root?.id ?? '',
    parentTitle: folderPathLabel(overview, parent),
    webViewLink: item.webViewLink,
    subjectId: null,
    subjectName: null,
    classroomId: null,
    classroomName: null,
    semesterKey: null,
    semesterLabel: null,
    createdBy: teacherId,
    createdAt: item.createdTime ?? item.modifiedTime ?? '',
    updatedAt: item.modifiedTime ?? item.createdTime ?? '',
    sizeBytes: item.size,
  }
}

export function driveDocuments(overview: DriveOverview, teacherId: string | null): DocumentItem[] {
  return overview.items.filter((i) => !i.isFolder).map((i) => driveItemToDocument(i, overview, teacherId))
}

export function driveFolderActivity(overview: DriveOverview): { id: string; name: string; createdTime: string | null; path: string }[] {
  const folders = folderMap(overview)
  return overview.items
    .filter((i) => i.isFolder)
    .map((f) => ({ id: f.id, name: f.name, createdTime: f.createdTime, path: folderPathLabel(overview, parentKey(f, overview, folders)) }))
}

// ==================================================
// Preview + formatting
// ==================================================

export type PreviewKind = 'pdf' | 'image' | 'text' | 'video' | 'audio'

/** What the in-app preview can render (Office files are downloaded). */
export function previewKind(mimeType: string | null): PreviewKind | null {
  const mime = (mimeType ?? '').toLowerCase()
  if (mime === 'application/pdf' || mime.startsWith('application/vnd.google-apps.')) return mime === 'application/vnd.google-apps.folder' ? null : 'pdf'
  if (/^image\/(png|jpe?g|gif|webp)$/.test(mime)) return 'image'
  if (mime === 'text/plain' || mime === 'text/csv') return 'text'
  if (mime === 'video/mp4') return 'video'
  if (mime === 'audio/mpeg' || mime === 'audio/mp4') return 'audio'
  return null
}

/** The server always answers application/octet-stream; give the bytes
 * the file's real type (Google Docs arrive exported as PDF) so the
 * browser renders them inline instead of downloading. */
export function typedPreviewBlob(blob: Blob, mimeType: string | null): Blob {
  const kind = previewKind(mimeType)
  return new Blob([blob], { type: kind === 'pdf' ? 'application/pdf' : (mimeType ?? 'application/octet-stream') })
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`
}

/** Folder names that already exist directly under a folder (case-insensitive). */
export function nameTaken(overview: DriveOverview, parentId: string | null, name: string, exceptId?: string): boolean {
  const { folders, files } = childrenOf(overview, parentId)
  const wanted = name.trim().toLocaleLowerCase('th')
  return [...folders, ...files].some((i) => i.id !== exceptId && i.name.trim().toLocaleLowerCase('th') === wanted)
}
