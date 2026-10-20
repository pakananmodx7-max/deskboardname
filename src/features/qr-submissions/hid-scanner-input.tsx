import { Bluetooth, MousePointerClick } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'

import { cn } from '@/lib/utils'

import { parseQrPayload } from './qr-payload'

/** Scanners that don't send Enter: submit once a complete payload has
 * been idle this long. */
const IDLE_SUBMIT_MS = 140

/**
 * Bluetooth / USB QR scanner in HID keyboard mode: the OS pairs it, it
 * "types" the QR text into this focused input and (usually) presses
 * Enter. Enter never submits a form or navigates; a complete payload
 * without Enter is picked up after a short idle; focus returns here after
 * every scan so the teacher can keep scanning. `inputMode="none"` keeps
 * a tablet's on-screen keyboard from covering the screen.
 */
export function HidScannerInput({ active, onScan }: { active: boolean; onScan: (text: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const idleRef = useRef<number | null>(null)
  const [focused, setFocused] = useState(false)

  const focus = useCallback(() => {
    if (active) inputRef.current?.focus({ preventScroll: true })
  }, [active])

  const flush = useCallback(() => {
    if (idleRef.current !== null) window.clearTimeout(idleRef.current)
    idleRef.current = null
    const input = inputRef.current
    if (!input) return
    const value = input.value
    input.value = ''
    if (value.trim()) onScan(value)
  }, [onScan])

  // Keep the scanner input focused while scanning is active: on open,
  // when the window regains focus, and after a scan elsewhere on screen.
  useEffect(() => {
    if (!active) return
    const raf = window.requestAnimationFrame(focus)
    window.addEventListener('focus', focus)
    return () => {
      window.cancelAnimationFrame(raf)
      window.removeEventListener('focus', focus)
      if (idleRef.current !== null) window.clearTimeout(idleRef.current)
    }
  }, [active, focus])

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === 'Tab') {
      // Never submit a form, move focus or trigger a default action.
      e.preventDefault()
      e.stopPropagation()
      flush()
    }
  }

  function handleInput() {
    if (idleRef.current !== null) window.clearTimeout(idleRef.current)
    const value = inputRef.current?.value ?? ''
    if (parseQrPayload(value)) idleRef.current = window.setTimeout(flush, IDLE_SUBMIT_MS)
  }

  return (
    <div className="space-y-3">
      <label
        htmlFor="hid-scanner-input"
        className={cn(
          'flex cursor-text flex-col items-center gap-3 rounded-2xl border-2 border-dashed p-6 text-center transition-colors',
          focused ? 'border-success bg-success/8' : 'border-border bg-muted/40',
        )}
      >
        <span className={cn('flex size-14 items-center justify-center rounded-full', focused ? 'bg-success/15 text-success' : 'bg-muted text-muted-foreground')}>
          {focused ? <Bluetooth className="size-7" /> : <MousePointerClick className="size-7" />}
        </span>
        <span className="text-base font-semibold text-foreground" aria-live="polite">
          {focused ? 'พร้อมรับการสแกน' : 'แตะ/คลิกที่นี่ เพื่อให้พร้อมรับการสแกน'}
        </span>
        <span className="max-w-sm text-sm text-muted-foreground">
          {focused
            ? 'สแกน QR ด้วยเครื่องสแกน Bluetooth/USB ได้ต่อเนื่อง — ไม่ต้องกดปุ่มใด ๆ'
            : 'เครื่องสแกนพิมพ์ข้อความลงช่องที่โฟกัสอยู่ หากโฟกัสหลุด ระบบจะไม่ได้รับการสแกน'}
        </span>
        <input
          ref={inputRef}
          id="hid-scanner-input"
          type="text"
          inputMode="none"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint="done"
          aria-label="ช่องรับข้อมูลจากเครื่องสแกน QR"
          onKeyDown={handleKeyDown}
          onInput={handleInput}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          className="h-10 w-full max-w-sm rounded-xl border border-input bg-background px-3 text-center font-mono text-xs text-muted-foreground focus-visible:border-success focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-success/30"
          placeholder="ข้อมูลจากเครื่องสแกนจะปรากฏที่นี่ชั่วครู่"
        />
      </label>
    </div>
  )
}
