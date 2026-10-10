import { Download, Eye, Loader2, Star } from 'lucide-react'
import type * as React from 'react'

import { RowActionsMenu, type RowAction } from '@/components/ui/row-actions-menu'
import { cn } from '@/lib/utils'

import { canDownload, CATEGORY_LABEL, formatDocumentDate, formatSize, KIND_LABEL, placeLabel, SOURCE_LABEL, sourcePath, type DocumentItem } from './document-center-model'
import { KIND_STYLE } from './document-center-ui'

export interface DocumentActions {
  onPreview: (item: DocumentItem) => void
  onDownload: (item: DocumentItem) => void
  onToggleFavorite: (item: DocumentItem) => void
  onOpenSource: (item: DocumentItem) => void
  onCopyLink: (item: DocumentItem) => void
  /** Drive storage files only (Phase 2). */
  onRename?: (item: DocumentItem) => void
  onTrash?: (item: DocumentItem) => void
}

export interface DocumentCollectionProps extends DocumentActions {
  items: DocumentItem[]
  view: 'list' | 'grid'
  selected: ReadonlySet<string>
  favorites: ReadonlySet<string>
  /** Item currently opening/downloading. */
  busyId: string | null
  now: Date
  onToggleSelect: (id: string) => void
  onSelectAll: () => void
}

export function KindTile({ item, className }: { item: DocumentItem; className?: string }) {
  const style = KIND_STYLE[item.kind]
  const Icon = style.icon
  return (
    <span className={cn('flex size-7 shrink-0 items-center justify-center rounded-[6px] text-[9px] font-bold', style.tile, className)} aria-hidden="true">
      {style.short ? style.short : <Icon className="size-3.5" />}
    </span>
  )
}

function moreActions(item: DocumentItem, actions: DocumentActions): RowAction[] {
  const list: RowAction[] = []
  if (sourcePath(item)) list.push({ key: 'source', label: item.source === 'assignment' ? 'เปิดหน้างานที่แนบไฟล์นี้' : 'เปิดหน้าบทเรียนที่แนบไฟล์นี้', onSelect: () => actions.onOpenSource(item) })
  if (item.url) list.push({ key: 'copy', label: 'คัดลอกลิงก์', onSelect: () => actions.onCopyLink(item) })
  if (item.source === 'drive' && actions.onRename) list.push({ key: 'rename', label: 'เปลี่ยนชื่อ', onSelect: () => actions.onRename!(item) })
  if (item.source === 'drive' && actions.onTrash) list.push({ key: 'trash', label: 'ลบ (ย้ายไปถังขยะ)', onSelect: () => actions.onTrash!(item), destructive: true, separatorBefore: list.length > 0 })
  if (list.length === 0) list.push({ key: 'none', label: 'ไม่มีการดำเนินการเพิ่มเติม', onSelect: () => {}, disabled: true })
  return list
}

function ActionButtons({ item, favorite, busy, actions }: { item: DocumentItem; favorite: boolean; busy: boolean; actions: DocumentActions }) {
  const downloadable = canDownload(item)
  const iconBtn = 'flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:pointer-events-none disabled:opacity-35'
  return (
    <div className="flex items-center justify-end gap-0.5">
      <button type="button" className={iconBtn} onClick={() => actions.onPreview(item)} aria-label={`ดูตัวอย่าง ${item.title}`} title={downloadable ? 'ดูตัวอย่าง' : 'เปิดลิงก์'} disabled={busy}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Eye className="size-4" />}
      </button>
      <button
        type="button"
        className={iconBtn}
        onClick={() => actions.onDownload(item)}
        disabled={!downloadable || busy}
        aria-label={downloadable ? `ดาวน์โหลด ${item.title}` : `${item.title} เป็นลิงก์ภายนอก ไม่มีไฟล์ให้ดาวน์โหลด`}
        title={downloadable ? 'ดาวน์โหลด' : 'ลิงก์ภายนอก — ไม่มีไฟล์ให้ดาวน์โหลด'}
      >
        <Download className="size-4" />
      </button>
      <button
        type="button"
        className={cn(iconBtn, favorite && 'text-amber-500 hover:text-amber-500')}
        onClick={() => actions.onToggleFavorite(item)}
        aria-pressed={favorite}
        aria-label={favorite ? `นำ ${item.title} ออกจากรายการโปรด` : `เพิ่ม ${item.title} ในรายการโปรด`}
        title={favorite ? 'นำออกจากรายการโปรด' : 'เพิ่มรายการโปรด'}
      >
        <Star className={cn('size-4', favorite && 'fill-amber-400')} />
      </button>
      <RowActionsMenu actions={moreActions(item, actions)} label={`ตัวเลือกเพิ่มเติมของ ${item.title}`} />
    </div>
  )
}

function Pill({ className, children }: { className: string; children: React.ReactNode }) {
  return <span className={cn('inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium', className)}>{children}</span>
}

/** "เอกสารล่าสุด" — responsive table (list) or cards (grid). */
export function DocumentCollection({ items, view, selected, favorites, busyId, now, onToggleSelect, onSelectAll, ...actions }: DocumentCollectionProps) {
  const allSelected = items.length > 0 && items.every((i) => selected.has(i.id))

  if (view === 'grid') {
    return (
      <ul className="grid gap-3 p-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="รายการเอกสาร" data-testid="document-grid">
        {items.map((item) => {
          const favorite = favorites.has(item.id)
          return (
            <li key={item.id} className={cn('flex flex-col rounded-2xl border bg-card p-3.5', selected.has(item.id) ? 'border-primary ring-1 ring-primary/30' : 'border-border')}>
              <div className="flex items-start gap-2.5">
                <input
                  type="checkbox"
                  checked={selected.has(item.id)}
                  onChange={() => onToggleSelect(item.id)}
                  aria-label={`เลือก ${item.title}`}
                  className="mt-1.5 size-4 shrink-0 accent-[var(--primary)]"
                />
                <KindTile item={item} className="size-9 text-[10px]" />
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-sm font-semibold leading-snug text-foreground">{item.title}</p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">{item.source === 'drive' ? item.parentTitle : placeLabel(item)}</p>
                </div>
              </div>
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                <Pill className={KIND_STYLE[item.kind].badge}>{KIND_LABEL[item.kind]}</Pill>
                <Pill className="bg-primary/10 text-primary">{CATEGORY_LABEL[item.category]}</Pill>
              </div>
              <div className="mt-2 flex items-center justify-between gap-2 border-t border-border/70 pt-2">
                <span className="text-xs text-muted-foreground">{formatDocumentDate(item.updatedAt, now)}</span>
                <ActionButtons item={item} favorite={favorite} busy={busyId === item.id} actions={actions} />
              </div>
            </li>
          )
        })}
      </ul>
    )
  }

  return (
    <div className="overflow-x-auto" data-testid="document-table">
      <table className="w-full min-w-[860px] text-left text-sm">
        <thead>
          <tr className="border-b border-border text-xs text-muted-foreground">
            <th scope="col" className="w-10 px-4 py-2.5">
              <input type="checkbox" checked={allSelected} onChange={onSelectAll} aria-label="เลือกเอกสารทั้งหมดในหน้านี้" className="size-4 accent-[var(--primary)]" />
            </th>
            <th scope="col" className="px-2 py-2.5 font-medium">
              ชื่อเอกสาร
            </th>
            <th scope="col" className="px-2 py-2.5 font-medium">
              ประเภท
            </th>
            <th scope="col" className="px-2 py-2.5 font-medium">
              หมวดหมู่
            </th>
            <th scope="col" className="px-2 py-2.5 font-medium">
              ห้องเรียน / รายวิชา
            </th>
            <th scope="col" className="px-2 py-2.5 font-medium">
              แก้ไขล่าสุด
            </th>
            <th scope="col" className="px-2 py-2.5 font-medium">
              ขนาด
            </th>
            <th scope="col" className="px-4 py-2.5 text-right font-medium">
              การดำเนินการ
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const favorite = favorites.has(item.id)
            const checked = selected.has(item.id)
            return (
              <tr key={item.id} className={cn('border-b border-border/70 last:border-0 hover:bg-accent/40', checked && 'bg-primary/[0.04]')}>
                <td className="px-4 py-2">
                  <input type="checkbox" checked={checked} onChange={() => onToggleSelect(item.id)} aria-label={`เลือก ${item.title}`} className="size-4 accent-[var(--primary)]" />
                </td>
                <td className="max-w-[22rem] px-2 py-2">
                  <div className="flex items-center gap-2.5">
                    <KindTile item={item} />
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 font-medium text-foreground">
                        <span className="truncate">{item.title}</span>
                        {favorite && <Star className="size-3.5 shrink-0 fill-amber-400 text-amber-500" aria-label="รายการโปรด" />}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {item.source === 'drive' ? item.parentTitle : `${SOURCE_LABEL[item.source]}: ${item.parentTitle}`}
                      </p>
                    </div>
                  </div>
                </td>
                <td className="px-2 py-2">
                  <Pill className={KIND_STYLE[item.kind].badge}>{KIND_LABEL[item.kind]}</Pill>
                </td>
                <td className="px-2 py-2">
                  <Pill className="bg-primary/10 text-primary">{CATEGORY_LABEL[item.category]}</Pill>
                </td>
                <td className="px-2 py-2 text-muted-foreground">{item.source === 'drive' ? 'Google Drive' : placeLabel(item)}</td>
                <td className="whitespace-nowrap px-2 py-2 text-muted-foreground">{formatDocumentDate(item.updatedAt, now)}</td>
                <td className="whitespace-nowrap px-2 py-2 text-muted-foreground" title={item.sizeBytes === null ? 'ระบบยังไม่ได้บันทึกขนาดไฟล์' : undefined}>
                  {formatSize(item.sizeBytes)}
                </td>
                <td className="px-4 py-2">
                  <ActionButtons item={item} favorite={favorite} busy={busyId === item.id} actions={actions} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
