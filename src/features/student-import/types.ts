export const IMPORT_ROW_LIMIT = 500

export type ImportTargetField =
  | 'studentCode'
  | 'number'
  | 'firstName'
  | 'lastName'
  | 'fullName'
  | 'nickname'
  | 'email'
  | 'phone'
  | 'classroom'

export const IMPORT_TARGET_FIELDS: ImportTargetField[] = [
  'studentCode',
  'number',
  'firstName',
  'lastName',
  'fullName',
  'nickname',
  'email',
  'phone',
  'classroom',
]

export const IMPORT_TARGET_FIELD_LABELS: Record<ImportTargetField, string> = {
  studentCode: 'รหัสนักเรียน',
  number: 'เลขที่',
  firstName: 'ชื่อ',
  lastName: 'นามสกุล',
  fullName: 'ชื่อ-นามสกุล (เต็ม)',
  nickname: 'ชื่อเล่น',
  email: 'อีเมล',
  phone: 'เบอร์โทร',
  /** Google Sheets Integration, Section 1: an OPTIONAL safety-check
   * column, not a routing field — this importer always imports into the
   * one classroom the teacher is already viewing (see
   * StudentImportDialog's classroomId prop); mapping this column only
   * lets parseImportRows cross-check each row's value against that
   * classroom's name and flag a mismatch, catching an accidental
   * paste from a mixed multi-classroom sheet rather than silently
   * importing a wrong-classroom row. */
  classroom: 'ห้องเรียน (ตรวจสอบเท่านั้น)',
}

/** Maps a target field to the source column index in the parsed sheet. */
export type ColumnMapping = Partial<Record<ImportTargetField, number>>

export interface ParsedSpreadsheet {
  fileName: string
  headers: string[]
  rows: string[][]
}

export type ImportRowStatus = 'ready' | 'duplicate' | 'invalid'

export interface DraftImportRow {
  rowNumber: number
  studentCode: string | null
  number: number | null
  firstName: string
  lastName: string
  nickname: string | null
  email: string | null
  phone: string | null
  /** The file's own "classroom" column value for this row, if mapped —
   * kept only for display/cross-check; never used to route the row to a
   * different classroom than the one this import is already scoped to. */
  classroom: string | null
  status: ImportRowStatus
  reason: string | null
  fullNameAmbiguous: boolean
}

export type ImportRowAction = 'create' | 'link' | 'skip'

export interface ResolvedImportRow extends DraftImportRow {
  action: ImportRowAction
  existingStudentId: string | null
}

export interface ImportPreviewSummary {
  total: number
  ready: number
  duplicate: number
  invalid: number
}

export interface ImportCommitResult {
  created: number
  linkedExisting: number
  duplicates: number
  failed: number
  failedRows: { rowNumber: number; firstName: string; lastName: string; reason: string }[]
}

export class ImportRowLimitExceededError extends Error {
  readonly count: number

  constructor(count: number) {
    super(`ไฟล์มีข้อมูลมากเกินไป (${count} แถว) โปรดนำเข้าไม่เกิน ${IMPORT_ROW_LIMIT} คนต่อไฟล์`)
    this.name = 'ImportRowLimitExceededError'
    this.count = count
  }
}

export class UnsupportedFileTypeError extends Error {
  constructor() {
    super('รองรับเฉพาะไฟล์ .xlsx และ .csv เท่านั้น')
    this.name = 'UnsupportedFileTypeError'
  }
}

export class EmptySpreadsheetError extends Error {
  constructor() {
    super('ไม่พบข้อมูลในไฟล์ที่เลือก')
    this.name = 'EmptySpreadsheetError'
  }
}
