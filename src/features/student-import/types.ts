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

export const IMPORT_TARGET_FIELDS: ImportTargetField[] = [
  'studentCode',
  'number',
  'firstName',
  'lastName',
  'fullName',
  'nickname',
  'email',
  'phone',
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
