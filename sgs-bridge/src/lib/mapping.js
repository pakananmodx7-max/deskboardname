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
 * Priority: student number, then normalized full name as a fallback. A
 * match is NEVER guessed — exactly one candidate is MATCHED, zero is
 * NOT_FOUND, more than one is AMBIGUOUS and stays AMBIGUOUS.
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
 * @param {{studentId: string, studentNumber: number|null, fullName: string, score: number}[]} krunameStudents
 * @param {{sgsRowKey: string, sgsStudentNumber: number|null, sgsStudentId: string|null, sgsFullNameRaw: string}[]} sgsCandidates
 */
export function matchStudentsToSgs(krunameStudents, sgsCandidates) {
  return krunameStudents.map((student) => {
    if (student.studentNumber !== null && student.studentNumber !== undefined) {
      const byNumber = matchOneOf(sgsCandidates, (c) => c.sgsStudentNumber === student.studentNumber)
      if (byNumber.status === 'MATCHED') {
        return buildResult(student, 'MATCHED', byNumber.match, 'จับคู่ด้วยเลขที่นักเรียน')
      }
      if (byNumber.status === 'AMBIGUOUS') {
        return buildResult(student, 'AMBIGUOUS', null, 'พบเลขที่นักเรียนซ้ำกันในหน้า SGS มากกว่า 1 แถว')
      }
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
