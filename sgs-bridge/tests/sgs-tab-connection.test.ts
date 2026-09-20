import { describe, expect, it } from 'vitest'

import { orderCandidatesByPreferredTabId, SGS_TAB_URL_MATCH_PATTERN } from '../src/lib/sgs-tab-connection'

describe('SGS_TAB_URL_MATCH_PATTERN — the ONE pattern resolveConnectedSgsTab, background.js\'s host_permissions, and manifest.json\'s content_scripts entry all share', () => {
  it('is the real SGS transcripts host, scoped to /sgs/ — never a bare origin, never <all_urls>', () => {
    expect(SGS_TAB_URL_MATCH_PATTERN).toBe('https://sgs.bopp-obec.info/sgs/*')
  })
})

describe('orderCandidatesByPreferredTabId — item 6\'s exact live regression, as a pure/testable unit', () => {
  it('LIVE REGRESSION: diagnostic confirmed CONNECTED/tabId=2121095410 — that exact tabId is moved to the front, regardless of where chrome.tabs.query happened to place it, or how many OTHER tabs/windows exist', () => {
    const candidates = [
      { id: 555, url: 'https://sgs.bopp-obec.info/sgs/SomeOtherPage.aspx' },
      { id: 2121095410, url: 'https://sgs.bopp-obec.info/sgs/TblTranscripts/Edit-TblTranscripts-Table.aspx' },
      { id: 777, url: 'https://sgs.bopp-obec.info/sgs/YetAnother.aspx' },
    ]
    const ordered = orderCandidatesByPreferredTabId(candidates, 2121095410)
    expect(ordered[0].id).toBe(2121095410)
    expect(ordered.map((t) => t.id).sort()).toEqual([555, 777, 2121095410].sort())
  })

  it('is a no-op (original search order preserved) when no preferred tab is given at all', () => {
    const candidates = [{ id: 1 }, { id: 2 }, { id: 3 }]
    expect(orderCandidatesByPreferredTabId(candidates, null)).toEqual(candidates)
    expect(orderCandidatesByPreferredTabId(candidates, undefined)).toEqual(candidates)
  })

  it('never inserts a fake entry for a preferredTabId that isn\'t actually among the candidates — the exact same candidates come back, just not reordered', () => {
    const candidates = [{ id: 1 }, { id: 2 }]
    const ordered = orderCandidatesByPreferredTabId(candidates, 999)
    expect(ordered).toEqual(candidates)
    expect(ordered.length).toBe(2)
  })

  it('never drops or duplicates a candidate — the returned list is always the same length as the input', () => {
    const candidates = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }]
    const ordered = orderCandidatesByPreferredTabId(candidates, 3)
    expect(ordered.length).toBe(candidates.length)
    expect(new Set(ordered.map((t) => t.id))).toEqual(new Set(candidates.map((t) => t.id)))
  })
})
