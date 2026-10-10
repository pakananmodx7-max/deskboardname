// deno-lint-ignore-file no-explicit-any
/**
 * KrunameClass document storage on the teacher's own Google Drive
 * (Document Center, Phase 2). Deno-independent on purpose (no `Deno.*`,
 * no `npm:` imports, no imports at all) so the exact code the Edge
 * Function runs is also executed by Vitest — see
 * src/services/drive-storage-core.test.ts.
 *
 * LEAST PRIVILEGE: everything here works with the `drive.file` scope the
 * existing integration already requests (supabase/functions/_shared/
 * google.ts). With `drive.file` the app can only see and change files it
 * created itself (or that the teacher picked through the Picker) — never
 * the rest of the teacher's Drive. No broader scope is requested.
 *
 * OWNERSHIP: every folder/file this module creates carries private
 * `appProperties` (visible only to this OAuth client):
 *   kc_app = 'krunameclass', kc_teacher = <Supabase user id>,
 *   kc_role = 'root' | 'folder' | 'file'.
 * Every operation re-reads the target from Drive and refuses anything
 * without those markers for the calling teacher — so a Picker-attached
 * file (no markers) or another account's item can never be renamed,
 * trashed or downloaded through this API, whatever id a client sends.
 * Drive is the source of truth; nothing is stored in Supabase.
 */

export const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file'
export const ROOT_FOLDER_NAME = 'KrunameClass'
export const FOLDER_MIME = 'application/vnd.google-apps.folder'
/** Upload cap per file (the file passes through the Edge Function). */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024
/** Safety stop for listing (pages of 1000). */
export const MAX_LIST_PAGES = 10

const DRIVE_API = 'https://www.googleapis.com/drive/v3'
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3'
const FILE_FIELDS = 'id,name,mimeType,size,createdTime,modifiedTime,parents,webViewLink,appProperties,trashed'

export type ItemRole = 'root' | 'folder' | 'file'

// ==================================================
// Errors
// ==================================================

export type DriveErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not_configured'
  | 'not_connected'
  | 'reauth_required'
  | 'scope_missing'
  | 'not_found'
  | 'invalid_request'
  | 'too_large'
  | 'unsupported_type'
  | 'quota_exceeded'
  | 'rate_limited'
  | 'drive_unavailable'

export const ERROR_STATUS: Record<DriveErrorCode, number> = {
  unauthorized: 401,
  forbidden: 403,
  not_configured: 503,
  not_connected: 409,
  reauth_required: 401,
  scope_missing: 403,
  not_found: 404,
  invalid_request: 400,
  too_large: 413,
  unsupported_type: 415,
  quota_exceeded: 507,
  rate_limited: 429,
  drive_unavailable: 502,
}

export const ERROR_MESSAGE: Record<DriveErrorCode, string> = {
  unauthorized: 'กรุณาเข้าสู่ระบบใหม่อีกครั้ง',
  forbidden: 'บัญชีนี้ไม่มีสิทธิ์ใช้งานพื้นที่จัดเก็บเอกสาร',
  not_configured: 'ระบบจัดเก็บบน Google Drive ยังไม่ได้ตั้งค่าบนเซิร์ฟเวอร์',
  not_connected: 'ยังไม่ได้เชื่อมต่อ Google Drive',
  reauth_required: 'การเชื่อมต่อ Google หมดอายุ กรุณาเชื่อมต่อใหม่อีกครั้ง',
  scope_missing: 'สิทธิ์ Google Drive ไม่ครบ กรุณาเชื่อมต่อใหม่และอนุญาตการเข้าถึงไฟล์',
  not_found: 'ไม่พบไฟล์หรือโฟลเดอร์นี้ในพื้นที่จัดเก็บของ KrunameClass',
  invalid_request: 'ข้อมูลไม่ถูกต้อง',
  too_large: 'ไฟล์ใหญ่เกิน 10 MB',
  unsupported_type: 'ไม่รองรับไฟล์ประเภทนี้',
  quota_exceeded: 'พื้นที่ Google Drive เต็ม',
  rate_limited: 'มีการใช้งานถี่เกินไป กรุณารอสักครู่แล้วลองใหม่',
  drive_unavailable: 'ติดต่อ Google Drive ไม่สำเร็จ กรุณาลองใหม่',
}

export class DriveStorageError extends Error {
  readonly code: DriveErrorCode
  readonly status: number
  constructor(code: DriveErrorCode, message: string = ERROR_MESSAGE[code]) {
    super(message)
    this.name = 'DriveStorageError'
    this.code = code
    this.status = ERROR_STATUS[code]
  }
}

/** Google API error → our code. Never forwards Google's raw message. */
export function mapGoogleError(status: number, body: any): DriveStorageError {
  const reasons: string[] = [
    ...((body?.error?.errors ?? []) as { reason?: string }[]).map((e) => e.reason ?? ''),
    String(body?.error?.status ?? ''),
    ...((body?.error?.details ?? []) as { reason?: string }[]).map((d) => d.reason ?? ''),
  ]
  const has = (r: string) => reasons.includes(r)
  if (status === 401) return new DriveStorageError('reauth_required')
  if (has('insufficientPermissions') || has('insufficientScopes') || has('ACCESS_TOKEN_SCOPE_INSUFFICIENT')) return new DriveStorageError('scope_missing')
  if (has('storageQuotaExceeded') || has('quotaExceeded')) return new DriveStorageError('quota_exceeded')
  if (status === 429 || has('rateLimitExceeded') || has('userRateLimitExceeded')) return new DriveStorageError('rate_limited')
  if (status === 404) return new DriveStorageError('not_found')
  if (status === 400) return new DriveStorageError('invalid_request')
  return new DriveStorageError('drive_unavailable')
}

/**
 * Why a refresh-token exchange failed, from the error google.ts throws
 * ("Google token endpoint returned <status>: <body>"):
 *   revoked       — invalid_grant: the teacher revoked access / token
 *                   expired (e.g. 7-day expiry while the OAuth app is in
 *                   "Testing"). Only this one removes the stored connection.
 *   misconfigured — invalid_client / unauthorized_client: wrong client
 *                   id/secret on the server. Keep the connection.
 *   transient     — network errors, 5xx, rate limits. Keep the connection.
 */
export function classifyRefreshFailure(error: unknown): 'revoked' | 'misconfigured' | 'transient' {
  const message = error instanceof Error ? error.message : String(error ?? '')
  if (/invalid_grant/.test(message)) return 'revoked'
  if (/invalid_client|unauthorized_client/.test(message)) return 'misconfigured'
  return 'transient'
}

// ==================================================
// Validation
// ==================================================

export function hasDriveFileScope(scope: string | null | undefined): boolean {
  return (scope ?? '').split(/\s+/).includes(DRIVE_FILE_SCOPE)
}

const FILE_ID = /^[A-Za-z0-9_-]{10,128}$/

export function validateFileId(raw: unknown): string {
  if (typeof raw !== 'string' || !FILE_ID.test(raw)) throw new DriveStorageError('invalid_request', 'รหัสไฟล์ไม่ถูกต้อง')
  return raw
}

/** Trimmed, single-spaced, no control characters or slashes, 1–200 chars. */
export function validateItemName(raw: unknown): string {
  if (typeof raw !== 'string') throw new DriveStorageError('invalid_request', 'กรุณาระบุชื่อ')
  // Control characters and path separators become spaces.
  const cleaned = Array.from(raw, (ch) => {
    const code = ch.charCodeAt(0)
    return code < 32 || code === 127 || ch === '/' || ch === '\\' ? ' ' : ch
  }).join('')
  const name = cleaned.replace(/\s+/g, ' ').trim()
  if (!name || name === '.' || name === '..') throw new DriveStorageError('invalid_request', 'กรุณาระบุชื่อ')
  if (name.length > 200) throw new DriveStorageError('invalid_request', 'ชื่อยาวเกิน 200 ตัวอักษร')
  return name
}

/** Documents teachers keep — office files, PDFs, images, text, audio/video clips. */
export const ALLOWED_UPLOAD_EXTENSIONS: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  odp: 'application/vnd.oasis.opendocument.presentation',
  rtf: 'application/rtf',
  txt: 'text/plain',
  csv: 'text/csv',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  mp4: 'video/mp4',
  zip: 'application/zip',
}

export function extensionOf(name: string): string {
  const match = /\.([A-Za-z0-9]{1,8})$/.exec(name)
  return match ? match[1].toLowerCase() : ''
}

/** Name, size and type checks before anything is sent to Google. The
 * stored MIME type comes from the extension allowlist, never from the
 * client's claim. */
export function validateUpload(file: { name: string; size: number }, nameOverride?: unknown): { name: string; mimeType: string } {
  const name = validateItemName(nameOverride ?? file.name)
  if (!Number.isFinite(file.size) || file.size <= 0) throw new DriveStorageError('invalid_request', 'ไฟล์ว่างเปล่า')
  if (file.size > MAX_UPLOAD_BYTES) throw new DriveStorageError('too_large')
  const mimeType = ALLOWED_UPLOAD_EXTENSIONS[extensionOf(name)]
  if (!mimeType) throw new DriveStorageError('unsupported_type')
  return { name, mimeType }
}

// ==================================================
// Ownership markers + queries
// ==================================================

export function appPropertiesFor(teacherId: string, role: ItemRole): Record<string, string> {
  return { kc_app: 'krunameclass', kc_teacher: teacherId, kc_role: role }
}

/** Drive query string literal escaping (\ and '). */
export function escapeQueryValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

export function ownedItemsQuery(teacherId: string): string {
  return `appProperties has { key='kc_teacher' and value='${escapeQueryValue(teacherId)}' } and appProperties has { key='kc_app' and value='krunameclass' } and trashed = false`
}

export function rootQuery(teacherId: string): string {
  return `${ownedItemsQuery(teacherId)} and appProperties has { key='kc_role' and value='root' } and mimeType = '${FOLDER_MIME}'`
}

export interface DriveFileRaw {
  id: string
  name: string
  mimeType: string
  size?: string
  createdTime?: string
  modifiedTime?: string
  parents?: string[]
  webViewLink?: string
  appProperties?: Record<string, string>
  trashed?: boolean
}

export function roleOf(file: DriveFileRaw, teacherId: string): ItemRole | null {
  const p = file.appProperties ?? {}
  if (p.kc_app !== 'krunameclass' || p.kc_teacher !== teacherId || file.trashed) return null
  return p.kc_role === 'root' || p.kc_role === 'folder' || p.kc_role === 'file' ? p.kc_role : null
}

export interface DriveItemDto {
  id: string
  name: string
  mimeType: string
  isFolder: boolean
  role: ItemRole
  size: number | null
  createdTime: string | null
  modifiedTime: string | null
  parentId: string | null
  webViewLink: string | null
}

/** What the browser receives — never appProperties or tokens. */
export function toItemDto(file: DriveFileRaw, teacherId: string): DriveItemDto | null {
  const role = roleOf(file, teacherId)
  if (!role) return null
  const size = file.size !== undefined ? Number(file.size) : NaN
  return {
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    isFolder: file.mimeType === FOLDER_MIME,
    role,
    size: Number.isFinite(size) ? size : null,
    createdTime: file.createdTime ?? null,
    modifiedTime: file.modifiedTime ?? null,
    parentId: file.parents?.[0] ?? null,
    webViewLink: file.webViewLink ?? null,
  }
}

/** Google Workspace documents have no binary — exported to PDF. */
export function exportMimeFor(mimeType: string): string | null {
  return mimeType.startsWith('application/vnd.google-apps.') && mimeType !== FOLDER_MIME ? 'application/pdf' : null
}

// ==================================================
// Drive REST client (fetch + token injected)
// ==================================================

export interface DriveClientDeps {
  fetch: (input: string, init?: RequestInit) => Promise<Response>
  /** `force` = the cached token was rejected; mint a fresh one. */
  getAccessToken: (force: boolean) => Promise<string>
}

export interface StorageQuota {
  usageBytes: number
  limitBytes: number | null
}

export interface DownloadResult {
  body: ReadableStream<Uint8Array> | ArrayBuffer | null
  name: string
  mimeType: string
}

export function createDriveClient(deps: DriveClientDeps) {
  async function request(url: string, init: RequestInit = {}, retried = false): Promise<Response> {
    const token = await deps.getAccessToken(retried)
    const headers = new Headers(init.headers)
    headers.set('Authorization', `Bearer ${token}`)
    let response: Response
    try {
      response = await deps.fetch(url, { ...init, headers })
    } catch {
      throw new DriveStorageError('drive_unavailable')
    }
    if (response.status === 401 && !retried) return request(url, init, true)
    if (!response.ok) {
      const body = await response.json().catch(() => null)
      throw mapGoogleError(response.status, body)
    }
    return response
  }

  const json = async (url: string, init?: RequestInit) => (await request(url, init)).json()

  async function listOwned(teacherId: string): Promise<DriveFileRaw[]> {
    const out: DriveFileRaw[] = []
    let pageToken: string | undefined
    for (let page = 0; page < MAX_LIST_PAGES; page++) {
      const params = new URLSearchParams({
        q: ownedItemsQuery(teacherId),
        fields: `nextPageToken,files(${FILE_FIELDS})`,
        pageSize: '1000',
        spaces: 'drive',
        orderBy: 'folder,name',
      })
      if (pageToken) params.set('pageToken', pageToken)
      const data = await json(`${DRIVE_API}/files?${params}`)
      out.push(...((data.files ?? []) as DriveFileRaw[]))
      pageToken = data.nextPageToken
      if (!pageToken) break
    }
    return out
  }

  async function findRoot(teacherId: string): Promise<DriveFileRaw | null> {
    const params = new URLSearchParams({ q: rootQuery(teacherId), fields: `files(${FILE_FIELDS})`, pageSize: '10', spaces: 'drive', orderBy: 'createdTime' })
    const data = await json(`${DRIVE_API}/files?${params}`)
    return ((data.files ?? []) as DriveFileRaw[])[0] ?? null
  }

  function createFolderRaw(name: string, parentId: string | null, appProperties: Record<string, string>): Promise<DriveFileRaw> {
    return json(`${DRIVE_API}/files?fields=${FILE_FIELDS}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({ name, mimeType: FOLDER_MIME, appProperties, ...(parentId ? { parents: [parentId] } : {}) }),
    })
  }

  /** The dedicated "KrunameClass" folder — created on first write only. */
  async function ensureRoot(teacherId: string): Promise<DriveFileRaw> {
    return (await findRoot(teacherId)) ?? createFolderRaw(ROOT_FOLDER_NAME, null, appPropertiesFor(teacherId, 'root'))
  }

  /** Reads an item and proves it belongs to this teacher's KrunameClass tree. */
  async function getOwned(teacherId: string, fileId: string): Promise<{ file: DriveFileRaw; role: ItemRole }> {
    const file = (await json(`${DRIVE_API}/files/${encodeURIComponent(validateFileId(fileId))}?fields=${FILE_FIELDS}`)) as DriveFileRaw
    const role = roleOf(file, teacherId)
    if (!role) throw new DriveStorageError('not_found')
    return { file, role }
  }

  async function resolveParent(teacherId: string, parentId: unknown): Promise<string> {
    if (parentId === undefined || parentId === null || parentId === '') return (await ensureRoot(teacherId)).id
    const { file, role } = await getOwned(teacherId, validateFileId(parentId))
    if (role === 'file' || file.mimeType !== FOLDER_MIME) throw new DriveStorageError('invalid_request', 'ปลายทางต้องเป็นโฟลเดอร์')
    return file.id
  }

  return {
    listOwned,
    findRoot,
    ensureRoot,
    getOwned,

    async createFolder(teacherId: string, name: unknown, parentId: unknown): Promise<DriveFileRaw> {
      const clean = validateItemName(name)
      const parent = await resolveParent(teacherId, parentId)
      return createFolderRaw(clean, parent, appPropertiesFor(teacherId, 'folder'))
    },

    /** Resumable upload, started and finished server-side (the browser
     * never talks to Google or sees a token). */
    async upload(teacherId: string, file: { name: string; size: number; bytes: () => Promise<ArrayBuffer> }, parentId: unknown, nameOverride?: unknown): Promise<DriveFileRaw> {
      const { name, mimeType } = validateUpload(file, nameOverride)
      const parent = await resolveParent(teacherId, parentId)
      const bytes = await file.bytes()
      if (bytes.byteLength > MAX_UPLOAD_BYTES) throw new DriveStorageError('too_large')
      const init = await request(`${DRIVE_UPLOAD_API}/files?uploadType=resumable&fields=${FILE_FIELDS}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': mimeType, 'X-Upload-Content-Length': String(bytes.byteLength) },
        body: JSON.stringify({ name, mimeType, parents: [parent], appProperties: appPropertiesFor(teacherId, 'file') }),
      })
      const session = init.headers.get('Location')
      if (!session || !session.startsWith('https://www.googleapis.com/')) throw new DriveStorageError('drive_unavailable')
      return (await request(session, { method: 'PUT', headers: { 'Content-Type': mimeType }, body: bytes })).json()
    },

    async rename(teacherId: string, fileId: unknown, name: unknown): Promise<DriveFileRaw> {
      const clean = validateItemName(name)
      const { file, role } = await getOwned(teacherId, validateFileId(fileId))
      if (role === 'root') throw new DriveStorageError('invalid_request', 'ไม่สามารถเปลี่ยนชื่อโฟลเดอร์หลักได้')
      return json(`${DRIVE_API}/files/${encodeURIComponent(file.id)}?fields=${FILE_FIELDS}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json; charset=UTF-8' },
        body: JSON.stringify({ name: clean }),
      })
    },

    /** "ลบ" = move to Drive's trash (recoverable for 30 days), never a
     * permanent delete. A folder takes its contents with it. */
    async trash(teacherId: string, fileId: unknown): Promise<void> {
      const { file, role } = await getOwned(teacherId, validateFileId(fileId))
      if (role === 'root') throw new DriveStorageError('invalid_request', 'ไม่สามารถลบโฟลเดอร์หลักได้')
      await request(`${DRIVE_API}/files/${encodeURIComponent(file.id)}?fields=id`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json; charset=UTF-8' },
        body: JSON.stringify({ trashed: true }),
      })
    },

    async download(teacherId: string, fileId: unknown): Promise<DownloadResult> {
      const { file } = await getOwned(teacherId, validateFileId(fileId))
      if (file.mimeType === FOLDER_MIME) throw new DriveStorageError('invalid_request', 'ดาวน์โหลดโฟลเดอร์ไม่ได้')
      const exportMime = exportMimeFor(file.mimeType)
      const url = exportMime
        ? `${DRIVE_API}/files/${encodeURIComponent(file.id)}/export?mimeType=${encodeURIComponent(exportMime)}`
        : `${DRIVE_API}/files/${encodeURIComponent(file.id)}?alt=media`
      const response = await request(url)
      return { body: response.body, name: exportMime ? `${file.name}.pdf` : file.name, mimeType: exportMime ?? file.mimeType }
    },

    async quota(): Promise<StorageQuota | null> {
      const data = await json(`${DRIVE_API}/about?fields=storageQuota`)
      const usage = Number(data?.storageQuota?.usage)
      const limit = data?.storageQuota?.limit !== undefined ? Number(data.storageQuota.limit) : null
      if (!Number.isFinite(usage)) return null
      return { usageBytes: usage, limitBytes: limit !== null && Number.isFinite(limit) ? limit : null }
    },
  }
}

export type DriveClient = ReturnType<typeof createDriveClient>

// ==================================================
// Action dispatch (what the Edge Function runs after auth)
// ==================================================

export type DriveAction = 'overview' | 'create_folder' | 'upload' | 'rename' | 'trash' | 'download'

export interface UploadedFile {
  name: string
  size: number
  bytes: () => Promise<ArrayBuffer>
}

export type DriveActionResult =
  | { kind: 'json'; status: number; body: unknown }
  | { kind: 'binary'; body: ReadableStream<Uint8Array> | ArrayBuffer | null; name: string; mimeType: string }

export async function handleDriveAction(
  input: { action: unknown; teacherId: string; params: Record<string, unknown>; file?: UploadedFile | null },
  drive: DriveClient,
): Promise<DriveActionResult> {
  const { teacherId, params } = input
  const ok = (body: unknown) => ({ kind: 'json' as const, status: 200, body })
  const dto = (raw: DriveFileRaw) => toItemDto(raw, teacherId)

  switch (input.action) {
    case 'overview': {
      // Read-only: never creates the root folder just by looking.
      const root = await drive.findRoot(teacherId)
      const [items, quota] = await Promise.all([root ? drive.listOwned(teacherId) : Promise.resolve([]), drive.quota().catch(() => null)])
      return ok({
        root: root ? dto(root) : null,
        items: items.map(dto).filter((i): i is DriveItemDto => i !== null && i.role !== 'root'),
        quota,
      })
    }
    case 'create_folder':
      return ok({ item: dto(await drive.createFolder(teacherId, params.name, params.parentId)) })
    case 'upload': {
      if (!input.file) throw new DriveStorageError('invalid_request', 'ไม่พบไฟล์ที่อัปโหลด')
      return ok({ item: dto(await drive.upload(teacherId, input.file, params.parentId, params.name || undefined)) })
    }
    case 'rename':
      return ok({ item: dto(await drive.rename(teacherId, params.fileId, params.name)) })
    case 'trash':
      await drive.trash(teacherId, params.fileId)
      return ok({ trashed: true })
    case 'download': {
      const result = await drive.download(teacherId, params.fileId)
      return { kind: 'binary', ...result }
    }
    default:
      throw new DriveStorageError('invalid_request', 'ไม่รู้จักคำสั่งนี้')
  }
}
