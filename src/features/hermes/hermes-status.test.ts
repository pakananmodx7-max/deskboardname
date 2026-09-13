import { describe, expect, it } from 'vitest'

import { HERMES_READ_TOOLS, HERMES_TOTAL_TOOL_COUNT, HERMES_WRITE_TOOLS } from '@/features/hermes/hermes-status'

describe('hermes-status — human-readable capability labels (C4)', () => {
  const allTools = [...HERMES_READ_TOOLS, ...HERMES_WRITE_TOOLS]

  it('every tool has a non-empty, non-technical label distinct from its raw name', () => {
    for (const tool of allTools) {
      expect(tool.label.length).toBeGreaterThan(0)
      expect(tool.label).not.toBe(tool.name)
      expect(tool.label).not.toContain('_')
    }
  })

  it('includes the exact human-readable capabilities named in the task (เช็กชื่อ, สร้างงาน, คัดลอกงาน)', () => {
    const labels = allTools.map((t) => t.label)
    expect(labels).toContain('เช็กชื่อ')
    expect(labels).toContain('สร้างงาน')
    expect(labels).toContain('คัดลอกงาน')
  })

  it('HERMES_TOTAL_TOOL_COUNT still matches the read+write counts (9 total)', () => {
    expect(HERMES_TOTAL_TOOL_COUNT).toBe(9)
    expect(allTools).toHaveLength(9)
  })
})
