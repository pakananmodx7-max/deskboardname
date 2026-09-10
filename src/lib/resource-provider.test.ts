import { describe, expect, it } from 'vitest'

import {
  detectResourceProvider,
  getGoogleSlidesEmbedUrl,
  getYoutubeEmbedUrl,
  GOOGLE_PERMISSIONS_HELPER_TEXT,
  isGoogleProvider,
  PROVIDER_OPEN_LABEL,
} from '@/lib/resource-provider'

describe('detectResourceProvider (Google Drive Integration, Section 2/9/10)', () => {
  it('recognizes drive.google.com as google_drive', () => {
    expect(detectResourceProvider('https://drive.google.com/file/d/abc123/view')).toBe('google_drive')
  })

  it('recognizes docs.google.com/document as google_docs', () => {
    expect(detectResourceProvider('https://docs.google.com/document/d/abc123/edit')).toBe('google_docs')
  })

  it('recognizes docs.google.com/spreadsheets as google_sheets', () => {
    expect(detectResourceProvider('https://docs.google.com/spreadsheets/d/abc123/edit')).toBe('google_sheets')
  })

  it('recognizes docs.google.com/presentation as google_slides', () => {
    expect(detectResourceProvider('https://docs.google.com/presentation/d/abc123/edit')).toBe('google_slides')
  })

  it('recognizes youtube.com and youtu.be as youtube', () => {
    expect(detectResourceProvider('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('youtube')
    expect(detectResourceProvider('https://youtu.be/dQw4w9WgXcQ')).toBe('youtube')
  })

  it('recognizes canva.com as canva', () => {
    expect(detectResourceProvider('https://www.canva.com/design/abc123/view')).toBe('canva')
  })

  it('falls back to "link" for an unrecognized docs.google.com path (e.g. forms)', () => {
    expect(detectResourceProvider('https://docs.google.com/forms/d/abc123/viewform')).toBe('link')
  })

  it('falls back to "link" for a generic https URL', () => {
    expect(detectResourceProvider('https://example.com/worksheet.pdf')).toBe('link')
  })

  it('falls back to "link" for a malformed URL', () => {
    expect(detectResourceProvider('not a url')).toBe('link')
  })

  it('rejects a deceptive lookalike hostname (drive.google.com.attacker.example) — never a substring/suffix match', () => {
    expect(detectResourceProvider('https://drive.google.com.attacker.example/file/d/abc123/view')).toBe('link')
  })

  it('rejects a lookalike hostname where the real host is a path segment, not the hostname', () => {
    expect(detectResourceProvider('https://attacker.example/drive.google.com/file')).toBe('link')
  })

  it('rejects http:// (non-https) even for an otherwise-valid Google Drive URL', () => {
    expect(detectResourceProvider('http://drive.google.com/file/d/abc123/view')).toBe('link')
  })

  it('accepts a www. prefix on a recognized host', () => {
    expect(detectResourceProvider('https://www.drive.google.com/file/d/abc123/view')).toBe('google_drive')
  })
})

describe('PROVIDER_OPEN_LABEL / GOOGLE_PERMISSIONS_HELPER_TEXT — exact required spec text', () => {
  it('always retains "เปิดใน Google Slides" as the Slides open-in-new-tab fallback (Section 4)', () => {
    expect(PROVIDER_OPEN_LABEL.google_slides).toBe('เปิดใน Google Slides')
  })

  it('shows the exact Google Drive sharing-permissions reminder (Section 5) — never claims this app controls Drive permissions', () => {
    expect(GOOGLE_PERMISSIONS_HELPER_TEXT).toBe(
      'ตรวจสอบว่าได้ตั้งค่าสิทธิ์ไฟล์ใน Google Drive ให้นักเรียนที่เกี่ยวข้องสามารถเปิดดูได้',
    )
  })
})

describe('isGoogleProvider', () => {
  it('is true for all four Google Workspace providers and false otherwise', () => {
    expect(isGoogleProvider('google_drive')).toBe(true)
    expect(isGoogleProvider('google_docs')).toBe(true)
    expect(isGoogleProvider('google_sheets')).toBe(true)
    expect(isGoogleProvider('google_slides')).toBe(true)
    expect(isGoogleProvider('youtube')).toBe(false)
    expect(isGoogleProvider('canva')).toBe(false)
    expect(isGoogleProvider('link')).toBe(false)
  })
})

describe('getGoogleSlidesEmbedUrl (Section 4 — safe preview derivation, never a permissions bypass)', () => {
  it('derives Google\'s own public embed URL for a recognized presentation link', () => {
    expect(getGoogleSlidesEmbedUrl('https://docs.google.com/presentation/d/abc123/edit')).toBe(
      'https://docs.google.com/presentation/d/abc123/embed',
    )
  })

  it('returns null for a non-Slides Google Docs URL', () => {
    expect(getGoogleSlidesEmbedUrl('https://docs.google.com/document/d/abc123/edit')).toBeNull()
  })

  it('returns null for a generic link', () => {
    expect(getGoogleSlidesEmbedUrl('https://example.com')).toBeNull()
  })
})

describe('getYoutubeEmbedUrl', () => {
  it('derives an embed URL from a standard watch link', () => {
    expect(getYoutubeEmbedUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('https://www.youtube.com/embed/dQw4w9WgXcQ')
  })

  it('derives an embed URL from a youtu.be short link', () => {
    expect(getYoutubeEmbedUrl('https://youtu.be/dQw4w9WgXcQ')).toBe('https://www.youtube.com/embed/dQw4w9WgXcQ')
  })

  it('returns null for a non-YouTube URL', () => {
    expect(getYoutubeEmbedUrl('https://example.com/video.mp4')).toBeNull()
  })
})
