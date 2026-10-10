import { describe, expect, it } from 'vitest'

import {
  computeDocumentStats,
  DEFAULT_DOCUMENT_FILTERS,
  deriveActivity,
  detectDocumentKind,
  downloadName,
  filterDocuments,
  formatDocumentDate,
  formatSize,
  matchesQuery,
  readFavorites,
  semesterOptions,
  sortDocuments,
  sourcePath,
  toDocumentItem,
  toggleFavorite,
  writeFavorites,
  type DocumentFilters,
  type ResourceRowInput,
} from './document-center-model'
import { DOCUMENT_TEMPLATES } from './document-templates'

const ME = 'teacher-me'
const SUBJ = '0f4c2d9e-1a2b-4c3d-8e9f-001122334455'
const CLS = 'a1b2c3d4-e5f6-4a7b-8c9d-aabbccddeeff'

function row(patch: Partial<ResourceRowInput> & { id: string }): ResourceRowInput {
  return {
    source: 'assignment',
    title: 'เอกสาร',
    filePath: null,
    url: null,
    mimeType: null,
    driveFileId: null,
    createdBy: ME,
    createdAt: '2026-10-01T03:00:00.000Z',
    updatedAt: '2026-10-01T03:00:00.000Z',
    parent: { id: 'a1', title: 'ใบงานเรื่องแรง', subjectId: SUBJ, subjectName: 'วิทยาศาสตร์', classroomId: CLS, classroomName: 'ม.1/1', academicYear: '2569', semester: '1' },
    ...patch,
  }
}

const ITEMS = [
  toDocumentItem(row({ id: '1', title: 'แผนการจัดการเรียนรู้ วิทยาศาสตร์', filePath: `${CLS}/a1/plan.docx`, mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', updatedAt: '2026-10-09T03:00:00Z', createdAt: '2026-10-09T03:00:00Z' })),
  toDocumentItem(row({ id: '2', title: 'ใบความรู้เรื่องแรง', filePath: `${CLS}/a1/sheet.pdf`, mimeType: 'application/pdf', updatedAt: '2026-10-05T03:00:00Z', createdAt: '2026-09-20T03:00:00Z' })),
  toDocumentItem(row({ id: '3', source: 'lesson', title: 'สไลด์บทที่ 2', url: 'https://docs.google.com/presentation/d/x/edit', driveFileId: 'x', updatedAt: '2026-10-08T03:00:00Z', createdAt: '2026-10-08T03:00:00Z', parent: { id: 'l1', title: 'บทที่ 2 พลังงาน', subjectId: SUBJ, subjectName: 'วิทยาศาสตร์', classroomId: CLS, classroomName: 'ม.1/1', academicYear: '2568', semester: '2' } })),
  toDocumentItem(row({ id: '4', title: 'แบบฟอร์มส่งงาน', url: 'https://forms.gle/abc', createdBy: 'another-teacher', updatedAt: '2026-09-01T03:00:00Z', createdAt: '2026-09-01T03:00:00Z' })),
]

function f(patch: Partial<DocumentFilters> = {}): DocumentFilters {
  return { ...DEFAULT_DOCUMENT_FILTERS, ...patch }
}
const ids = (list: { resourceId: string }[]) => list.map((i) => i.resourceId)
const ctx = { userId: ME, favorites: new Set<string>() }

describe('document kinds (from what the resource row stores)', () => {
  it('mime type, Google URLs, extensions, Drive id, plain links', () => {
    expect(detectDocumentKind({ mimeType: 'application/pdf', url: null, filePath: 'x', driveFileId: null })).toBe('pdf')
    expect(detectDocumentKind({ mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', url: null, filePath: 'x', driveFileId: null })).toBe('excel')
    expect(detectDocumentKind({ mimeType: null, url: 'https://docs.google.com/document/d/1/edit', filePath: null, driveFileId: null })).toBe('google_doc')
    expect(detectDocumentKind({ mimeType: null, url: 'https://docs.google.com/spreadsheets/d/1', filePath: null, driveFileId: null })).toBe('google_sheet')
    expect(detectDocumentKind({ mimeType: null, url: 'https://drive.google.com/file/d/1/view', filePath: null, driveFileId: null })).toBe('drive_file')
    expect(detectDocumentKind({ mimeType: null, url: 'https://www.youtube.com/watch?v=1', filePath: null, driveFileId: null })).toBe('video')
    expect(detectDocumentKind({ mimeType: null, url: null, filePath: 'a/b/report.pptx', driveFileId: null })).toBe('powerpoint')
    expect(detectDocumentKind({ mimeType: null, url: 'https://example.org/page', filePath: null, driveFileId: null })).toBe('link')
  })

  it('Drive items, semester and place come from the real parent rows', () => {
    expect(ITEMS[2]).toMatchObject({ id: 'lesson:3', inDrive: true, semesterKey: '2568|2', semesterLabel: 'ภาคเรียนที่ 2/2568', category: 'academic', sizeBytes: null })
    expect(ITEMS[0].inDrive).toBe(false)
  })
})

describe('tabs', () => {
  it('ทั้งหมด / เอกสารของฉัน / ใน Google Drive / รายการโปรด; แชร์กับฉัน is always empty (no sharing exists)', () => {
    expect(ids(filterDocuments(ITEMS, f(), ctx))).toEqual(['1', '2', '3', '4'])
    expect(ids(filterDocuments(ITEMS, f({ tab: 'mine' }), ctx))).toEqual(['1', '2', '3'])
    expect(ids(filterDocuments(ITEMS, f({ tab: 'mine' }), { ...ctx, userId: null }))).toEqual([])
    expect(ids(filterDocuments(ITEMS, f({ tab: 'drive' }), ctx))).toEqual(['3'])
    expect(ids(filterDocuments(ITEMS, f({ tab: 'shared' }), ctx))).toEqual([])
    expect(ids(filterDocuments(ITEMS, f({ tab: 'favorites' }), { ...ctx, favorites: new Set(['assignment:2']) }))).toEqual(['2'])
  })
})

describe('search and filters', () => {
  it('search: title, assignment/lesson, subject, classroom, type and category; all words must match', () => {
    expect(ids(filterDocuments(ITEMS, f({ query: 'แรง' }), ctx))).toEqual(['1', '2', '4'])
    expect(ids(filterDocuments(ITEMS, f({ query: 'พลังงาน' }), ctx))).toEqual(['3'])
    expect(ids(filterDocuments(ITEMS, f({ query: 'pdf' }), ctx))).toEqual(['2'])
    expect(ids(filterDocuments(ITEMS, f({ query: 'งานวิชาการ' }), ctx))).toHaveLength(4)
    expect(matchesQuery(ITEMS[0], '  แผน   วิทยาศาสตร์ ')).toBe(true)
    expect(matchesQuery(ITEMS[0], 'แผน คณิต')).toBe(false)
  })

  it('ประเภทไฟล์ / หมวดหมู่ / ภาคเรียน', () => {
    expect(ids(filterDocuments(ITEMS, f({ kind: 'word' }), ctx))).toEqual(['1'])
    expect(ids(filterDocuments(ITEMS, f({ kind: 'google' }), ctx))).toEqual(['3'])
    expect(ids(filterDocuments(ITEMS, f({ kind: 'link' }), ctx))).toEqual(['4'])
    expect(ids(filterDocuments(ITEMS, f({ category: 'homeroom' }), ctx))).toEqual([])
    expect(ids(filterDocuments(ITEMS, f({ semester: '2568|2' }), ctx))).toEqual(['3'])
    expect(semesterOptions(ITEMS)).toEqual([
      { key: '2569|1', label: 'ภาคเรียนที่ 1/2569' },
      { key: '2568|2', label: 'ภาคเรียนที่ 2/2568' },
    ])
  })

  it('sort: แก้ไขล่าสุด, ชื่อ A–Z, ชื่อ Z–A, เก่าสุด', () => {
    expect(ids(sortDocuments(ITEMS, 'updated_desc'))).toEqual(['1', '3', '2', '4'])
    // Thai dictionary order ignores leading vowels: แบบ, ใบ, แผน, สไลด์
    expect(ids(sortDocuments(ITEMS, 'name_asc'))).toEqual(['4', '2', '1', '3'])
    expect(ids(sortDocuments(ITEMS, 'name_desc'))).toEqual(['3', '1', '2', '4'])
    expect(ids(sortDocuments(ITEMS, 'oldest'))).toEqual(['4', '2', '3', '1'])
  })
})

describe('statistics and activity — only from real rows', () => {
  it('counts real documents; unsupported categories are null, never 0 or a sample number', () => {
    const stats = computeDocumentStats(ITEMS, new Date('2026-10-10T05:00:00Z'))
    expect(stats).toEqual({ total: 4, addedThisMonth: 2, inDrive: 1, byCategory: { academic: 4, homeroom: null, reports: null, personal: null } })
    expect(computeDocumentStats([], new Date())).toMatchObject({ total: 0, inDrive: 0, byCategory: { academic: 0, homeroom: null } })
  })

  it('activity = when each real file/link was added, newest first; nothing else invented', () => {
    const activity = deriveActivity(ITEMS, 3)
    expect(activity.map((a) => [a.id, a.label])).toEqual([
      ['assignment:1', 'อัปโหลดไฟล์'],
      ['lesson:3', 'เพิ่มไฟล์จาก Google Drive'],
      ['assignment:2', 'อัปโหลดไฟล์'],
    ])
    expect(deriveActivity(ITEMS).find((a) => a.id === 'assignment:4')?.label).toBe('เพิ่มลิงก์')
    expect(deriveActivity([])).toEqual([])
  })
})

describe('formatting, paths, favourites', () => {
  const now = new Date('2026-10-10T05:00:00Z')
  it('dates and sizes', () => {
    expect(formatDocumentDate('2026-10-10T03:32:00Z', now)).toMatch(/^วันนี้ 10:32/)
    expect(formatDocumentDate('2026-10-09T09:20:00Z', now)).toMatch(/^เมื่อวาน 16:20/)
    expect(formatDocumentDate('2026-10-03T03:00:00Z', now)).toBe('3 ต.ค. 2569')
    expect(formatSize(null)).toBe('—')
    expect(formatSize(262144)).toBe('256 KB')
    expect(formatSize(1258291)).toBe('1.2 MB')
  })

  it('where to manage the file; download name keeps the stored extension', () => {
    expect(sourcePath(ITEMS[0])).toBe(`/teacher/subjects/${SUBJ}/classrooms/${CLS}/assignments/a1`)
    expect(sourcePath(ITEMS[2])).toBe(`/teacher/subjects/${SUBJ}/classrooms/${CLS}?tab=lessons`)
    expect(downloadName(ITEMS[1])).toBe('ใบความรู้เรื่องแรง.pdf')
    expect(downloadName({ ...ITEMS[1], title: 'a/b:c' })).toBe('a b c.pdf')
  })

  it('favourites are per teacher on this device and survive bad storage', () => {
    const store = new Map<string, string>()
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) }
    writeFavorites(storage, 'a', new Set(['assignment:1']))
    expect([...readFavorites(storage, 'a')]).toEqual(['assignment:1'])
    expect(readFavorites(storage, 'b').size).toBe(0)
    store.set('kc-document-favorites:a', '{not json')
    expect(readFavorites(storage, 'a').size).toBe(0)
    expect(readFavorites(null, 'a').size).toBe(0)
    const throwing = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } }
    expect(readFavorites(throwing, 'a').size).toBe(0)
    expect(() => writeFavorites(throwing, 'a', new Set(['x']))).not.toThrow()
    expect([...toggleFavorite(new Set(['x']), 'x')]).toEqual([])
    expect([...toggleFavorite(new Set(), 'x')]).toEqual(['x'])
  })
})

describe('templates (Phase 1 placeholders)', () => {
  it('the five requested templates, each describing its Phase 2 autofill and outputs', () => {
    expect(DOCUMENT_TEMPLATES.map((t) => t.title)).toEqual(['แผนการจัดการเรียนรู้', 'แบบบันทึกกิจกรรมโฮมรูม', 'บันทึกข้อความราชการ', 'รายงานผลการจัดกิจกรรม', 'แบบรายชื่อนักเรียน'])
    for (const t of DOCUMENT_TEMPLATES) {
      expect(t.description.length).toBeGreaterThan(0)
      expect(t.titleChunks.join('')).toBe(t.title)
      expect(t.autofill.length).toBeGreaterThan(0)
      expect(t.outputs).toEqual(expect.arrayContaining(['docx', 'pdf']))
    }
  })
})
