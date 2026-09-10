import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

function readSource(): string {
  return readFileSync(new URL('./settings-page.tsx', import.meta.url), 'utf-8')
}

describe('SettingsPage — สำรองข้อมูล export button (Data Safety phase, Section 3)', () => {
  const source = readSource()

  it('builds the backup and the ZIP before ever downloading — never downloads a partial/failed export', () => {
    expect(source).toMatch(/await buildTeacherBackup\(\)[\s\S]*await buildZip\(backup\.files\)[\s\S]*downloadBlob\(/)
  })

  it('shows กำลังสร้างไฟล์สำรองข้อมูล... while exporting and disables the button, never claiming success before it resolves', () => {
    expect(source).toContain("state === 'exporting'")
    expect(source).toContain('กำลังสร้างไฟล์สำรองข้อมูล')
    expect(source).toContain("disabled={state === 'exporting'}")
  })

  it('only toasts success after downloadBlob has actually been called', () => {
    const fn = source.slice(source.indexOf('async function handleExport'), source.indexOf('return ('))
    expect(fn).toMatch(/downloadBlob\([\s\S]*toast\(/)
  })

  it('shows an error state with a message on failure, and never silently drops the failure', () => {
    expect(source).toContain("setState('error')")
    expect(source).toContain('errorMessage')
  })
})

describe('SettingsPage route — teacher-only (Data Safety phase, Section 4)', () => {
  it('/teacher/settings is registered only under the ProtectedRoute-gated /teacher layout, never under /student', () => {
    const router = readFileSync(new URL('../../../app/router.tsx', import.meta.url), 'utf-8')
    const teacherSection = router.slice(router.indexOf("path: '/teacher'"), router.indexOf("path: '*'"))
    expect(teacherSection).toContain("path: 'settings', element: <SettingsPage />")
    const studentSection = router.slice(router.indexOf("path: '/student'"), router.indexOf("path: '/teacher'"))
    expect(studentSection).not.toContain('SettingsPage')
  })
})
