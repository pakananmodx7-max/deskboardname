import { describe, expect, it } from 'vitest'

import {
  buildCompactStudentGridReport,
  buildDiagnosticReport,
  buildStudentGridDebugReport,
  formatDiagnosticReportForCopy,
} from '../src/lib/diagnostic-report.js'

const rawFacts = {
  pageUrl: 'https://example.test/grades',
  pageTitle: 'ระบบ SGS — กรอกคะแนน',
  formCount: 1,
  tableCount: 2,
  tables: [{ selectorCandidate: 'table#grade-table', rowCount: 31, columnHeaders: ['เลขที่', 'ชื่อ-นามสกุล'], columnsHaveInput: [false, false] }],
  inputTypeCounts: { number: 30, text: 2, checkbox: 1 },
  inputSelectorCandidates: ['input.score-input', 'input#search'],
  knownFilters: {
    subject: { present: true, selectedText: 'ประวัติศาสตร์ไทย' },
    classroom: { present: true, selectedText: 'ม.5/1' },
  },
}

describe('buildDiagnosticReport (verbose/debug raw dump)', () => {
  it('passes every base structural field through unchanged, including knownFilters', () => {
    const report = buildDiagnosticReport(rawFacts)
    expect(report.pageUrl).toBe(rawFacts.pageUrl)
    expect(report.tables).toEqual(rawFacts.tables)
    expect(report.inputTypeCounts).toEqual(rawFacts.inputTypeCounts)
    expect(report.knownFilters).toEqual(rawFacts.knownFilters)
  })

  it('defaults knownFilters to null when the facts omit it (an older capture)', () => {
    const { knownFilters: _omit, ...withoutFilters } = rawFacts
    expect(buildDiagnosticReport(withoutFilters).knownFilters).toBeNull()
  })

  it('adds a generatedAt timestamp', () => {
    const report = buildDiagnosticReport(rawFacts)
    expect(typeof report.generatedAt).toBe('string')
    expect(() => new Date(report.generatedAt).toISOString()).not.toThrow()
  })

  it('never contains a password/cookie/token-shaped field, by construction', () => {
    const report = buildDiagnosticReport(rawFacts)
    expect(JSON.stringify(report)).not.toMatch(/password|cookie|token|secret/i)
  })
})

function text(t: string) {
  return { hasInput: false, hasLink: false, text: t, inputMeta: null }
}
function input() {
  return { hasInput: true, hasLink: false, text: '', inputMeta: { count: 1, type: 'text', disabled: false, readonly: false } }
}
function studentRow(number: string, code: string, name: string) {
  return [text(number), text(code), text(name), input(), input()]
}

const gridFacts = {
  pageTitle: 'ระบบ SGS — กรอกคะแนน',
  pageUrl: 'https://example.test/grades',
  subjectFilter: { present: true, selectedText: 'ประวัติศาสตร์ไทย' },
  classroomFilter: { present: true, selectedText: 'ม.5/1' },
  tables: [
    { tableIndex: 0, selectorFingerprint: 'table[0]', rows: [[text('layout')], [text('layout')], [text('layout')]] },
    {
      tableIndex: 1,
      selectorFingerprint: 'table[1]',
      rows: [
        [text(''), text(''), text(''), text('ช่อง 1 (15)'), text('รวมตลอดภาค')],
        studentRow('1', '00001', 'สมชาย ใจดี'),
        studentRow('2', '00002', 'สมหญิง ใจดี'),
        studentRow('3', '00003', 'วิชัย เก่งกล้า'),
      ],
    },
  ],
}

describe('buildCompactStudentGridReport — the exact shape the spec requires', () => {
  it('finds the real grid and reports it in the compact shape, matching the spec\'s field names exactly', () => {
    const report = buildCompactStudentGridReport(gridFacts)
    expect(report.pageTitle).toBe(gridFacts.pageTitle)
    expect(report.pageUrl).toBe(gridFacts.pageUrl)
    expect(report.subjectFilter).toEqual(gridFacts.subjectFilter)
    expect(report.classroomFilter).toEqual(gridFacts.classroomFilter)
    expect(report.studentGrid.found).toBe(true)
    expect(report.studentGrid.studentRowCount).toBe(3)
    expect(report.studentGrid.numberColumnIndex).toBe(0)
    expect(report.studentGrid.codeColumnIndex).toBe(1)
    expect(report.studentGrid.nameColumnIndex).toBe(2)
    // "ช่อง 1 (15)" is a real, editable score column; "รวมตลอดภาค" is a
    // calculated total and must never appear in writableScoreColumns.
    expect(report.studentGrid.writableScoreColumns).toEqual([
      expect.objectContaining({ columnIndex: 3, label: 'ช่อง 1 (15)', maxScore: 15 }),
    ])
    expect(report.studentGrid.derivedColumns).toEqual([
      { columnIndex: 4, label: 'รวมตลอดภาค', reason: 'label_indicates_calculated_or_status' },
    ])
    // LIVE DISCOVERY: the field exists even when empty — never omitted —
    // so a consumer can always rely on studentGrid.activatableScoreColumns.
    expect(report.studentGrid.activatableScoreColumns).toEqual([])
    expect(report.pagination).toEqual({
      detected: false,
      currentPage: null,
      totalPages: null,
      visibleStudentRows: 3,
      totalStudentRows: null,
      pageSize: null,
    })
    // Only 3 sample rows here — computeGridConfidence requires >=5 rows
    // for "high," so this small fixture is honestly "medium."
    expect(report.confidence).toBe('medium')
    expect(report.warnings).toEqual([])
  })

  it('never includes an actual student name/code anywhere in the report', () => {
    const report = buildCompactStudentGridReport(gridFacts)
    const serialized = JSON.stringify(report)
    expect(serialized).not.toContain('สมชาย')
    expect(serialized).not.toContain('00001')
  })

  it('reports found: false and a warning when no table has a qualifying repeating row', () => {
    const noGridFacts = { ...gridFacts, tables: [gridFacts.tables[0]] }
    const report = buildCompactStudentGridReport(noGridFacts)
    expect(report.studentGrid.found).toBe(false)
    expect(report.studentGrid.writableScoreColumns).toEqual([])
    expect(report.studentGrid.derivedColumns).toEqual([])
    expect(report.confidence).toBe('none')
    expect(report.warnings.length).toBeGreaterThan(0)
  })

  it('a grid with ONLY derived/calculated score columns is confidence "low" with a distinct warning', () => {
    const onlyDerivedFacts = {
      ...gridFacts,
      tables: [
        gridFacts.tables[0],
        {
          tableIndex: 1,
          selectorFingerprint: 'table[1]',
          rows: [
            [text(''), text(''), text(''), text('รวมตลอดภาค'), text('%')],
            studentRow('1', '00001', 'สมชาย ใจดี'),
            studentRow('2', '00002', 'สมหญิง ใจดี'),
            studentRow('3', '00003', 'วิชัย เก่งกล้า'),
          ],
        },
      ],
    }
    const report = buildCompactStudentGridReport(onlyDerivedFacts)
    expect(report.studentGrid.writableScoreColumns).toEqual([])
    expect(report.studentGrid.derivedColumns).toHaveLength(2)
    expect(report.confidence).toBe('low')
    expect(report.warnings.some((w: string) => w.includes('คำนวณ/อ่านอย่างเดียว'))).toBe(true)
  })

  it('never contains a password/cookie/token-shaped field', () => {
    const report = buildCompactStudentGridReport(gridFacts)
    expect(JSON.stringify(report)).not.toMatch(/password|cookie|token|secret/i)
  })

  it('LIVE DISCOVERY: a real score column gated by an unchecked SGS header checkbox is reported as activatableScoreColumns — never writableScoreColumns, never derivedColumns', () => {
    function checkboxCell(label: string, checked: boolean) {
      return {
        hasInput: true,
        hasLink: false,
        text: label,
        inputMeta: { count: 1, visibleCount: 1, type: 'checkbox', disabled: false, readonly: false, visible: true, checked },
      }
    }
    const activatableFacts = {
      ...gridFacts,
      tables: [
        gridFacts.tables[0],
        {
          tableIndex: 1,
          selectorFingerprint: 'table[1]',
          rows: [
            [text(''), text(''), text(''), checkboxCell('11', false), text('รวมตลอดภาค')],
            studentRow('1', '00001', 'สมชาย ใจดี'),
            studentRow('2', '00002', 'สมหญิง ใจดี'),
            studentRow('3', '00003', 'วิชัย เก่งกล้า'),
          ],
        },
      ],
    }
    const report = buildCompactStudentGridReport(activatableFacts)
    expect(report.studentGrid.writableScoreColumns).toEqual([])
    expect(report.studentGrid.activatableScoreColumns).toEqual([
      expect.objectContaining({ columnIndex: 3, label: '11', reason: 'header_checkbox_unchecked' }),
    ])
    expect(report.studentGrid.derivedColumns).toEqual([
      { columnIndex: 4, label: 'รวมตลอดภาค', reason: 'label_indicates_calculated_or_status' },
    ])
    // Never described the same way as a genuinely calculated column.
    expect(report.warnings.some((w: string) => w.includes('ยังไม่เปิดใช้งาน'))).toBe(true)
  })
})

describe('buildStudentGridDebugReport — anonymized row metadata only', () => {
  it('reports structural metadata for the winning table\'s rows, never actual text', () => {
    const debug = buildStudentGridDebugReport(gridFacts)
    expect(debug.found).toBe(true)
    expect(debug.rows).toHaveLength(3)
    expect(debug.rows[0]).toMatchObject({ cellCount: 5, inputCount: 2, probableNameCell: 2 })
    expect(JSON.stringify(debug)).not.toContain('สมชาย')
  })

  it('reports found: false when no grid was found', () => {
    const noGridFacts = { ...gridFacts, tables: [gridFacts.tables[0]] }
    expect(buildStudentGridDebugReport(noGridFacts)).toEqual({ found: false, rows: [] })
  })
})

describe('formatDiagnosticReportForCopy', () => {
  it('produces valid, re-parseable JSON for both report types', () => {
    const verbose = buildDiagnosticReport(rawFacts)
    expect(JSON.parse(formatDiagnosticReportForCopy(verbose))).toEqual(verbose)
    const compact = buildCompactStudentGridReport(gridFacts)
    expect(JSON.parse(formatDiagnosticReportForCopy(compact))).toEqual(compact)
  })
})
