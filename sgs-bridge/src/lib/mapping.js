/**
 * Mirrors src/services/sgs-mapping-service.ts's rules EXACTLY — this
 * extension is a separate, standalone folder that runs outside the
 * KrunameClass Vite build (loaded unpacked by Chrome), so it can't
 * import a TypeScript module from ../../src, and duplicates this pure
 * logic instead — the same reason
 * supabase/functions/teacher-agent-tools/tools/write-tools.ts
 * duplicates nextStatusAfterScore rather than importing the browser
 * module that owns it. Any change to the matching RULE must be made in
 * both places.
 *
 * BUG FIX + LIVE DISCOVERY priority reorder: previously this matched by
 * student number ALONE first, falling back to name alone — which meant
 * a duplicate SGS student NUMBER was always AMBIGUOUS even when the two
 * candidates' names clearly differed, and a KrunameClass payload's
 * `studentCode` was never even used to match against SGS's own รหัส
 * นักเรียน column. Priority is now:
 *   1. exact normalized student code (only when the KrunameClass student
 *      actually carries one — the legacy assignment-scoped payload has
 *      no studentCode field at all, see src/types/sgs-bridge.ts, so this
 *      step is simply skipped for it, never treated as a failure).
 *   2. exact student number AND normalized Thai full name together (both
 *      must agree on the SAME row) — this is intentionally stricter than
 *      "number alone": two SGS rows sharing a number but NOT sharing a
 *      name are no longer AMBIGUOUS at this step, because the combined
 *      condition itself disambiguates them.
 *   3. normalized Thai full name alone, as a last resort.
 * A match is NEVER guessed: exactly one candidate at a given priority
 * level is a MATCH, zero falls through to the next priority (or
 * NOT_FOUND if none remain), more than one is AMBIGUOUS and stays
 * AMBIGUOUS even if a lower-priority signal could theoretically break
 * the tie.
 */

const THAI_TITLE_PREFIXES = ['เด็กชาย', 'เด็กหญิง', 'นางสาว', 'นาย', 'นาง', 'ด.ช.', 'ด.ญ.']

export function normalizeThaiFullName(raw) {
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
 * never case-insensitive beyond a plain lowercase (Thai school codes are
 * numeric strings, but this stays safe for any stray letters too). */
export function normalizeStudentCode(raw) {
  return typeof raw === 'string' ? raw.trim().toLowerCase() : ''
}

function matchOneOf(candidates, predicate) {
  const matches = candidates.filter(predicate)
  if (matches.length === 1) return { status: 'MATCHED', match: matches[0] }
  if (matches.length === 0) return { status: 'NOT_FOUND', match: null }
  return { status: 'AMBIGUOUS', match: null }
}

function buildResult(student, status, match, reason) {
  return {
    studentId: student.studentId,
    studentNumber: student.studentNumber,
    fullName: student.fullName,
    score: student.score,
    status,
    matchedSgsRowKey: match ? match.sgsRowKey : null,
    reason,
  }
}

/**
 * @param {{studentId: string, studentNumber: number|null, studentCode?: string|null, fullName: string, score: number}[]} krunameStudents
 * @param {{sgsRowKey: string, sgsStudentNumber: number|null, sgsStudentId: string|null, sgsFullNameRaw: string}[]} sgsCandidates
 */
export function matchStudentsToSgs(krunameStudents, sgsCandidates) {
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
    if (student.studentNumber !== null && student.studentNumber !== undefined) {
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
