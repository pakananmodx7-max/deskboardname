import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

function readSource(): string {
  return readFileSync(new URL('./sgs-export-dialog.tsx', import.meta.url), 'utf-8')
}

// ==================================================
// SgsExportDialog — SGS integration Phase 2. This is a DRY-RUN preview
// only: it must never contain a fetch/XHR to any SGS-looking host, never
// reference chrome.* extension APIs directly (that only happens inside
// sgs-bridge/, a fully separate folder), and never auto-trigger a
// download on open — only on an explicit button click. Source-text
// guards, the same convention every other component in this codebase
// uses since vitest.config.ts runs in a `node` environment with no
// DOM/jsdom.
// ==================================================

describe('SgsExportDialog — never talks to SGS or the network directly', () => {
  const source = readSource()

  it('contains no fetch/XHR/axios call', () => {
    expect(source).not.toMatch(/\bfetch\(/)
    expect(source).not.toMatch(/XMLHttpRequest/)
    expect(source).not.toMatch(/axios/)
  })

  it('never references chrome.* extension APIs — that boundary lives only in sgs-bridge/', () => {
    expect(source).not.toMatch(/chrome\.(runtime|tabs|storage|scripting)/)
  })

  it('never imports a Supabase client — this dialog only reshapes already-loaded props', () => {
    expect(source).not.toContain("from '@/lib/supabase'")
    expect(source).not.toContain('getSupabaseClient')
  })
})

describe('SgsExportDialog — the three required actions exist and nothing auto-fires', () => {
  const source = readSource()

  it('offers exactly the three buttons the spec requires', () => {
    expect(source).toContain('ดาวน์โหลด CSV')
    expect(source).toContain('เตรียมส่งผ่าน SGS Bridge')
    expect(source).toContain('ยกเลิก')
  })

  it('both export actions are wired to onClick handlers, never to a useEffect that fires on open', () => {
    expect(source).toContain('onClick={handleDownloadCsv}')
    expect(source).toContain('onClick={handlePrepareBridgePayload}')
    expect(source).not.toContain('useEffect')
  })

  it('re-validates the payload before ever handing it to downloadJson, even though buildSgsBridgePayload is trusted', () => {
    const fn = source.slice(source.indexOf('function handlePrepareBridgePayload'), source.indexOf('return (', source.indexOf('function handlePrepareBridgePayload')))
    expect(fn).toContain('validateSgsBridgePayload(payload)')
    const validateIndex = fn.indexOf('validateSgsBridgePayload(payload)')
    const downloadIndex = fn.indexOf('downloadJson(')
    expect(downloadIndex).toBeGreaterThan(validateIndex)
  })
})

describe('SgsExportDialog — reads rows from the SAME assignment_submissions-backed data already on screen', () => {
  const source = readSource()

  it('derives rows via buildSgsExportRows from the roster/submissions props — never fabricated data', () => {
    expect(source).toContain('buildSgsExportRows(roster, submissions)')
  })

  it('shows an explicit "ไม่ส่ง" for a skipped row rather than silently omitting the student', () => {
    expect(source).toContain('ไม่ส่ง')
  })

  it('states explicitly that this phase never auto-sends to SGS', () => {
    expect(source).toContain('ยังไม่มีการส่งคะแนนไป SGS โดยอัตโนมัติ')
  })
})
