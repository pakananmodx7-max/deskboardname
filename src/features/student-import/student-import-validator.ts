import { splitFullName } from '@/features/student-import/student-import-mapper'
import type {
  ColumnMapping,
  DraftImportRow,
  ImportPreviewSummary,
  ParsedSpreadsheet,
} from '@/features/student-import/types'

function getCell(row: string[], columnIndex: number | undefined): string {
  if (columnIndex === undefined) return ''
  return (row[columnIndex] ?? '').trim()
}

/**
 * Turns raw spreadsheet rows into draft student records using the given
 * column mapping: applies the firstName/lastName columns when present,
 * otherwise falls back to splitting a single fullName column. Flags rows
 * missing a required name as invalid, and flags student_codes that repeat
 * within the file itself as duplicates. Pure and synchronous — it never
 * talks to Supabase (see resolveImportRows for the DB-aware step).
 */
export function parseImportRows(
  parsed: ParsedSpreadsheet,
  mapping: ColumnMapping,
): DraftImportRow[] {
  const rows: DraftImportRow[] = parsed.rows.map((row, index) => {
    const studentCodeRaw = getCell(row, mapping.studentCode)
    const numberRaw = getCell(row, mapping.number)
    const number = numberRaw && /^\d+$/.test(numberRaw) ? Number(numberRaw) : null

    let firstName = getCell(row, mapping.firstName)
    let lastName = getCell(row, mapping.lastName)
    let fullNameAmbiguous = false

    if ((!firstName || !lastName) && mapping.fullName !== undefined) {
      const fullName = getCell(row, mapping.fullName)
      if (fullName) {
        const split = splitFullName(fullName)
        firstName = firstName || split.firstName
        lastName = lastName || split.lastName
        fullNameAmbiguous = split.ambiguous
      }
    }

    const nickname = getCell(row, mapping.nickname) || null
    const email = getCell(row, mapping.email) || null
    const phone = getCell(row, mapping.phone) || null

    const isValid = firstName.trim().length > 0 && lastName.trim().length > 0

    return {
      rowNumber: index + 1,
      studentCode: studentCodeRaw || null,
      number,
      firstName,
      lastName,
      nickname,
      email,
      phone,
      status: isValid ? 'ready' : 'invalid',
      reason: isValid ? null : 'ไม่พบชื่อหรือนามสกุล',
      fullNameAmbiguous,
    }
  })

  return flagInFileDuplicates(rows)
}

/** Marks every occurrence after the first of a repeated student_code as a duplicate. */
export function flagInFileDuplicates(rows: DraftImportRow[]): DraftImportRow[] {
  const seen = new Set<string>()

  return rows.map((row) => {
    if (row.status !== 'ready' || !row.studentCode) {
      return row
    }

    if (seen.has(row.studentCode)) {
      return { ...row, status: 'duplicate', reason: 'รหัสนักเรียนซ้ำในไฟล์นี้' }
    }

    seen.add(row.studentCode)
    return row
  })
}

export function summarizeImportRows(rows: DraftImportRow[]): ImportPreviewSummary {
  return rows.reduce<ImportPreviewSummary>(
    (summary, row) => {
      summary.total += 1
      summary[row.status] += 1
      return summary
    },
    { total: 0, ready: 0, duplicate: 0, invalid: 0 },
  )
}
