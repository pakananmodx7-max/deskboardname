import type { WorkspaceLink } from './workspace-types'

export const DEFAULT_LINK_CATEGORIES = ['เอกสารการสอน', 'งานธุรการ', 'เว็บไซต์ราชการ', 'สื่อการเรียนรู้', 'อื่น ๆ']

export const MAX_URL_LENGTH = 2048

export type UrlCheck = { ok: true; url: string } | { ok: false; error: string }

// A leading "word:" that is a scheme — but "localhost:3000" or
// "example.com:8080/x" (host:port) is not.
const SCHEME_RE = /^([a-z][a-z0-9+.-]*):(?!\d+(?:[/?#]|$))/i

/**
 * Validates and normalises a link a teacher typed. Only http:// and
 * https:// are accepted (javascript:, data:, file:, mailto: … are
 * refused); a bare "www.example.com" becomes https://www.example.com/.
 * Credentials in the URL ("https://user:pass@…") are refused too — they
 * are a classic way to disguise where a link really goes.
 */
export function normalizeLinkUrl(raw: string): UrlCheck {
  const value = raw.trim()
  if (!value) return { ok: false, error: 'กรุณาระบุลิงก์' }
  if (value.length > MAX_URL_LENGTH) return { ok: false, error: 'ลิงก์ยาวเกินไป' }
  // eslint-disable-next-line no-control-regex
  if (/[\s\u0000-\u001f\u007f]/.test(value)) return { ok: false, error: 'ลิงก์ต้องไม่มีช่องว่าง' }

  const scheme = SCHEME_RE.exec(value)?.[1]?.toLowerCase()
  if (scheme && scheme !== 'http' && scheme !== 'https') {
    return { ok: false, error: 'รองรับเฉพาะลิงก์ที่ขึ้นต้นด้วย http:// หรือ https:// เท่านั้น' }
  }
  const candidate = scheme ? value : `https://${value.replace(/^\/+/, '')}`

  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    return { ok: false, error: 'รูปแบบลิงก์ไม่ถูกต้อง' }
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, error: 'รองรับเฉพาะลิงก์ที่ขึ้นต้นด้วย http:// หรือ https:// เท่านั้น' }
  }
  if (url.username || url.password) return { ok: false, error: 'ลิงก์ต้องไม่มีชื่อผู้ใช้หรือรหัสผ่าน' }
  const host = url.hostname
  if (!host || (!host.includes('.') && host !== 'localhost' && !host.startsWith('['))) {
    return { ok: false, error: 'รูปแบบลิงก์ไม่ถูกต้อง' }
  }
  if (url.href.length > MAX_URL_LENGTH) return { ok: false, error: 'ลิงก์ยาวเกินไป' }
  return { ok: true, url: url.href }
}

/** The href to render, or null if a stored value is not a safe http(s) link. */
export function safeHref(url: string): string | null {
  const check = normalizeLinkUrl(url)
  return check.ok && /^https?:\/\//i.test(url.trim()) ? check.url : null
}

/** "drive.google.com" (no "www."). */
export function hostLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/** A title suggestion from the URL when the teacher leaves it empty. */
export function suggestTitle(url: string): string {
  return hostLabel(url)
}

export type LinkSort = 'recent' | 'popular' | 'title' | 'created'

export const LINK_SORTS: { key: LinkSort; label: string }[] = [
  { key: 'recent', label: 'ใช้ล่าสุด' },
  { key: 'popular', label: 'ใช้บ่อย' },
  { key: 'title', label: 'ชื่อ (ก-ฮ)' },
  { key: 'created', label: 'เพิ่มล่าสุด' },
]

export interface LinkFilters {
  query: string
  category: 'all' | string
  pinnedOnly: boolean
  sort: LinkSort
}

export const DEFAULT_LINK_FILTERS: LinkFilters = { query: '', category: 'all', pinnedOnly: false, sort: 'recent' }

const lastUsed = (l: WorkspaceLink) => l.lastOpenedAt ?? l.createdAt

export function sortLinks(links: WorkspaceLink[], sort: LinkSort): WorkspaceLink[] {
  const copy = [...links]
  copy.sort((a, b) => {
    switch (sort) {
      case 'recent':
        return lastUsed(b).localeCompare(lastUsed(a))
      case 'popular':
        return b.openCount - a.openCount || lastUsed(b).localeCompare(lastUsed(a))
      case 'title':
        return a.title.localeCompare(b.title, 'th')
      case 'created':
        return b.createdAt.localeCompare(a.createdAt)
    }
  })
  return copy
}

export function filterLinks(links: WorkspaceLink[], filters: LinkFilters): WorkspaceLink[] {
  const q = filters.query.trim().toLocaleLowerCase('th')
  const result = links.filter((l) => {
    if (filters.pinnedOnly && !l.pinned) return false
    if (filters.category !== 'all' && (l.category ?? '') !== filters.category) return false
    if (!q) return true
    return [l.title, l.url, l.description, l.category ?? ''].some((v) => v.toLocaleLowerCase('th').includes(q))
  })
  // Pinned first, then the chosen order.
  const sorted = sortLinks(result, filters.sort)
  return [...sorted.filter((l) => l.pinned), ...sorted.filter((l) => !l.pinned)]
}

/** ภาพรวม: pinned links, then the most recently used. */
export function featuredLinks(links: WorkspaceLink[], limit = 4): WorkspaceLink[] {
  return filterLinks(links, DEFAULT_LINK_FILTERS).slice(0, limit)
}

export function validateLinkFields(fields: { title: string; description: string; category: string | null }): string | null {
  if (fields.title.trim().length > 200) return 'ชื่อลิงก์ยาวเกิน 200 ตัวอักษร'
  if (fields.description.length > 1000) return 'คำอธิบายยาวเกิน 1,000 ตัวอักษร'
  if (fields.category && fields.category.trim().length > 60) return 'ชื่อหมวดหมู่ยาวเกิน 60 ตัวอักษร'
  return null
}
