import { describe, expect, it } from 'vitest'

import {
  ASPNET_PAGER_ID_SUFFIXES,
  ASPNET_PAGINATION_VALUE_SUFFIXES,
  buildPaginationDiagnosticReport,
  buildPaginationHintsFromInspection,
  classifyPaginationCandidate,
  computeSiblingPagerIds,
  evaluateRunResumption,
  findSgsNextPageControl,
  identifyPaginationControlSet,
  isConfidentEnoughToAutoClick,
  PAGINATION_ROLE,
  shouldAttemptPageAdvance,
  verifyPageAdvance,
} from '../src/lib/pagination-control.js'

function candidate(
  overrides: Partial<{
    tag: string
    id: string | null
    name: string | null
    type: string | null
    text: string
    onclick: string | null
    href: string | null
    disabled: boolean
    domOrder: number
  }> = {},
) {
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
  it('an id containing "next" (but not ending with the confirmed "NextPage" suffix) is NEXT at low confidence', () => {
    const result = classifyPaginationCandidate(candidate({ id: 'ctl00_PageContent_lnkNext', text: '' }))
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

describe('classifyPaginationCandidate — FINAL PAGINATION FIX: the CONFIRMED ASP.NET pager id suffix (highest confidence, checked before even __doPostBack)', () => {
  it('the live-confirmed FirstPage/PreviousPage ids are classified at high confidence', () => {
    expect(classifyPaginationCandidate(candidate({ id: 'ctl00_PageContent_TblTranscriptsPagination__FirstPage' }))).toEqual({
      role: PAGINATION_ROLE.FIRST,
      confidence: 'high',
      reason: expect.stringContaining('FirstPage'),
    })
    expect(classifyPaginationCandidate(candidate({ id: 'ctl00_PageContent_TblTranscriptsPagination__PreviousPage' }))).toEqual({
      role: PAGINATION_ROLE.PREV,
      confidence: 'high',
      reason: expect.stringContaining('PreviousPage'),
    })
  })

  it('the SAME namespace\'s NextPage/LastPage ids are ALSO classified at high confidence', () => {
    expect(classifyPaginationCandidate(candidate({ id: 'ctl00_PageContent_TblTranscriptsPagination__NextPage' })).role).toBe(PAGINATION_ROLE.NEXT)
    expect(classifyPaginationCandidate(candidate({ id: 'ctl00_PageContent_TblTranscriptsPagination__NextPage' })).confidence).toBe('high')
    expect(classifyPaginationCandidate(candidate({ id: 'ctl00_PageContent_TblTranscriptsPagination__LastPage' })).role).toBe(PAGINATION_ROLE.LAST)
  })

  it('the suffix match is case-insensitive but still requires the id to actually END with it', () => {
    expect(classifyPaginationCandidate(candidate({ id: 'ctl00_nextpage' })).confidence).toBe('high')
    expect(classifyPaginationCandidate(candidate({ id: 'ctl00_NextPageWrapper' })).confidence).not.toBe('high')
  })

  it('wins over the weaker glyph/id-substring rules even when a candidate also has a plain ">" label', () => {
    const result = classifyPaginationCandidate(candidate({ id: 'ctl00_PageContent_TblTranscriptsPagination__NextPage', text: '>' }))
    expect(result.confidence).toBe('high')
  })
})

describe('computeSiblingPagerIds — "search the same DOM namespace": deriving First/Previous/Next/Last/CurrentPage/PageSize from any ONE confirmed id', () => {
  it('derives all six ids from the live-confirmed FirstPage id', () => {
    expect(computeSiblingPagerIds('ctl00_PageContent_TblTranscriptsPagination__FirstPage')).toEqual({
      first: 'ctl00_PageContent_TblTranscriptsPagination__FirstPage',
      previous: 'ctl00_PageContent_TblTranscriptsPagination__PreviousPage',
      next: 'ctl00_PageContent_TblTranscriptsPagination__NextPage',
      last: 'ctl00_PageContent_TblTranscriptsPagination__LastPage',
      currentPage: 'ctl00_PageContent_TblTranscriptsPagination__CurrentPage',
      pageSize: 'ctl00_PageContent_TblTranscriptsPagination__PageSize',
    })
  })

  it('LIVE DOM EVIDENCE: derives the same six ids starting from the CONFIRMED CurrentPage or PageSize id', () => {
    const fromCurrentPage = computeSiblingPagerIds('ctl00_PageContent_TblTranscriptsPagination__CurrentPage')
    const fromPageSize = computeSiblingPagerIds('ctl00_PageContent_TblTranscriptsPagination__PageSize')
    const fromFirst = computeSiblingPagerIds('ctl00_PageContent_TblTranscriptsPagination__FirstPage')
    expect(fromCurrentPage).toEqual(fromFirst)
    expect(fromPageSize).toEqual(fromFirst)
  })

  it('derives the same six ids starting from ANY one of the four click-role suffixes', () => {
    const fromNext = computeSiblingPagerIds('ctl00_PageContent_TblTranscriptsPagination__NextPage')
    const fromLast = computeSiblingPagerIds('ctl00_PageContent_TblTranscriptsPagination__LastPage')
    expect(fromNext).toEqual(fromLast)
  })

  it('returns null for an id that does not end with any known suffix — never a guessed prefix', () => {
    expect(computeSiblingPagerIds('ctl00_PageContent_someUnrelatedButton')).toBeNull()
    expect(computeSiblingPagerIds(null)).toBeNull()
    expect(computeSiblingPagerIds('')).toBeNull()
  })

  it('ASPNET_PAGER_ID_SUFFIXES exposes the exact four confirmed click-role suffix strings', () => {
    expect(ASPNET_PAGER_ID_SUFFIXES).toEqual({ FIRST: 'FirstPage', PREV: 'PreviousPage', NEXT: 'NextPage', LAST: 'LastPage' })
  })

  it('ASPNET_PAGINATION_VALUE_SUFFIXES exposes the two live-confirmed value suffix strings', () => {
    expect(ASPNET_PAGINATION_VALUE_SUFFIXES).toEqual({ CURRENT_PAGE: 'CurrentPage', PAGE_SIZE: 'PageSize' })
  })
})

describe('identifyPaginationControlSet — classifies ALL four roles at once (first/previous/next/last), for the live diagnostic report', () => {
  it('finds all four from their confirmed id suffixes', () => {
    const candidates = [
      candidate({ id: 'ns__FirstPage' }),
      candidate({ id: 'ns__PreviousPage' }),
      candidate({ id: 'ns__NextPage' }),
      candidate({ id: 'ns__LastPage' }),
    ]
    const result = identifyPaginationControlSet(candidates)
    expect(result.first?.control.id).toBe('ns__FirstPage')
    expect(result.previous?.control.id).toBe('ns__PreviousPage')
    expect(result.next?.control.id).toBe('ns__NextPage')
    expect(result.last?.control.id).toBe('ns__LastPage')
    expect(result.next?.confidence).toBe('high')
  })

  it('a missing role is reported as null, never guessed from the others', () => {
    const result = identifyPaginationControlSet([candidate({ id: 'ns__NextPage' })])
    expect(result.next).not.toBeNull()
    expect(result.first).toBeNull()
    expect(result.previous).toBeNull()
    expect(result.last).toBeNull()
  })

  it('never returns a disabled control for any role', () => {
    const result = identifyPaginationControlSet([candidate({ id: 'ns__NextPage', disabled: true })])
    expect(result.next).toBeNull()
  })

  it('an empty candidate list reports every role as null', () => {
    expect(identifyPaginationControlSet([])).toEqual({ first: null, previous: null, next: null, last: null })
  })
})

describe('identifyPaginationControlSet — item 6\'s DOM-ORDER FALLBACK: an anonymous image button with no meaningful id, classified by position relative to CurrentPage', () => {
  // [first] [previous] [CurrentPage] [next] [last] — none carry a
  // recognizable id/glyph/postback, only their position around the
  // confirmed CurrentPage control (domOrder: 2).
  function anonymousCluster() {
    return [
      candidate({ tag: 'img', id: null, domOrder: 0 }),
      candidate({ tag: 'img', id: null, domOrder: 1 }),
      candidate({ tag: 'input', type: 'text', id: 'ns__CurrentPage', domOrder: 2 }),
      candidate({ tag: 'img', id: null, domOrder: 3 }),
      candidate({ tag: 'img', id: null, domOrder: 4 }),
    ]
  }

  it('classifies previous/first (before) and next/last (after) purely by DOM order, at low confidence', () => {
    const result = identifyPaginationControlSet(anonymousCluster(), 2)
    expect(result.previous?.control.domOrder).toBe(1)
    expect(result.first?.control.domOrder).toBe(0)
    expect(result.next?.control.domOrder).toBe(3)
    expect(result.last?.control.domOrder).toBe(4)
    expect(result.previous?.confidence).toBe('low')
    expect(result.next?.confidence).toBe('low')
  })

  it('never overwrites a role an exact rule already matched', () => {
    const candidates = [
      ...anonymousCluster(),
      candidate({ tag: 'a', id: 'ns__NextPage', domOrder: 5 }),
    ]
    const result = identifyPaginationControlSet(candidates, 2)
    expect(result.next?.control.id).toBe('ns__NextPage')
    expect(result.next?.confidence).toBe('high')
  })

  it('is never applied when currentPageDomOrder is omitted — existing callers keep their exact prior behavior', () => {
    const result = identifyPaginationControlSet(anonymousCluster())
    expect(result).toEqual({ first: null, previous: null, next: null, last: null })
  })

  it('never picks a disabled control via the fallback either', () => {
    const candidates = [
      candidate({ tag: 'img', id: null, domOrder: 1, disabled: true }),
      candidate({ tag: 'input', type: 'text', id: 'ns__CurrentPage', domOrder: 2 }),
    ]
    const result = identifyPaginationControlSet(candidates, 2)
    expect(result.previous).toBeNull()
  })
})

describe('findSgsNextPageControl — item 6\'s DOM-order fallback also applies to the real Next-finding used by auto-run itself', () => {
  it('finds Next via DOM order when currentPageDomOrder is given and nothing else classifies it', () => {
    const candidates = [
      candidate({ tag: 'input', type: 'text', id: 'ns__CurrentPage', domOrder: 0 }),
      candidate({ tag: 'img', id: null, domOrder: 1 }),
    ]
    const result = findSgsNextPageControl(candidates, 0)
    expect(result.control?.domOrder).toBe(1)
    expect(result.confidence).toBe('low')
  })

  it('without currentPageDomOrder, behaves exactly as before (no fallback)', () => {
    const candidates = [
      candidate({ tag: 'input', type: 'text', id: 'ns__CurrentPage' }),
      candidate({ tag: 'img', id: null }),
    ]
    const result = findSgsNextPageControl(candidates)
    expect(result.control).toBeNull()
    expect(result.confidence).toBe('none')
  })
})

describe('buildPaginationHintsFromInspection — turns inspectPaginationControls\' raw result into detectPagination\'s expected hints shape', () => {
  it('item 5\'s exact live example: current page 1, "ของ 4", 32 records, page size 10', () => {
    const inspection = { found: true, currentPageValue: '1', totalPagesText: '4', totalRowsText: '32', pageSizeValue: '10', candidates: [] }
    expect(buildPaginationHintsFromInspection(inspection)).toEqual({ currentPage: 1, totalPages: 4, totalStudentRows: 32, pageSize: 10 })
  })

  it('LIVE DOM EVIDENCE regression fixture: ctl00_PageContent_TblTranscriptsPagination__CurrentPage (value "1") and ...__PageSize (value "10"), plus the shared container\'s own "ของ 4" / "32 รายการ" / "/หน้า" text — exactly what inspectPaginationControls reports for this confirmed real layout', () => {
    // This mirrors inspectPaginationControls' actual return shape once it
    // has read ...__CurrentPage.value === '1' and ...__PageSize.value ===
    // '10' directly by id, and found "ของ 4"/"32 รายการ" in their shared
    // container's own text — never a single combined "1/4" string.
    const inspection = {
      found: true,
      totalPagesText: '4',
      totalRowsText: '32',
      currentPageValue: '1',
      pageSizeValue: '10',
      currentPageDomOrder: 2,
      candidates: [
        { tag: 'input', id: 'ctl00_PageContent_TblTranscriptsPagination__CurrentPage', type: 'text', value: '1', disabled: false, domOrder: 2 },
        { tag: 'input', id: 'ctl00_PageContent_TblTranscriptsPagination__PageSize', type: 'text', value: '10', disabled: false, domOrder: 6 },
      ],
    }
    expect(buildPaginationHintsFromInspection(inspection)).toEqual({
      currentPage: 1,
      totalPages: 4,
      totalStudentRows: 32,
      pageSize: 10,
    })
  })

  it('pages 2, 3, and 4 of 4 — only the current-page value differs', () => {
    for (const page of [2, 3, 4]) {
      const inspection = { found: true, currentPageValue: String(page), totalPagesText: '4', totalRowsText: '32', pageSizeValue: '10', candidates: [] }
      expect(buildPaginationHintsFromInspection(inspection).currentPage).toBe(page)
    }
  })

  it('every field is null when nothing was found at all', () => {
    expect(buildPaginationHintsFromInspection({ found: false, currentPageValue: null, totalPagesText: null, totalRowsText: null, pageSizeValue: null, candidates: [] })).toEqual({
      currentPage: null,
      totalPages: null,
      totalStudentRows: null,
      pageSize: null,
    })
  })

  it('handles a null/undefined inspection honestly, never throwing', () => {
    expect(buildPaginationHintsFromInspection(null)).toEqual({ currentPage: null, totalPages: null, totalStudentRows: null, pageSize: null })
    expect(buildPaginationHintsFromInspection(undefined)).toEqual({ currentPage: null, totalPages: null, totalStudentRows: null, pageSize: null })
  })

  it('an empty-string value (an ambiguous/ untyped current-page box) is treated as unknown, never coerced to 0', () => {
    const inspection = { found: true, currentPageValue: '', totalPagesText: '4', totalRowsText: '32', pageSizeValue: '10', candidates: [] }
    expect(buildPaginationHintsFromInspection(inspection).currentPage).toBeNull()
  })
})

describe('buildPaginationDiagnosticReport — the exact shape "ตรวจปุ่มเปลี่ยนหน้า SGS" renders', () => {
  it('reports currentPage/totalPages/totalRows/pageSize plus each control\'s id', () => {
    const inspection = {
      found: true,
      currentPageValue: '1',
      totalPagesText: '4',
      totalRowsText: '32',
      pageSizeValue: '10',
      candidates: [
        candidate({ id: 'ns__FirstPage' }),
        candidate({ id: 'ns__PreviousPage' }),
        candidate({ id: 'ns__NextPage' }),
        candidate({ id: 'ns__LastPage' }),
      ],
    }
    expect(buildPaginationDiagnosticReport(inspection)).toEqual({
      currentPage: 1,
      totalPages: 4,
      totalRows: 32,
      pageSize: 10,
      controls: { first: 'ns__FirstPage', previous: 'ns__PreviousPage', next: 'ns__NextPage', last: 'ns__LastPage' },
    })
  })

  it('a control with no id is described by tag/text instead of a null id', () => {
    const inspection = {
      found: true,
      currentPageValue: '1',
      totalPagesText: '4',
      totalRowsText: null,
      pageSizeValue: null,
      candidates: [candidate({ id: null, tag: 'a', text: '>' })],
    }
    const report = buildPaginationDiagnosticReport(inspection)
    expect(report.controls.next).toContain('>')
    expect(report.controls.first).toBeNull()
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
