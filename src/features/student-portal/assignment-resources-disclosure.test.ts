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
