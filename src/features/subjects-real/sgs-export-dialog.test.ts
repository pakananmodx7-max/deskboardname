import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

function readSource(): string {
  return readFileSync(new URL('./sgs-export-dialog.tsx', import.meta.url), 'utf-8')
}

// ==================================================
// SgsExportDialog — SGS integration, column-specific fill. This is a
// DRY-RUN preview only: it must never contain a fetch/XHR to any
// SGS-looking host, never reference chrome.* extension APIs directly
// (that only happens inside sgs-bridge/), and never auto-trigger a
// download on open — only on an explicit button click, and only once a
// single target column has been chosen. Source-text guards, the same
// convention every other component in this codebase uses since
// vitest.config.ts runs in a `node` environment with no DOM/jsdom.
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

describe('SgsExportDialog — exactly one SGS column must be selected before anything can be sent', () => {
  const source = readSource()

  it('renders every SGS_COLUMNS entry as its own radio option', () => {
    expect(source).toContain('SGS_COLUMNS.map((col) =>')
    expect(source).toContain('type="radio"')
    expect(source).toContain('name="sgs-target-column"')
  })

  it('both export buttons are disabled until a column is picked', () => {
    expect(source).toContain('onClick={handleDownloadCsv} disabled={!targetColumn}')
    expect(source).toContain('onClick={handlePrepareBridgePayload} disabled={!targetColumn}')
  })

  it('bails out of both handlers if somehow called with no column selected — never sends an empty/undefined column', () => {
    const csvFn = source.slice(source.indexOf('function handleDownloadCsv'), source.indexOf('function handlePrepareBridgePayload'))
    const payloadFn = source.slice(source.indexOf('function handlePrepareBridgePayload'), source.indexOf('return ('))
    expect(csvFn).toContain('if (!targetColumn) return')
    expect(payloadFn).toContain('if (!targetColumn) return')
  })
})

describe('SgsExportDialog — overwrite mode defaults to skipping existing values', () => {
  const source = readSource()

  it('initializes state with DEFAULT_SGS_OVERWRITE_MODE, never a hardcoded overwrite default', () => {
    expect(source).toContain('useState<SgsOverwriteMode>(DEFAULT_SGS_OVERWRITE_MODE)')
  })

  it('offers both modes as explicit, mutually exclusive radio choices', () => {
    expect(source).toContain('name="sgs-overwrite-mode"')
    expect(source).toContain('ข้ามคะแนนที่มีอยู่แล้ว')
    expect(source).toContain('เขียนทับเฉพาะช่องที่เลือก')
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

describe('SgsExportDialog — the preview never fabricates a known SGS existing value', () => {
  const source = readSource()

  it('always computes the plan against an empty/known-none existing-scores map — KrunameClass has no live SGS access', () => {
    expect(source).toContain('NO_KNOWN_EXISTING_SCORES')
    expect(source).toContain('computeSgsColumnFillPlan(rows, NO_KNOWN_EXISTING_SCORES, overwriteMode)')
  })

  it('discloses this limitation to the teacher in plain text', () => {
    expect(source).toContain('ยังไม่สามารถอ่านคะแนนเดิมจากหน้า SGS ได้โดยตรง')
  })
})

describe('SgsExportDialog — reads rows from the SAME assignment_submissions-backed data already on screen', () => {
  const source = readSource()

  it('derives rows via buildSgsExportRows from the roster/submissions props — never fabricated data', () => {
    expect(source).toContain('buildSgsExportRows(roster, submissions)')
  })

  it('shows the full 5-column preview shape required by the spec', () => {
    expect(source).toContain('เลขที่')
    expect(source).toContain('คะแนนเดิม SGS')
    expect(source).toContain('คะแนนใหม่')
  })

  it('states explicitly that this phase never auto-sends to SGS', () => {
    expect(source).toContain('ยังไม่มีการส่งคะแนนไป SGS โดยอัตโนมัติ')
  })
})
