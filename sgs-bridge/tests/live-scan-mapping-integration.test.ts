import { describe, expect, it } from 'vitest'

import { matchStudentsToSgs } from '../src/lib/mapping.js'
import { evaluateStudentGridCandidate, extractSgsStudentCandidates } from '../src/lib/sgs-table-extraction.js'

/**
 * BUG FIX (mapping button was not atomic): these tests exercise the FULL
 * live-scan pipeline — raw table facts (as content-diagnostic.js's
 * collectAllTableRowFacts would return) -> evaluateStudentGridCandidate
 * (grid detection) -> extractSgsStudentCandidates (row extraction) ->
 * matchStudentsToSgs (the mapping engine) — with NO diagnostic textarea,
 * NO "diagnostic completed" boolean, and NO separate step-4 state
 * involved anywhere. This is exactly the pipeline runMappingCheck in
 * popup.js now performs on every click, proving a live scan alone is
 * sufficient to produce a MATCHED result end-to-end.
 */

function text(t: string) {
  return { hasInput: false, hasLink: false, text: t, inputMeta: null }
}
function input() {
  return { hasInput: true, hasLink: false, text: '', inputMeta: { count: 1, type: 'text', disabled: false, readonly: false, visible: true, checked: null } }
}
function studentRow(number: string, code: string, name: string) {
  return [text(number), text(code), text(name), input(), input()]
}

function kn(studentId: string, studentNumber: number | null, fullName: string, score: number, studentCode: string | null = null) {
  return { studentId, studentNumber, studentCode, fullName, score }
}

describe('live scan -> mapping integration: a successful scan feeds real candidates DIRECTLY into the mapping engine', () => {
  it('the exact live example from the bug report: เลขที่ 1 / เกศ ศรีคำฉิม / score 8 becomes MATCHED, using only freshly-scanned table facts', () => {
    const tableFacts = {
      tableIndex: 0,
      selectorFingerprint: 'table[0]',
      rows: [
        studentRow('1', '00001', 'เกศ ศรีคำฉิม'),
        studentRow('2', '00002', 'สมชาย ใจดี'),
        studentRow('3', '00003', 'สมหญิง ใจดี'),
      ],
    }

    // Steps 1-2: grid detection, exactly as performLiveGridScan does.
    const candidate = evaluateStudentGridCandidate(tableFacts)
    expect(candidate).not.toBeNull()

    // Step 3: real visible row extraction, using ONLY the confirmed
    // identifier column indexes — never a table-wide heuristic.
    const sgsCandidates = extractSgsStudentCandidates(tableFacts, candidate!.run, candidate!.identifierColumns)
    expect(sgsCandidates).toHaveLength(3)

    // Step 4: direct hand-off into the mapping service — no intermediate
    // textarea, JSON copy, or "diagnostic completed" flag of any kind.
    const krunameStudents = [kn('k1', 1, 'เกศ ศรีคำฉิม', 8)]
    const results = matchStudentsToSgs(krunameStudents, sgsCandidates)

    expect(results[0].status).toBe('MATCHED')
    expect(results[0].matchedSgsRowKey).toBe('row-0')
    expect(results[0].score).toBe(8)
  })

  it('exact student code match survives the full live-scan pipeline even when number/name differ', () => {
    const tableFacts = {
      tableIndex: 0,
      selectorFingerprint: 'table[0]',
      rows: [studentRow('9', '00042', 'ชื่อในระบบ SGS'), studentRow('2', '00002', 'อีกคน'), studentRow('3', '00003', 'อีกคนหนึ่ง')],
    }
    const candidate = evaluateStudentGridCandidate(tableFacts)!
    const sgsCandidates = extractSgsStudentCandidates(tableFacts, candidate.run, candidate.identifierColumns)

    const krunameStudents = [kn('k1', 1, 'ชื่อใน KrunameClass', 10, '00042')]
    const results = matchStudentsToSgs(krunameStudents, sgsCandidates)
    expect(results[0].status).toBe('MATCHED')
    expect(results[0].matchedSgsRowKey).toBe('row-0')
  })

  it('number + Thai full name together survive the full live-scan pipeline (no code on either side)', () => {
    const tableFacts = {
      tableIndex: 0,
      selectorFingerprint: 'table[0]',
      rows: [studentRow('1', '00001', 'สมชาย ใจดี'), studentRow('1', '00099', 'คนละคน'), studentRow('3', '00003', 'อีกคน')],
    }
    const candidate = evaluateStudentGridCandidate(tableFacts)!
    const sgsCandidates = extractSgsStudentCandidates(tableFacts, candidate.run, candidate.identifierColumns)

    const krunameStudents = [kn('k1', 1, 'สมชาย ใจดี', 7)]
    const results = matchStudentsToSgs(krunameStudents, sgsCandidates)
    expect(results[0].status).toBe('MATCHED')
    expect(results[0].matchedSgsRowKey).toBe('row-0')
  })

  it('a genuinely absent student is NOT_FOUND from a real (non-empty) live scan — never a false MATCHED just because SOME rows were extracted', () => {
    const tableFacts = {
      tableIndex: 0,
      selectorFingerprint: 'table[0]',
      rows: [studentRow('1', '00001', 'สมชาย ใจดี'), studentRow('2', '00002', 'สมหญิง ใจดี'), studentRow('3', '00003', 'อีกคน')],
    }
    const candidate = evaluateStudentGridCandidate(tableFacts)!
    const sgsCandidates = extractSgsStudentCandidates(tableFacts, candidate.run, candidate.identifierColumns)

    const krunameStudents = [kn('k1', 99, 'ไม่มีในหน้านี้', 5)]
    const results = matchStudentsToSgs(krunameStudents, sgsCandidates)
    expect(results[0].status).toBe('NOT_FOUND')
  })

  it('an empty scan (no grid found on the current page) never fabricates a MATCHED result — extractSgsStudentCandidates is simply never called, matchStudentsToSgs sees an empty candidate list', () => {
    // Mirrors extractCurrentSgsStudentCandidates()'s own `return []` when
    // no candidate exists yet — proves NOT_FOUND, never a stale/guessed
    // match, is what a genuinely empty live scan produces.
    const krunameStudents = [kn('k1', 1, 'เกศ ศรีคำฉิม', 8)]
    const results = matchStudentsToSgs(krunameStudents, [])
    expect(results[0].status).toBe('NOT_FOUND')
  })
})
