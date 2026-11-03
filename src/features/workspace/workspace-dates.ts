/**
 * Calendar-day helpers for the workspace. A task's due date is a plain
 * 'YYYY-MM-DD' key (a Postgres `date`), never a timestamp, so it is
 * never shifted by a time zone. "Today" is always the current day in
 * Asia/Bangkok, whatever the device's own time zone is. Day arithmetic
 * runs on UTC midnights, which have no DST or offset surprises.
 */

export const WORKSPACE_TIME_ZONE = 'Asia/Bangkok'

const KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/

const keyFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: WORKSPACE_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' })

export function isDateKey(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const m = KEY_RE.exec(value)
  if (!m) return false
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3])
}

/** The Bangkok calendar day of an instant, as 'YYYY-MM-DD'. */
export function bangkokDateKey(instant: Date | string | number = new Date()): string {
  const parts = keyFormatter.formatToParts(new Date(instant))
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

export function todayKey(now: Date = new Date()): string {
  return bangkokDateKey(now)
}

function keyToUtc(key: string): number {
  const m = KEY_RE.exec(key)
  if (!m) throw new Error(`Invalid date key: ${key}`)
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

function utcToKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

export function addDays(key: string, days: number): string {
  return utcToKey(keyToUtc(key) + days * 86_400_000)
}

/** b − a in whole days. */
export function diffDays(a: string, b: string): number {
  return Math.round((keyToUtc(b) - keyToUtc(a)) / 86_400_000)
}

/** 0 = Sunday … 6 = Saturday. */
export function weekdayOf(key: string): number {
  return new Date(keyToUtc(key)).getUTCDay()
}

export function monthOf(key: string): { year: number; month: number } {
  const m = KEY_RE.exec(key)!
  return { year: Number(m[1]), month: Number(m[2]) }
}

export function monthKey(year: number, month: number, day = 1): string {
  return utcToKey(Date.UTC(year, month - 1, day))
}

export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const d = new Date(Date.UTC(year, month - 1 + delta, 1))
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 }
}

/** 6 weeks × 7 days, Sunday first, covering the whole month. */
export function monthGrid(year: number, month: number): string[] {
  const first = monthKey(year, month)
  const start = addDays(first, -weekdayOf(first))
  return Array.from({ length: 42 }, (_, i) => addDays(start, i))
}

/** The Sunday-first week containing `key`. */
export function weekDays(key: string): string[] {
  const start = addDays(key, -weekdayOf(key))
  return Array.from({ length: 7 }, (_, i) => addDays(start, i))
}

export const THAI_WEEKDAYS_SHORT = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส']

// Formatting a date-only key: noon UTC rendered in UTC can never land on
// a neighbouring day.
const noonUtc = (key: string) => new Date(keyToUtc(key) + 12 * 3_600_000)
const shortFmt = new Intl.DateTimeFormat('th-TH', { timeZone: 'UTC', day: 'numeric', month: 'short' })
const shortYearFmt = new Intl.DateTimeFormat('th-TH', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' })
const longFmt = new Intl.DateTimeFormat('th-TH', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
const monthFmt = new Intl.DateTimeFormat('th-TH', { timeZone: 'UTC', month: 'long', year: 'numeric' })
const dateTimeFmt = new Intl.DateTimeFormat('th-TH', { timeZone: WORKSPACE_TIME_ZONE, day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
const timeFmt = new Intl.DateTimeFormat('th-TH', { timeZone: WORKSPACE_TIME_ZONE, hour: '2-digit', minute: '2-digit' })

/** "3 พ.ย." (the year is added when it is not the current one). */
export function formatThaiDate(key: string, today?: string): string {
  const sameYear = today ? key.slice(0, 4) === today.slice(0, 4) : false
  return (sameYear ? shortFmt : shortYearFmt).format(noonUtc(key))
}

/** "วันอังคารที่ 3 พฤศจิกายน 2569". */
export function formatThaiDateLong(key: string): string {
  return longFmt.format(noonUtc(key))
}

/** "พฤศจิกายน 2569". */
export function formatThaiMonth(year: number, month: number): string {
  return monthFmt.format(noonUtc(monthKey(year, month)))
}

/** A timestamp in Bangkok: "วันนี้ 08:20", "เมื่อวาน 17:05" or "3 พ.ย. 2569 08:20". */
export function formatThaiDateTime(iso: string, now: Date = new Date()): string {
  const key = bangkokDateKey(iso)
  const today = bangkokDateKey(now)
  if (key === today) return `วันนี้ ${timeFmt.format(new Date(iso))}`
  if (key === addDays(today, -1)) return `เมื่อวาน ${timeFmt.format(new Date(iso))}`
  return dateTimeFmt.format(new Date(iso))
}

/** "วันนี้", "พรุ่งนี้", "เมื่อวาน", "อีก 3 วัน", "เลยมา 2 วัน" or the date. */
export function relativeDayLabel(key: string, today: string): string {
  const d = diffDays(today, key)
  if (d === 0) return 'วันนี้'
  if (d === 1) return 'พรุ่งนี้'
  if (d === -1) return 'เมื่อวาน'
  if (d > 1 && d <= 6) return `อีก ${d} วัน`
  if (d < -1 && d >= -30) return `เลยมา ${-d} วัน`
  return formatThaiDate(key, today)
}
