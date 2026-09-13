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
    expect(source).toContain('ไม่สามารถรายงานสถานะ Agent, Telegram หรือ MCP bridge แบบเรียลไทม์ได้')
  })

  it('collapses the honesty statement into one sentence rather than repeating it per row (C4)', () => {
    const occurrences = (source.match(/ไม่สามารถรายงานสถานะ/g) ?? []).length
    expect(occurrences).toBe(1)
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

  it('leads every capability row with its plain-language label, never the raw MCP tool identifier (C4)', () => {
    expect(source).toContain('<p className="font-medium">{tool.label}</p>')
  })

  it('tucks the raw tool identifiers behind a collapsed technical disclosure, not the main capability list', () => {
    expect(source).toContain('<Disclosure summary="รายละเอียดทางเทคนิค (ชื่อเครื่องมือ MCP)">')
  })

  it('groups capabilities in plain language — "ตอบได้" (read) vs "ทำแทนได้" (write) — not just "read/write tools"', () => {
    expect(source).toContain('สิ่งที่ Hermes ตอบได้')
    expect(source).toContain('สิ่งที่ Hermes ทำแทนได้')
  })

  it('no longer shows the quick-links card — it only repeated destinations already permanent in the sidebar', () => {
    expect(source).not.toContain('ทางลัด')
    expect(source).not.toContain('/teacher/classroom-management"')
  })

  it('never adds a Telegram link/URL — none exists in this codebase, so the launch action stays omitted, not hardcoded', () => {
    expect(source).not.toMatch(/https?:\/\/t\.me|telegram\.me|เปิด Telegram/i)
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
