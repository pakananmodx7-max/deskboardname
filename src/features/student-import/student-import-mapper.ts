import type { ColumnMapping, ImportTargetField } from '@/features/student-import/types'
import { IMPORT_TARGET_FIELDS } from '@/features/student-import/types'

const HEADER_ALIASES: Record<ImportTargetField, string[]> = {
  number: ['เลขที่', 'ลำดับ', 'ลำดับที่', 'no', 'no.', 'number'],
  studentCode: [
    'รหัสนักเรียน',
    'รหัส',
    'เลขประจำตัว',
    'เลขประจำตัวนักเรียน',
    'studentcode',
    'studentid',
    'id',
  ],
  firstName: ['ชื่อ', 'ชื่อจริง', 'firstname', 'first'],
  lastName: ['นามสกุล', 'สกุล', 'lastname', 'last', 'surname'],
  fullName: [
    'ชื่อนามสกุล',
    'ชื่อสกุล',
    'ชื่อเต็ม',
    'ชื่อจริงนามสกุล',
    'fullname',
    'name',
  ],
  nickname: ['ชื่อเล่น', 'nickname'],
  email: ['อีเมล', 'อีเมล์', 'email', 'emailaddress'],
  phone: ['เบอร์โทร', 'เบอร์โทรศัพท์', 'เบอร์', 'โทรศัพท์', 'phone', 'tel', 'telephone'],
  classroom: ['ห้องเรียน', 'ห้อง', 'classroom', 'class', 'room'],
}

/** Lower-cases and strips whitespace/punctuation so header variants converge. */
export function normalizeHeader(header: string): string {
  return header
    .toLowerCase()
    .normalize('NFC')
    .replace(/[\s\-_./()]/g, '')
}

const ALIAS_LOOKUP: Map<string, ImportTargetField> = new Map()
for (const field of IMPORT_TARGET_FIELDS) {
  for (const alias of HEADER_ALIASES[field]) {
    ALIAS_LOOKUP.set(normalizeHeader(alias), field)
  }
}

/**
 * Every known header spelling across all target fields, flattened and
 * deduped. Exported so detect-header-row.ts can score candidate header
 * rows against the same vocabulary autoDetectMapping uses, rather than
 * maintaining a second, potentially-drifting word list.
 */
export const ALL_HEADER_ALIASES: string[] = Array.from(
  new Set(IMPORT_TARGET_FIELDS.flatMap((field) => HEADER_ALIASES[field])),
)

/**
 * Guesses which spreadsheet column maps to which target field based on
 * common Thai/English header spellings. The result is always editable by
 * the user afterward — this is a starting point, not a guarantee.
 */
export function autoDetectMapping(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {}

  headers.forEach((header, index) => {
    const field = ALIAS_LOOKUP.get(normalizeHeader(header))
    if (field && mapping[field] === undefined) {
      mapping[field] = index
    }
  })

  return mapping
}

const HONORIFIC_PREFIXES = [
  'เด็กชาย',
  'เด็กหญิง',
  'นางสาว',
  'นาย',
  'นาง',
  'ด.ช.',
  'ด.ญ.',
  'ด.ช',
  'ด.ญ',
]

export interface SplitFullNameResult {
  firstName: string
  lastName: string
  ambiguous: boolean
}

/**
 * Splits a single "full name" spreadsheet value into first/last name.
 * Confident only for the common "ชื่อ นามสกุล" (whitespace-separated)
 * shape; anything else is still split as best-effort but flagged
 * ambiguous so the import preview can surface it for manual correction.
 */
export function splitFullName(fullName: string): SplitFullNameResult {
  let remaining = fullName.trim()

  for (const prefix of HONORIFIC_PREFIXES) {
    if (remaining.startsWith(prefix)) {
      remaining = remaining.slice(prefix.length).trim()
      break
    }
  }

  const tokens = remaining.split(/\s+/).filter(Boolean)

  if (tokens.length >= 2) {
    return { firstName: tokens[0], lastName: tokens.slice(1).join(' '), ambiguous: false }
  }

  if (tokens.length === 1) {
    const hyphenTokens = tokens[0].split('-').filter(Boolean)
    if (hyphenTokens.length >= 2) {
      return {
        firstName: hyphenTokens[0],
        lastName: hyphenTokens.slice(1).join('-'),
        ambiguous: true,
      }
    }
    return { firstName: tokens[0], lastName: '', ambiguous: true }
  }

  return { firstName: '', lastName: '', ambiguous: true }
}
