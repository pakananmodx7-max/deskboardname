import { AlertTriangle, ChevronRight, Cloud, CloudOff, Folder, FolderOpen, FolderPlus, RotateCw, Upload } from 'lucide-react'
import type * as React from 'react'

import { Button } from '@/components/ui/button'
import { RowActionsMenu } from '@/components/ui/row-actions-menu'
import type { DriveStorageItem } from '@/services/drive-storage-service'

import { formatDocumentDate, type DocumentItem } from './document-center-model'
import { DocumentEmptyState } from './document-empty-state'
import { DocumentCollection, type DocumentCollectionProps } from './document-table'
import { breadcrumbs, childrenOf, countInside, formatBytes, unavailableHelp, type StorageState } from './drive-storage-model'

export interface DriveStoragePanelProps {
  state: StorageState
  folderId: string | null
  /** Search/filters active → show matching Drive files from every folder. */
  searching: boolean
  /** Drive files (as documents) — already filtered and sorted by the page. */
  documents: DocumentItem[]
  /** Drive files attached to assignments/lessons via the Picker (Phase 1). */
  attachments: DocumentItem[]
  collection: Omit<DocumentCollectionProps, 'items'>
  now: Date
  onOpenFolder: (folderId: string | null) => void
  onUpload: () => void
  onNewFolder: () => void
  onRenameFolder: (folder: DriveStorageItem) => void
  onTrashFolder: (folder: DriveStorageItem) => void
  onConnect: () => void
  onReconnect: () => void
  onRetry: () => void
}

function Toolbar({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">{children}</div>
}

/**
 * "ใน Google Drive" — the teacher's KrunameClass folder on their own
 * Google Drive, managed entirely here: browse folders, upload, create
 * folders, rename, move to trash, preview and download. Every operation
 * runs through the google-drive-files Edge Function.
 */
export function DriveStoragePanel(props: DriveStoragePanelProps) {
  const { state } = props

  if (state.status === 'unsupported') {
    return <DocumentEmptyState icon={CloudOff} title="พื้นที่จัดเก็บบน Google Drive ใช้ได้เมื่อเชื่อมต่อฐานข้อมูลจริง" description="โหมดสาธิตไม่ได้เชื่อมต่อ Google Drive — ไม่มีการอ่านหรือเขียนไฟล์ใด ๆ" />
  }
  if (state.status === 'checking' || state.status === 'loading') {
    return (
      <div className="space-y-2 p-4" role="status" aria-label="กำลังโหลดไฟล์จาก Google Drive" data-testid="drive-loading">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="flex items-center gap-3">
            <span className="size-8 animate-pulse rounded-lg bg-muted" />
            <span className="h-4 flex-1 animate-pulse rounded bg-muted" />
          </div>
        ))}
      </div>
    )
  }
  if (state.status === 'not_connected') {
    return (
      <DocumentEmptyState
        icon={Cloud}
        title="ยังไม่ได้เชื่อมต่อ Google Drive"
        description="เชื่อมต่อบัญชี Google เพื่อเก็บเอกสารในโฟลเดอร์ KrunameClass บน Google Drive ของคุณ — ระบบเข้าถึงได้เฉพาะไฟล์ที่สร้างผ่าน KrunameClass เท่านั้น"
        action={
          <Button type="button" variant="outline" size="sm" onClick={props.onConnect}>
            เชื่อมต่อ Google Drive
          </Button>
        }
      />
    )
  }
  if (state.status === 'unavailable') {
    const help = unavailableHelp(state.code)
    return (
      <div data-testid="drive-unavailable">
        <DocumentEmptyState
          icon={CloudOff}
          title={help.title}
          description={help.hint}
          action={
            help.reconnect ? (
              <Button type="button" variant="outline" size="sm" onClick={props.onReconnect}>
                เชื่อมต่อ Google Drive ใหม่
              </Button>
            ) : undefined
          }
        />
      </div>
    )
  }
  if (state.status === 'error') {
    return (
      <div role="alert" className="flex flex-col items-center gap-3 px-6 py-10 text-center" data-testid="drive-error">
        <AlertTriangle className="size-6 text-destructive" />
        <p className="text-sm text-foreground">{state.message}</p>
        <Button type="button" variant="outline" size="sm" onClick={props.onRetry}>
          <RotateCw className="size-4" />
          ลองใหม่
        </Button>
      </div>
    )
  }

  const { overview } = state
  const crumbs = breadcrumbs(overview, props.folderId)
  const { folders } = childrenOf(overview, props.folderId)
  // driveItemToDocument maps a root-level (or orphaned) file to the root id.
  const filesHere = props.documents.filter((d) => d.parentId === (props.folderId ?? overview.root?.id))
  const actions = (
    <div className="flex flex-wrap gap-2">
      <Button type="button" size="sm" className="rounded-lg" onClick={props.onUpload}>
        <Upload className="size-4" />
        อัปโหลดไฟล์
      </Button>
      <Button type="button" size="sm" variant="outline" className="rounded-lg" onClick={props.onNewFolder}>
        <FolderPlus className="size-4" />
        โฟลเดอร์ใหม่
      </Button>
    </div>
  )
  const quota = overview.quota

  return (
    <div data-testid="drive-panel">
      <Toolbar>
        {props.searching ? (
          <p className="text-sm font-medium">ผลการค้นหาในโฟลเดอร์ KrunameClass ({props.documents.length})</p>
        ) : (
          <nav aria-label="ตำแหน่งโฟลเดอร์" className="flex min-w-0 flex-wrap items-center gap-1 text-sm">
            {crumbs.map((c, i) => (
              <span key={c.id ?? 'root'} className="flex items-center gap-1">
                {i > 0 && <ChevronRight className="size-3.5 text-muted-foreground" aria-hidden="true" />}
                {i === crumbs.length - 1 ? (
                  <span className="font-semibold text-foreground" aria-current="location">
                    {c.name}
                  </span>
                ) : (
                  <button type="button" onClick={() => props.onOpenFolder(c.id)} className="rounded px-1 text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
                    {c.name}
                  </button>
                )}
              </span>
            ))}
          </nav>
        )}
        {actions}
      </Toolbar>

      {props.searching ? (
        props.documents.length === 0 ? (
          <DocumentEmptyState compact icon={Cloud} title="ไม่พบไฟล์ใน Google Drive ที่ตรงกับการค้นหา" />
        ) : (
          <DocumentCollection items={props.documents} {...props.collection} />
        )
      ) : !overview.root ? (
        <DocumentEmptyState
          icon={FolderOpen}
          title="ยังไม่มีโฟลเดอร์ KrunameClass ใน Google Drive"
          description="ระบบจะสร้างโฟลเดอร์ “KrunameClass” ให้อัตโนมัติเมื่อคุณอัปโหลดไฟล์หรือสร้างโฟลเดอร์ครั้งแรก"
        />
      ) : folders.length === 0 && filesHere.length === 0 ? (
        <DocumentEmptyState icon={FolderOpen} title="โฟลเดอร์นี้ยังว่าง" description="อัปโหลดไฟล์หรือสร้างโฟลเดอร์ย่อยได้จากปุ่มด้านบน" />
      ) : (
        <>
          {folders.length > 0 && (
            <ul className="grid gap-2 border-b border-border p-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="โฟลเดอร์">
              {folders.map((f) => {
                const inside = countInside(overview, f.id)
                return (
                  <li key={f.id} className="flex items-center gap-1 rounded-xl border border-border bg-card pr-1 transition-colors hover:bg-accent/50">
                    <button type="button" onClick={() => props.onOpenFolder(f.id)} className="flex min-w-0 flex-1 items-center gap-3 rounded-xl p-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
                      <Folder className="size-8 shrink-0 fill-amber-400/30 text-amber-500" aria-hidden="true" />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold">{f.name}</span>
                        <span className="block text-xs text-muted-foreground">
                          {inside.files} ไฟล์{inside.folders > 0 ? ` · ${inside.folders} โฟลเดอร์` : ''}
                          {f.modifiedTime ? ` · ${formatDocumentDate(f.modifiedTime, props.now)}` : ''}
                        </span>
                      </span>
                    </button>
                    <RowActionsMenu
                      label={`ตัวเลือกโฟลเดอร์ ${f.name}`}
                      actions={[
                        { key: 'open', label: 'เปิดโฟลเดอร์', onSelect: () => props.onOpenFolder(f.id) },
                        { key: 'rename', label: 'เปลี่ยนชื่อ', onSelect: () => props.onRenameFolder(f) },
                        { key: 'trash', label: 'ลบ (ย้ายไปถังขยะ)', onSelect: () => props.onTrashFolder(f), destructive: true, separatorBefore: true },
                      ]}
                    />
                  </li>
                )
              })}
            </ul>
          )}
          {filesHere.length > 0 && <DocumentCollection items={filesHere} {...props.collection} />}
        </>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-2 text-xs text-muted-foreground">
        <span>เข้าถึงเฉพาะไฟล์ที่สร้างผ่าน KrunameClass · ลบแล้วกู้คืนได้จากถังขยะของ Google Drive ภายใน 30 วัน</span>
        {quota && <span>ใช้พื้นที่ Google Drive {formatBytes(quota.usageBytes)}{quota.limitBytes ? ` จาก ${formatBytes(quota.limitBytes)}` : ''}</span>}
      </div>

      {props.attachments.length > 0 && (
        <section aria-label="ไฟล์จาก Google Drive ที่แนบในงานและบทเรียน" className="border-t border-border">
          <p className="px-4 pb-1 pt-3 text-sm font-semibold">ไฟล์จาก Google Drive ที่แนบในงานและบทเรียน ({props.attachments.length})</p>
          <DocumentCollection items={props.attachments} {...props.collection} />
        </section>
      )}
    </div>
  )
}

