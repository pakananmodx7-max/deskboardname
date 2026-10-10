import { AlertTriangle, CheckCircle2, ChevronDown, Cloud, FilePlus2, FileText, FolderPlus, Loader2, Plus, RotateCw, SearchX, Share2, Star, Upload, Users } from 'lucide-react'
import { useEffect, useId, useMemo, useReducer, useRef, useState } from 'react'
import type * as React from 'react'
import { Link } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import type { Resource } from '@/features/classroom-analytics/resource'
import { cn } from '@/lib/utils'

import { DocumentActivityPanel } from './document-activity-panel'
import {
  computeDocumentStats,
  deriveActivity,
  DOCUMENT_CATEGORIES,
  filterDocuments,
  hasActiveFilters,
  semesterOptions,
  sortDocuments,
  type DocumentCategory,
  type DocumentItem,
  type DocumentTab,
} from './document-center-model'
import { documentCenterUiReducer, INITIAL_UI_STATE, RECENT_LIMIT, type DocumentCenterUiState, type DocumentInfoTopic, type DriveConnection } from './document-center-ui'
import { DocumentEmptyState } from './document-empty-state'
import { DocumentFolderCard, NewFolderCard } from './document-folder-card'
import { DocumentInfoDialog } from './document-info-dialog'
import { DocumentStats, StorageCard } from './document-stats'
import { DocumentCollection, type DocumentActions } from './document-table'
import { DocumentTabs } from './document-tabs'
import { DocumentTemplateCard } from './document-template-card'
import { DOCUMENT_TEMPLATES } from './document-templates'
import { DocumentToolbar } from './document-toolbar'

export interface DocumentCenterViewProps extends Omit<DocumentActions, 'onToggleFavorite'> {
  data: Resource<DocumentItem[]>
  drive: DriveConnection
  userId: string | null
  favorites: ReadonlySet<string>
  onSetFavorites: (ids: string[], favorite: boolean) => void
  onRetry: () => void
  onConnectDrive: () => void
  onManageDrive: () => void
  busyId: string | null
  /** Tests / previews. */
  initialUi?: Partial<DocumentCenterUiState>
  now?: Date
}

function Section({ id, title, subtitle, action, children }: { id?: string; title: string; subtitle?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={id ? `${id}-title` : undefined} className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id={id ? `${id}-title` : undefined} className="text-base font-bold text-foreground">
            {title}
          </h2>
          {subtitle && <p className="mt-0.5 text-xs text-muted-foreground sm:text-sm">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

function DriveButton({ drive, onConnect, onManage }: { drive: DriveConnection; onConnect: () => void; onManage: () => void }) {
  const base = 'h-10 gap-2 rounded-xl'
  const logo = <Cloud className="size-4 text-emerald-600" aria-hidden="true" />
  switch (drive.status) {
    case 'loading':
      return (
        <Button type="button" variant="outline" className={base} disabled>
          <Loader2 className="size-4 animate-spin" />
          กำลังตรวจสอบ Google Drive
        </Button>
      )
    case 'connected':
      return (
        <Button type="button" variant="outline" className={base} onClick={onManage} title={drive.email ? `เชื่อมต่อกับ ${drive.email}` : undefined}>
          <CheckCircle2 className="size-4 text-emerald-600" aria-hidden="true" />
          เชื่อมต่อ Google Drive แล้ว
        </Button>
      )
    case 'unsupported':
      return (
        <Button type="button" variant="outline" className={base} disabled title="ใช้ได้เมื่อเชื่อมต่อฐานข้อมูลจริง (ไม่รองรับในโหมดสาธิต)">
          {logo}
          เชื่อมต่อ Google Drive
        </Button>
      )
    default:
      return (
        <Button type="button" variant="outline" className={base} onClick={onConnect}>
          {logo}
          เชื่อมต่อ Google Drive
        </Button>
      )
  }
}

/** "สร้างเอกสารใหม่" menu — every option is honest about Phase 1. */
function CreateMenu({ onPick }: { onPick: (choice: 'template' | 'blank' | 'upload' | 'folder') => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const menuId = useId()
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  const items = [
    { key: 'template', label: 'สร้างจากแบบฟอร์ม', Icon: FileText },
    { key: 'blank', label: 'เอกสารเปล่า', Icon: FilePlus2 },
    { key: 'upload', label: 'อัปโหลดไฟล์', Icon: Upload },
    { key: 'folder', label: 'สร้างโฟลเดอร์', Icon: FolderPlus },
  ] as const
  return (
    <div ref={ref} className="relative">
      <Button type="button" className="h-10 gap-2 rounded-xl px-4" onClick={() => setOpen((v) => !v)} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined}>
        <Plus className="size-4" />
        สร้างเอกสารใหม่
        <ChevronDown className="size-4" />
      </Button>
      {open && (
        <div id={menuId} role="menu" className="absolute right-0 z-30 mt-1.5 w-56 overflow-hidden rounded-xl border border-border bg-card p-1 shadow-lg">
          {items.map(({ key, label, Icon }) => (
            <button
              key={key}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false)
                onPick(key)
              }}
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
            >
              <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * ระบบเอกสาร (Phase 1): layout, navigation, search/filter and honest
 * empty/unavailable states over the teacher's real files. Presentational —
 * data and side effects come from DocumentCenterPage.
 */
export function DocumentCenterView({
  data,
  drive,
  userId,
  favorites,
  onSetFavorites,
  onRetry,
  onConnectDrive,
  onManageDrive,
  busyId,
  initialUi,
  now: nowProp,
  ...actions
}: DocumentCenterViewProps) {
  const [ui, dispatch] = useReducer(documentCenterUiReducer, { ...INITIAL_UI_STATE, ...initialUi })
  const [info, setInfo] = useState<DocumentInfoTopic | null>(null)
  const panelId = useId()
  // One clock per visit, so relative dates and memoised stats stay stable.
  const [now] = useState(() => nowProp ?? new Date())

  const items = useMemo(() => (data.status === 'success' ? data.data : []), [data])
  const loading = data.status === 'loading'
  const stats = useMemo(() => (data.status === 'success' ? computeDocumentStats(items, now) : null), [data.status, items, now])
  const activity = useMemo(() => deriveActivity(items), [items])
  const semesters = useMemo(() => semesterOptions(items), [items])
  const ctx = useMemo(() => ({ userId, favorites }), [userId, favorites])
  const visible = useMemo(() => sortDocuments(filterDocuments(items, ui.filters, ctx), ui.filters.sort), [items, ui.filters, ctx])
  const shown = ui.showAll ? visible : visible.slice(0, RECENT_LIMIT)
  const counts = useMemo(() => {
    const count = (tab: DocumentTab) => filterDocuments(items, { ...ui.filters, tab, query: '', kind: 'all', category: 'all', semester: 'all' }, ctx).length
    return data.status === 'success' ? { all: count('all'), mine: count('mine'), drive: count('drive'), favorites: count('favorites') } : {}
  }, [data.status, items, ui.filters, ctx])

  const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  const pickCategory = (category: DocumentCategory) => {
    dispatch({ type: 'filters', patch: { category: ui.filters.category === category ? 'all' : category } })
    scrollTo('documents-recent')
  }

  let body: React.ReactNode
  if (data.status === 'loading') {
    body = (
      <div className="space-y-2 p-4" role="status" aria-label="กำลังโหลดเอกสาร" data-testid="document-loading">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="flex items-center gap-3">
            <span className="size-7 animate-pulse rounded-md bg-muted" />
            <span className="h-4 flex-1 animate-pulse rounded bg-muted" />
            <span className="hidden h-4 w-24 animate-pulse rounded bg-muted sm:block" />
          </div>
        ))}
      </div>
    )
  } else if (data.status === 'error') {
    body = (
      <div role="alert" className="flex flex-col items-center gap-3 px-6 py-10 text-center" data-testid="document-error">
        <AlertTriangle className="size-6 text-destructive" />
        <p className="text-sm text-foreground">{data.error}</p>
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          <RotateCw className="size-4" />
          ลองใหม่
        </Button>
      </div>
    )
  } else if (ui.filters.tab === 'shared') {
    body = <DocumentEmptyState icon={Share2} title="ยังไม่มีเอกสารที่แชร์กับคุณ" description="ระบบยังไม่รองรับการแชร์เอกสารระหว่างครู — จะเปิดให้ใช้ในเฟสถัดไป" />
  } else if (visible.length === 0 && hasActiveFilters(ui.filters)) {
    body = (
      <DocumentEmptyState
        icon={SearchX}
        title="ไม่พบเอกสารที่ตรงกับการค้นหา"
        description="ลองเปลี่ยนคำค้นหาหรือตัวกรอง"
        action={
          <Button type="button" variant="outline" size="sm" onClick={() => dispatch({ type: 'clearFilters' })}>
            ล้างตัวกรอง
          </Button>
        }
      />
    )
  } else if (visible.length === 0 && ui.filters.tab === 'drive') {
    body =
      drive.status === 'connected' ? (
        <DocumentEmptyState icon={Cloud} title="ยังไม่มีไฟล์จาก Google Drive" description="แสดงเฉพาะไฟล์ที่เลือกจาก Google Drive มาแนบในงานหรือบทเรียน — ระบบไม่ได้อ่านไฟล์ทั้งหมดใน Drive ของคุณ" />
      ) : (
        <DocumentEmptyState
          icon={Cloud}
          title={drive.status === 'unsupported' ? 'Google Drive ใช้ได้เมื่อเชื่อมต่อฐานข้อมูลจริง' : 'ยังไม่ได้เชื่อมต่อ Google Drive'}
          description="เชื่อมต่อบัญชี Google แล้วเลือกไฟล์จาก Drive มาแนบในงานหรือบทเรียน ไฟล์เหล่านั้นจะแสดงที่นี่"
          action={
            drive.status === 'unsupported' ? undefined : (
              <Button type="button" variant="outline" size="sm" onClick={onConnectDrive}>
                เชื่อมต่อ Google Drive
              </Button>
            )
          }
        />
      )
  } else if (visible.length === 0 && ui.filters.tab === 'favorites') {
    body = <DocumentEmptyState icon={Star} title="ยังไม่มีรายการโปรด" description="กดรูปดาวที่เอกสารเพื่อเพิ่มในรายการโปรด (บันทึกไว้ในอุปกรณ์นี้)" />
  } else if (visible.length === 0) {
    body = (
      <DocumentEmptyState
        icon={FileText}
        title="ยังไม่มีเอกสาร"
        description="ไฟล์และลิงก์ที่แนบในงานหรือบทเรียนของคุณจะแสดงที่นี่ — การสร้างเอกสารจากแบบฟอร์มจะเปิดให้ใช้ในเฟส 2"
        action={
          <Button asChild variant="outline" size="sm">
            <Link to="/teacher/subjects">ไปที่รายวิชา</Link>
          </Button>
        }
      />
    )
  } else {
    body = (
      <>
        {ui.selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-b border-border bg-primary/5 px-4 py-2 text-sm" role="status">
            <span className="font-medium">เลือก {ui.selected.size} รายการ</span>
            <Button type="button" variant="outline" size="sm" onClick={() => onSetFavorites([...ui.selected], true)}>
              <Star className="size-4" />
              เพิ่มในรายการโปรด
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => dispatch({ type: 'clearSelection' })}>
              ยกเลิกการเลือก
            </Button>
          </div>
        )}
        <DocumentCollection
          items={shown}
          view={ui.view}
          selected={ui.selected}
          favorites={favorites}
          busyId={busyId}
          now={now}
          onToggleSelect={(id) => dispatch({ type: 'toggleSelect', id })}
          onSelectAll={() => dispatch({ type: 'selectAll', ids: shown.map((i) => i.id) })}
          onToggleFavorite={(item) => onSetFavorites([item.id], !favorites.has(item.id))}
          {...actions}
        />
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-2.5 text-xs text-muted-foreground">
          <span>
            แสดง {shown.length} จาก {visible.length} รายการ
          </span>
          {visible.length > RECENT_LIMIT && (
            <button type="button" onClick={() => dispatch({ type: 'showAll', value: !ui.showAll })} className="font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
              {ui.showAll ? 'แสดงเฉพาะล่าสุด' : 'ดูเอกสารทั้งหมด'}
            </button>
          )}
        </div>
      </>
    )
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-primary/12 text-primary" aria-hidden="true">
            <FileText className="size-7" />
          </span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">ระบบเอกสาร</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">จัดเก็บและจัดการเอกสาร แบบฟอร์ม และไฟล์ต่าง ๆ ของคุณในที่เดียว</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DriveButton drive={drive} onConnect={onConnectDrive} onManage={onManageDrive} />
          <CreateMenu
            onPick={(choice) => {
              if (choice === 'template') scrollTo('document-templates')
              else setInfo({ kind: choice })
            }}
          />
        </div>
      </header>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_16.5rem]">
        <div className="min-w-0 space-y-6">
          <DocumentStats stats={stats} loading={loading} drive={drive} />

          <div className="space-y-3">
            <DocumentTabs active={ui.filters.tab} onChange={(tab) => dispatch({ type: 'tab', tab })} counts={counts} panelId={panelId} />
            <DocumentToolbar filters={ui.filters} semesters={semesters} view={ui.view} onFilters={(patch) => dispatch({ type: 'filters', patch })} onView={(view) => dispatch({ type: 'view', view })} />
          </div>

          <Section id="document-templates" title="สร้างเอกสารจากแบบฟอร์ม" subtitle="เลือกแบบฟอร์มเอกสารสำหรับครู พร้อมรองรับการดึงข้อมูลจากระบบในอนาคต">
            <div className="grid grid-cols-[repeat(auto-fill,minmax(10.25rem,1fr))] gap-3">
              {DOCUMENT_TEMPLATES.map((template) => (
                <DocumentTemplateCard key={template.id} template={template} onCreate={(t) => setInfo({ kind: 'template', template: t })} />
              ))}
            </div>
          </Section>

          <Section id="document-folders" title="โฟลเดอร์ของฉัน" subtitle="หมวดหมู่เอกสาร — เลือกเพื่อกรองรายการด้านล่าง">
            <div className="grid grid-cols-[repeat(auto-fill,minmax(10.25rem,1fr))] gap-3">
              {DOCUMENT_CATEGORIES.map((category) => (
                <DocumentFolderCard
                  key={category.key}
                  category={category}
                  count={stats ? stats.byCategory[category.key] : null}
                  loading={loading && category.supported}
                  active={ui.filters.category === category.key}
                  onSelect={pickCategory}
                />
              ))}
              <NewFolderCard onClick={() => setInfo({ kind: 'folder' })} />
            </div>
          </Section>

          <Section
            id="documents-recent"
            title="เอกสารล่าสุด"
            action={
              data.status === 'success' && visible.length > RECENT_LIMIT && !ui.showAll ? (
                <button type="button" onClick={() => dispatch({ type: 'showAll', value: true })} className="text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
                  ดูเอกสารทั้งหมด →
                </button>
              ) : undefined
            }
          >
            <div id={panelId} role="tabpanel" aria-labelledby={`document-tab-${ui.filters.tab}`} className={cn('overflow-hidden rounded-2xl border border-border bg-card shadow-sm')}>
              {body}
            </div>
          </Section>
        </div>

        <aside className="space-y-4" aria-label="ข้อมูลเพิ่มเติม">
          <StorageCard usage={null} />
          <DocumentActivityPanel activity={activity} loading={loading} now={now} />
          <div className="rounded-2xl border border-dashed border-border bg-card/60 p-4 text-xs leading-relaxed text-muted-foreground">
            <p className="flex items-center gap-1.5 font-semibold text-foreground">
              <Users className="size-4 text-primary" aria-hidden="true" />
              ระบบเอกสาร เฟส 1
            </p>
            <p className="mt-1">แสดงไฟล์และลิงก์จริงที่แนบในงานและบทเรียนของคุณ การสร้างเอกสารอัตโนมัติ การแก้ไข และการส่งออก Word / PDF จะมาในเฟส 2</p>
          </div>
        </aside>
      </div>

      <DocumentInfoDialog topic={info} onClose={() => setInfo(null)} />
    </div>
  )
}
