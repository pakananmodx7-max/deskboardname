/**
 * Phase 6 mapping strategy — matches a KrunameClass roster against
 * whatever student rows the SGS Bridge extension manages to read off
 * the live SGS page (see sgs-bridge/src/lib/mapping.js, an intentional
 * plain-JS mirror of this file's rules — the extension runs outside
 * this app's build and can't import a TS module from src/, the same
 * reason teacher-agent-tools/write-tools.ts duplicates
 * nextStatusAfterScore instead of importing it).
 *
 * BUG FIX + LIVE DISCOVERY priority reorder: previously this matched by
 * student number ALONE first, falling back to name alone — a duplicate
 * SGS student NUMBER was always AMBIGUOUS even when the two candidates'
 * names clearly differed, and `studentCode` was never used at all.
 * Priority is now:
 *   1. exact normalized student code (skipped, never a failure, when the
 *      KrunameClass student has none — e.g. the legacy assignment-scoped
 *      payload family, which has no studentCode field at all).
 *   2. exact student number AND normalized Thai full name TOGETHER (both
 *      must agree on the SAME row) — intentionally stricter than "number
 *      alone": two SGS rows sharing a number but not a name no longer
 *      count as ambiguous at this step, since the combined condition
 *      itself disambiguates them.
 *   3. normalized Thai full name alone, as a last resort.
 * A match is NEVER guessed: exactly one candidate at a given priority
 * level is a MATCH, zero falls through to the next priority (or
 * NOT_FOUND if none remain), more than one is AMBIGUOUS and stays
 * AMBIGUOUS even if a lower-priority signal could theoretically break
 * the tie — silently guessing which of two same-named students is which
 * is exactly the failure mode this exists to prevent.
 */
export type SgsMappingStatus = 'MATCHED' | 'NOT_FOUND' | 'AMBIGUOUS'

export interface SgsMappingCandidate {
  /** Whatever the extension used to key this row on the SGS page —
   * opaque to this module, only used to report back which row matched. */
  sgsRowKey: string
  sgsStudentNumber: number | null
  /** SGS's own รหัสนักเรียน column, read structurally by the extension
   * (never a header-text guess) — null only when that column genuinely
   * couldn't be identified for this row. */
  sgsStudentId: string | null
  sgsFullNameRaw: string
}

export interface SgsMappingInputStudent {
  studentId: string
  studentNumber: number | null
  /** Only populated by payload families that actually carry a student
   * code (e.g. the SGS Score Workspace payload) — `null`/`undefined` for
   * the legacy assignment-scoped payload, which never had this field. */
  studentCode?: string | null
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

/** Student codes are compared exactly after trimming — never fuzzy,
 * never case-insensitive beyond a plain lowercase. */
export function normalizeStudentCode(raw: string): string {
  return raw.trim().toLowerCase()
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
    // Priority 1: exact normalized student code.
    const normalizedCode = student.studentCode ? normalizeStudentCode(student.studentCode) : ''
    if (normalizedCode) {
      const byCode = matchOneOf(
        sgsCandidates,
        (c) => c.sgsStudentId !== null && c.sgsStudentId !== '' && normalizeStudentCode(c.sgsStudentId) === normalizedCode,
      )
      if (byCode.status === 'MATCHED') {
        return buildResult(student, 'MATCHED', byCode.match, 'จับคู่ด้วยรหัสนักเรียน')
      }
      if (byCode.status === 'AMBIGUOUS') {
        return buildResult(student, 'AMBIGUOUS', null, 'พบรหัสนักเรียนซ้ำกันในหน้า SGS มากกว่า 1 แถว')
      }
      // NOT_FOUND by code falls through — SGS may not expose a รหัส
      // นักเรียน column at all, or this student's row simply isn't on
      // the currently visible page.
    }

    const normalizedTarget = normalizeThaiFullName(student.fullName)

    // Priority 2: exact student number AND normalized name TOGETHER.
    if (student.studentNumber !== null) {
      const byNumberAndName = matchOneOf(
        sgsCandidates,
        (c) => c.sgsStudentNumber === student.studentNumber && normalizeThaiFullName(c.sgsFullNameRaw) === normalizedTarget,
      )
      if (byNumberAndName.status === 'MATCHED') {
        return buildResult(student, 'MATCHED', byNumberAndName.match, 'จับคู่ด้วยเลขที่นักเรียนและชื่อ-นามสกุล')
      }
      if (byNumberAndName.status === 'AMBIGUOUS') {
        return buildResult(student, 'AMBIGUOUS', null, 'พบเลขที่นักเรียนและชื่อ-นามสกุลตรงกันมากกว่า 1 แถว')
      }
      // NOT_FOUND by number+name falls through to name-alone below — the
      // number might simply not match SGS's own เลขที่ ordering.
    }

    // Priority 3: normalized Thai full name alone.
    const byName = matchOneOf(sgsCandidates, (c) => normalizeThaiFullName(c.sgsFullNameRaw) === normalizedTarget)
    if (byName.status === 'MATCHED') {
      return buildResult(student, 'MATCHED', byName.match, 'จับคู่ด้วยชื่อ-นามสกุล (ไม่พบรหัส/เลขที่ตรงกัน)')
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
