import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

function readSource(): string {
  return readFileSync(new URL('./assignment-resources-section.tsx', import.meta.url), 'utf-8')
}

describe('AssignmentResourcesSection — teacher resource manager (Google Drive Integration, Section 1/9)', () => {
  const source = readSource()

  it('offers a Google/link kind picker sourced from the ONE shared RESOURCE_ADD_KINDS list, never a locally hardcoded set', () => {
    expect(source).toContain("from '@/lib/resource-provider'")
    expect(source).toContain('RESOURCE_ADD_KINDS')
    expect(source).toContain('RESOURCE_ADD_KIND_PLACEHOLDER')
  })

  it('shows the Google Drive permissions reminder only for a Google-provider kind, using the shared exact helper text (Section 5)', () => {
    expect(source).toContain('isGoogleProvider(linkKind)')
    expect(source).toContain('GOOGLE_PERMISSIONS_HELPER_TEXT')
  })

  it('never persists the picked "kind" — the kind state is only ever read for placeholder text and the permissions reminder, never sent to addLinkResource', () => {
    const addLinkCall = source.slice(source.indexOf('await addLinkResource('), source.indexOf(')', source.indexOf('await addLinkResource(')))
    expect(addLinkCall).not.toContain('linkKind')
  })

  it('re-derives the provider from the saved resource.url at render time (never trusting a client-supplied label)', () => {
    expect(source).toMatch(/detectResourceProvider\(resource\.url/)
  })

  it('opens every Google/external resource in a new tab with noopener/noreferrer', () => {
    expect(source).toContain('target="_blank"')
    expect(source).toContain('rel="noopener noreferrer"')
  })
})
