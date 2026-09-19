import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

function read(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf-8')
}

describe('manifest.json — minimal permissions, no host_permissions, no remote code', () => {
  const manifest = JSON.parse(read('../manifest.json'))

  it('requests only activeTab/scripting/storage — never a broad host permission or "tabs"/"cookies"', () => {
    expect(manifest.permissions.sort()).toEqual(['activeTab', 'scripting', 'storage'])
    expect(manifest.host_permissions).toBeUndefined()
  })

  it('is Manifest V3', () => {
    expect(manifest.manifest_version).toBe(3)
  })
})

describe('content-diagnostic.js — never reads cookies, storage, or input values', () => {
  // Sliced to the actual function body, past the leading doc comment —
  // that comment explains, in prose, exactly what NOT to do (mentioning
  // "cookie"/"localStorage"/".value" as things this function must never
  // touch), which would otherwise trip these same guards against the
  // comment text itself rather than the code.
  const fullSource = read('../src/content-diagnostic.js')
  const source = fullSource.slice(fullSource.indexOf('export function collectRawSgsFacts'))

  it('never touches document.cookie', () => {
    expect(source).not.toMatch(/document\.cookie/)
  })

  it('never touches localStorage/sessionStorage', () => {
    expect(source).not.toMatch(/localStorage|sessionStorage/)
  })

  it('never reads an input/select/textarea\'s .value', () => {
    expect(source).not.toMatch(/\.value\b/)
  })

  it('never reads a table BODY row\'s text — only header cells via headerRow/headerCells', () => {
    const fnBody = source.slice(source.indexOf('const allTables'), source.indexOf('const inputTypeCounts'))
    expect(fnBody).toContain('headerCells')
    expect(fnBody).not.toMatch(/rows\[.*\]\.textContent|Array\.from\(rows\)\.map/)
  })
})

describe('popup.js — never sends the loaded payload or diagnostic report anywhere except local chrome.storage', () => {
  const source = read('../src/popup.js')

  it('contains no fetch/XHR/axios call', () => {
    expect(source).not.toMatch(/\bfetch\(/)
    expect(source).not.toMatch(/XMLHttpRequest/)
  })

  it('only uses chrome.storage.session/local, never chrome.storage.sync (which leaves the machine)', () => {
    expect(source).not.toMatch(/chrome\.storage\.sync/)
  })

  it('never auto-runs the diagnostic or mapping check without a button click', () => {
    expect(source).toContain("diagnosticBtn.addEventListener('click'")
    expect(source).toContain("mappingBtn.addEventListener('click'")
  })

  it('the SGS-candidate list passed into matchStudentsToSgs is empty — no invented selector-based extraction yet', () => {
    const fn = source.slice(source.indexOf('function renderMappingResult'), source.indexOf('fileInput.addEventListener'))
    expect(fn).toContain('matchStudentsToSgs(krunameStudents, [])')
  })
})

describe('options.js — only ever writes the non-sensitive keyword setting', () => {
  const source = read('../src/options.js')

  it('only touches the sgsKeyword storage key', () => {
    const matches = [...source.matchAll(/chrome\.storage\.local\.(?:get|set)\(([^)]*)\)/g)]
    expect(matches.length).toBeGreaterThan(0)
    for (const match of matches) {
      expect(match[1]).toContain('sgsKeyword')
    }
  })
})
