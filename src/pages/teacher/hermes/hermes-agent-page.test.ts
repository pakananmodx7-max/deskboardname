import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

function readSource(): string {
  return readFileSync(new URL('./hermes-agent-page.tsx', import.meta.url), 'utf-8')
}

/** Strips block/line comments so assertions about the actual CODE aren't
 * tripped up by doc comments discussing the very thing being avoided. */
function stripComments(content: string): string {
  return content.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

describe('HermesAgentPage — Agent Control Center (Requirement 5)', () => {
  const rawSource = readSource()
  const source = stripComments(rawSource)

  it('is not a competing LLM chatbot — no chat input, message list, or LLM call', () => {
    expect(source).not.toMatch(/<Input|<form|handleSubmit|onSubmit/)
  })

  it('never claims a live Online/Offline connection status', () => {
    expect(source).not.toMatch(/Online|Offline|เชื่อมต่อแล้ว|กำลังทำงานอยู่/)
    expect(source).toContain('ไม่สามารถตรวจสอบได้จากหน้านี้')
  })

  it('lists the real, static tool set shared with the Home page summary — not invented tool names', () => {
    expect(source).toContain('HERMES_READ_TOOLS')
    expect(source).toContain('HERMES_WRITE_TOOLS')
  })

  it('never fabricates a Hermes-specific activity feed (Requirement 8)', () => {
    expect(source).not.toContain('getRecentActivity()')
    expect(source).not.toMatch(/<RecentActivityCard|<RecentActivity\b/)
    expect(source).toContain('ไม่มีข้อมูลกิจกรรมที่ยืนยันได้ว่ามาจาก Hermes')
  })

  it('never renders an actual secret value — only the static safety statement that none is shown', () => {
    // The one legitimate mention of "API key"/"token"/"password" is the
    // safety card's own disclaimer that none of these is ever shown —
    // this checks no OTHER line mentions them (e.g. an accidentally
    // hardcoded credential or env var read).
    const linesMentioningSecrets = source
      .split('\n')
      .filter((line) => /api[_-]?key|token|password|secret/i.test(line))
    expect(linesMentioningSecrets).toHaveLength(1)
    expect(linesMentioningSecrets[0]).toContain('ไม่แสดงและไม่จัดเก็บ')
    expect(source).not.toMatch(/import\.meta\.env|process\.env/)
  })
})
