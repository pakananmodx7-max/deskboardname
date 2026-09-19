import { describe, expect, it } from 'vitest'

import { buildDiagnosticReport, formatDiagnosticReportForCopy } from '../src/lib/diagnostic-report.js'

const facts = {
  pageUrl: 'https://example.test/grades',
  pageTitle: 'ระบบ SGS — กรอกคะแนน',
  formCount: 1,
  tableCount: 2,
  tables: [
    { selectorCandidate: 'table#grade-table', rowCount: 31, columnHeaders: ['เลขที่', 'ชื่อ-นามสกุล', 'คะแนน'] },
  ],
  inputTypeCounts: { number: 30, text: 2, checkbox: 1 },
  inputSelectorCandidates: ['input.score-input', 'input#search'],
}

describe('buildDiagnosticReport', () => {
  it('carries every structural field through unchanged', () => {
    const report = buildDiagnosticReport(facts)
    expect(report.pageUrl).toBe(facts.pageUrl)
    expect(report.tables).toEqual(facts.tables)
    expect(report.inputTypeCounts).toEqual(facts.inputTypeCounts)
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
