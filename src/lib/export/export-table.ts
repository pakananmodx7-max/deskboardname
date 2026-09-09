/**
 * The one shape every report's export (CSV/DOCX/PDF) is built from — a
 * report screen renders exactly this table (already respecting whatever
 * filters are currently selected, since it's built from the same
 * already-filtered rows the on-screen table renders) and hands it to
 * whichever export function the teacher clicked. This is what
 * guarantees "exports must respect the currently selected filters":
 * there is no separate, unfiltered export code path — export only ever
 * sees what's already on screen.
 */
export interface ExportTable {
  title: string
  /** Shown under the title — typically a human-readable summary of the
   * active filters (classroom/subject/date range), e.g.
   * "ห้องเรียน: ม.5/1 · วันที่ 1 ก.ย. 2569 - 30 ก.ย. 2569". */
  subtitle: string
  headers: string[]
  rows: (string | number)[][]
}

const FORMULA_TRIGGER_CHARS = ['=', '+', '-', '@', '\t', '\r']

function escapeCsvCell(value: string | number): string {
  let text = String(value)

  // CSV/formula injection guard: Excel/Sheets treat a cell that STARTS
  // with one of these characters as a formula to evaluate when the file
  // is opened, regardless of what wrote it — report data can include
  // teacher-entered assignment titles/notes, so a leading apostrophe
  // (Excel/Sheets' own "treat as plain text" convention) neutralizes
  // that without changing the visible text in any spreadsheet app.
  if (FORMULA_TRIGGER_CHARS.some((char) => text.startsWith(char))) {
    text = `'${text}`
  }

  if (text.includes(',') || text.includes('"') || text.includes('\n') || text.includes('\r')) {
    return `"${text.replace(/"/g, '""')}"`
  }
  return text
}

/**
 * Pure CSV content builder — a leading UTF-8 BOM is required for Excel
 * (not LibreOffice/Sheets, which don't need it) to correctly detect the
 * encoding and render Thai text instead of mojibake; every other
 * consumer ignores a BOM harmlessly, so it's always included.
 */
export function buildCsvContent(table: ExportTable): string {
  const lines = [table.headers, ...table.rows].map((row) => row.map(escapeCsvCell).join(','))
  return '﻿' + lines.join('\r\n')
}
