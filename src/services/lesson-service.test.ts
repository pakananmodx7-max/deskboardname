import { describe, expect, it } from 'vitest'

import {
  buildLessonResourcePath,
  computeNextLessonSortOrder,
  computeNextResourceSortOrder,
  generateLessonResourceFileName,
  getYoutubeEmbedUrl,
  lessonResourceTypeLabel,
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
