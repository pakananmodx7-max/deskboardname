import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

function readSource(): string {
  return readFileSync(new URL('./hermes-summary-card.tsx', import.meta.url), 'utf-8')
}

describe('HermesSummaryCard — honest status only (Requirement 8: never fabricate)', () => {
  const source = readSource()

  it('never claims a live Online/Offline/Connected status in its rendered JSX', () => {
    const jsxOnly = source.slice(source.indexOf('return ('))
    expect(jsxOnly).not.toMatch(/Online|Offline|เชื่อมต่อแล้ว|กำลังทำงาน/)
  })

  it('links to the full Hermes Agent page', () => {
    expect(source).toContain('to="/teacher/hermes"')
  })

  it('shows only the fixed, known tool count, not a fabricated activity feed', () => {
    expect(source).toContain('HERMES_TOTAL_TOOL_COUNT')
  })

  it('shows human-readable capability labels, never a raw MCP tool identifier', () => {
    expect(source).toContain('เช็กชื่อ')
    expect(source).not.toMatch(/mark_attendance_bulk|create_assignment|copy_assignment_to_classrooms/)
  })

  it('never invents a Telegram launch link — states plainly that none is configured', () => {
    expect(source).toContain('ยังไม่ได้ตั้งค่าลิงก์ Telegram')
    expect(source).not.toMatch(/https?:\/\/t\.me/)
  })
})
