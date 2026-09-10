import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

function readSource(): string {
  return readFileSync(new URL('./lesson-resources-section.tsx', import.meta.url), 'utf-8')
}

describe('LessonResourcesSection — teacher resource manager (Section 5)', () => {
  const source = readSource()

  it('offers a file-upload entry point for slide/document, and one consolidated link/Google entry point (Google Drive Integration, Section 1)', () => {
    expect(source).toContain("handleFileButtonClick('slide')")
    expect(source).toContain("handleFileButtonClick('document')")
    expect(source).toContain('เพิ่มลิงก์ / Google')
  })

  it('never offers a video FILE upload path — only slide/document trigger the file picker (Section 4/8 storage strategy)', () => {
    expect(source).toContain("UPLOADABLE_TYPES: Extract<LessonResourceType, 'slide' | 'document'>[] = ['slide', 'document']")
    expect(source).not.toContain("handleFileButtonClick('video')")
  })

  it('adding a video is always the link/URL form, never addLessonFileResource — reached via the YouTube kind, mapped to resource_type "video"', () => {
    expect(source).toContain('addLessonLinkResource(')
    expect(source).toContain("kindToResourceType(linkKind)")
    expect(source).toMatch(/kindToResourceType[\s\S]*?if \(kind === 'youtube'\) return 'video'/)
  })

  it('supports reorder (move up/down) and remove for every resource', () => {
    expect(source).toContain('handleMove')
    expect(source).toContain('handleRemove')
    expect(source).toContain('reorderLessonResources')
  })

  it('has its own independent load-error state — a resource load failure here does not blank the whole lesson dialog', () => {
    expect(source).toMatch(/const \[loadError, setLoadError\] = useState/)
  })
})

describe('LessonResourcesSection — Google resource kind picker (Google Drive Integration, Section 1/5/9)', () => {
  const source = readSource()

  it('offers the Google/link kind picker sourced from the ONE shared RESOURCE_ADD_KINDS list', () => {
    expect(source).toContain("from '@/lib/resource-provider'")
    expect(source).toContain('RESOURCE_ADD_KINDS')
    expect(source).toContain('RESOURCE_ADD_KIND_PLACEHOLDER')
  })

  it('shows the shared Google Drive permissions reminder only for a Google-provider kind', () => {
    expect(source).toContain('isGoogleProvider(linkKind)')
    expect(source).toContain('GOOGLE_PERMISSIONS_HELPER_TEXT')
  })

  it('re-derives the provider from the saved resource.url at render time, never from resource_type or the picked kind', () => {
    expect(source).toMatch(/detectResourceProvider\(resource\.url\)/)
  })
})

describe('LessonResourcesSection — "เลือกจาก Google Drive" (Google Drive API Integration, Section 3/5)', () => {
  const source = readSource()

  it('offers a Google Drive Picker button alongside the existing add-file/add-link entry points', () => {
    expect(source).toContain('เลือกจาก Google Drive')
    expect(source).toContain('pickGoogleDriveFile')
  })

  it('a Picker-added resource is saved via the SAME addLessonLinkResource call as a hand-pasted link — never a second, separate insert path', () => {
    const fn = source.slice(source.indexOf('async function handlePickFromDrive'), source.indexOf('async function handleRemove'))
    expect(fn).toContain('addLessonLinkResource(')
    expect(fn).toContain('driveFileId: picked.driveFileId')
  })

  it('never uploads the picked file\'s bytes to Supabase Storage', () => {
    const fn = source.slice(source.indexOf('async function handlePickFromDrive'), source.indexOf('async function handleRemove'))
    expect(fn).not.toContain('.storage.')
  })

  it('surfaces a clear message (not a generic error) when Google is not connected or needs reconnecting', () => {
    expect(source).toContain('GoogleNotConnectedError')
    expect(source).toContain('GoogleReauthRequiredError')
  })
})
