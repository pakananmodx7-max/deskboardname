/**
 * Phase 5 — shapes the RAW structural facts collectRawSgsFacts()
 * (content-diagnostic.js) reads off the live SGS page into the final
 * copyable report. Kept as a separate, pure function (no DOM access)
 * specifically so it's unit-testable without a browser — all the
 * actual document.querySelectorAll calls live only in
 * content-diagnostic.js, which this file never imports and is never
 * imported by.
 *
 * This function only ever sees what collectRawSgsFacts already decided
 * to collect — page URL, form/table counts, row counts, input element
 * TYPES (never values), and visible header text. It never sees a
 * password, cookie, token, or a data table's body rows.
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
  }
}

/** Pretty JSON, ready to select-all/copy out of the popup's textarea. */
export function formatDiagnosticReportForCopy(report) {
  return JSON.stringify(report, null, 2)
}
