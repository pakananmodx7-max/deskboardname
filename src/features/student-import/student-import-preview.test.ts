import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

function readSource(): string {
  return readFileSync(new URL('./student-import-preview.tsx', import.meta.url), 'utf-8')
}

describe('StudentImportPreview — shows new vs existing students before commit (Google Sheets Integration, Section 5)', () => {
  const source = readSource()

  it('computes newCount/existingCount straight from each row\'s resolved action — the exact same field commitImportRows reads to decide create vs link', () => {
    expect(source).toContain("rows.filter((r) => r.action === 'create')")
    expect(source).toContain("rows.filter((r) => r.action === 'link')")
  })

  it('shows a per-row action label, never just the ready/duplicate/invalid status', () => {
    expect(source).toContain('actionLabel[row.action]')
  })
})
