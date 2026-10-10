import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import {
  classifyRefreshFailure,
  createDriveClient,
  DriveStorageError,
  escapeQueryValue,
  FOLDER_MIME,
  handleDriveAction,
  hasDriveFileScope,
  mapGoogleError,
  MAX_UPLOAD_BYTES,
  ownedItemsQuery,
  toItemDto,
  validateFileId,
  validateItemName,
  validateUpload,
  type DriveFileRaw,
} from '../../supabase/functions/_shared/drive-storage'

// ==================================================
// Executed tests of the exact Drive storage code the google-drive-files
// Edge Function runs (Deno-independent module), against an in-memory
// fake of the Google Drive v3 REST API. No network, no real tokens.
// ==================================================

const TEACHER = '11111111-2222-4333-8444-555555555555'
const OTHER = '99999999-8888-4777-8666-555555555555'

interface FakeOptions {
  /** First call with a non-forced token gets 401 (expired token). */
  expireFirstToken?: boolean
  /** Every call fails with this Google error. */
  failWith?: { status: number; body: unknown }
  networkDown?: boolean
  badUploadLocation?: boolean
}

function fakeDrive(options: FakeOptions = {}) {
  const files = new Map<string, DriveFileRaw & { content?: string }>()
  const calls: { method: string; url: string; auth: string | null }[] = []
  let seq = 0
  const newId = () => `fileid${String(++seq).padStart(6, '0')}`
  let tokenCalls = 0

  // A file picked with the Google Picker (no KrunameClass markers) and an
  // item of another teacher — both must stay untouchable.
  files.set('pickedfile0001', { id: 'pickedfile0001', name: 'แผนจาก Picker.docx', mimeType: 'application/msword', parents: ['root'] })
  files.set('otherteach0001', { id: 'otherteach0001', name: 'ของครูอื่น.pdf', mimeType: 'application/pdf', parents: ['x'], appProperties: { kc_app: 'krunameclass', kc_teacher: OTHER, kc_role: 'file' } })
  files.set('gdocnative0001', { id: 'gdocnative0001', name: 'บันทึก', mimeType: 'application/vnd.google-apps.document', parents: ['x'], appProperties: { kc_app: 'krunameclass', kc_teacher: TEACHER, kc_role: 'file' } })

  const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })
  const matchesQuery = (f: DriveFileRaw, q: string) => {
    if (f.trashed) return false
    const p = f.appProperties ?? {}
    const teacher = /key='kc_teacher' and value='([^']*)'/.exec(q)?.[1]
    if (teacher !== undefined && p.kc_teacher !== teacher) return false
    if (q.includes("key='kc_app' and value='krunameclass'") && p.kc_app !== 'krunameclass') return false
    if (q.includes("key='kc_role' and value='root'") && p.kc_role !== 'root') return false
    return true
  }

  async function fetchImpl(input: string, init: RequestInit = {}): Promise<Response> {
    const method = init.method ?? 'GET'
    const auth = new Headers(init.headers).get('Authorization')
    calls.push({ method, url: input, auth })
    if (options.networkDown) throw new TypeError('fetch failed')
    if (options.expireFirstToken && auth === 'Bearer stale-token') return json({ error: { code: 401 } }, 401)
    if (options.failWith) return json(options.failWith.body, options.failWith.status)
    const url = new URL(input)
    const path = url.pathname

    if (path === '/drive/v3/about') return json({ storageQuota: { usage: '1288490188', limit: '16106127360' } })
    if (path === '/drive/v3/files' && method === 'GET') {
      const q = url.searchParams.get('q') ?? ''
      return json({ files: [...files.values()].filter((f) => matchesQuery(f, q)) })
    }
    if (path === '/drive/v3/files' && method === 'POST') {
      const meta = JSON.parse(String(init.body))
      const id = newId()
      const file = { id, name: meta.name, mimeType: meta.mimeType, parents: meta.parents ?? ['root'], appProperties: meta.appProperties, createdTime: '2026-10-10T03:00:00Z', modifiedTime: '2026-10-10T03:00:00Z' }
      files.set(id, file)
      return json(file)
    }
    if (path === '/upload/drive/v3/files' && method === 'POST') {
      const meta = JSON.parse(String(init.body))
      const uploadId = newId()
      pendingUploads.set(uploadId, meta)
      const location = options.badUploadLocation ? 'https://evil.example/upload' : `https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=${uploadId}`
      return new Response(null, { status: 200, headers: { Location: location } })
    }
    if (path === '/upload/drive/v3/files' && method === 'PUT') {
      const meta = pendingUploads.get(url.searchParams.get('upload_id') ?? '')
      if (!meta) return json({ error: { code: 404 } }, 404)
      const bytes = init.body as ArrayBuffer
      const id = newId()
      const file = { id, name: meta.name, mimeType: meta.mimeType, parents: meta.parents, appProperties: meta.appProperties, size: String(bytes.byteLength), content: new TextDecoder().decode(bytes) }
      files.set(id, file)
      return json(file)
    }
    const fileMatch = /^\/drive\/v3\/files\/([^/]+)(\/export)?$/.exec(path)
    if (fileMatch) {
      const file = files.get(decodeURIComponent(fileMatch[1]))
      if (!file) return json({ error: { code: 404, errors: [{ reason: 'notFound' }] } }, 404)
      if (fileMatch[2]) return new Response(`PDF:${file.name}`, { status: 200 })
      if (method === 'GET' && url.searchParams.get('alt') === 'media') return new Response(file.content ?? '', { status: 200 })
      if (method === 'GET') return json(file)
      if (method === 'PATCH') {
        Object.assign(file, JSON.parse(String(init.body)))
        return json(file)
      }
    }
    return json({ error: { code: 400 } }, 400)
  }
  const pendingUploads = new Map<string, { name: string; mimeType: string; parents: string[]; appProperties: Record<string, string> }>()

  const drive = createDriveClient({
    fetch: fetchImpl,
    getAccessToken: async (force) => {
      tokenCalls += 1
      return options.expireFirstToken && !force ? 'stale-token' : 'fresh-token'
    },
  })
  return { drive, files, calls, tokenCalls: () => tokenCalls }
}

const run = (drive: ReturnType<typeof fakeDrive>['drive'], action: string, params: Record<string, unknown> = {}, file: { name: string; size: number; text: string } | null = null) =>
  handleDriveAction(
    {
      action,
      teacherId: TEACHER,
      params,
      file: file ? { name: file.name, size: file.size, bytes: async () => new TextEncoder().encode(file.text).buffer as ArrayBuffer } : null,
    },
    drive,
  )

function body<T>(result: Awaited<ReturnType<typeof run>>): T {
  if (result.kind !== 'json') throw new Error('expected json')
  return result.body as T
}

async function expectCode(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toMatchObject({ code })
}

describe('overview (read-only)', () => {
  it('before first use: no KrunameClass folder, nothing listed, nothing created', async () => {
    const f = fakeDrive()
    const result = body<{ root: unknown; items: unknown[]; quota: unknown }>(await run(f.drive, 'overview'))
    expect(result.root).toBeNull()
    expect(result.items).toEqual([])
    expect(result.quota).toEqual({ usageBytes: 1288490188, limitBytes: 16106127360 })
    expect(f.calls.some((c) => c.method !== 'GET')).toBe(false)
  })
})

describe('folders and uploads', () => {
  it('first write creates the dedicated "KrunameClass" folder once, with private ownership markers', async () => {
    const f = fakeDrive()
    const folder = body<{ item: { id: string; name: string; isFolder: boolean; parentId: string } }>(await run(f.drive, 'create_folder', { name: '  งาน วิชาการ  ' })).item
    await run(f.drive, 'create_folder', { name: 'เอกสารประจำชั้น' })
    const roots = [...f.files.values()].filter((x) => x.appProperties?.kc_role === 'root')
    expect(roots).toHaveLength(1)
    expect(roots[0]).toMatchObject({ name: 'KrunameClass', mimeType: FOLDER_MIME, appProperties: { kc_app: 'krunameclass', kc_teacher: TEACHER, kc_role: 'root' } })
    expect(folder).toMatchObject({ name: 'งาน วิชาการ', isFolder: true, parentId: roots[0].id })
    expect(folder).not.toHaveProperty('appProperties')
  })

  it('upload: server-side resumable session, MIME from the extension allowlist, into a chosen folder', async () => {
    const f = fakeDrive()
    const folder = body<{ item: { id: string } }>(await run(f.drive, 'create_folder', { name: 'งานวิชาการ' })).item
    const up = body<{ item: { id: string; name: string; mimeType: string; parentId: string; size: number } }>(
      await run(f.drive, 'upload', { parentId: folder.id }, { name: 'แผนการสอน.docx', size: 5, text: 'hello' }),
    ).item
    expect(up).toMatchObject({ name: 'แผนการสอน.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', parentId: folder.id, size: 5 })
    const put = f.calls.find((c) => c.method === 'PUT')!
    expect(put.url.startsWith('https://www.googleapis.com/upload/drive/v3/files')).toBe(true)
    const overview = body<{ items: { name: string }[] }>(await run(f.drive, 'overview'))
    expect(overview.items.map((i) => i.name).sort()).toEqual(['บันทึก', 'งานวิชาการ', 'แผนการสอน.docx'].sort())
  })

  it('upload refuses: too large, empty, unsupported type, missing file, a non-folder parent, a foreign parent', async () => {
    const f = fakeDrive()
    await expectCode(run(f.drive, 'upload', {}, { name: 'big.pdf', size: MAX_UPLOAD_BYTES + 1, text: 'x' }), 'too_large')
    await expectCode(run(f.drive, 'upload', {}, { name: 'empty.pdf', size: 0, text: '' }), 'invalid_request')
    await expectCode(run(f.drive, 'upload', {}, { name: 'virus.exe', size: 3, text: 'abc' }), 'unsupported_type')
    await expectCode(run(f.drive, 'upload', {}), 'invalid_request')
    const file = body<{ item: { id: string } }>(await run(f.drive, 'upload', {}, { name: 'a.pdf', size: 1, text: 'a' })).item
    await expectCode(run(f.drive, 'upload', { parentId: file.id }, { name: 'b.pdf', size: 1, text: 'b' }), 'invalid_request')
    await expectCode(run(f.drive, 'upload', { parentId: 'pickedfile0001' }, { name: 'b.pdf', size: 1, text: 'b' }), 'not_found')
  })

  it('never PUTs file bytes to a non-Google upload URL', async () => {
    const f = fakeDrive({ badUploadLocation: true })
    await expectCode(run(f.drive, 'upload', {}, { name: 'a.pdf', size: 1, text: 'a' }), 'drive_unavailable')
    expect(f.calls.some((c) => c.method === 'PUT')).toBe(false)
  })
})

describe('rename, trash, download — own KrunameClass items only', () => {
  it('rename and trash (to Drive trash, recoverable); trashed items disappear from the list', async () => {
    const f = fakeDrive()
    const file = body<{ item: { id: string } }>(await run(f.drive, 'upload', {}, { name: 'เก่า.pdf', size: 1, text: 'a' })).item
    expect(body<{ item: { name: string } }>(await run(f.drive, 'rename', { fileId: file.id, name: 'ใหม่.pdf' })).item.name).toBe('ใหม่.pdf')
    await run(f.drive, 'trash', { fileId: file.id })
    expect(f.files.get(file.id)?.trashed).toBe(true)
    expect(f.files.has(file.id)).toBe(true) // never permanently deleted
    expect(body<{ items: { id: string }[] }>(await run(f.drive, 'overview')).items.map((i) => i.id)).not.toContain(file.id)
  })

  it('a Picker-attached file, another teacher\'s item and the root folder are refused', async () => {
    const f = fakeDrive()
    await run(f.drive, 'create_folder', { name: 'x' })
    const rootId = [...f.files.values()].find((x) => x.appProperties?.kc_role === 'root')!.id
    for (const fileId of ['pickedfile0001', 'otherteach0001']) {
      await expectCode(run(f.drive, 'rename', { fileId, name: 'hacked' }), 'not_found')
      await expectCode(run(f.drive, 'trash', { fileId }), 'not_found')
      await expectCode(run(f.drive, 'download', { fileId }), 'not_found')
    }
    await expectCode(run(f.drive, 'rename', { fileId: rootId, name: 'x' }), 'invalid_request')
    await expectCode(run(f.drive, 'trash', { fileId: rootId }), 'invalid_request')
    expect(f.files.get('pickedfile0001')).toMatchObject({ name: 'แผนจาก Picker.docx' })
    expect(f.files.get('pickedfile0001')?.trashed).toBeUndefined()
  })

  it('download streams the bytes; Google Docs are exported to PDF; folders and bad ids refused', async () => {
    const f = fakeDrive()
    const file = body<{ item: { id: string } }>(await run(f.drive, 'upload', {}, { name: 'note.txt', size: 5, text: 'hello' })).item
    const result = await run(f.drive, 'download', { fileId: file.id })
    expect(result).toMatchObject({ kind: 'binary', name: 'note.txt', mimeType: 'text/plain' })
    if (result.kind === 'binary') expect(await new Response(result.body).text()).toBe('hello')
    const gdoc = await run(f.drive, 'download', { fileId: 'gdocnative0001' })
    expect(gdoc).toMatchObject({ kind: 'binary', name: 'บันทึก.pdf', mimeType: 'application/pdf' })
    const folder = body<{ item: { id: string } }>(await run(f.drive, 'create_folder', { name: 'f' })).item
    await expectCode(run(f.drive, 'download', { fileId: folder.id }), 'invalid_request')
    await expectCode(run(f.drive, 'download', { fileId: '../../etc' }), 'invalid_request')
  })

  it('unknown action', async () => {
    await expectCode(run(fakeDrive().drive, 'delete_everything'), 'invalid_request')
  })
})

describe('tokens and Google errors', () => {
  it('an expired token is refreshed once server-side and the call retried', async () => {
    const f = fakeDrive({ expireFirstToken: true })
    const result = body<{ root: unknown }>(await run(f.drive, 'overview'))
    expect(result.root).toBeNull()
    expect(f.calls.some((c) => c.auth === 'Bearer fresh-token')).toBe(true)
  })

  it('maps quota, scope, rate-limit, not-found and network failures to stable codes', async () => {
    await expectCode(run(fakeDrive({ failWith: { status: 403, body: { error: { errors: [{ reason: 'storageQuotaExceeded' }] } } } }).drive, 'overview'), 'quota_exceeded')
    await expectCode(run(fakeDrive({ failWith: { status: 403, body: { error: { errors: [{ reason: 'insufficientPermissions' }] } } } }).drive, 'overview'), 'scope_missing')
    await expectCode(run(fakeDrive({ failWith: { status: 429, body: {} } }).drive, 'overview'), 'rate_limited')
    await expectCode(run(fakeDrive({ networkDown: true }).drive, 'overview'), 'drive_unavailable')
    expect(mapGoogleError(401, null).code).toBe('reauth_required')
    expect(mapGoogleError(404, null).code).toBe('not_found')
    expect(mapGoogleError(500, null).code).toBe('drive_unavailable')
    expect(mapGoogleError(403, { error: { status: 'PERMISSION_DENIED', details: [{ reason: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT' }] } }).code).toBe('scope_missing')
  })
})

describe('refresh-token failures', () => {
  it('only a revoked grant removes the connection; outages and misconfiguration keep it', () => {
    expect(classifyRefreshFailure(new Error('Google token endpoint returned 400: {"error":"invalid_grant","error_description":"Token has been expired or revoked."}'))).toBe('revoked')
    expect(classifyRefreshFailure(new Error('Google token endpoint returned 401: {"error":"invalid_client"}'))).toBe('misconfigured')
    expect(classifyRefreshFailure(new Error('Google token endpoint returned 503: backend error'))).toBe('transient')
    expect(classifyRefreshFailure(new TypeError('fetch failed'))).toBe('transient')
    expect(classifyRefreshFailure(null)).toBe('transient')
  })

  it('the token helper deletes the connection only in the revoked branch', () => {
    const token = readFileSync(new URL('../../supabase/functions/_shared/google-token.ts', import.meta.url), 'utf-8')
    const del = token.indexOf(".delete().eq('teacher_id', teacherId)")
    expect(token.indexOf("if (reason === 'revoked') {")).toBeGreaterThan(0)
    expect(del).toBeGreaterThan(token.indexOf("if (reason === 'revoked') {"))
    expect(token.match(/\.delete\(\)/g)).toHaveLength(1)
  })
})

describe('validation helpers', () => {
  it('names, ids, scopes, upload rules', () => {
    expect(validateItemName('  a\u0000b/c\\d  ')).toBe('a b c d')
    expect(() => validateItemName('   ')).toThrow(DriveStorageError)
    expect(() => validateItemName('x'.repeat(201))).toThrow(/200/)
    expect(validateFileId('1AbC-dEf_ghIJKLmn')).toBe('1AbC-dEf_ghIJKLmn')
    expect(() => validateFileId('short')).toThrow(DriveStorageError)
    expect(() => validateFileId("x' or name contains 'a")).toThrow(DriveStorageError)
    expect(hasDriveFileScope('openid https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email')).toBe(true)
    expect(hasDriveFileScope('openid https://www.googleapis.com/auth/userinfo.email')).toBe(false)
    expect(hasDriveFileScope(null)).toBe(false)
    expect(validateUpload({ name: 'รายงาน.PDF', size: 10 })).toEqual({ name: 'รายงาน.PDF', mimeType: 'application/pdf' })
  })

  it('query values are escaped; DTOs carry no private markers', () => {
    expect(escapeQueryValue("a'b\\c")).toBe("a\\'b\\\\c")
    expect(ownedItemsQuery("x' or '1'='1")).toContain("value='x\\' or \\'1\\'=\\'1'")
    const dto = toItemDto({ id: 'abcdefghij', name: 'n', mimeType: 'application/pdf', size: '42', parents: ['p'], appProperties: { kc_app: 'krunameclass', kc_teacher: TEACHER, kc_role: 'file' } }, TEACHER)
    expect(dto).toEqual({ id: 'abcdefghij', name: 'n', mimeType: 'application/pdf', isFolder: false, role: 'file', size: 42, createdTime: null, modifiedTime: null, parentId: 'p', webViewLink: null })
    expect(toItemDto({ id: 'abcdefghij', name: 'n', mimeType: 'x', appProperties: { kc_app: 'krunameclass', kc_teacher: OTHER, kc_role: 'file' } }, TEACHER)).toBeNull()
  })
})

describe('Edge Function wiring (source guards — Deno code is not run under Vitest)', () => {
  const read = (p: string) => readFileSync(new URL(`../../supabase/functions/${p}`, import.meta.url), 'utf-8')
  const index = read('google-drive-files/index.ts')
  const token = read('_shared/google-token.ts')
  const google = read('_shared/google.ts')

  it('verifies the Supabase session and the teacher role before any Drive call', () => {
    const auth = index.indexOf('requireTeacherId(req, admin)')
    const role = index.indexOf("['teacher', 'admin'].includes(profile.role)")
    const drive = index.indexOf('createDriveClient(')
    expect(auth).toBeGreaterThan(0)
    expect(role).toBeGreaterThan(auth)
    expect(drive).toBeGreaterThan(role)
  })

  it('tokens stay server-side: never in a response, never logged', () => {
    expect(index).not.toMatch(/accessToken\s*[:,}]/)
    expect(index).not.toMatch(/refresh_token/)
    expect(token).toContain('hasDriveFileScope(connection.scope)')
    // Log calls may mention a token in words, but never pass a token value.
    expect(token).not.toMatch(/console\.\w+\([^)]*,\s*(connection|refreshed|env|access_token|refresh_token)/i)
    expect(index).toContain("'Content-Type': 'application/octet-stream'")
    expect(index).toContain('MAX_REQUEST_BYTES')
  })

  it('does not widen the OAuth scope (still drive.file only)', () => {
    expect(google).toContain("'https://www.googleapis.com/auth/drive.file'")
    expect(google).not.toMatch(/auth\/drive['"\s,]|auth\/drive\.readonly|auth\/drive\.metadata/)
  })
})
