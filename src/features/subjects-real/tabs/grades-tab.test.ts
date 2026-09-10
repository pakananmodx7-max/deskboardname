import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

function readSource(): string {
  return readFileSync(new URL('./grades-tab.tsx', import.meta.url), 'utf-8')
}

describe('GradesTab — export grades (Google Sheets Integration, Section 2/6)', () => {
  const source = readSource()

  it('exports from the exact state already rendered on screen — assignments/roster/submissionsByAssignment, never a separate fetch', () => {
    const fn = source.slice(source.indexOf('function handleExport'), source.indexOf('if (!loading && assignments.length === 0)'))
    expect(fn).toContain('buildClassroomGradesExportTable(subject.name, classroomName, assignments, roster, submissionsByAssignment)')
  })

  it('downloads via the shared downloadCsv/ExportTable pipeline — never a locally reimplemented CSV writer', () => {
    expect(source).toContain("from '@/lib/export/csv-export'")
    expect(source).toContain('buildClassroomGradesExportTable')
  })

  it('the export button is disabled while loading or when there is no roster to export', () => {
    expect(source).toMatch(/onClick=\{handleExport\}\s*disabled=\{loading \|\| roster\.length === 0\}/)
  })
})
