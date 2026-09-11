import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import {
  buildLessonResourcePath,
  computeNextLessonSortOrder,
  computeNextResourceSortOrder,
  generateLessonResourceFileName,
  getYoutubeEmbedUrl,
  lessonResourceTypeLabel,
  removeLessonResourceStorageObjects,
  reorderLessonResourcesLocally,
  reorderLessonsLocally,
  validateLessonResourceFile,
  validateLessonResourceTitle,
  validateLessonResourceUrl,
} from '@/services/lesson-service'
import type { Lesson, LessonResource } from '@/types/lesson'

function lesson(id: string, sortOrder: number): Lesson {
  return {
    id,
    subjectId: 'subj-1',
    classroomId: 'room-1',
    title: `บทที่ ${sortOrder}`,
    description: null,
    sortOrder,
    isPublished: false,
    isArchived: false,
    createdBy: null,
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
  }
}

function resource(id: string, sortOrder: number): LessonResource {
  return {
    id,
    lessonId: 'lesson-1',
    resourceType: 'link',
    title: `resource ${sortOrder}`,
    filePath: null,
    url: 'https://example.com',
    mimeType: null,
    driveFileId: null,
    sortOrder,
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
  }
}

describe('reorderLessonsLocally — teacher drag/move-up-down reorder', () => {
  it('moves a lesson to a new index and renumbers every sortOrder 0..n-1', () => {
    const lessons = [lesson('a', 0), lesson('b', 1), lesson('c', 2)]
    const result = reorderLessonsLocally(lessons, 0, 2)
    expect(result.map((l) => l.id)).toEqual(['b', 'c', 'a'])
    expect(result.map((l) => l.sortOrder)).toEqual([0, 1, 2])
  })
})

describe('computeNextLessonSortOrder', () => {
  it('appends to the end — one past the current max', () => {
    expect(computeNextLessonSortOrder([lesson('a', 0), lesson('b', 3)])).toBe(4)
  })

  it('starts at 0 for the first lesson in a subject+classroom', () => {
    expect(computeNextLessonSortOrder([])).toBe(0)
  })
})

/**
 * Google Drive Integration, Section 7/8/10: a Google-linked resource
 * (or any link resource) must never be uploaded into Supabase Storage —
 * only addLessonFileResource (the separate slide/document upload path)
 * ever calls `.storage.`. This is a source-text guard rather than a
 * mocked-Supabase test, matching this codebase's established pattern for
 * "never touches X" assertions (see assignment-resources-disclosure.test.ts).
 */
describe('addLessonLinkResource — never touches Supabase Storage (Section 7/8/10)', () => {
  const source = readFileSync(new URL('./lesson-service.ts', import.meta.url), 'utf-8')
  const fnBody = source.slice(
    source.indexOf('export async function addLessonLinkResource'),
    source.indexOf('\n}', source.indexOf('export async function addLessonLinkResource')),
  )

  it('addLessonLinkResource never calls supabase.storage', () => {
    expect(fnBody).not.toContain('.storage.')
  })

  it('addLessonLinkResource only inserts into lesson_resources with a url, never a file_path', () => {
    expect(fnBody).toContain("from('lesson_resources')")
    expect(fnBody).toContain('url: input.url.trim()')
  })
})

describe('reorderLessonResourcesLocally', () => {
  it('moves a resource to a new index and renumbers sortOrder', () => {
    const resources = [resource('r1', 0), resource('r2', 1), resource('r3', 2)]
    const result = reorderLessonResourcesLocally(resources, 2, 0)
    expect(result.map((r) => r.id)).toEqual(['r3', 'r1', 'r2'])
    expect(result.map((r) => r.sortOrder)).toEqual([0, 1, 2])
  })
})

describe('computeNextResourceSortOrder', () => {
  it('appends to the end of an existing resource list', () => {
    expect(computeNextResourceSortOrder([resource('r1', 0), resource('r2', 5)])).toBe(6)
  })
})

describe('validateLessonResourceTitle', () => {
  it('rejects empty/whitespace-only titles', () => {
    expect(validateLessonResourceTitle('')).not.toBeNull()
    expect(validateLessonResourceTitle('   ')).not.toBeNull()
  })

  it('accepts a real title', () => {
    expect(validateLessonResourceTitle('สไลด์บทที่ 1')).toBeNull()
  })
})

describe('validateLessonResourceUrl — invalid URL rejection (Section 12 required test)', () => {
  it('accepts a well-formed https:// URL', () => {
    expect(validateLessonResourceUrl('https://www.youtube.com/watch?v=abc123')).toBeNull()
  })

  it('rejects a non-https URL (http, javascript:, data:, ftp:)', () => {
    expect(validateLessonResourceUrl('http://example.com')).not.toBeNull()
    expect(validateLessonResourceUrl('javascript:alert(1)')).not.toBeNull()
    expect(validateLessonResourceUrl('data:text/html,hi')).not.toBeNull()
    expect(validateLessonResourceUrl('ftp://example.com/file')).not.toBeNull()
  })

  it('rejects an empty or unparseable URL', () => {
    expect(validateLessonResourceUrl('')).not.toBeNull()
    expect(validateLessonResourceUrl('not a url at all')).not.toBeNull()
  })
})

describe('validateLessonResourceFile — uploaded slide/document validation', () => {
  it('accepts an allowed slide/document type under the size limit', () => {
    expect(validateLessonResourceFile({ type: 'application/pdf', size: 1024 } as File)).toBeNull()
    expect(
      validateLessonResourceFile({
        type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        size: 1024,
      } as File),
    ).toBeNull()
  })

  it('rejects an unsupported type (e.g. a video mime type — uploads never allowed for video)', () => {
    expect(validateLessonResourceFile({ type: 'video/mp4', size: 1024 } as File)).not.toBeNull()
  })

  it('rejects a file over the 20MB limit', () => {
    expect(validateLessonResourceFile({ type: 'application/pdf', size: 21 * 1024 * 1024 } as File)).not.toBeNull()
  })
})

describe('generateLessonResourceFileName / buildLessonResourcePath', () => {
  it('never uses the original filename — always <uuid>.<ext>', () => {
    const name = generateLessonResourceFileName('application/pdf')
    expect(name).toMatch(/^[0-9a-f-]{36}\.pdf$/)
  })

  it('falls back to .bin for an unrecognized mime type', () => {
    expect(generateLessonResourceFileName('application/x-unknown')).toMatch(/\.bin$/)
  })

  it('builds the exact <teacherId>/<subjectId>/<classroomId>/<lessonId>/<file> path shape', () => {
    expect(buildLessonResourcePath('t1', 's1', 'c1', 'l1', 'x.pdf')).toBe('t1/s1/c1/l1/x.pdf')
  })
})

describe('lessonResourceTypeLabel', () => {
  it('labels all four resource types in Thai', () => {
    expect(lessonResourceTypeLabel('slide')).toBe('สไลด์')
    expect(lessonResourceTypeLabel('video')).toBe('วิดีโอ')
    expect(lessonResourceTypeLabel('document')).toBe('เอกสาร')
    expect(lessonResourceTypeLabel('link')).toBe('ลิงก์')
  })
})

describe('getYoutubeEmbedUrl — Section 7 VIDEO UX: inline preview for a trusted provider only', () => {
  it('extracts the video id from a youtube.com/watch link', () => {
    expect(getYoutubeEmbedUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(
      'https://www.youtube.com/embed/dQw4w9WgXcQ',
    )
  })

  it('extracts the video id from a youtu.be short link', () => {
    expect(getYoutubeEmbedUrl('https://youtu.be/dQw4w9WgXcQ')).toBe('https://www.youtube.com/embed/dQw4w9WgXcQ')
  })

  it('extracts the video id from a /shorts/ link', () => {
    expect(getYoutubeEmbedUrl('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe(
      'https://www.youtube.com/embed/dQw4w9WgXcQ',
    )
  })

  it('returns null for a non-YouTube provider (e.g. Google Drive) — falls back to a plain open link, never an error', () => {
    expect(getYoutubeEmbedUrl('https://drive.google.com/file/d/abc123/view')).toBeNull()
  })

  it('returns null for a malformed URL, never throws', () => {
    expect(getYoutubeEmbedUrl('not a url')).toBeNull()
  })

  it('returns null for a youtube.com URL missing an extractable video id', () => {
    expect(getYoutubeEmbedUrl('https://www.youtube.com/')).toBeNull()
  })

  it('never embeds a non-https YouTube-looking URL', () => {
    expect(getYoutubeEmbedUrl('http://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBeNull()
  })
})

// ==================================================
// "ลบบทเรียน" (permanent delete) — source-text guards, same pattern as
// this codebase's other network-calling authorization/wiring assertions
// (see assignment-service.test.ts's deleteAssignmentPermanently tests).
// ==================================================

describe('getLessonsForSubject — subject-wide (every linked classroom), used only by deleteSubjectPermanently', () => {
  const source = readFileSync(new URL('./lesson-service.ts', import.meta.url), 'utf-8')
  const fnBody = source.slice(
    source.indexOf('export async function getLessonsForSubject'),
    source.indexOf('\n}\n', source.indexOf('export async function getLessonsForSubject')),
  )

  it('queries by subject_id only — never scoped to one classroom (unlike getLessons)', () => {
    expect(fnBody).toContain("eq('subject_id', subjectId)")
    expect(fnBody).not.toContain("eq('classroom_id'")
  })
})

describe('removeLessonResourceStorageObjects — file resources only; a link/video (Google Drive, YouTube, ...) is never touched', () => {
  it('is a no-op (never touches the network) for an empty resource list', async () => {
    await expect(removeLessonResourceStorageObjects([])).resolves.toBeUndefined()
  })

  it('is a no-op for a list of only link/video resources (no filePath at all)', async () => {
    await expect(
      removeLessonResourceStorageObjects([resource('r1', 0), { ...resource('r2', 1), resourceType: 'video' }]),
    ).resolves.toBeUndefined()
  })

  const source = readFileSync(new URL('./lesson-service.ts', import.meta.url), 'utf-8')
  const fnBody = source.slice(
    source.indexOf('export async function removeLessonResourceStorageObjects'),
    source.indexOf('\n}\n', source.indexOf('export async function removeLessonResourceStorageObjects')),
  )

  it('never calls out to any Google/Drive API — the only network call is Supabase Storage .remove()', () => {
    expect(fnBody).not.toMatch(/google|drive/i)
    expect(fnBody).toContain('.storage.from(RESOURCE_BUCKET).remove(paths)')
  })
})

describe('deleteLessonPermanently — Storage cleanup before the row delete; never calls Google Drive; scoped to ONE lesson', () => {
  const source = readFileSync(new URL('./lesson-service.ts', import.meta.url), 'utf-8')
  const fnBody = source.slice(
    source.indexOf('export async function deleteLessonPermanently'),
    source.indexOf('\n}\n', source.indexOf('export async function deleteLessonPermanently')),
  )

  it('fetches this lesson\'s own resources, then removes their Storage objects, BEFORE deleting the row', () => {
    const resourcesFetchIndex = fnBody.indexOf('getLessonResources(lessonId)')
    const cleanupIndex = fnBody.indexOf('removeLessonResourceStorageObjects(resources)')
    const deleteIndex = fnBody.indexOf(".delete().eq('id', lessonId)")
    expect(resourcesFetchIndex).toBeGreaterThan(-1)
    expect(cleanupIndex).toBeGreaterThan(resourcesFetchIndex)
    expect(cleanupIndex).toBeLessThan(deleteIndex)
  })

  it('reads back the deleted row via .select(\'id\') to tell "genuinely deleted" apart from "RLS silently denied it"', () => {
    expect(fnBody).toContain(".delete().eq('id', lessonId).select('id')")
    expect(fnBody).toContain('data.length === 0')
  })

  it('never references Google/Drive anywhere — deleting a lesson never touches the teacher\'s original Drive file', () => {
    expect(fnBody).not.toMatch(/google|drive/i)
  })

  it('is scoped strictly to the given lessonId — never fetches/removes another lesson\'s resources', () => {
    expect(fnBody).toContain('getLessonResources(lessonId)')
    expect(fnBody).not.toMatch(/getLessonResources\((?!lessonId\))/)
  })
})
