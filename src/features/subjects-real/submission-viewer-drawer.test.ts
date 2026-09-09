import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

function readSource(): string {
  return readFileSync(new URL('./submission-viewer-drawer.tsx', import.meta.url), 'utf-8')
}

describe('SubmissionViewerDrawer — teacher viewer + manual cleanup (Section 3/9/10)', () => {
  const source = readSource()

  it('shows submitted_at, late/on-time status, score, and teacher note — sourced from the `submission` prop directly, not re-derived from resources', () => {
    expect(source).toContain('submission.submittedAt')
    expect(source).toContain('STATUS_LABEL[submission.status]')
    expect(source).toContain('submission.score')
    expect(source).toContain('submission.note')
  })

  it('a resource-list load failure never hides submitted_at/status/score — those render from a separate block above the resource list', () => {
    const headerBlockEnd = source.indexOf('{rowError &&')
    const resourceListStart = source.indexOf('loading ? (')
    expect(headerBlockEnd).toBeGreaterThan(-1)
    expect(resourceListStart).toBeGreaterThan(headerBlockEnd)
  })

  it('cleanup requires explicit confirmation before removing a file (never a one-click destructive action)', () => {
    expect(source).toContain('ConfirmDialog')
    expect(source).toContain('confirmCleanupResource')
    expect(source).toContain('destructive')
  })

  it('cleanup is offered only for file resources, never link/text', () => {
    expect(source).toMatch(/resource\.resourceType === 'file' && !cleaned/)
  })

  it('a cleaned-up resource is visually marked, not hidden — history stays visible', () => {
    expect(source).toContain('ล้างไฟล์แล้ว')
  })
})
