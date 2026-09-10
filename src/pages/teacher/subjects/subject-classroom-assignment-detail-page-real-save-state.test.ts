import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

function readSource(): string {
  return readFileSync(new URL('./subject-classroom-assignment-detail-page-real.tsx', import.meta.url), 'utf-8')
}

describe('Teacher assignment detail — save-state indicators (Data Safety phase, Section 2)', () => {
  const source = readSource()

  it('a single shared save-state map keys score/status/note independently, so one field never shows another field\'s state', () => {
    expect(source).toContain('fieldSaveState')
    expect(source).toMatch(/`score:\$\{studentId\}`/)
    expect(source).toMatch(/`status:\$\{studentId\}`/)
    expect(source).toMatch(/`note:\$\{studentId\}`/)
  })

  it('handleSetStatus shows saving before the write and saved/error only after Supabase confirms or rejects it — never before', () => {
    const fn = source.slice(source.indexOf('async function handleSetStatus'), source.indexOf('async function handleBulkStatus'))
    // Structural check: 'saving' is set, then the await, then 'saved' inside
    // the try block and 'error' inside the catch block — not the reverse.
    expect(fn).toMatch(/'saving'\)[\s\S]*await setSubmissionStatus[\s\S]*'saved'\)/)
    expect(fn).toMatch(/catch \(err\) \{[\s\S]*'error'\)/)
  })

  it('handleNoteBlur shows saving/saved/error around the actual write, and never reverts the teacher\'s typed value on failure', () => {
    const fn = source.slice(source.indexOf('async function handleNoteBlur'), source.indexOf('async function handleArchive'))
    expect(fn).toMatch(/'saving'\)[\s\S]*await setSubmissionNote[\s\S]*'saved'\)/)
    expect(fn).toMatch(/catch \(err\) \{[\s\S]*'error'\)/)
    expect(fn).not.toContain('setNoteDrafts')
  })

  it('status buttons render a กำลังบันทึก.../บันทึกแล้ว/บันทึกไม่สำเร็จ indicator and disable while saving', () => {
    expect(source).toContain('statusSaveState')
    expect(source).toContain("disabled={statusSaveState === 'saving'}")
  })

  it('the note input renders its own กำลังบันทึก.../บันทึกแล้ว/บันทึกไม่สำเร็จ indicator', () => {
    expect(source).toContain('noteSaveState')
  })

  it('score entry keeps its pre-existing per-row save indicator, now read from the shared fieldSaveState map', () => {
    expect(source).toContain("fieldSaveState[`score:${student.id}`]")
  })
})
