import { describe, expect, it } from 'vitest'

import {
  RESOURCE_FILE_MAX_BYTES,
  buildAssignmentResourcePath,
  computeNextSortOrder,
  generateResourceFileName,
  reorderResourcesLocally,
  validateResourceFile,
  validateResourceTitle,
  validateResourceUrl,
} from '@/services/assignment-resource-service'
import type { AssignmentResource } from '@/types/assignment-resource'

function resource(overrides: Partial<AssignmentResource> = {}): AssignmentResource {
  return {
    id: 'r1',
    assignmentId: 'a1',
    resourceType: 'link',
    title: 'ลิงก์ทดสอบ',
    filePath: null,
    url: 'https://example.com',
    mimeType: null,
    sortOrder: 0,
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
    ...overrides,
  }
}

function fakeFile(type: string, sizeBytes: number, name = 'file'): File {
  return new File([new Uint8Array(sizeBytes)], name, { type })
}

// ==================================================
// URL safety — "Only allow https://, reject javascript:/data:/file:/malformed"
// ==================================================
describe('validateResourceUrl — URL safety', () => {
  it('accepts a well-formed https:// URL', () => {
    expect(validateResourceUrl('https://forms.google.com/abc')).toBeNull()
  })

  it('rejects a javascript: URL', () => {
    expect(validateResourceUrl('javascript:alert(1)')).not.toBeNull()
  })

  it('rejects a data: URL', () => {
    expect(validateResourceUrl('data:text/html,<script>alert(1)</script>')).not.toBeNull()
  })

  it('rejects a file: URL', () => {
    expect(validateResourceUrl('file:///etc/passwd')).not.toBeNull()
  })

  it('rejects a plain http:// URL (https-only)', () => {
    expect(validateResourceUrl('http://example.com')).not.toBeNull()
  })

  it('rejects a malformed URL', () => {
    expect(validateResourceUrl('not a url')).not.toBeNull()
  })

  it('rejects an empty/whitespace-only URL', () => {
    expect(validateResourceUrl('   ')).not.toBeNull()
  })
})

// ==================================================
// File type/size — "unsupported file rejected"
// ==================================================
describe('validateResourceFile — allowlist + size limit', () => {
  it('accepts a PDF within the size limit', () => {
    expect(validateResourceFile(fakeFile('application/pdf', 1024))).toBeNull()
  })

  it.each([
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'image/jpeg',
    'image/png',
    'image/webp',
  ])('accepts every allowed type: %s', (type) => {
    expect(validateResourceFile(fakeFile(type, 1024))).toBeNull()
  })

  it('rejects an unsupported file type (e.g. a raw executable)', () => {
    expect(validateResourceFile(fakeFile('application/x-msdownload', 1024))).not.toBeNull()
  })

  it('rejects a file over the 10MB limit', () => {
    expect(validateResourceFile(fakeFile('application/pdf', RESOURCE_FILE_MAX_BYTES + 1))).not.toBeNull()
  })

  it('accepts a file exactly at the size limit', () => {
    expect(validateResourceFile(fakeFile('application/pdf', RESOURCE_FILE_MAX_BYTES))).toBeNull()
  })
})

describe('validateResourceTitle', () => {
  it('rejects an empty title', () => {
    expect(validateResourceTitle('')).not.toBeNull()
  })

  it('rejects a whitespace-only title', () => {
    expect(validateResourceTitle('   ')).not.toBeNull()
  })

  it('accepts a non-empty title', () => {
    expect(validateResourceTitle('ใบงานบทที่ 2')).toBeNull()
  })
})

// ==================================================
// Storage path shape — "stable scoped paths, never the original filename"
// ==================================================
describe('buildAssignmentResourcePath', () => {
  it('builds the exact teacher/subject/classroom/assignment/file path shape', () => {
    const path = buildAssignmentResourcePath('teacher-1', 'subj-1', 'room-1', 'assign-1', 'abc123.pdf')
    expect(path).toBe('teacher-1/subj-1/room-1/assign-1/abc123.pdf')
  })

  it('never embeds a different teacher/subject/classroom than the ones passed in', () => {
    const path = buildAssignmentResourcePath('teacher-A', 'subj-A', 'room-A', 'assign-A', 'x.pdf')
    expect(path).not.toContain('teacher-B')
    expect(path).not.toContain('room-B')
  })
})

describe('generateResourceFileName', () => {
  it('never uses the original filename — always a generated uuid-based name', () => {
    const name = generateResourceFileName('application/pdf')
    expect(name).toMatch(/^[0-9a-f-]{36}\.pdf$/)
  })

  it('picks the extension from mime type, not any user-supplied string', () => {
    expect(generateResourceFileName('image/png')).toMatch(/\.png$/)
    expect(generateResourceFileName('image/jpeg')).toMatch(/\.jpg$/)
  })

  it('two calls never collide (random uuid each time)', () => {
    expect(generateResourceFileName('application/pdf')).not.toBe(generateResourceFileName('application/pdf'))
  })
})

// ==================================================
// Sort order — multiple resources
// ==================================================
describe('computeNextSortOrder', () => {
  it('returns 0 for the first resource on an assignment with none yet', () => {
    expect(computeNextSortOrder([])).toBe(0)
  })

  it('appends after the current maximum sortOrder', () => {
    const existing = [resource({ id: 'r1', sortOrder: 0 }), resource({ id: 'r2', sortOrder: 1 })]
    expect(computeNextSortOrder(existing)).toBe(2)
  })

  it('is robust to out-of-order sortOrder values', () => {
    const existing = [resource({ id: 'r1', sortOrder: 5 }), resource({ id: 'r2', sortOrder: 1 })]
    expect(computeNextSortOrder(existing)).toBe(6)
  })
})

describe('reorderResourcesLocally', () => {
  it('moves a resource from one index to another and renumbers sortOrder 0..n-1', () => {
    const list = [
      resource({ id: 'r1', sortOrder: 0 }),
      resource({ id: 'r2', sortOrder: 1 }),
      resource({ id: 'r3', sortOrder: 2 }),
    ]
    const reordered = reorderResourcesLocally(list, 0, 2)
    expect(reordered.map((r) => r.id)).toEqual(['r2', 'r3', 'r1'])
    expect(reordered.map((r) => r.sortOrder)).toEqual([0, 1, 2])
  })

  it('never mutates the input array', () => {
    const list = [resource({ id: 'r1', sortOrder: 0 }), resource({ id: 'r2', sortOrder: 1 })]
    const copy = [...list]
    reorderResourcesLocally(list, 0, 1)
    expect(list).toEqual(copy)
  })
})
