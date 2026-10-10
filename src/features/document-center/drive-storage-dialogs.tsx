import { AlertTriangle, Download, FileUp, Loader2 } from 'lucide-react'
import { useEffect, useId, useRef, useState, type FormEvent } from 'react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { NativeSelect } from '@/components/ui/select'
import { toFriendlyErrorMessage } from '@/lib/errors'
import { checkUpload, MAX_UPLOAD_BYTES } from '@/services/drive-storage-service'

import type { DocumentItem } from './document-center-model'
import { formatBytes, previewKind, typedPreviewBlob } from './drive-storage-model'

const INPUT = 'h-10 w-full rounded-xl border border-input bg-background px-3 text-sm focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40'

/** Ask for a folder/file name (create folder, rename). */
export function NameDialog({
  open,
  title,
  description,
  initial = '',
  confirmLabel,
  validate,
  onSubmit,
  onClose,
}: {
  open: boolean
  title: string
  description: string
  initial?: string
  confirmLabel: string
  /** Extra check (e.g. a name already used in the folder). */
  validate?: (name: string) => string | null
  onSubmit: (name: string) => Promise<void>
  onClose: () => void
}) {
  const [value, setValue] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const inputId = useId()

  async function submit(e: FormEvent) {
    e.preventDefault()
    const name = value.replace(/\s+/g, ' ').trim()
    const problem = !name ? 'กรุณาระบุชื่อ' : name.length > 200 ? 'ชื่อยาวเกิน 200 ตัวอักษร' : /[/\\]/.test(name) ? 'ชื่อห้ามมีเครื่องหมาย / หรือ \\' : (validate?.(name) ?? null)
    if (problem) {
      setError(problem)
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onSubmit(name)
      onClose()
    } catch (err) {
      setError(toFriendlyErrorMessage(err, 'บันทึกไม่สำเร็จ'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <label htmlFor={inputId} className="text-sm font-medium">
              ชื่อ
            </label>
            <input id={inputId} value={value} onChange={(e) => setValue(e.target.value)} maxLength={200} autoFocus className={INPUT} aria-invalid={Boolean(error)} />
            {error && (
              <p role="alert" className="text-xs text-destructive">
                {error}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
              ยกเลิก
            </Button>
            <Button type="submit" disabled={busy}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              {confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Upload one file to a chosen KrunameClass folder. */
export function UploadDialog({
  open,
  folders,
  defaultFolderId,
  onUpload,
  onClose,
}: {
  open: boolean
  folders: { id: string | null; label: string }[]
  defaultFolderId: string | null
  onUpload: (file: File, parentId: string | null) => Promise<void>
  onClose: () => void
}) {
  const [file, setFile] = useState<File | null>(null)
  const [folderId, setFolderId] = useState<string | null>(defaultFolderId)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const fileId = useId()
  const folderSelectId = useId()

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!file) {
      setError('กรุณาเลือกไฟล์')
      return
    }
    const problem = checkUpload(file)
    if (problem) {
      setError(problem)
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onUpload(file, folderId)
      onClose()
    } catch (err) {
      setError(toFriendlyErrorMessage(err, 'อัปโหลดไม่สำเร็จ'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>อัปโหลดไฟล์ไป Google Drive</DialogTitle>
            <DialogDescription>ไฟล์จะถูกเก็บในโฟลเดอร์ KrunameClass บน Google Drive ของคุณ (สูงสุด {formatBytes(MAX_UPLOAD_BYTES)} ต่อไฟล์)</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <label htmlFor={fileId} className="text-sm font-medium">
              ไฟล์
            </label>
            <input
              id={fileId}
              type="file"
              accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.ods,.odp,.rtf,.txt,.csv,.png,.jpg,.jpeg,.gif,.webp,.mp3,.m4a,.mp4,.zip"
              onChange={(e) => {
                const picked = e.target.files?.[0] ?? null
                setFile(picked)
                setError(picked ? checkUpload(picked) : null)
              }}
              className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-primary/12 file:px-3 file:py-2 file:text-sm file:font-medium file:text-primary"
            />
            {file && (
              <p className="text-xs text-muted-foreground">
                {file.name} · {formatBytes(file.size)}
              </p>
            )}
          </div>
          <div className="grid gap-1.5">
            <label htmlFor={folderSelectId} className="text-sm font-medium">
              โฟลเดอร์ปลายทาง
            </label>
            <NativeSelect id={folderSelectId} value={folderId ?? ''} onChange={(e) => setFolderId(e.target.value || null)} className="h-10 w-full rounded-xl">
              {folders.map((f) => (
                <option key={f.id ?? 'root'} value={f.id ?? ''}>
                  {f.label}
                </option>
              ))}
            </NativeSelect>
          </div>
          {error && (
            <p role="alert" className="flex items-center gap-1.5 text-sm text-destructive">
              <AlertTriangle className="size-4" />
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
              ยกเลิก
            </Button>
            <Button type="submit" disabled={busy || !file || checkUpload(file) !== null}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <FileUp className="size-4" />}
              {busy ? 'กำลังอัปโหลด...' : 'อัปโหลด'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** In-app preview of a Drive file (PDF, image, text, audio, video) —
 * fetched through the server, shown from a local object URL. */
export function DrivePreviewDialog({ item, load, onDownload, onClose }: { item: DocumentItem | null; load: (item: DocumentItem) => Promise<Blob>; onDownload: (item: DocumentItem) => void; onClose: () => void }) {
  const [state, setState] = useState<{ itemId: string; url: string | null; text: string | null; error: string | null } | null>(null)
  const urlRef = useRef<string | null>(null)
  const kind = item ? previewKind(item.mimeType) : null
  const current = state && item && state.itemId === item.id ? state : null

  useEffect(() => {
    if (!item || !kind) return
    let active = true
    load(item).then(
      async (blob) => {
        if (!active) return
        if (kind === 'text') {
          const text = (await blob.slice(0, 200_000).text()).replace(/\r\n/g, '\n')
          if (active) setState({ itemId: item.id, url: null, text, error: null })
          return
        }
        const url = URL.createObjectURL(typedPreviewBlob(blob, item.mimeType))
        urlRef.current = url
        if (active) setState({ itemId: item.id, url, text: null, error: null })
      },
      (err: unknown) => active && setState({ itemId: item.id, url: null, text: null, error: toFriendlyErrorMessage(err, 'เปิดไฟล์ไม่สำเร็จ') }),
    )
    return () => {
      active = false
      if (urlRef.current) URL.revokeObjectURL(urlRef.current)
      urlRef.current = null
    }
  }, [item, kind, load])

  return (
    <Dialog open={item !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl">
        {item && (
          <>
            <DialogHeader>
              <DialogTitle className="truncate leading-snug">{item.title}</DialogTitle>
              <DialogDescription>{item.parentTitle}</DialogDescription>
            </DialogHeader>
            <div className="min-h-[16rem] overflow-hidden rounded-xl border border-border bg-muted/30" data-testid="drive-preview">
              {!kind ? (
                <div className="flex h-64 flex-col items-center justify-center gap-2 px-6 text-center">
                  <p className="text-sm font-medium">ไม่สามารถแสดงตัวอย่างไฟล์ประเภทนี้ในระบบได้</p>
                  <p className="text-xs text-muted-foreground">ดาวน์โหลดเพื่อเปิดด้วยโปรแกรมในเครื่อง</p>
                </div>
              ) : current?.error ? (
                <div role="alert" className="flex h-64 items-center justify-center px-6 text-center text-sm text-destructive">
                  {current.error}
                </div>
              ) : !current ? (
                <div className="flex h-64 items-center justify-center" role="status" aria-label="กำลังโหลดตัวอย่าง">
                  <Loader2 className="size-6 animate-spin text-muted-foreground" />
                </div>
              ) : kind === 'pdf' ? (
                <iframe title={`ตัวอย่าง ${item.title}`} src={current.url ?? undefined} className="h-[70vh] w-full bg-white" />
              ) : kind === 'image' ? (
                <img src={current.url ?? undefined} alt={item.title} className="mx-auto max-h-[70vh] object-contain" />
              ) : kind === 'video' ? (
                <video src={current.url ?? undefined} controls className="max-h-[70vh] w-full" />
              ) : kind === 'audio' ? (
                <div className="flex h-40 items-center justify-center px-4">
                  <audio src={current.url ?? undefined} controls className="w-full" />
                </div>
              ) : (
                <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap p-4 text-xs leading-relaxed">{current.text}</pre>
              )}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onDownload(item)}>
                <Download className="size-4" />
                ดาวน์โหลด
              </Button>
              <Button type="button" onClick={onClose}>
                ปิด
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
