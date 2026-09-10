import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

function readSourceRelativeToThisFile(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf-8')
}

/**
 * Source-text regression guard: "students must never see raw internal
 * storage paths" (the migration's own requirement) is a rule about what
 * NEVER appears in the rendered output, which isn't something a pure-
 * function test can assert directly (there's no jsdom in this project —
 * see vitest.config.ts). Instead this asserts, at the source-text level,
 * that the disclosure component never interpolates `.filePath` into
 * anything shown to the student, and that opening a file always goes
 * through the signed-URL service call first.
 */
describe('AssignmentResourcesDisclosure — never exposes a raw storage path', () => {
  const source = readSourceRelativeToThisFile('./assignment-resources-disclosure.tsx')

  it('never renders resource.filePath as visible text', () => {
    expect(source).not.toMatch(/\{resource\.filePath\}/)
  })

  it('opens a file resource only via getResourceSignedUrl, never a direct filePath link', () => {
    expect(source).toContain('getResourceSignedUrl')
    expect(source).not.toMatch(/href=\{resource\.filePath/)
  })

  it('opens every external resource in a new tab with noopener/noreferrer', () => {
    expect(source).toContain("target=\"_blank\"")
    expect(source).toMatch(/noopener/)
  })
})

/**
 * Google Drive Integration, Section 6/9: the student view must derive its
 * provider label/icon from the ONE shared detectResourceProvider — never a
 * second, locally re-implemented Google URL parser — and must never trust
 * a client-supplied/stored "provider" label (there is none to trust: the
 * database has no provider column, per Section 11's "no migration
 * required").
 */
describe('AssignmentResourcesDisclosure — Google provider display (Section 6/9)', () => {
  const source = readSourceRelativeToThisFile('./assignment-resources-disclosure.tsx')

  it('imports the shared resource-provider module rather than re-implementing URL detection', () => {
    expect(source).toContain("from '@/lib/resource-provider'")
    expect(source).toContain('detectResourceProvider')
  })

  it('re-derives the provider from resource.url at render time, never from a stored field', () => {
    expect(source).toMatch(/detectResourceProvider\(resource\.url\)/)
  })

  it('keeps the original "เปิดงานออนไลน์" wording for a generic/unrecognized link, and only uses the provider-specific label for a recognized Google/YouTube/Canva provider', () => {
    expect(source).toContain('เปิดงานออนไลน์')
    expect(source).toContain("provider === 'link' ? 'เปิดงานออนไลน์' : PROVIDER_OPEN_LABEL[provider]")
  })
})
