import { readdirSync, readFileSync } from 'node:fs'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import { success, type Resource } from '@/features/classroom-analytics/resource'

import { toDocumentItem, type DocumentItem, type ResourceRowInput } from './document-center-model'
import { documentCenterUiReducer, INITIAL_UI_STATE, nextTabIndex, type DocumentCenterUiState, type DriveConnection } from './document-center-ui'
import { DocumentCenterView } from './document-center-view'
import { DocumentInfoBody } from './document-info-dialog'
import { DOCUMENT_TEMPLATES } from './document-templates'
import type { StorageState } from './drive-storage-model'

const ME = 'teacher-me'
const NOW = new Date('2026-10-10T05:00:00Z')
const noop = () => {}

function row(id: string, patch: Partial<ResourceRowInput> = {}): ResourceRowInput {
  return {
    source: 'assignment',
    id,
    title: `เอกสาร ${id}`,
    filePath: `c/a/${id}.pdf`,
    url: null,
    mimeType: 'application/pdf',
    driveFileId: null,
    createdBy: ME,
    createdAt: '2026-10-09T03:00:00Z',
    updatedAt: '2026-10-09T03:00:00Z',
    parent: { id: 'a1', title: 'ใบงานเรื่องแรง', subjectId: 's1', subjectName: 'วิทยาศาสตร์', classroomId: 'c1', classroomName: 'ม.1/1', academicYear: '2569', semester: '1' },
    ...patch,
  }
}

const ITEMS: DocumentItem[] = [
  toDocumentItem(row('1', { title: 'แผนการจัดการเรียนรู้ วิทยาศาสตร์', filePath: 'c/a/plan.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })),
  toDocumentItem(row('2', { title: 'ใบความรู้เรื่องแรง' })),
  toDocumentItem(row('3', { title: 'แบบฟอร์มส่งงาน', filePath: null, url: 'https://forms.gle/abc', mimeType: null })),
]

const NO_STORAGE_ACTIONS = {
  upload: async () => {},
  createFolder: async () => {
    throw new Error('not used')
  },
  rename: async () => {},
  trash: async () => {},
  fetchFile: async () => new Blob(),
  retry: () => {},
}

function render(opts: { data?: Resource<DocumentItem[]>; drive?: DriveConnection; storage?: StorageState; ui?: Partial<DocumentCenterUiState>; favorites?: string[]; userId?: string | null } = {}): string {
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(DocumentCenterView, {
        data: opts.data ?? success(ITEMS),
        drive: opts.drive ?? { status: 'connected', email: 'teacher@example.test' },
        userId: opts.userId === undefined ? ME : opts.userId,
        favorites: new Set(opts.favorites ?? []),
        onSetFavorites: noop,
        onRetry: noop,
        onConnectDrive: noop,
        onManageDrive: noop,
        onPreview: noop,
        onDownload: noop,
        onOpenSource: noop,
        onCopyLink: noop,
        busyId: null,
        initialUi: opts.ui,
        now: NOW,
        storage: opts.storage ?? { status: 'not_connected' },
        storageActions: NO_STORAGE_ACTIONS,
      }),
    ),
  )
}

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf-8')
}

describe('Document Center — page structure', () => {
  const html = render()
  const t = text(html)

  it('title, subtitle and the two top actions', () => {
    expect(html).toContain('<h1')
    expect(t).toContain('ระบบเอกสาร')
    expect(t).toContain('จัดเก็บและจัดการเอกสาร แบบฟอร์ม และไฟล์ต่าง ๆ ของคุณในที่เดียว')
    expect(t).toContain('เชื่อมต่อ Google Drive แล้ว')
    expect(t).toContain('สร้างเอกสารใหม่')
    expect(html).toContain('aria-haspopup="menu"')
  })

  it('stats from real rows; โฟลเดอร์ / ฉบับร่าง "—"; storage unavailable', () => {
    expect(t).toMatch(/3 เอกสารทั้งหมด/)
    expect(t).toMatch(/— โฟลเดอร์ เชื่อมต่อ Google Drive เพื่อสร้างโฟลเดอร์/)
    expect(t).toMatch(/— ฉบับร่าง/)
    expect(t).toMatch(/0 ไฟล์บน Google Drive เชื่อมต่อแล้ว/)
    expect(t).toContain('ยังไม่มีข้อมูลพื้นที่จัดเก็บ')
    expect(html).not.toContain('role="progressbar"')
  })

  it('tabs with real counts, toolbar, five templates, four folders + create, recent table', () => {
    for (const label of ['ทั้งหมด', 'เอกสารของฉัน', 'แชร์กับฉัน', 'ใน Google Drive', 'รายการโปรด']) expect(t).toContain(label)
    expect(html.match(/role="tab"/g)).toHaveLength(5)
    expect(html).toContain('aria-selected="true"')
    expect(html).toContain('placeholder="ค้นหาเอกสาร โฟลเดอร์ หรือแท็ก..."')
    for (const label of ['ประเภทไฟล์', 'หมวดหมู่', 'ภาคเรียน', 'เรียงลำดับ']) expect(html).toContain(`aria-label="${label}"`)
    for (const s of ['แก้ไขล่าสุด', 'ชื่อ A–Z', 'ชื่อ Z–A', 'เก่าสุด']) expect(t).toContain(s)
    expect(t).toContain('สร้างเอกสารจากแบบฟอร์ม')
    expect(t).toContain('เลือกแบบฟอร์มเอกสารสำหรับครู พร้อมรองรับการดึงข้อมูลจากระบบในอนาคต')
    for (const tpl of DOCUMENT_TEMPLATES) expect(t.replace(/ /g, '')).toContain(tpl.title)
    expect(t.match(/สร้างเอกสาร /g)?.length).toBeGreaterThanOrEqual(5)
    for (const folder of ['งานวิชาการ', 'เอกสารประจำชั้น', 'รายงานและประเมินผล', 'เอกสารส่วนตัว']) expect(t).toContain(folder)
    expect(t).toMatch(/งานวิชาการ 3 รายการ/)
    expect(t).toMatch(/เอกสารประจำชั้น ยังไม่มีแหล่งข้อมูล/)
    expect(t).toContain('สร้างโฟลเดอร์ใหม่')
    for (const col of ['ชื่อเอกสาร', 'ประเภท', 'หมวดหมู่', 'ห้องเรียน / รายวิชา', 'แก้ไขล่าสุด', 'ขนาด', 'การดำเนินการ']) expect(t).toContain(col)
    expect(html).toContain('data-testid="document-table"')
    expect(html.match(/<tbody>[\s\S]*<\/tbody>/)?.[0].match(/<tr/g)).toHaveLength(3)
  })

  it('row actions: preview, download (disabled for links), favourite, more menu; size "—" (not stored)', () => {
    expect(html).toContain('aria-label="ดูตัวอย่าง ใบความรู้เรื่องแรง"')
    expect(html).toContain('aria-label="ดาวน์โหลด ใบความรู้เรื่องแรง"')
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*aria-label="แบบฟอร์มส่งงาน เป็นลิงก์ภายนอก ไม่มีไฟล์ให้ดาวน์โหลด"/)
    expect(html).toContain('aria-label="เพิ่ม ใบความรู้เรื่องแรง ในรายการโปรด"')
    expect(html).toContain('aria-pressed="false"')
    expect(html).toContain('aria-label="ตัวเลือกเพิ่มเติมของ ใบความรู้เรื่องแรง"')
    expect(html).toContain('title="ระบบยังไม่ได้บันทึกขนาดไฟล์"')
  })

  it('recent activity only from real rows', () => {
    expect(t).toContain('การดำเนินการล่าสุด')
    expect(t).toContain('อัปโหลดไฟล์')
    expect(t).toContain('เพิ่มลิงก์')
  })
})

describe('states', () => {
  it('loading: skeletons, never "0"', () => {
    const html = render({ data: { status: 'loading' } })
    expect(html).toContain('data-testid="document-loading"')
    expect(text(html)).not.toMatch(/\b0 เอกสารทั้งหมด/)
  })

  it('error with retry', () => {
    const html = render({ data: { status: 'error', error: 'โหลดเอกสารไม่สำเร็จ' } })
    expect(html).toContain('data-testid="document-error"')
    expect(html).toContain('role="alert"')
    expect(text(html)).toContain('ลองใหม่')
  })

  it('no documents: honest empty states everywhere (no sample files, no fake activity)', () => {
    const t = text(render({ data: success([]) }))
    expect(t).toContain('ยังไม่มีเอกสาร')
    expect(t).toContain('ยังไม่มีประวัติกิจกรรม')
    expect(t).toMatch(/0 เอกสารทั้งหมด/)
    for (const fake of ['48', '12 รายการในเดือนนี้', '1.2 GB', '15 GB', 'วันนี้ 14:32']) expect(t).not.toContain(fake)
  })

  it('แชร์กับฉัน: sharing not supported yet', () => {
    expect(text(render({ ui: { filters: { ...INITIAL_UI_STATE.filters, tab: 'shared' } } }))).toContain('ระบบยังไม่รองรับการแชร์เอกสารระหว่างครู')
  })

  it('ใน Google Drive: every storage state is explicit (never an empty list pretending to be data)', () => {
    const drive = (storage: StorageState) => text(render({ storage, ui: { filters: { ...INITIAL_UI_STATE.filters, tab: 'drive' } } }))
    expect(drive({ status: 'not_connected' })).toContain('ยังไม่ได้เชื่อมต่อ Google Drive')
    expect(drive({ status: 'not_connected' })).toContain('ระบบเข้าถึงได้เฉพาะไฟล์ที่สร้างผ่าน KrunameClass เท่านั้น')
    expect(drive({ status: 'unsupported' })).toContain('พื้นที่จัดเก็บบน Google Drive ใช้ได้เมื่อเชื่อมต่อฐานข้อมูลจริง')
    expect(render({ storage: { status: 'loading' }, ui: { filters: { ...INITIAL_UI_STATE.filters, tab: 'drive' } } })).toContain('data-testid="drive-loading"')
    expect(drive({ status: 'unavailable', code: 'not_deployed', message: 'x' })).toContain('ระบบจัดเก็บบน Google Drive ยังไม่พร้อม')
    expect(drive({ status: 'unavailable', code: 'scope_missing', message: 'x' })).toContain('เชื่อมต่อ Google Drive ใหม่')
    const err = render({ storage: { status: 'error', message: 'ติดต่อ Google Drive ไม่สำเร็จ' }, ui: { filters: { ...INITIAL_UI_STATE.filters, tab: 'drive' } } })
    expect(err).toContain('data-testid="drive-error"')
    expect(text(err)).toContain('ลองใหม่')
  })

  it('รายการโปรด empty / with a favourite', () => {
    const fav = { filters: { ...INITIAL_UI_STATE.filters, tab: 'favorites' as const } }
    expect(text(render({ ui: fav }))).toContain('ยังไม่มีรายการโปรด')
    expect(render({ ui: fav, favorites: ['assignment:2'] }).match(/<tbody>[\s\S]*<\/tbody>/)?.[0].match(/<tr/g)).toHaveLength(1)
  })

  it('search with no match → clear-filters action', () => {
    const t = text(render({ ui: { filters: { ...INITIAL_UI_STATE.filters, query: 'ไม่มีแน่นอน' } } }))
    expect(t).toContain('ไม่พบเอกสารที่ตรงกับการค้นหา')
    expect(t).toContain('ล้างตัวกรอง')
  })

  it('grid / list toggle', () => {
    const grid = render({ ui: { view: 'grid' } })
    expect(grid).toContain('data-testid="document-grid"')
    expect(grid).not.toContain('data-testid="document-table"')
    expect(grid).toMatch(/aria-pressed="true"[^>]*aria-label="แสดงแบบตาราง"/)
    expect(render()).toMatch(/aria-pressed="true"[^>]*aria-label="แสดงแบบรายการ"/)
  })

  it('Drive button reflects the existing connection state', () => {
    expect(text(render({ drive: { status: 'disconnected' } }))).toMatch(/เชื่อมต่อ Google Drive(?! แล้ว)/)
    expect(render({ drive: { status: 'unsupported' } })).toMatch(/disabled=""[^>]*title="ใช้ได้เมื่อเชื่อมต่อฐานข้อมูลจริง/)
    expect(text(render({ drive: { status: 'loading' } }))).toContain('กำลังตรวจสอบ Google Drive')
  })
})

describe('UI state (tabs, filters, view, selection)', () => {
  it('switching tab keeps filters, clears selection', () => {
    let s = documentCenterUiReducer(INITIAL_UI_STATE, { type: 'filters', patch: { query: 'แผน' } })
    s = documentCenterUiReducer(s, { type: 'toggleSelect', id: 'a' })
    s = documentCenterUiReducer(s, { type: 'tab', tab: 'drive' })
    expect(s.filters).toMatchObject({ tab: 'drive', query: 'แผน' })
    expect(s.selected.size).toBe(0)
  })

  it('clear filters keeps tab and sort; view toggle; select all toggles', () => {
    let s = documentCenterUiReducer(INITIAL_UI_STATE, { type: 'tab', tab: 'mine' })
    s = documentCenterUiReducer(s, { type: 'filters', patch: { kind: 'pdf', sort: 'oldest', semester: '2569|1' } })
    s = documentCenterUiReducer(s, { type: 'clearFilters' })
    expect(s.filters).toMatchObject({ tab: 'mine', sort: 'oldest', kind: 'all', semester: 'all' })
    s = documentCenterUiReducer(s, { type: 'view', view: 'grid' })
    expect(s.view).toBe('grid')
    s = documentCenterUiReducer(s, { type: 'selectAll', ids: ['a', 'b'] })
    expect([...s.selected]).toEqual(['a', 'b'])
    s = documentCenterUiReducer(s, { type: 'selectAll', ids: ['a', 'b'] })
    expect(s.selected.size).toBe(0)
  })

  it('keyboard: arrows wrap, Home/End jump', () => {
    expect(nextTabIndex(0, 'ArrowRight', 5)).toBe(1)
    expect(nextTabIndex(4, 'ArrowRight', 5)).toBe(0)
    expect(nextTabIndex(0, 'ArrowLeft', 5)).toBe(4)
    expect(nextTabIndex(2, 'Home', 5)).toBe(0)
    expect(nextTabIndex(2, 'End', 5)).toBe(4)
    expect(nextTabIndex(2, 'Enter', 5)).toBeNull()
  })
})

describe('template placeholders (Phase 1)', () => {
  it('the notice says "กำลังพัฒนา"/เฟส 2 and that nothing was created or saved', () => {
    const t = text(renderToStaticMarkup(createElement(DocumentInfoBody, { topic: { kind: 'template', template: DOCUMENT_TEMPLATES[0] } })))
    expect(t).toContain('เฟสถัดไป')
    expect(t).toContain('ยังไม่มีการสร้างหรือบันทึกเอกสารใด ๆ')
    expect(t).toContain('ส่งออกเป็น Word (.docx), PDF')
    const folder = text(renderToStaticMarkup(createElement(DocumentInfoBody, { topic: { kind: 'folder' } })))
    expect(folder).toContain('ยังไม่มีการสร้างโฟลเดอร์ใด ๆ')
  })

  it('"สร้างเอกสาร" only opens the notice — no service call, no saved document', () => {
    const view = source('./document-center-view.tsx')
    expect(view).toContain("onCreate={(t) => setInfo({ kind: 'template', template: t })}")
    // Only type imports from services — the view itself never calls one.
    expect(view).not.toMatch(/^import (?!type )[^\n]*@\/services\//m)
    expect(view).not.toMatch(/^import \{[^}]*\} from '@\/services\//m)
  })
})

describe('safety and compatibility (source guards)', () => {
  const files = readdirSync(new URL('.', import.meta.url)).filter((f) => /\.tsx?$/.test(f) && !f.endsWith('.test.ts'))

  it('no Tailwind dark: variants (theme tokens via data-theme)', () => {
    for (const f of files) expect(source(`./${f}`)).not.toMatch(/\bdark:/)
  })

  it('read-only service over existing tables; no service role, no new API', () => {
    const svc = source('../../services/document-center-service.ts')
    expect(svc).not.toMatch(/\.(insert|update|upsert|delete)\(/)
    expect(svc).not.toMatch(/service_role|SERVICE_ROLE|functions\.invoke/)
    expect(svc).toContain("'assignment_resources'")
    expect(svc).toContain("'lesson_resources'")
  })

  it('route + sidebar: real page, no "เร็ว ๆ นี้", Drive uses the existing OAuth functions', () => {
    expect(source('../../app/router.tsx')).toContain("{ path: 'documents', element: <DocumentCenterPage /> }")
    expect(source('../../components/layout/nav-items.ts')).not.toContain("badge: 'เร็ว ๆ นี้'")
    const page = source('../../pages/teacher/documents/document-center-page.tsx')
    expect(page).toContain('getGoogleConnectionStatus')
    expect(page).toContain('startGoogleConnect')
    expect(page).toContain("dataMode === 'supabase'")
  })
})
