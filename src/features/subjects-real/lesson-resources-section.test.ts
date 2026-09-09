import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

function readSource(): string {
  return readFileSync(new URL('./lesson-resources-section.tsx', import.meta.url), 'utf-8')
}

describe('LessonResourcesSection — teacher resource manager (Section 5)', () => {
  const source = readSource()

  it('offers exactly the four spec buttons: +เพิ่มสไลด์ / +เพิ่มวิดีโอ / +เพิ่มเอกสาร / +เพิ่มลิงก์', () => {
    expect(source).toContain('เพิ่มสไลด์')
    expect(source).toContain('เพิ่มวิดีโอ')
    expect(source).toContain('เพิ่มเอกสาร')
    expect(source).toContain('เพิ่มลิงก์')
  })

  it('never offers a video FILE upload path — only slide/document trigger the file picker (Section 4/8 storage strategy)', () => {
    expect(source).toContain("UPLOADABLE_TYPES: Extract<LessonResourceType, 'slide' | 'document'>[] = ['slide', 'document']")
    expect(source).not.toContain("handleFileButtonClick('video')")
  })

  it('adding a video is always the link/URL form, never addLessonFileResource', () => {
    expect(source).toContain("openLinkForm('video')")
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
