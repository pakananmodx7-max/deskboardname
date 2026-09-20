/**
 * BUG FIX — LIVE DISCOVERY: the single-cell-test safety gate's
 * subject/classroom check (computeSubjectClassroomOk in popup.js)
 * compared KrunameClass's own subjectName/classroomName against SGS's
 * raw filter text with a plain `===`. On the real page this ALWAYS
 * failed even for the CORRECT subject/classroom, because the two
 * systems format the same thing completely differently:
 *
 *   KrunameClass subject:   "สังคมศึกษา3"
 *   SGS subject filter:     "ส22101 สังคมศึกษา3 ม.2"  (course code + name + grade, all one string)
 *   KrunameClass classroom: "2/1"                       (grade/section, no "ม." prefix)
 *   SGS classroom filter:   "1"                          (just the group/section number)
 *
 * This module replaces the raw string comparison with real semantic
 * matching:
 *
 *   SUBJECT — prefer an exact course-code match (a Thai-consonant + 5
 *   digit code, e.g. "ส22101") when BOTH sides carry one: a code
 *   mismatch is authoritative and blocks even if the names happen to
 *   overlap. Otherwise, normalize both sides' subject NAME (strip a
 *   leading course code and a trailing "ม.X" grade suffix — SGS bakes
 *   the grade into the very same filter text — then ignore whitespace
 *   differences) and compare those.
 *
 *   CLASSROOM — parse KrunameClass's "grade/section" (e.g. "2/1" ->
 *   grade 2, section 1) and compare against the grade SGS's OWN subject
 *   filter text already embeds ("ม.2") plus the group number SGS's
 *   classroom/section filter holds ("1"). Never a raw string compare of
 *   "2/1" against "1" — those were never going to be equal.
 *
 * AUTHORITATIVE SGS ELEMENTS: this module only ever consumes the two
 * filters content-diagnostic.js already reads by CONFIRMED element id —
 * ClassSubjectIDFilter (subject, which happens to embed the grade) and
 * ClassSectionNoFilter (the group/section number) — because those are
 * the exact two controls already confirmed to scope the visible score
 * table itself (see content-diagnostic.js's own doc comment). A real SGS
 * page may also show a page-chrome-level "ชั้น" control elsewhere on the
 * screen; this module deliberately does NOT read one, because no live
 * discovery in this project has ever confirmed such a control is wired
 * to the SAME context that scopes the currently-visible score table — a
 * stale/unrelated leftover selection there would create a false
 * mismatch this module has no way to detect or explain. If a future live
 * discovery confirms a specific "ชั้น" element id IS a reliable signal,
 * it should be added here explicitly by id, exactly like the two above —
 * never guessed.
 *
 * Never blocks on missing/unparseable data on EITHER side — same
 * philosophy as the code this replaces: a genuinely DETECTED mismatch is
 * what blocks the single-cell test, never a mere inability to compare.
 */

const COURSE_CODE_PATTERN = /[ก-ฮ]\d{5}/
const SGS_GRADE_PATTERN = /ม\.?\s*(\d+)/
const KRUNAME_CLASSROOM_PATTERN = /^(\d+)\s*\/\s*(\d+)$/

/** A Thai school course code — one Thai consonant followed by exactly 5
 * digits (e.g. "ส22101"). Null when none is found. */
export function extractCourseCode(raw) {
  if (typeof raw !== 'string') return null
  const match = raw.match(COURSE_CODE_PATTERN)
  return match ? match[0] : null
}

/**
 * Strips a leading course code and a trailing "ม.X" grade suffix — both
 * of which SGS's own subject filter bakes into one string, but
 * KrunameClass's subject name never has — then ignores every whitespace
 * difference, so "สังคมศึกษา 3" and "สังคมศึกษา3" compare equal.
 */
export function normalizeSubjectNameForMatch(raw) {
  if (typeof raw !== 'string') return ''
  let name = raw.trim()
  name = name.replace(new RegExp(`^${COURSE_CODE_PATTERN.source}\\s*`), '')
  name = name.replace(new RegExp(`\\s*${SGS_GRADE_PATTERN.source}\\s*$`), '')
  return name.replace(/\s+/g, '').toLowerCase()
}

/**
 * @param {string|null|undefined} krunameSubjectName
 * @param {string|null|undefined} sgsSubjectFilterText
 * @returns {{ok: boolean, reason: 'unknown'|'code_match'|'code_mismatch'|'name_match'|'name_mismatch', krunameCode: string|null, sgsCode: string|null}}
 */
export function evaluateSubjectMatch(krunameSubjectName, sgsSubjectFilterText) {
  const kruname = typeof krunameSubjectName === 'string' ? krunameSubjectName.trim() : ''
  const sgs = typeof sgsSubjectFilterText === 'string' ? sgsSubjectFilterText.trim() : ''
  if (!kruname || !sgs) {
    return { ok: true, reason: 'unknown', krunameCode: null, sgsCode: null }
  }

  const krunameCode = extractCourseCode(kruname)
  const sgsCode = extractCourseCode(sgs)
  if (krunameCode && sgsCode) {
    const codesMatch = krunameCode === sgsCode
    return { ok: codesMatch, reason: codesMatch ? 'code_match' : 'code_mismatch', krunameCode, sgsCode }
  }

  const normalizedKruname = normalizeSubjectNameForMatch(kruname)
  const normalizedSgs = normalizeSubjectNameForMatch(sgs)
  if (!normalizedKruname || !normalizedSgs) {
    return { ok: true, reason: 'unknown', krunameCode, sgsCode }
  }
  const namesMatch = normalizedKruname === normalizedSgs
  return { ok: namesMatch, reason: namesMatch ? 'name_match' : 'name_mismatch', krunameCode, sgsCode }
}

/** Parses KrunameClass's own "grade/section" classroom name — e.g. "2/1"
 * -> { grade: 2, section: 1 }. Null for any other shape (never guessed). */
export function parseKrunameClassroom(raw) {
  if (typeof raw !== 'string') return null
  const match = raw.trim().match(KRUNAME_CLASSROOM_PATTERN)
  if (!match) return null
  return { grade: Number(match[1]), section: Number(match[2]) }
}

/** SGS's own subject filter text embeds the grade level, e.g. "ส22101
 * สังคมศึกษา3 ม.2" -> 2. Null when no "ม.X" pattern is found. */
export function parseSgsGradeFromSubjectText(raw) {
  if (typeof raw !== 'string') return null
  const match = raw.match(SGS_GRADE_PATTERN)
  return match ? Number(match[1]) : null
}

/** SGS's classroom/section filter holds just the group number, e.g. "1"
 * or "กลุ่ม 1" — the first run of digits found. Null if none. */
export function parseSgsGroupNumber(raw) {
  if (typeof raw !== 'string') return null
  const match = raw.match(/\d+/)
  return match ? Number(match[0]) : null
}

/**
 * @param {string|null|undefined} krunameClassroomName
 * @param {string|null|undefined} sgsSubjectFilterText
 * @param {string|null|undefined} sgsClassroomFilterText
 * @returns {{ok: boolean, reason: 'unknown'|'match'|'mismatch', krunameLabel: string|null, sgsLabel: string|null, krunameGrade: number|null, krunameSection: number|null, sgsGrade: number|null, sgsSection: number|null}}
 */
export function evaluateClassroomMatch(krunameClassroomName, sgsSubjectFilterText, sgsClassroomFilterText) {
  const kruname = parseKrunameClassroom(krunameClassroomName)
  const sgsGrade = parseSgsGradeFromSubjectText(sgsSubjectFilterText)
  const sgsSection = parseSgsGroupNumber(sgsClassroomFilterText)

  const krunameLabel = kruname ? `ม.${kruname.grade}/${kruname.section}` : null
  const sgsLabel =
    sgsGrade === null && sgsSection === null
      ? null
      : `${sgsGrade === null ? 'ไม่ทราบชั้น' : `ม.${sgsGrade}`} กลุ่ม ${sgsSection === null ? 'ไม่ทราบ' : sgsSection}`

  if (!kruname || sgsGrade === null || sgsSection === null) {
    return {
      ok: true,
      reason: 'unknown',
      krunameLabel,
      sgsLabel,
      krunameGrade: kruname ? kruname.grade : null,
      krunameSection: kruname ? kruname.section : null,
      sgsGrade,
      sgsSection,
    }
  }

  const matches = kruname.grade === sgsGrade && kruname.section === sgsSection
  return {
    ok: matches,
    reason: matches ? 'match' : 'mismatch',
    krunameLabel,
    sgsLabel,
    krunameGrade: kruname.grade,
    krunameSection: kruname.section,
    sgsGrade,
    sgsSection,
  }
}

/**
 * The combined check popup.js's evaluateCurrentSubjectClassroomMatch
 * delegates to entirely, replacing the old byte-for-byte string
 * comparison (previously named computeSubjectClassroomOk). `ok` is the
 * single boolean the single-cell-test safety gate consumes;
 * `subject`/`classroom` carry everything the preview UI needs to show
 * "KrunameClass: ... / SGS: ... / ผลตรวจ: ..." for each half.
 */
export function evaluateSubjectClassroomMatch({
  krunameSubjectName,
  krunameClassroomName,
  sgsSubjectFilterText,
  sgsClassroomFilterText,
}) {
  const subject = evaluateSubjectMatch(krunameSubjectName, sgsSubjectFilterText)
  const classroom = evaluateClassroomMatch(krunameClassroomName, sgsSubjectFilterText, sgsClassroomFilterText)
  return { ok: subject.ok && classroom.ok, subject, classroom }
}

/** A short Thai verdict label for one half's result — used by both
 * halves of the preview UI so they read consistently. */
export function describeMatchVerdict(result) {
  if (result.reason === 'unknown') return 'ไม่ทราบ (ข้อมูลไม่พอเปรียบเทียบ)'
  return result.ok ? 'ตรงกัน' : 'ไม่ตรงกัน'
}
