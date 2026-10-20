/**
 * The text inside a KrunameClass student QR: `kcqr1` + 64 lowercase hex
 * digits (the random token from student_qr_identities, migration 0030).
 * It carries no name, student code or database id — only an opaque
 * token the server resolves for an authorised teacher.
 *
 * No separator characters on purpose: a USB/Bluetooth scanner in HID
 * keyboard mode "types" the payload, and on a computer whose keyboard
 * layout is Thai (Kedmanee) every key arrives as a Thai character.
 * Letters and digits map back unambiguously; '-', '/' or ':' would not
 * (in Kedmanee, the '3' key types '-').
 */

export const QR_PAYLOAD_PREFIX = 'kcqr1'
const TOKEN_PATTERN = /^[0-9a-f]{64}$/

export function buildQrPayload(token: string): string {
  return `${QR_PAYLOAD_PREFIX}${token}`
}

/** Kedmanee (Thai) character → the US key that types it, for every key a
 * payload can contain (letters, digits). */
const KEDMANEE_TO_US: Record<string, string> = {
  'ๅ': '1', '/': '2', '-': '3', 'ภ': '4', 'ถ': '5', 'ุ': '6', 'ึ': '7', 'ค': '8', 'ต': '9', 'จ': '0',
  'ๆ': 'q', 'ไ': 'w', 'ำ': 'e', 'พ': 'r', 'ะ': 't', 'ั': 'y', 'ี': 'u', 'ร': 'i', 'น': 'o', 'ย': 'p',
  'ฟ': 'a', 'ห': 's', 'ก': 'd', 'ด': 'f', 'เ': 'g', '้': 'h', '่': 'j', 'า': 'k', 'ส': 'l',
  'ผ': 'z', 'ป': 'x', 'แ': 'c', 'อ': 'v', 'ิ': 'b', 'ื': 'n', 'ท': 'm',
  // Shifted Kedmanee keys (scanner sending upper-case / Caps Lock on).
  '+': '1', '๑': '2', '๒': '3', '๓': '4', '๔': '5', 'ู': '6', '฿': '7', '๕': '8', '๖': '9', '๗': '0',
  '๐': 'q', '"': 'w', 'ฎ': 'e', 'ฑ': 'r', 'ธ': 't', 'ํ': 'y', '๊': 'u', 'ณ': 'i', 'ฯ': 'o', 'ญ': 'p',
  'ฤ': 'a', 'ฆ': 's', 'ฏ': 'd', 'โ': 'f', 'ฌ': 'g', '็': 'h', '๋': 'j', 'ษ': 'k', 'ศ': 'l',
  '(': 'z', ')': 'x', 'ฉ': 'c', 'ฮ': 'v', 'ฺ': 'b', '์': 'n', '?': 'm',
}

const THAI_CHAR = /[\u0E00-\u0E7F]/

/**
 * Clean up scanned text: drop whitespace/control characters (CR, LF,
 * tabs a scanner may append), undo a Thai keyboard layout when Thai
 * characters are present, and lower-case.
 */
export function normalizeScannedText(raw: string): string {
  const compact = [...raw].filter((ch) => {
    const code = ch.charCodeAt(0)
    return code > 0x20 && code !== 0x7f && !/\s/.test(ch)
  }).join('')
  const mapped = THAI_CHAR.test(compact) ? [...compact].map((ch) => KEDMANEE_TO_US[ch] ?? ch).join('') : compact
  return mapped.toLowerCase()
}

/** The token from scanned text, or null when it is not a KrunameClass
 * student QR. Accepts the full payload or a bare 64-hex token. */
export function parseQrPayload(raw: string): string | null {
  const text = normalizeScannedText(raw)
  const token = text.startsWith(QR_PAYLOAD_PREFIX) ? text.slice(QR_PAYLOAD_PREFIX.length) : text
  return TOKEN_PATTERN.test(token) ? token : null
}

/** What the server receives: always the canonical payload, so the RPC
 * never has to repeat the keyboard-layout clean-up. */
export function canonicalQrPayload(raw: string): string | null {
  const token = parseQrPayload(raw)
  return token ? buildQrPayload(token) : null
}
