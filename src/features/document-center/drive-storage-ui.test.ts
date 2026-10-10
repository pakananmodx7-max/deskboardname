import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import { success } from '@/features/classroom-analytics/resource'
import { checkUpload, toDriveError, type DriveOverview, type DriveStorageItem } from '@/services/drive-storage-service'

import { canDownload, deriveActivity, toDocumentItem, type DocumentItem } from './document-center-model'
import { INITIAL_UI_STATE, type DocumentCenterUiState } from './document-center-ui'
import { DocumentCenterView } from './document-center-view'
import {
  breadcrumbs,
  childrenOf,
  countInside,
  driveDocuments,
  driveFolderActivity,
  driveItemToDocument,
  folderPathLabel,
  formatBytes,
  nameTaken,
  previewKind,
  storageCounts,
  storageStateFromError,
  typedPreviewBlob,
  type StorageState,
} from './drive-storage-model'

const ME = 'teacher-me'
const NOW = new Date('2026-10-10T05:00:00Z')
const noop = () => {}

function item(id: string, name: string, parentId: string, patch: Partial<DriveStorageItem> = {}): DriveStorageItem {
  const isFolder = patch.isFolder ?? false
  return {
    id,
    name,
    mimeType: isFolder ? 'application/vnd.google-apps.folder' : 'application/pdf',
    isFolder,
    role: isFolder ? 'folder' : 'file',
    size: isFolder ? null : 2048,
    createdTime: '2026-10-09T03:00:00Z',
    modifiedTime: '2026-10-09T04:00:00Z',
    parentId,
    webViewLink: `https://drive.google.com/file/d/${id}/view`,
    ...patch,
  }
}

const ROOT = item('rootfolder01', 'KrunameClass', 'drive-root', { isFolder: true, role: 'root' })
const OVERVIEW: DriveOverview = {
  root: ROOT,
  quota: { usageBytes: 1288490188, limitBytes: 16106127360 },
  items: [
    item('fold-academic', 'งานวิชาการ', ROOT.id, { isFolder: true }),
    item('fold-plans', 'แผนการสอน', 'fold-academic', { isFolder: true, createdTime: '2026-10-10T02:00:00Z' }),
    item('fold-mine', 'โครงการพิเศษ', ROOT.id, { isFolder: true }),
    item('file-root', 'ปฏิทินการศึกษา.pdf', ROOT.id),
    item('file-plan', 'แผน ม.1.docx', 'fold-plans', { mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', createdTime: '2026-10-10T04:30:00Z' }),
    item('file-acad', 'ปกรายงาน.png', 'fold-academic', { mimeType: 'image/png' }),
  ],
}

const ATTACHMENTS: DocumentItem[] = [
  toDocumentItem({
    source: 'lesson',
    id: 'l1',
    title: 'สไลด์บทที่ 2',
    filePath: null,
    url: 'https://docs.google.com/presentation/d/x/edit',
    mimeType: null,
    driveFileId: 'x',
    createdBy: ME,
    createdAt: '2026-10-01T03:00:00Z',
    updatedAt: '2026-10-01T03:00:00Z',
    parent: { id: 'p', title: 'บทที่ 2', subjectId: 's', subjectName: 'วิทยาศาสตร์', classroomId: 'c', classroomName: 'ม.1/1', academicYear: '2569', semester: '1' },
  }),
]

const NO_STORAGE_ACTIONS = {
  upload: async () => {},
  createFolder: async () => OVERVIEW.items[0],
  rename: async () => {},
  trash: async () => {},
  fetchFile: async () => new Blob(),
  retry: noop,
}

function render(opts: { storage?: StorageState; ui?: Partial<DocumentCenterUiState>; folder?: string | null } = {}): string {
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(DocumentCenterView, {
        data: success(ATTACHMENTS),
        drive: { status: 'connected', email: 'teacher@example.test' },
        userId: ME,
        favorites: new Set<string>(),
        onSetFavorites: noop,
        onRetry: noop,
        onConnectDrive: noop,
        onManageDrive: noop,
        onPreview: noop,
        onDownload: noop,
        onOpenSource: noop,
        onCopyLink: noop,
        busyId: null,
        now: NOW,
        storage: opts.storage ?? { status: 'ready', overview: OVERVIEW },
        storageActions: NO_STORAGE_ACTIONS,
        initialUi: opts.ui,
        initialDriveFolderId: opts.folder ?? null,
      }),
    ),
  )
}
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
/** Only the Drive panel (the side activity panel also lists file names). */
const panelText = (html: string) => text(html.slice(html.indexOf('data-testid="drive-panel"'), html.indexOf('aria-label="ข้อมูลเพิ่มเติม"')))
const driveTab = { filters: { ...INITIAL_UI_STATE.filters, tab: 'drive' as const } }

describe('folder tree model', () => {
  it('breadcrumbs, children (folders first, by name), deep counts, paths', () => {
    expect(breadcrumbs(OVERVIEW, 'fold-plans').map((c) => c.name)).toEqual(['KrunameClass', 'งานวิชาการ', 'แผนการสอน'])
    expect(breadcrumbs(OVERVIEW, null)).toEqual([{ id: null, name: 'KrunameClass' }])
    expect(breadcrumbs(OVERVIEW, 'does-not-exist')).toEqual([{ id: null, name: 'KrunameClass' }])
    const root = childrenOf(OVERVIEW, null)
    expect(root.folders.map((f) => f.name)).toEqual(['โครงการพิเศษ', 'งานวิชาการ'])
    expect(root.files.map((f) => f.name)).toEqual(['ปฏิทินการศึกษา.pdf'])
    expect(countInside(OVERVIEW, 'fold-academic')).toEqual({ files: 2, folders: 1 })
    expect(folderPathLabel(OVERVIEW, 'fold-plans')).toBe('KrunameClass / งานวิชาการ / แผนการสอน')
    expect(storageCounts(OVERVIEW)).toEqual({ files: 3, folders: 3 })
  })

  it('Drive files become documents: category from the top-level folder name, real size, owner = teacher', () => {
    const docs = driveDocuments(OVERVIEW, ME)
    const plan = docs.find((d) => d.resourceId === 'file-plan')!
    expect(plan).toMatchObject({ id: 'drive:file-plan', source: 'drive', kind: 'word', category: 'academic', parentId: 'fold-plans', parentTitle: 'KrunameClass / งานวิชาการ / แผนการสอน', sizeBytes: 2048, createdBy: ME, inDrive: true })
    expect(docs.find((d) => d.resourceId === 'file-root')).toMatchObject({ category: 'uncategorized', parentId: ROOT.id, parentTitle: 'KrunameClass' })
    expect(canDownload(plan)).toBe(true)
    expect(canDownload(driveItemToDocument(OVERVIEW.items[3], OVERVIEW, null))).toBe(true)
  })

  it('duplicate names per folder, preview types, sizes', () => {
    expect(nameTaken(OVERVIEW, null, '  งานวิชาการ ')).toBe(true)
    expect(nameTaken(OVERVIEW, 'fold-academic', 'งานวิชาการ')).toBe(false)
    expect(nameTaken(OVERVIEW, null, 'งานวิชาการ', 'fold-academic')).toBe(false)
    expect(previewKind('application/pdf')).toBe('pdf')
    expect(previewKind('application/vnd.google-apps.document')).toBe('pdf')
    expect(previewKind('image/png')).toBe('image')
    expect(previewKind('text/plain')).toBe('text')
    expect(previewKind('application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBeNull()
    // Downloads arrive as octet-stream; previews get the real type.
    const raw = new Blob(['x'], { type: 'application/octet-stream' })
    expect(typedPreviewBlob(raw, 'application/pdf').type).toBe('application/pdf')
    expect(typedPreviewBlob(raw, 'application/vnd.google-apps.document').type).toBe('application/pdf')
    expect(typedPreviewBlob(raw, 'image/png').type).toBe('image/png')
    expect(formatBytes(16106127360)).toBe('15.0 GB')
    expect(formatBytes(2048)).toBe('2 KB')
  })

  it('activity: real uploads and folder creations only', () => {
    const activity = deriveActivity(driveDocuments(OVERVIEW, ME), 3, driveFolderActivity(OVERVIEW))
    expect(activity.map((a) => [a.label, a.documentTitle])).toEqual([
      ['อัปโหลดไฟล์ไป Google Drive', 'แผน ม.1.docx'],
      ['สร้างโฟลเดอร์', 'แผนการสอน'],
      ['อัปโหลดไฟล์ไป Google Drive', 'ปฏิทินการศึกษา.pdf'],
    ])
  })
})

describe('storage states from server errors', () => {
  it('set-up problems vs transient errors', () => {
    expect(storageStateFromError({ code: 'not_connected' })).toEqual({ status: 'not_connected' })
    for (const code of ['not_deployed', 'not_configured', 'scope_missing', 'reauth_required', 'forbidden']) {
      expect(storageStateFromError({ code, message: 'm' })).toMatchObject({ status: 'unavailable', code })
    }
    expect(storageStateFromError({ code: 'rate_limited', message: 'm' })).toEqual({ status: 'error', message: 'm' })
    expect(storageStateFromError(null)).toMatchObject({ status: 'error' })
  })

  it('client error mapping: server code, missing function (404), network', async () => {
    const http = (status: number, body: unknown) => ({ name: 'FunctionsHttpError', context: new Response(JSON.stringify(body), { status }) })
    expect(await toDriveError(http(507, { error: 'พื้นที่ Google Drive เต็ม', code: 'quota_exceeded' }))).toMatchObject({ code: 'quota_exceeded', message: 'พื้นที่ Google Drive เต็ม' })
    expect(await toDriveError(http(404, { code: 'NOT_FOUND', message: 'Requested function was not found' }))).toMatchObject({ code: 'not_deployed' })
    expect(await toDriveError({ name: 'FunctionsFetchError' })).toMatchObject({ code: 'drive_unavailable' })
  })

  it('upload is checked in the browser with the same rules as the server', () => {
    expect(checkUpload({ name: 'แผน.docx', size: 100 })).toBeNull()
    expect(checkUpload({ name: 'setup.exe', size: 100 })).toBe('ไม่รองรับไฟล์ประเภทนี้')
    expect(checkUpload({ name: 'big.pdf', size: 11 * 1024 * 1024 })).toBe('ไฟล์ใหญ่เกิน 10 MB')
  })
})

describe('Document Center with Drive storage connected', () => {
  it('stats: real folder count, Drive file count (storage + attached), real quota', () => {
    const t = text(render())
    expect(t).toMatch(/3 โฟลเดอร์ ใน KrunameClass บน Google Drive/)
    expect(t).toMatch(/4 ไฟล์บน Google Drive/)
    expect(t).toMatch(/4 เอกสารทั้งหมด/)
    expect(t).toContain('ใช้ไป 1.2 GB จาก 15.0 GB')
    expect(render()).toContain('role="progressbar"')
    const unlimited = text(render({ storage: { status: 'ready', overview: { ...OVERVIEW, quota: { usageBytes: 2048, limitBytes: null } } } }))
    expect(unlimited).toContain('บัญชีนี้ไม่จำกัดพื้นที่')
  })

  it('ใน Google Drive tab: breadcrumb, folders with counts, files, upload / new folder, scope note', () => {
    const html = render({ ui: driveTab })
    const t = panelText(html)
    expect(html).toContain('data-testid="drive-panel"')
    expect(html).toContain('aria-current="location"')
    expect(t).toContain('งานวิชาการ 2 ไฟล์ · 1 โฟลเดอร์')
    expect(t).toContain('ปฏิทินการศึกษา.pdf')
    expect(t).not.toContain('แผน ม.1.docx') // lives in a sub-folder
    expect(t).toContain('อัปโหลดไฟล์')
    expect(t).toContain('โฟลเดอร์ใหม่')
    expect(t).toContain('เข้าถึงเฉพาะไฟล์ที่สร้างผ่าน KrunameClass')
    expect(t).toContain('ไฟล์จาก Google Drive ที่แนบในงานและบทเรียน (1)')
    expect(html).toContain('aria-label="ตัวเลือกโฟลเดอร์ งานวิชาการ"')
  })

  it('inside a folder: breadcrumb trail and that folder\'s files only', () => {
    const t = panelText(render({ ui: driveTab, folder: 'fold-plans' }))
    expect(t).toMatch(/KrunameClass .*งานวิชาการ .*แผนการสอน/)
    expect(t).toContain('แผน ม.1.docx')
    expect(t).not.toContain('ปฏิทินการศึกษา.pdf')
  })

  it('search in the Drive tab looks through every folder', () => {
    const t = text(render({ ui: { filters: { ...driveTab.filters, query: 'แผน' } } }))
    expect(t).toContain('ผลการค้นหาในโฟลเดอร์ KrunameClass (1)')
    expect(t).toContain('แผน ม.1.docx')
  })

  it('first use: no KrunameClass folder yet — created on the first upload/folder, never just by looking', () => {
    const t = text(render({ ui: driveTab, storage: { status: 'ready', overview: { root: null, items: [], quota: null } } }))
    expect(t).toContain('ยังไม่มีโฟลเดอร์ KrunameClass ใน Google Drive')
    expect(t).toContain('ระบบจะสร้างโฟลเดอร์ “KrunameClass” ให้อัตโนมัติ')
  })

  it('ทั้งหมด lists Drive files with their folder path; download enabled', () => {
    const html = render()
    const t = text(html)
    expect(t).toContain('KrunameClass / งานวิชาการ / แผนการสอน')
    expect(html).toContain('aria-label="ดาวน์โหลด แผน ม.1.docx"')
    expect(html).not.toMatch(/disabled=""[^>]*aria-label="ดาวน์โหลด แผน ม.1.docx"/)
  })

  it('folder cards: matching category folder shows its real count; extra folders appear; activity from Drive', () => {
    const t = text(render())
    expect(t).toContain('โฟลเดอร์ใน KrunameClass บน Google Drive ของคุณ — เลือกเพื่อเปิด')
    expect(t).toMatch(/งานวิชาการ 3 รายการ/) // 2 Drive files + 1 attachment
    expect(t).toMatch(/เอกสารประจำชั้น 0 รายการ/)
    expect(t).toMatch(/โครงการพิเศษ 0 รายการ/)
    expect(t).toContain('อัปโหลดไฟล์ไป Google Drive')
    expect(t).toContain('สร้างโฟลเดอร์')
  })
})
