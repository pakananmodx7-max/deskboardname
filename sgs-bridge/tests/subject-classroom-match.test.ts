import { describe, expect, it } from 'vitest'

import {
  describeMatchVerdict,
  evaluateClassroomMatch,
  evaluateSubjectClassroomMatch,
  evaluateSubjectMatch,
  extractCourseCode,
  normalizeSubjectNameForMatch,
  parseKrunameClassroom,
  parseSgsGradeFromSubjectText,
  parseSgsGroupNumber,
} from '../src/lib/subject-classroom-match.js'

// BUG FIX — LIVE DISCOVERY: real example from the bug report.
//   KrunameClass: subject "สังคมศึกษา3", classroom "2/1"
//   SGS:          subject filter "ส22101 สังคมศึกษา3 ม.2", classroom/group filter "1"
// These describe the SAME class (ม.2/1) and must be treated as a match.

describe('extractCourseCode', () => {
  it('finds a Thai-consonant + 5-digit course code anywhere in the text', () => {
    expect(extractCourseCode('ส22101 สังคมศึกษา3 ม.2')).toBe('ส22101')
  })

  it('returns null when no such code is present', () => {
    expect(extractCourseCode('สังคมศึกษา3')).toBeNull()
    expect(extractCourseCode('2/1')).toBeNull()
  })
})

describe('normalizeSubjectNameForMatch', () => {
  it('strips a leading course code and a trailing ม.X grade suffix, then ignores whitespace', () => {
    expect(normalizeSubjectNameForMatch('ส22101 สังคมศึกษา3 ม.2')).toBe(normalizeSubjectNameForMatch('สังคมศึกษา3'))
  })

  it('ignores whitespace-only formatting differences', () => {
    expect(normalizeSubjectNameForMatch('สังคมศึกษา 3')).toBe(normalizeSubjectNameForMatch('สังคมศึกษา3'))
  })
})

describe('evaluateSubjectMatch', () => {
  it('BUG FIX: the exact live example — KrunameClass "สังคมศึกษา3" matches SGS "ส22101 สังคมศึกษา3 ม.2" via normalized name (no code on the KrunameClass side)', () => {
    const result = evaluateSubjectMatch('สังคมศึกษา3', 'ส22101 สังคมศึกษา3 ม.2')
    expect(result.ok).toBe(true)
    expect(result.reason).toBe('name_match')
  })

  it('course code exact match: when BOTH sides carry a code, equal codes match even if surrounding text differs slightly', () => {
    const result = evaluateSubjectMatch('ส22101 สังคมศึกษา3', 'ส22101 สังคมศึกษา3 ม.2')
    expect(result.ok).toBe(true)
    expect(result.reason).toBe('code_match')
    expect(result.krunameCode).toBe('ส22101')
    expect(result.sgsCode).toBe('ส22101')
  })

  it('course codes are authoritative: a code mismatch blocks even though it is never reached without both sides carrying one', () => {
    const result = evaluateSubjectMatch('ส22101 สังคมศึกษา3', 'ค22101 คณิตศาสตร์3 ม.2')
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('code_mismatch')
  })

  it('real subject mismatch is blocked when normalized names genuinely differ', () => {
    const result = evaluateSubjectMatch('คณิตศาสตร์1', 'ส22101 สังคมศึกษา3 ม.2')
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('name_mismatch')
  })

  it('never blocks when either side is blank/unknown', () => {
    expect(evaluateSubjectMatch('', 'ส22101 สังคมศึกษา3 ม.2').ok).toBe(true)
    expect(evaluateSubjectMatch('สังคมศึกษา3', '').ok).toBe(true)
    expect(evaluateSubjectMatch(null, undefined).ok).toBe(true)
  })
})

describe('parseKrunameClassroom', () => {
  it('parses "grade/section"', () => {
    expect(parseKrunameClassroom('2/1')).toEqual({ grade: 2, section: 1 })
    expect(parseKrunameClassroom('2/2')).toEqual({ grade: 2, section: 2 })
  })

  it('returns null for anything else', () => {
    expect(parseKrunameClassroom('ม.2/1')).toBeNull()
    expect(parseKrunameClassroom('2')).toBeNull()
    expect(parseKrunameClassroom('')).toBeNull()
  })
})

describe('parseSgsGradeFromSubjectText / parseSgsGroupNumber', () => {
  it('extracts the grade embedded in the SGS subject filter text', () => {
    expect(parseSgsGradeFromSubjectText('ส22101 สังคมศึกษา3 ม.2')).toBe(2)
    expect(parseSgsGradeFromSubjectText('ส22101 สังคมศึกษา3 ม.3')).toBe(3)
  })

  it('extracts the bare group number from the SGS classroom/section filter', () => {
    expect(parseSgsGroupNumber('1')).toBe(1)
    expect(parseSgsGroupNumber('กลุ่ม 2')).toBe(2)
  })
})

describe('evaluateClassroomMatch', () => {
  it('2/1 matches ม.2 + group 1', () => {
    const result = evaluateClassroomMatch('2/1', 'ส22101 สังคมศึกษา3 ม.2', '1')
    expect(result.ok).toBe(true)
    expect(result.reason).toBe('match')
    expect(result.krunameLabel).toBe('ม.2/1')
    expect(result.sgsLabel).toBe('ม.2 กลุ่ม 1')
  })

  it('2/2 matches ม.2 + group 2', () => {
    const result = evaluateClassroomMatch('2/2', 'ส22101 สังคมศึกษา3 ม.2', '2')
    expect(result.ok).toBe(true)
    expect(result.reason).toBe('match')
  })

  it('2/1 does not match ม.3 + group 1 (grade mismatch) -> BLOCK', () => {
    const result = evaluateClassroomMatch('2/1', 'ส22101 สังคมศึกษา3 ม.3', '1')
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('mismatch')
  })

  it('2/1 does not match ม.2 + group 2 (section mismatch) -> BLOCK', () => {
    const result = evaluateClassroomMatch('2/1', 'ส22101 สังคมศึกษา3 ม.2', '2')
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('mismatch')
  })

  it('never blocks when the classroom cannot be parsed on either side', () => {
    expect(evaluateClassroomMatch(null, 'ส22101 สังคมศึกษา3 ม.2', '1').ok).toBe(true)
    expect(evaluateClassroomMatch('2/1', null, '1').ok).toBe(true)
    expect(evaluateClassroomMatch('2/1', 'ส22101 สังคมศึกษา3 ม.2', null).ok).toBe(true)
  })
})

describe('evaluateSubjectClassroomMatch — the combined check', () => {
  it('BUG FIX: the exact live example is a full match end to end', () => {
    const result = evaluateSubjectClassroomMatch({
      krunameSubjectName: 'สังคมศึกษา3',
      krunameClassroomName: '2/1',
      sgsSubjectFilterText: 'ส22101 สังคมศึกษา3 ม.2',
      sgsClassroomFilterText: '1',
    })
    expect(result.ok).toBe(true)
    expect(result.subject.ok).toBe(true)
    expect(result.classroom.ok).toBe(true)
  })

  it('a genuine subject mismatch blocks the combined result even if the classroom parses as matching', () => {
    const result = evaluateSubjectClassroomMatch({
      krunameSubjectName: 'คณิตศาสตร์1',
      krunameClassroomName: '2/1',
      sgsSubjectFilterText: 'ส22101 สังคมศึกษา3 ม.2',
      sgsClassroomFilterText: '1',
    })
    expect(result.ok).toBe(false)
    expect(result.subject.ok).toBe(false)
    expect(result.classroom.ok).toBe(true)
  })

  it('a genuine classroom mismatch (wrong group) blocks the combined result even with a matching subject', () => {
    const result = evaluateSubjectClassroomMatch({
      krunameSubjectName: 'สังคมศึกษา3',
      krunameClassroomName: '2/1',
      sgsSubjectFilterText: 'ส22101 สังคมศึกษา3 ม.2',
      sgsClassroomFilterText: '2',
    })
    expect(result.ok).toBe(false)
    expect(result.classroom.ok).toBe(false)
  })
})

describe('describeMatchVerdict', () => {
  it('reports "ตรงกัน" for an ok match, "ไม่ตรงกัน" for a real mismatch, and an honest "unknown" label otherwise', () => {
    expect(describeMatchVerdict({ ok: true, reason: 'match' })).toBe('ตรงกัน')
    expect(describeMatchVerdict({ ok: false, reason: 'mismatch' })).toBe('ไม่ตรงกัน')
    expect(describeMatchVerdict({ ok: true, reason: 'unknown' })).toContain('ไม่ทราบ')
  })
})
