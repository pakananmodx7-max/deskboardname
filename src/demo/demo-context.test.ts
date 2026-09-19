import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

function readSource(): string {
  return readFileSync(new URL('./demo-context.tsx', import.meta.url), 'utf-8')
}

// ==================================================
// addSubjectAssignment / addLesson — id collision fix. Both are now
// called in a tight synchronous loop (once per selected classroom) by
// the "ห้องที่ใช้"/"เผยแพร่ไปยังห้อง" cross-classroom pickers
// (demo-subjects/assignment-dialog.tsx, demo-subjects/tabs/lessons-tab.tsx).
// Two calls within the same millisecond previously generated the exact
// same `demo-subject-assignment-${Date.now()}` / `demo-lesson-${Date.now()}`
// id, which would have silently merged two independent rows under one
// id. Source-text guard, the same convention every other file in this
// codebase uses since vitest.config.ts runs in a `node` environment
// with no DOM.
// ==================================================

describe('addSubjectAssignment — id is collision-safe across rapid, same-tick calls', () => {
  const source = readSource()
  const fnBody = source.slice(
    source.indexOf('function addSubjectAssignment('),
    source.indexOf('\n  }\n', source.indexOf('function addSubjectAssignment(')),
  )

  it('the id is never Date.now() alone — a random component is always appended', () => {
    expect(fnBody).toMatch(/id: `demo-subject-assignment-\$\{Date\.now\(\)\}-\$\{crypto\.randomUUID\(\)\}`/)
  })
})

describe('addLesson — id is collision-safe across rapid, same-tick calls', () => {
  const source = readSource()
  const fnBody = source.slice(
    source.indexOf('function addLesson('),
    source.indexOf('\n  }\n', source.indexOf('function addLesson(')),
  )

  it('the id is never Date.now() alone — a random component is always appended', () => {
    expect(fnBody).toMatch(/id: `demo-lesson-\$\{Date\.now\(\)\}-\$\{crypto\.randomUUID\(\)\}`/)
  })
})
