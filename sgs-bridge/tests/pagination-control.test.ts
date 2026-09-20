import { describe, expect, it } from 'vitest'

import {
  classifyPaginationCandidate,
  evaluateRunResumption,
  findSgsNextPageControl,
  isConfidentEnoughToAutoClick,
  PAGINATION_ROLE,
  shouldAttemptPageAdvance,
  verifyPageAdvance,
} from '../src/lib/pagination-control.js'

function candidate(overrides: Partial<{ tag: string; id: string | null; name: string | null; type: string | null; text: string; onclick: string | null; href: string | null; disabled: boolean }> = {}) {
  return { tag: 'a', id: null, name: null, type: null, text: '', onclick: null, href: null, disabled: false, ...overrides }
}

describe('classifyPaginationCandidate — ASP.NET __doPostBack convention (highest confidence)', () => {
  it('recognizes Page$Next via onclick', () => {
    const result = classifyPaginationCandidate(candidate({ onclick: "javascript:__doPostBack('ctl00$Grid','Page$Next')" }))
    expect(result).toEqual({ role: PAGINATION_ROLE.NEXT, confidence: 'high', reason: expect.stringContaining('page') })
  })

  it('recognizes Page$Next via href', () => {
    const result = classifyPaginationCandidate(candidate({ href: "javascript:__doPostBack('ctl00$Grid','Page$Next')" }))
    expect(result.role).toBe(PAGINATION_ROLE.NEXT)
    expect(result.confidence).toBe('high')
  })

  it('recognizes Page$Last distinctly from Page$Next', () => {
    const result = classifyPaginationCandidate(candidate({ onclick: "__doPostBack('ctl00$Grid','Page$Last')" }))
    expect(result.role).toBe(PAGINATION_ROLE.LAST)
  })

  it('recognizes Page$Prev and Page$First', () => {
    expect(classifyPaginationCandidate(candidate({ onclick: "__doPostBack('x','Page$Prev')" })).role).toBe(PAGINATION_ROLE.PREV)
    expect(classifyPaginationCandidate(candidate({ onclick: "__doPostBack('x','Page$First')" })).role).toBe(PAGINATION_ROLE.FIRST)
  })
})

describe('classifyPaginationCandidate — exact glyph match (medium confidence)', () => {
  it('a lone ">" is NEXT, never confused with ">>"', () => {
    expect(classifyPaginationCandidate(candidate({ text: '>' }))).toEqual({ role: PAGINATION_ROLE.NEXT, confidence: 'medium', reason: expect.any(String) })
  })

  it('">>" is LAST, never misread as NEXT', () => {
    expect(classifyPaginationCandidate(candidate({ text: '>>' })).role).toBe(PAGINATION_ROLE.LAST)
  })

  it('"<" is PREV and "<<" is FIRST', () => {
    expect(classifyPaginationCandidate(candidate({ text: '<' })).role).toBe(PAGINATION_ROLE.PREV)
    expect(classifyPaginationCandidate(candidate({ text: '<<' })).role).toBe(PAGINATION_ROLE.FIRST)
  })

  it('a longer label merely containing ">" is NOT glyph-matched (falls through to id/name or UNKNOWN)', () => {
    const result = classifyPaginationCandidate(candidate({ text: 'หน้าถัดไป >' }))
    expect(result.confidence).not.toBe('medium')
  })
})

describe('classifyPaginationCandidate — id/name substring (low confidence)', () => {
  it('an id containing "next" (but not "last") is NEXT at low confidence', () => {
    const result = classifyPaginationCandidate(candidate({ id: 'ctl00_PageContent_btnNextPage', text: '' }))
    expect(result).toEqual({ role: PAGINATION_ROLE.NEXT, confidence: 'low', reason: expect.any(String) })
  })

  it('an id containing "last" is LAST, never NEXT, even though it might also loosely resemble "next" phrasing', () => {
    const result = classifyPaginationCandidate(candidate({ id: 'ctl00_PageContent_btnLastPage' }))
    expect(result.role).toBe(PAGINATION_ROLE.LAST)
  })

  it('no match at all is UNKNOWN with confidence none', () => {
    const result = classifyPaginationCandidate(candidate({ text: 'ของ', id: 'someLabel' }))
    expect(result).toEqual({ role: PAGINATION_ROLE.UNKNOWN, confidence: 'none', reason: expect.any(String) })
  })
})

describe('findSgsNextPageControl — the real "<< < 1 ของ 4 > >>" cluster', () => {
  it('picks the ">" control as Next, never the ">>" Last control', () => {
    const candidates = [
      candidate({ id: 'first', text: '<<' }),
      candidate({ id: 'prev', text: '<' }),
      candidate({ id: 'current', text: '1', tag: 'span' }),
      candidate({ id: 'next', text: '>' }),
      candidate({ id: 'last', text: '>>' }),
    ]
    const result = findSgsNextPageControl(candidates)
    expect(result.control?.id).toBe('next')
    expect(result.confidence).toBe('medium')
  })

  it('prefers the high-confidence __doPostBack Page$Next match over a lower-confidence glyph match if both somehow appear', () => {
    const candidates = [
      candidate({ id: 'weak-next', text: '>' }),
      candidate({ id: 'strong-next', text: 'ถัดไป', onclick: "__doPostBack('x','Page$Next')" }),
    ]
    const result = findSgsNextPageControl(candidates)
    expect(result.control?.id).toBe('strong-next')
    expect(result.confidence).toBe('high')
  })

  it('never returns a disabled control (already on the last page)', () => {
    const candidates = [candidate({ id: 'next', text: '>', disabled: true })]
    const result = findSgsNextPageControl(candidates)
    expect(result.control).toBeNull()
    expect(result.confidence).toBe('none')
  })

  it('returns null/none when nothing in the candidate list looks like Next at all', () => {
    const candidates = [candidate({ id: 'unrelated-link', text: 'ออกจากระบบ' })]
    const result = findSgsNextPageControl(candidates)
    expect(result.control).toBeNull()
    expect(result.confidence).toBe('none')
  })
})

describe('isConfidentEnoughToAutoClick', () => {
  it('true only for high/medium, false for low/none — never forces automatic action on a weak finding', () => {
    expect(isConfidentEnoughToAutoClick('high')).toBe(true)
    expect(isConfidentEnoughToAutoClick('medium')).toBe(true)
    expect(isConfidentEnoughToAutoClick('low')).toBe(false)
    expect(isConfidentEnoughToAutoClick('none')).toBe(false)
  })
})

describe('shouldAttemptPageAdvance — item 7: never advances past the final page', () => {
  it('true when currentPage < totalPages', () => {
    expect(shouldAttemptPageAdvance({ detected: true, currentPage: 1, totalPages: 4, visibleStudentRows: 10, totalStudentRows: 32 })).toBe(true)
    expect(shouldAttemptPageAdvance({ detected: true, currentPage: 3, totalPages: 4, visibleStudentRows: 10, totalStudentRows: 32 })).toBe(true)
  })

  it('false once currentPage === totalPages (the final page)', () => {
    expect(shouldAttemptPageAdvance({ detected: true, currentPage: 4, totalPages: 4, visibleStudentRows: 2, totalStudentRows: 32 })).toBe(false)
  })

  it('false when pagination was never detected, or fields are missing', () => {
    expect(shouldAttemptPageAdvance({ detected: false, currentPage: null, totalPages: null, visibleStudentRows: 10, totalStudentRows: null })).toBe(false)
    expect(shouldAttemptPageAdvance(null)).toBe(false)
  })
})

describe('verifyPageAdvance — item 3: ALL conditions must hold before treating a click as a real advance', () => {
  function okInput() {
    return { expectedNextPage: 2, actualPage: 2, beforeFingerprint: 'page1-fingerprint', afterFingerprint: 'page2-fingerprint', columnStillFound: true, subjectOk: true, classroomOk: true }
  }

  it('page 1 -> 2: confirmed when everything matches', () => {
    expect(verifyPageAdvance(okInput())).toEqual({ ok: true, reason: null, kind: 'confirmed' })
  })

  it('page 2 -> 3 and page 3 -> 4: the same rule generalizes to any page pair', () => {
    expect(verifyPageAdvance({ ...okInput(), expectedNextPage: 3, actualPage: 3, beforeFingerprint: 'p2', afterFingerprint: 'p3' }).ok).toBe(true)
    expect(verifyPageAdvance({ ...okInput(), expectedNextPage: 4, actualPage: 4, beforeFingerprint: 'p3', afterFingerprint: 'p4' }).ok).toBe(true)
  })

  it('current page must equal expectedNextPage exactly — off by one is not confirmed', () => {
    const result = verifyPageAdvance({ ...okInput(), actualPage: 3 })
    expect(result.ok).toBe(false)
    expect(result.kind).toBe('advance_unconfirmed')
  })

  it('the grid must actually change before writing again — an unchanged fingerprint is never confirmed, even if the page number looks right', () => {
    const result = verifyPageAdvance({ ...okInput(), afterFingerprint: 'page1-fingerprint' })
    expect(result.ok).toBe(false)
    expect(result.kind).toBe('advance_unconfirmed')
  })

  it('a wrong subject after reload is a CONTEXT mismatch (not just "unconfirmed") — a real safety concern', () => {
    const result = verifyPageAdvance({ ...okInput(), subjectOk: false })
    expect(result.ok).toBe(false)
    expect(result.kind).toBe('context_mismatch')
  })

  it('a wrong classroom after reload is also a CONTEXT mismatch', () => {
    const result = verifyPageAdvance({ ...okInput(), classroomOk: false })
    expect(result.ok).toBe(false)
    expect(result.kind).toBe('context_mismatch')
  })

  it('the confirmed column must still be found on the new page', () => {
    const result = verifyPageAdvance({ ...okInput(), columnStillFound: false })
    expect(result.ok).toBe(false)
    expect(result.kind).toBe('advance_unconfirmed')
  })
})

describe('evaluateRunResumption — item 4/5: restoring an active run after a popup reopen/page reload', () => {
  function storedState() {
    return { active: true, expectedNextPage: 2, targetColumnKey: 'real-ช่อง-10-3' }
  }

  it('resumes when the fresh scan matches exactly what was expected', () => {
    const result = evaluateRunResumption(storedState(), { gridFound: true, currentPage: 2, columnKey: 'real-ช่อง-10-3' })
    expect(result).toEqual({ shouldResume: true, reason: null })
  })

  it('does not resume when there is no stored active run', () => {
    expect(evaluateRunResumption(null, { gridFound: true, currentPage: 2, columnKey: 'real-ช่อง-10-3' }).shouldResume).toBe(false)
    expect(evaluateRunResumption({ active: false, expectedNextPage: 2, targetColumnKey: 'x' }, { gridFound: true, currentPage: 2, columnKey: 'x' }).shouldResume).toBe(false)
  })

  it('does not resume when no grid is found on the reopened page', () => {
    const result = evaluateRunResumption(storedState(), { gridFound: false, currentPage: null, columnKey: null })
    expect(result.shouldResume).toBe(false)
  })

  it('does not resume when the current page does not match the expected page — popup closing/reopening never silently skips or repeats a page', () => {
    const result = evaluateRunResumption(storedState(), { gridFound: true, currentPage: 3, columnKey: 'real-ช่อง-10-3' })
    expect(result.shouldResume).toBe(false)
    expect(result.reason).toContain('3')
  })

  it('does not resume when the confirmed column can no longer be found', () => {
    const result = evaluateRunResumption(storedState(), { gridFound: true, currentPage: 2, columnKey: 'a-different-column' })
    expect(result.shouldResume).toBe(false)
  })
})
