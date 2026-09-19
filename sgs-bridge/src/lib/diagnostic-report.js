import {
  buildAnonymizedRowDiagnostics,
  buildGridWarnings,
  computeGridConfidence,
  detectPagination,
  pickBestStudentGridCandidate,
} from './sgs-table-extraction.js'

/**
 * Shapes the RAW structural facts collectRawSgsFacts()
 * (content-diagnostic.js) reads off the live SGS page into a copyable
 * report. This is the "optional verbose/debug mode" — a raw dump of
 * every table's row count/header text/input-type counts, with NO
 * attempt at guessing which table is the real student grid (that guess
 * needs actual row CONTENT, which this raw-facts shape deliberately
 * doesn't collect — see buildCompactStudentGridReport below for the one
 * that does).
 */
export function buildDiagnosticReport(facts) {
  return {
    generatedAt: new Date().toISOString(),
    pageUrl: facts.pageUrl,
    pageTitle: facts.pageTitle,
    formCount: facts.formCount,
    tableCount: facts.tableCount,
    tables: facts.tables,
    inputTypeCounts: facts.inputTypeCounts,
    inputSelectorCandidates: facts.inputSelectorCandidates,
    knownFilters: facts.knownFilters ?? null,
  }
}

/**
 * The PRIMARY diagnostic — built from collectAllTableRowFacts's rich
 * per-row data (content-diagnostic.js), this is what actually finds the
 * real student grid among the page's ~200 tables
 * (pickBestStudentGridCandidate), splits its score columns into
 * genuinely WRITABLE ones versus calculated/read-only ones
 * (classifyScoreColumns, run inside evaluateStudentGridCandidate), and
 * reports pagination as a best-effort, separate signal. Never includes
 * a student's actual name/code/number — only column indexes, counts,
 * and derived labels/keys.
 */
export function buildCompactStudentGridReport(facts) {
  const candidate = pickBestStudentGridCandidate(facts.tables)

  return {
    generatedAt: new Date().toISOString(),
    pageTitle: facts.pageTitle,
    pageUrl: facts.pageUrl,
    subjectFilter: facts.subjectFilter,
    classroomFilter: facts.classroomFilter,
    studentGrid: {
      found: candidate !== null,
      selectorOrFingerprint: candidate?.selectorFingerprint ?? null,
      studentRowCount: candidate?.studentRowCount ?? 0,
      numberColumnIndex: candidate?.identifierColumns.numberColumnIndex ?? null,
      codeColumnIndex: candidate?.identifierColumns.codeColumnIndex ?? null,
      nameColumnIndex: candidate?.identifierColumns.nameColumnIndex ?? null,
      writableScoreColumns: candidate?.writableScoreColumns ?? [],
      derivedColumns: candidate?.derivedColumns ?? [],
    },
    pagination: detectPagination(facts.tables, candidate),
    confidence: computeGridConfidence(candidate),
    warnings: buildGridWarnings(candidate),
  }
}

/**
 * The optional verbose/debug companion to buildCompactStudentGridReport
 * — anonymized per-row structural metadata (see
 * buildAnonymizedRowDiagnostics's own doc comment) for whichever table
 * won, so a developer can sanity-check WHY a given table was picked
 * without ever seeing an actual student's name or code.
 */
export function buildStudentGridDebugReport(facts) {
  const candidate = pickBestStudentGridCandidate(facts.tables)
  if (!candidate) return { found: false, rows: [] }
  const winningTable = facts.tables.find((t) => t.tableIndex === candidate.tableIndex)
  return { found: true, rows: winningTable ? buildAnonymizedRowDiagnostics(winningTable, candidate) : [] }
}

/** Pretty JSON, ready to select-all/copy out of the popup's textarea. */
export function formatDiagnosticReportForCopy(report) {
  return JSON.stringify(report, null, 2)
}
