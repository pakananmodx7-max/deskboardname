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

/** Loose match for a spreadsheet-typed classroom name against the target
 * classroom's real name — case/whitespace-insensitive (NFC-normalized)
 * so "ม.5/1", " ม.5/1 ", and "ม.5/1" (different Unicode composition) all
 * still match; anything else is a genuine mismatch worth flagging. */
function classroomNamesMatch(a: string, b: string): boolean {
  const normalize = (s: string) => s.trim().toLowerCase().normalize('NFC')
  return normalize(a) === normalize(b)
}

/**
 * Turns raw spreadsheet rows into draft student records using the given
 * column mapping: applies the firstName/lastName columns when present,
 * otherwise falls back to splitting a single fullName column. Flags rows
 * missing a required name as invalid, and flags student_codes that repeat
 * within the file itself as duplicates. Pure and synchronous — it never
 * talks to Supabase (see resolveImportRows for the DB-aware step).
 *
 * `expectedClassroomName`, when given alongside a mapped `classroom`
 * column, is a pure safety net (Google Sheets Integration, Section 1's
 * "Detect: ... invalid classroom") — the import is always scoped to one
 * already-selected classroom (StudentImportDialog's classroomId), so a
 * row whose OWN classroom cell disagrees with it is flagged invalid
 * rather than silently imported into the wrong room, catching an
 * accidental paste from a mixed multi-classroom sheet. A row with no
 * classroom column mapped, or an empty cell, is never flagged this way.
 */
export function parseImportRows(
  parsed: ParsedSpreadsheet,
  mapping: ColumnMapping,
  expectedClassroomName?: string,
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
    const classroomRaw = getCell(row, mapping.classroom)
    const classroom = classroomRaw || null

    const hasName = firstName.trim().length > 0 && lastName.trim().length > 0
    const classroomMismatch =
      !!expectedClassroomName && !!classroom && !classroomNamesMatch(classroom, expectedClassroomName)

    const isValid = hasName && !classroomMismatch

    let reason: string | null = null
    if (!hasName) reason = 'ไม่พบชื่อหรือนามสกุล'
    else if (classroomMismatch) reason = `ห้องเรียนในไฟล์ ("${classroom}") ไม่ตรงกับห้องที่กำลังนำเข้า ("${expectedClassroomName}")`

    return {
      rowNumber: index + 1,
      studentCode: studentCodeRaw || null,
      number,
      firstName,
      lastName,
      nickname,
      email,
      phone,
      classroom,
      status: isValid ? 'ready' : 'invalid',
      reason,
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
