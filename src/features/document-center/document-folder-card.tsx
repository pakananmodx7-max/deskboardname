import { Folder, Plus } from 'lucide-react'

import { cn } from '@/lib/utils'

import type { CategoryInfo, DocumentCategory } from './document-center-model'

const FOLDER_TONE: Record<DocumentCategory, string> = {
  academic: 'text-blue-500 fill-blue-500/25',
  homeroom: 'text-amber-500 fill-amber-500/25',
  reports: 'text-emerald-500 fill-emerald-500/25',
  personal: 'text-violet-500 fill-violet-500/25',
  uncategorized: 'text-sky-500 fill-sky-500/25',
}

export interface DocumentFolderCardProps {
  category: CategoryInfo
  /** Real item count; null when the category has no data source yet. */
  count: number | null
  loading: boolean
  active: boolean
  onSelect: (category: DocumentCategory) => void
}

/** A category "folder": selecting it filters the document list. */
export function DocumentFolderCard({ category, count, loading, active, onSelect }: DocumentFolderCardProps) {
  const unavailable = count === null
  return (
    <button
      type="button"
      onClick={() => onSelect(category.key)}
      aria-pressed={active}
      title={unavailable ? 'เชื่อมต่อ Google Drive เพื่อเก็บเอกสารในหมวดนี้' : undefined}
      className={cn(
        'flex min-w-0 items-center gap-3 rounded-2xl border bg-card p-3.5 text-left shadow-sm transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
        active ? 'border-primary ring-1 ring-primary/30' : 'border-border',
      )}
    >
      <Folder className={cn('size-9 shrink-0', FOLDER_TONE[category.key])} aria-hidden="true" />
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold text-foreground">{category.label}</span>
        <span className="block text-xs text-muted-foreground">
          {loading ? 'กำลังโหลด...' : unavailable ? 'ยังไม่มีแหล่งข้อมูล' : `${count} รายการ`}
        </span>
      </span>
    </button>
  )
}

export function NewFolderCard({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-card p-3.5 text-sm font-semibold text-primary shadow-sm transition-colors hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
    >
      <Plus className="size-5" aria-hidden="true" />
      สร้างโฟลเดอร์ใหม่
    </button>
  )
}
