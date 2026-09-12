import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

function readSource(): string {
  return readFileSync(new URL('./classroom-detail-page-demo.tsx', import.meta.url), 'utf-8')
}

describe('ClassroomDetailPageDemo — Classroom Workspace tabs (demo mirror)', () => {
  const source = readSource()

  it('has exactly these 5 tabs, in this order', () => {
    const labels = [...source.matchAll(/label:\s*'([^']+)'/g)].map((m) => m[1])
    expect(labels).toEqual(['ภาพรวม', 'นักเรียน', 'งานและการบ้าน', 'เช็กชื่อ', 'คะแนนและการประเมิน'])
  })

  it('reuses the demo-subjects tab components rather than duplicating logic', () => {
    expect(source).toContain("from '@/features/demo-subjects/tabs/assignments-tab'")
    expect(source).toContain("from '@/features/demo-subjects/tabs/attendance-tab'")
    expect(source).toContain("from '@/features/demo-subjects/tabs/grades-tab'")
  })

  it('derives linked subjects from demo-context state (subjects.classroomIds), never a new data source', () => {
    expect(source).toContain('subjects.filter')
    expect(source).toContain('classroomIds.includes')
  })
})
