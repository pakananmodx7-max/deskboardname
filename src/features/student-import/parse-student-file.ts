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

/**
 * Parses a .xlsx/.xls/.csv file entirely in the browser — the raw file is
 * never uploaded to Supabase Storage. Only the first worksheet is used.
 */
export async function parseStudentFile(file: File): Promise<ParsedSpreadsheet> {
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

  const rawRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: false,
    defval: '',
  })

  const stringRows = rawRows
    .map((row) => row.map((cell) => (cell == null ? '' : String(cell).trim())))
    .filter((row) => !isRowBlank(row))

  if (stringRows.length === 0) {
    throw new EmptySpreadsheetError()
  }

  const [headers, ...dataRows] = stringRows

  if (dataRows.length === 0) {
    throw new EmptySpreadsheetError()
  }

  if (dataRows.length > IMPORT_ROW_LIMIT) {
    throw new ImportRowLimitExceededError(dataRows.length)
  }

  const columnCount = headers.length
  const normalizedRows = dataRows.map((row) =>
    Array.from({ length: columnCount }, (_, i) => row[i] ?? ''),
  )

  return {
    fileName: file.name,
    headers,
    rows: normalizedRows,
  }
}
