import { readFileSync } from 'node:fs'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ALL_SEMESTERS, listSemesterOptions, type AnalyticsContext } from '@/features/classroom-analytics/analytics'
import { success, type Resource } from '@/features/classroom-analytics/resource'

import {
  parseSemesterPreference,
  readStoredSemester,
  resolveSemesterKey,
  SEMESTER_METADATA_KEY,
  semesterStorageKey,
  writeStoredSemester,
  type SemesterPreference,
} from './semester-preference'
import { useSemesterSelection } from './semester-selection'

function readSource(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf-8')
}

class MemoryStorage {
  data = new Map<string, string>()
  getItem(key: string) {
    return this.data.get(key) ?? null
  }
  setItem(key: string, value: string) {
    this.data.set(key, value)
  }
}

const CONTEXT: AnalyticsContext = {
  classrooms: [
    { id: 'new', name: 'ม.1/1', academicYear: '2569', semester: '1', isActive: true },
    { id: 'old', name: 'ม.1/1', academicYear: '2568', semester: '2', isActive: true },
    { id: 'none', name: 'ชุมนุม', academicYear: null, semester: null, isActive: true },
  ],
  subjects: [],
  links: [],
}

describe('semester preference — storage', () => {
  it('round-trips per teacher; one teacher never reads another teacher\'s choice', () => {
    const storage = new MemoryStorage()
    writeStoredSemester(storage, 'teacher-a', { key: '2568|2', updatedAt: 5 })
    expect(readStoredSemester(storage, 'teacher-a')).toEqual({ key: '2568|2', updatedAt: 5 })
    expect(readStoredSemester(storage, 'teacher-b')).toBeNull()
    expect(semesterStorageKey('teacher-a')).not.toBe(semesterStorageKey('teacher-b'))
  })

  it('corrupt / foreign values and failing storage never throw', () => {
    const storage = new MemoryStorage()
    storage.setItem(semesterStorageKey('t'), '{not json')
    expect(readStoredSemester(storage, 't')).toBeNull()
    const throwing = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('quota')
      },
    }
    expect(readStoredSemester(throwing, 't')).toBeNull()
    expect(() => writeStoredSemester(throwing, 't', { key: 'all', updatedAt: 1 })).not.toThrow()
    expect(readStoredSemester(null, 't')).toBeNull()
  })

  it('parses both JSON text (localStorage) and objects (auth metadata)', () => {
    expect(parseSemesterPreference('{"key":"2569|1","updatedAt":3}')).toEqual({ key: '2569|1', updatedAt: 3 })
    expect(parseSemesterPreference({ key: 'all', updatedAt: 9 })).toEqual({ key: 'all', updatedAt: 9 })
    expect(parseSemesterPreference({ key: 'all' })).toEqual({ key: 'all', updatedAt: 0 })
    expect(parseSemesterPreference({ key: 7 })).toBeNull()
    expect(parseSemesterPreference(null)).toBeNull()
  })
})

describe('semester preference — resolution', () => {
  const options = listSemesterOptions(CONTEXT)

  it('options come from the data: each real semester, ไม่ระบุภาคเรียน, ทุกภาคเรียน', () => {
    expect(options.map((o) => o.label)).toEqual(['ภาคเรียนที่ 1/2569', 'ภาคเรียนที่ 2/2568', 'ไม่ระบุภาคเรียน', 'ทุกภาคเรียน'])
  })

  it('newest valid preference wins (local vs. remote / another device)', () => {
    const local = { key: '2568|2', updatedAt: 10 }
    const remote = { key: ALL_SEMESTERS, updatedAt: 20 }
    expect(resolveSemesterKey(CONTEXT, options, [local, remote])).toBe(ALL_SEMESTERS)
    expect(resolveSemesterKey(CONTEXT, options, [{ ...local, updatedAt: 30 }, remote])).toBe('2568|2')
  })

  it('a stored semester that no longer exists falls back to the data default', () => {
    expect(resolveSemesterKey(CONTEXT, options, [{ key: '2550|1', updatedAt: 99 }])).toBe('2569|1')
    expect(resolveSemesterKey(CONTEXT, options, [null, undefined])).toBe('2569|1')
  })
})

describe('useSemesterSelection — per-teacher persistence (rendered)', () => {
  afterEach(() => vi.unstubAllGlobals())

  function selectedKey(ownerId: string, remote: SemesterPreference | null = null, context: Resource<AnalyticsContext> = success(CONTEXT)): string | null {
    const seen: (string | null)[] = []
    function Probe() {
      seen.push(useSemesterSelection(ownerId, context, remote, null).semesterKey)
      return null
    }
    renderToStaticMarkup(createElement(Probe))
    return seen[seen.length - 1]
  }

  it('restores this teacher\'s stored semester after a refresh; another teacher gets the default', () => {
    const storage = new MemoryStorage()
    writeStoredSemester(storage, 'teacher-a', { key: '2568|2', updatedAt: 1 })
    vi.stubGlobal('window', { localStorage: storage })
    expect(selectedKey('teacher-a')).toBe('2568|2')
    expect(selectedKey('teacher-b')).toBe('2569|1')
  })

  it('a newer choice saved in the teacher\'s account (later login elsewhere) wins over an older local one', () => {
    const storage = new MemoryStorage()
    writeStoredSemester(storage, 'teacher-a', { key: '2568|2', updatedAt: 1 })
    vi.stubGlobal('window', { localStorage: storage })
    expect(selectedKey('teacher-a', { key: '|', updatedAt: 2 })).toBe('|')
  })

  it('no semester (and no scope) until the classroom context has loaded', () => {
    vi.stubGlobal('window', { localStorage: new MemoryStorage() })
    expect(selectedKey('teacher-a', null, { status: 'loading' })).toBeNull()
  })
})

describe('semester provider wiring (source guards)', () => {
  const provider = readSource('./semester-context.tsx')
  const selection = readSource('./semester-selection.ts')
  const layout = readSource('../../layouts/teacher-layout.tsx')
  const header = readSource('../../components/layout/header.tsx')

  it('the whole teacher area shares one provider (header + every page)', () => {
    expect(layout).toContain('<SemesterProvider>')
    expect(layout.indexOf('<SemesterProvider>')).toBeLessThan(layout.indexOf('<Header'))
  })

  it('both headers render the shared selector; no hardcoded semester label', () => {
    expect(header.slice(header.indexOf('function DemoHeader'), header.indexOf('function RealHeader'))).toContain('<SemesterSelect')
    expect(header.slice(header.indexOf('function RealHeader'))).toContain('<SemesterSelect')
    expect(header).not.toMatch(/ภาคเรียนที่ \d/)
  })

  it('selecting is read/filter only: no table writes — only the teacher\'s own auth metadata', () => {
    for (const source of [provider, selection]) {
      expect(source).not.toMatch(/\.(insert|update|upsert|delete)\(/)
      expect(source).not.toContain(".from('")
    }
    expect(provider).toContain(`auth.updateUser({ data: { [SEMESTER_METADATA_KEY]: preference } })`)
    expect(SEMESTER_METADATA_KEY).toBe('krunameclass_semester')
    expect(provider).not.toMatch(/service_role|SERVICE_ROLE/)
  })

  it('Demo Mode never touches Supabase and keeps its own storage owner', () => {
    const demo = provider.slice(provider.indexOf('function DemoSemesterProvider'), provider.indexOf('export function SemesterProvider'))
    expect(demo).toContain("useSemesterSelection('demo', context, null, null)")
    expect(demo).not.toMatch(/getSupabaseClient|supabaseAnalyticsLoaders/)
  })
})
