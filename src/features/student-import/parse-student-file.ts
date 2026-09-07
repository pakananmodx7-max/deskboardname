import * as XLSX from 'xlsx'

import {
  EmptySpreadsheetError,
  IMPORT_ROW_LIMIT,
  ImportRowLimitExceededError,
  UnsupportedFileTypeError,
  type ParsedSpreadsheet,
} from '@/features/student-import/types'

const SUPPORTED_EXTENSIONS = ['.xlsx', '.xls', '.csv']

function hasSupportedExtension(fileName: string): boolean {
  const lower = fileName.toLowerCase()
  return SUPPORTED_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

function isRowBlank(row: string[]): boolean {
  return row.every((cell) => cell.trim() === '')
}

export interface SpreadsheetGrid {
  fileName: string
  /** Every row exactly as parsed from the sheet, including any title,
   * blank, or spacer rows above the real student table — nothing is
   * filtered out yet, since detectHeaderRow (and, when confidence is low,
   * the teacher via the manual "เลือกแถวหัวตาราง" picker) needs to see the
   * file as-is to find the header row. */
  allRows: string[][]
}

/**
 * Parses a .xlsx/.xls/.csv file entirely in the browser — the raw file is
 * never uploaded to Supabase Storage. Only the first worksheet is used.
 *
 * Deliberately does NOT assume row 0 is the header — real school
 * spreadsheets routinely have a school name, class name, academic year, or
 * blank spacer rows above the actual header row. Header-row detection is a
 * separate step (see detect-header-row.ts) that runs on the result of this
 * function; this function's only job is turning the file into a plain grid
 * of trimmed string cells.
 */
export async function readSpreadsheetGrid(file: File): Promise<SpreadsheetGrid> {
  if (!hasSupportedExtension(file.name)) {
    throw new UnsupportedFileTypeError()
  }

  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: 'array' })
  const sheetName = workbook.SheetNames[0]
  const sheet = sheetName ? workbook.Sheets[sheetName] : undefined

  if (!sheet) {
    throw new EmptySpreadsheetError()
  }

  // raw: false + defval: '' gives every cell (including ones inside a
  // merged range that sheet_to_json can't expand, and cells that are
  // simply empty) back as a plain trimmable string, never null/undefined —
  // this is what makes isRowBlank/detectHeaderRow safe to run against
  // merged/blank cells without special-casing them.
  const rawRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: false,
    defval: '',
  })

  const allRows = rawRows.map((row) => row.map((cell) => (cell == null ? '' : String(cell).trim())))

  if (allRows.length === 0) {
    throw new EmptySpreadsheetError()
  }

  return { fileName: file.name, allRows }
}

/**
 * Turns a parsed grid plus a chosen header-row index into the
 * ParsedSpreadsheet shape the rest of the import pipeline
 * (student-import-mapper.ts, student-import-validator.ts) already expects
 * and is unit-tested against — this function is the only place that ever
 * decides "row N is the header, everything after is data", whether that
 * index came from auto-detection or the teacher's manual pick.
 *
 * Blank rows interspersed among the data rows (a stray spacer row in the
 * middle of the class list) are skipped safely rather than turning into a
 * garbage all-empty student row. The IMPORT_ROW_LIMIT is enforced here,
 * against the actual data-row count — title/header/blank rows above the
 * header never count against it.
 */
export function buildParsedSpreadsheet(grid: SpreadsheetGrid, headerRowIndex: number): ParsedSpreadsheet {
  const headerRow = grid.allRows[headerRowIndex] ?? []
  const columnCount = headerRow.length

  const dataRows = grid.allRows.slice(headerRowIndex + 1).filter((row) => !isRowBlank(row))

  if (dataRows.length === 0) {
    throw new EmptySpreadsheetError()
  }

  if (dataRows.length > IMPORT_ROW_LIMIT) {
    throw new ImportRowLimitExceededError(dataRows.length)
  }

  const normalizedRows = dataRows.map((row) => Array.from({ length: columnCount }, (_, i) => row[i] ?? ''))

  return {
    fileName: grid.fileName,
    headers: headerRow,
    rows: normalizedRows,
  }
}
