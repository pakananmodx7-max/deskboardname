import { describe, expect, it } from 'vitest'

import { buildDiagnosticReport, formatDiagnosticReportForCopy } from '../src/lib/diagnostic-report.js'

const facts = {
  pageUrl: 'https://example.test/grades',
  pageTitle: 'ระบบ SGS — กรอกคะแนน',
  formCount: 1,
  tableCount: 2,
  tables: [
    {
      selectorCandidate: 'table#grade-table',
      rowCount: 31,
      columnHeaders: ['เลขที่', 'ชื่อ-นามสกุล', 'กลางภาค (10)'],
      columnsHaveInput: [false, false, true],
    },
  ],
  inputTypeCounts: { number: 30, text: 2, checkbox: 1 },
  inputSelectorCandidates: ['input.score-input', 'input#search'],
  knownFilters: {
    subject: { present: true, currentValue: 'ประวัติศาสตร์ไทย' },
    classroom: { present: true, currentValue: 'ม.5/1' },
  },
}

describe('buildDiagnosticReport', () => {
  it('carries every base structural field through unchanged', () => {
    const report = buildDiagnosticReport(facts)
    expect(report.pageUrl).toBe(facts.pageUrl)
    expect(report.inputTypeCounts).toEqual(facts.inputTypeCounts)
  })

  it('passes knownFilters through, and defaults to null when the facts omit it (an older capture)', () => {
    const report = buildDiagnosticReport(facts)
    expect(report.knownFilters).toEqual(facts.knownFilters)
    const { knownFilters: _omit, ...withoutFilters } = facts
    expect(buildDiagnosticReport(withoutFilters).knownFilters).toBeNull()
  })

  it('enriches each table with an identifier-column guess', () => {
    const report = buildDiagnosticReport(facts)
    expect(report.tables[0].identifierColumns).toEqual({
      numberColumnIndex: 0,
      codeColumnIndex: null,
      nameColumnIndex: 1,
    })
  })

  it('enriches each table with score-column candidates, including a derived key and parsed max score', () => {
    const report = buildDiagnosticReport(facts)
    expect(report.tables[0].scoreColumnCandidates).toEqual([
      { columnIndex: 2, key: 'real-กลางภาค-10-2', label: 'กลางภาค (10)', maxScore: 10 },
    ])
  })

  it('a table with no columnsHaveInput data (an old capture) reports zero score-column candidates rather than crashing', () => {
    const { columnsHaveInput: _omit, ...tableWithoutInputFlags } = facts.tables[0]
    const report = buildDiagnosticReport({ ...facts, tables: [tableWithoutInputFlags] })
    expect(report.tables[0].scoreColumnCandidates).toEqual([])
  })

  it('adds a generatedAt timestamp', () => {
    const report = buildDiagnosticReport(facts)
    expect(typeof report.generatedAt).toBe('string')
    expect(() => new Date(report.generatedAt).toISOString()).not.toThrow()
  })

  it('never contains a password/cookie/token-shaped field, by construction', () => {
    const report = buildDiagnosticReport(facts)
    const serialized = JSON.stringify(report)
    expect(serialized).not.toMatch(/password|cookie|token|secret/i)
  })
})

describe('formatDiagnosticReportForCopy', () => {
  it('produces valid, re-parseable JSON', () => {
    const report = buildDiagnosticReport(facts)
    const text = formatDiagnosticReportForCopy(report)
    expect(JSON.parse(text)).toEqual(report)
  })
})
