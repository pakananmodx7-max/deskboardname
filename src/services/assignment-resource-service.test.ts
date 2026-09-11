import { readFileSync } from 'node:fs'

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
    driveFileId: null,
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

/**
 * Google Drive Integration, Section 7/8/10: a Google-linked (or any
 * link) resource must never be uploaded to the assignment-files Storage
 * bucket — only addFileResource (the separate upload path) ever calls
 * `.storage.`. Source-text guard, same pattern as the lesson-service
 * equivalent and assignment-resources-disclosure.test.ts.
 */
describe('addLinkResource — never touches Supabase Storage (Section 7/8/10)', () => {
  const source = readFileSync(new URL('./assignment-resource-service.ts', import.meta.url), 'utf-8')
  const fnBody = source.slice(
    source.indexOf('export async function addLinkResource'),
    source.indexOf('\n}', source.indexOf('export async function addLinkResource')),
  )

  it('addLinkResource never calls supabase.storage', () => {
    expect(fnBody).not.toContain('.storage.')
  })

  it('addLinkResource only inserts into assignment_resources with a url, never a file_path', () => {
    expect(fnBody).toContain("from('assignment_resources')")
    expect(fnBody).toContain('url: input.url.trim()')
  })
})

/**
 * "คัดลอกไปห้องอื่น" resource copy (Section 1) — a 'link' resource is a
 * plain new row; a 'file' resource's underlying object is copied
 * server-side (Storage's own .copy(), never re-downloaded/re-uploaded
 * through the client) to a FRESH path scoped under the TARGET
 * subject/classroom/assignment, never the source's own path — reusing the
 * source path would deny a student in a different target classroom (the
 * path's classroom_id segment gates their Storage read access, 0013).
 */
describe('copyResourceToAssignment — file copy uses Storage .copy() into a fresh target-scoped path', () => {
  const source = readFileSync(new URL('./assignment-resource-service.ts', import.meta.url), 'utf-8')
  const fnBody = source.slice(
    source.indexOf('export async function copyResourceToAssignment'),
    source.indexOf('\n}\n', source.indexOf('export async function copyResourceToAssignment')),
  )

  it('a link resource is inserted as a new row referencing the target assignment, no Storage call', () => {
    const linkBranch = fnBody.slice(0, fnBody.indexOf("resourceType === 'file'"))
    expect(linkBranch).toContain('assignment_id: targetAssignmentId')
    expect(linkBranch).not.toContain('.storage.')
  })

  it('a file resource is copied via storage .copy(), never .upload() (the bytes never pass through this client)', () => {
    expect(fnBody).toContain('.storage.from(RESOURCE_BUCKET).copy(resource.filePath, newPath)')
    expect(fnBody).not.toContain('.upload(')
  })

  it('the destination path is built from the TARGET subject/classroom/assignment, never the source resource\'s own assignmentId', () => {
    expect(fnBody).toContain(
      'buildAssignmentResourcePath(teacherId, targetSubjectId, targetClassroomId, targetAssignmentId, newFileName)',
    )
    expect(fnBody).not.toContain('resource.assignmentId')
  })

  it('a failed insert best-effort removes the just-copied object so no orphaned file survives a rejected resource', () => {
    const cleanupSection = fnBody.slice(fnBody.indexOf('if (error) {'))
    expect(cleanupSection).toContain('.storage.from(RESOURCE_BUCKET).remove([newPath])')
  })
})

describe('removeResourceStorageObjects — only touches file resources, never link/submission storage', () => {
  it('collects only file-type resources that actually have a filePath', async () => {
    const { removeResourceStorageObjects } = await import('@/services/assignment-resource-service')
    // A resource list with only a link (no filePath) — nothing to remove,
    // so this must resolve without ever touching the network/Storage.
    await expect(removeResourceStorageObjects([resource({ resourceType: 'link', filePath: null })])).resolves.toBeUndefined()
  })

  it('is a no-op (returns immediately) for an empty resource list', async () => {
    const { removeResourceStorageObjects } = await import('@/services/assignment-resource-service')
    await expect(removeResourceStorageObjects([])).resolves.toBeUndefined()
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
