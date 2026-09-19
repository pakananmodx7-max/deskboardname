/**
 * Phase 6 mapping strategy — matches a KrunameClass roster against
 * whatever student rows the SGS Bridge extension manages to read off
 * the live SGS page (see sgs-bridge/src/lib/mapping.js, an intentional
 * plain-JS mirror of this file's rules — the extension runs outside
 * this app's build and can't import a TS module from src/, the same
 * reason teacher-agent-tools/write-tools.ts duplicates
 * nextStatusAfterScore instead of importing it).
 *
 * Priority, per the spec: student number first, then a stable SGS
 * student id IF SGS ever exposes one (unknown until Phase 5's
 * diagnostic mode reports back), then normalized full name as a last
 * resort. A match is NEVER guessed: exactly one candidate at a given
 * priority level is a MATCH, zero is NOT_FOUND, more than one is
 * AMBIGUOUS and stays AMBIGUOUS even if a lower-priority signal could
 * theoretically break the tie — silently guessing which of two
 * same-named students is which is exactly the failure mode this exists
 * to prevent.
 */
export type SgsMappingStatus = 'MATCHED' | 'NOT_FOUND' | 'AMBIGUOUS'

export interface SgsMappingCandidate {
  /** Whatever the extension used to key this row on the SGS page —
   * opaque to this module, only used to report back which row matched. */
  sgsRowKey: string
  sgsStudentNumber: number | null
  /** Only populated once Phase 5 confirms SGS exposes a usable stable
   * identifier — null until then, and this module works fine without it. */
  sgsStudentId: string | null
  sgsFullNameRaw: string
}

export interface SgsMappingInputStudent {
  studentId: string
  studentNumber: number | null
  fullName: string
  score: number
}

export interface SgsMappingResult {
  studentId: string
  studentNumber: number | null
  fullName: string
  score: number
  status: SgsMappingStatus
  matchedSgsRowKey: string | null
  reason: string
}

const THAI_TITLE_PREFIXES = ['เด็กชาย', 'เด็กหญิง', 'นางสาว', 'นาย', 'นาง', 'ด.ช.', 'ด.ญ.']

/**
 * Strips common Thai name titles and collapses whitespace so
 * "เด็กชายสมชาย   ใจดี" and "สมชาย ใจดี" compare equal — SGS's own
 * display format for student names is unknown until Phase 5, so this
 * normalizes toward the more common "no title" form used elsewhere in
 * this codebase (students.first_name never stores a title).
 */
export function normalizeThaiFullName(raw: string): string {
  let name = raw.trim().replace(/\s+/g, ' ')
  for (const prefix of THAI_TITLE_PREFIXES) {
    if (name.startsWith(prefix)) {
      name = name.slice(prefix.length).trim()
      break
    }
  }
  return name.replace(/\s+/g, '').toLowerCase()
}

function matchOneOf(
  candidates: SgsMappingCandidate[],
  predicate: (c: SgsMappingCandidate) => boolean,
): { status: SgsMappingStatus; match: SgsMappingCandidate | null } {
  const matches = candidates.filter(predicate)
  if (matches.length === 1) return { status: 'MATCHED', match: matches[0] }
  if (matches.length === 0) return { status: 'NOT_FOUND', match: null }
  return { status: 'AMBIGUOUS', match: null }
}

export function matchStudentsToSgs(
  krunameStudents: SgsMappingInputStudent[],
  sgsCandidates: SgsMappingCandidate[],
): SgsMappingResult[] {
  return krunameStudents.map((student) => {
    if (student.studentNumber !== null) {
      const byNumber = matchOneOf(sgsCandidates, (c) => c.sgsStudentNumber === student.studentNumber)
      if (byNumber.status === 'MATCHED') {
        return buildResult(student, 'MATCHED', byNumber.match, 'จับคู่ด้วยเลขที่นักเรียน')
      }
      if (byNumber.status === 'AMBIGUOUS') {
        return buildResult(student, 'AMBIGUOUS', null, 'พบเลขที่นักเรียนซ้ำกันในหน้า SGS มากกว่า 1 แถว')
      }
      // NOT_FOUND by number falls through to try name matching below —
      // a number that doesn't appear in SGS yet isn't necessarily fatal
      // (e.g. SGS's own roster ordering differs), but a name-only match
      // is a weaker signal, so it's tried only after number match fails.
    }

    const normalizedTarget = normalizeThaiFullName(student.fullName)
    const byName = matchOneOf(sgsCandidates, (c) => normalizeThaiFullName(c.sgsFullNameRaw) === normalizedTarget)
    if (byName.status === 'MATCHED') {
      return buildResult(student, 'MATCHED', byName.match, 'จับคู่ด้วยชื่อ-นามสกุล (ไม่พบเลขที่ตรงกัน)')
    }
    if (byName.status === 'AMBIGUOUS') {
      return buildResult(student, 'AMBIGUOUS', null, 'พบชื่อ-นามสกุลซ้ำกันในหน้า SGS มากกว่า 1 แถว — ต้องตรวจสอบด้วยตนเอง')
    }
    return buildResult(student, 'NOT_FOUND', null, 'ไม่พบนักเรียนคนนี้ในหน้า SGS')
  })
}

function buildResult(
  student: SgsMappingInputStudent,
  status: SgsMappingStatus,
  match: SgsMappingCandidate | null,
  reason: string,
): SgsMappingResult {
  return {
    studentId: student.studentId,
    studentNumber: student.studentNumber,
    fullName: student.fullName,
    score: student.score,
    status,
    matchedSgsRowKey: match?.sgsRowKey ?? null,
    reason,
  }
}
