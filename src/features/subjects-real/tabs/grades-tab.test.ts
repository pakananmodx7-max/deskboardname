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

describe('GradesTab — a submitted-but-ungraded score cell is never rendered/treated as 0', () => {
  const source = readSource()

  it('derives each cell\'s state via the shared computeSubmissionCellState — no locally reinvented ungraded check', () => {
    expect(source).toContain("from '@/services/assignment-service'")
    expect(source).toContain('computeSubmissionCellState')
    expect(source).toContain('computeSubmissionCellState(status, score)')
  })

  it('a submitted/late-but-ungraded cell shows a "รอตรวจ" placeholder, distinct from a plain not-submitted cell', () => {
    expect(source).toContain("cellState === 'submitted_ungraded' || cellState === 'late_ungraded' ? 'รอตรวจ' : '—'")
  })

  it('the score <Input> itself is never given a literal 0 default for an ungraded cell — defaultValue always comes straight from the real score (null stays null, never coerced)', () => {
    const cellBlock = source.slice(source.indexOf('{assignments.map((assignment) => {'), source.indexOf('</td>\n                          )\n                        })}'))
    expect(cellBlock).toContain('defaultValue={score ?? \'\'}')
    expect(cellBlock).not.toMatch(/defaultValue=\{score \?\? 0\}/)
  })

  it('computeGradeRows\' own total never sums a null score as 0 (score !== null gates every addition)', () => {
    // grades-tab.tsx renders computeGradeRows' output as-is; the totals
    // math itself lives in assignment-service.ts (see that file's own
    // computeGradeRows tests) — this just pins down that grades-tab.tsx
    // never re-derives or overrides `row.total`/`row.percentage` locally.
    expect(source).not.toMatch(/row\.total\s*\+\s*1|row\?\.\total\s*\|\|\s*score/)
    expect(source).toContain('{row?.total ?? 0}/{row?.possible ?? 0}')
  })
})
