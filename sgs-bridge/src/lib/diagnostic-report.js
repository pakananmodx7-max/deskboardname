import { identifyIdentifierColumns, identifyScoreColumnCandidates } from './sgs-table-extraction.js'

/**
 * Shapes the RAW structural facts collectRawSgsFacts()
 * (content-diagnostic.js) reads off the live SGS page into the final
 * copyable report. Kept as a separate, pure function (no DOM access)
 * specifically so it's unit-testable without a browser — all the
 * actual document.querySelectorAll calls live only in
 * content-diagnostic.js, which this file never imports and is never
 * imported by.
 *
 * This function only ever sees what collectRawSgsFacts already decided
 * to collect — page URL, form/table counts, row counts, input element
 * TYPES/PRESENCE (never values), and visible header text. It never sees
 * a password, cookie, token, or a data table's body rows.
 *
 * For EACH table, this also runs the same identifier/score-column
 * guessing logic Phase 2's real extraction uses
 * (identifyIdentifierColumns/identifyScoreColumnCandidates from
 * ./sgs-table-extraction.js) — so surveying one of the ~18 real SGS
 * pages this way already shows which table looks like the score table,
 * which columns look like เลขที่/รหัส/ชื่อ, and which look like score
 * columns with their derived columnKey/maxScore guess, without needing
 * to separately run the fill-flow's own inspectSgsScoreTable.
 */
export function buildDiagnosticReport(facts) {
  return {
    generatedAt: new Date().toISOString(),
    pageUrl: facts.pageUrl,
    pageTitle: facts.pageTitle,
    formCount: facts.formCount,
    tableCount: facts.tableCount,
    tables: facts.tables.map((table) => {
      const identifierColumns = identifyIdentifierColumns(table.columnHeaders)
      const scoreColumnCandidates = table.columnsHaveInput
        ? identifyScoreColumnCandidates(table.columnHeaders, table.columnsHaveInput, identifierColumns)
        : []
      return { ...table, identifierColumns, scoreColumnCandidates }
    }),
    inputTypeCounts: facts.inputTypeCounts,
    inputSelectorCandidates: facts.inputSelectorCandidates,
    knownFilters: facts.knownFilters ?? null,
  }
}

/** Pretty JSON, ready to select-all/copy out of the popup's textarea. */
export function formatDiagnosticReportForCopy(report) {
  return JSON.stringify(report, null, 2)
}
