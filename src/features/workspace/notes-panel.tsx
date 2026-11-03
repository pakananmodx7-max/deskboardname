import { Archive, ArchiveRestore, ArrowLeft, Copy, ExternalLink, FileText, Pin, PinOff, Plus, Search, StickyNote, Trash2 } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/select'
import { useToast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'

import { useWorkspaceState, useWorkspaceStore } from './workspace-hooks'
import { formatThaiDateTime } from './workspace-dates'
import { hostLabel } from './workspace-links-model'
import {
  DEFAULT_NOTE_CATEGORIES,
  DEFAULT_NOTE_FILTERS,
  extractLinks,
  filterNotes,
  formatTags,
  MAX_NOTE_TITLE,
  NOTE_SORTS,
  noteCopyText,
  noteDisplayTitle,
  noteExcerpt,
  parseTags,
  type NoteFilters,
  type NoteSort,
} from './workspace-notes-model'
import { categoryOptions } from './workspace-tasks-model'
import type { WorkspaceNote } from './workspace-types'
import { CategoryInput, EmptyState, ListSkeleton, SaveIndicator } from './workspace-ui'

/** บันทึก tab: searchable list + editor (side by side on desktop, one at a time on phones). */
export function NotesPanel({ selectedId, onSelect, loading }: { selectedId: string | null; onSelect: (id: string | null) => void; loading: boolean }) {
  const store = useWorkspaceStore()
  const { notes } = useWorkspaceState()
  const [filters, setFilters] = useState<NoteFilters>(DEFAULT_NOTE_FILTERS)
  const visible = useMemo(() => filterNotes(notes, filters), [notes, filters])
  const categories = useMemo(() => categoryOptions(DEFAULT_NOTE_CATEGORIES, notes.map((n) => n.category)), [notes])
  const selected = notes.find((n) => n.id === selectedId) ?? null
  const archivedCount = notes.filter((n) => n.archivedAt).length
  const searchId = useId()

  const create = () => {
    const note = store.createNote(filters.category !== 'all' ? { category: filters.category } : {})
    setFilters((f) => ({ ...f, view: 'active', query: '' }))
    onSelect(note.id)
  }

  return (
    <div className="grid min-h-[60vh] gap-4 lg:grid-cols-[minmax(17rem,22rem)_minmax(0,1fr)]">
      <section className={cn('min-w-0 flex-col rounded-2xl border border-border bg-card p-3 shadow-sm sm:p-4', selected ? 'hidden lg:flex' : 'flex')} aria-label="รายการบันทึก">
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <label htmlFor={searchId} className="sr-only">
              ค้นหาบันทึก
            </label>
            <Input id={searchId} type="search" value={filters.query} onChange={(e) => setFilters((f) => ({ ...f, query: e.target.value }))} placeholder="ค้นหาบันทึก แท็ก หรือหมวดหมู่" className="pl-9" />
          </div>
          <Button type="button" onClick={create} aria-label="สร้างบันทึกใหม่" data-testid="note-create">
            <Plus />
            <span className="hidden sm:inline">ใหม่</span>
          </Button>
        </div>
        <div className="mt-2 grid grid-cols-3 gap-2">
          <NativeSelect aria-label="มุมมองบันทึก" value={filters.view} onChange={(e) => setFilters((f) => ({ ...f, view: e.target.value as NoteFilters['view'] }))} className="h-8 px-2 text-xs">
            <option value="active">ใช้งานอยู่</option>
            <option value="archived">เก็บถาวร ({archivedCount})</option>
          </NativeSelect>
          <NativeSelect aria-label="กรองหมวดหมู่บันทึก" value={filters.category} onChange={(e) => setFilters((f) => ({ ...f, category: e.target.value }))} className="h-8 px-2 text-xs">
            <option value="all">ทุกหมวดหมู่</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect aria-label="เรียงบันทึก" value={filters.sort} onChange={(e) => setFilters((f) => ({ ...f, sort: e.target.value as NoteSort }))} className="h-8 px-2 text-xs">
            {NOTE_SORTS.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="mt-3 min-h-0 flex-1 overflow-y-auto lg:max-h-[calc(100vh-22rem)]">
          {loading ? (
            <ListSkeleton label="กำลังโหลดบันทึก" />
          ) : visible.length === 0 ? (
            notes.length === 0 ? (
              <EmptyState icon={StickyNote} title="ยังไม่มีบันทึก" description="จดไอเดีย สรุปประชุม หรือสิ่งที่ต้องจำ ระบบบันทึกให้อัตโนมัติขณะพิมพ์" action={<Button type="button" size="sm" onClick={create}><Plus />สร้างบันทึกแรก</Button>} />
            ) : (
              <EmptyState compact icon={Search} title={filters.view === 'archived' ? 'ไม่มีบันทึกที่เก็บถาวร' : 'ไม่พบบันทึกที่ตรงกับการค้นหา'} />
            )
          ) : (
            <ul className="space-y-1.5" data-testid="note-list">
              {visible.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(n.id)}
                    aria-current={n.id === selectedId ? 'true' : undefined}
                    className={cn('w-full rounded-xl border px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40', n.id === selectedId ? 'border-primary/50 bg-primary/8' : 'border-transparent hover:bg-accent/60', n.pinned && !n.archivedAt && 'border-l-4 border-l-amber-400')}
                    data-testid="note-item"
                  >
                    <span className="flex items-center gap-1.5">
                      {n.pinned && !n.archivedAt && <Pin className="size-3.5 shrink-0 text-amber-500" aria-label="ปักหมุด" />}
                      <span className="truncate text-sm font-semibold text-foreground">{noteDisplayTitle(n)}</span>
                    </span>
                    {noteExcerpt(n) && <span className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{noteExcerpt(n)}</span>}
                    <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                      <span>{formatThaiDateTime(n.updatedAt)}</span>
                      {n.category && <span className="rounded-full bg-muted px-1.5">{n.category}</span>}
                      {n.tags.slice(0, 3).map((t) => (
                        <span key={t} className="text-primary">
                          #{t}
                        </span>
                      ))}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className={cn('min-w-0 rounded-2xl border border-border bg-card shadow-sm', selected ? 'block' : 'hidden lg:block')} aria-label="แก้ไขบันทึก">
        {selected ? (
          <NoteEditor key={selected.id} note={selected} categories={categories} onClose={() => onSelect(null)} />
        ) : (
          <div className="flex h-full items-center justify-center p-6">
            <EmptyState icon={FileText} title="เลือกบันทึกเพื่อแก้ไข" description="หรือสร้างบันทึกใหม่ ทุกการแก้ไขจะบันทึกอัตโนมัติ" />
          </div>
        )}
      </section>
    </div>
  )
}

function NoteEditor({ note, categories, onClose }: { note: WorkspaceNote; categories: string[]; onClose: () => void }) {
  const store = useWorkspaceStore()
  const state = useWorkspaceState()
  const { toast } = useToast()
  const [title, setTitle] = useState(note.title)
  const [body, setBody] = useState(note.body)
  const [category, setCategory] = useState(note.category ?? '')
  const [tags, setTags] = useState(formatTags(note.tags))
  const [confirmDelete, setConfirmDelete] = useState(false)
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const id = useId()
  const status = state.noteStatus[note.id]
  const conflict = state.noteConflicts[note.id]
  const draft = state.recoverableDrafts[note.id]
  const links = useMemo(() => extractLinks(body), [body])

  // Leaving the note (another note, another tab, unmount) saves right away.
  useEffect(() => () => void store.flushNote(note.id), [store, note.id])

  // Grow the textarea with its content.
  useEffect(() => {
    const el = bodyRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.max(el.scrollHeight, 240)}px`
  }, [body])

  const edit = (patch: Parameters<typeof store.editNote>[1], immediate = false) => store.editNote(note.id, patch, { immediate })
  const reloadFrom = (n: WorkspaceNote) => {
    setTitle(n.title)
    setBody(n.body)
    setCategory(n.category ?? '')
    setTags(formatTags(n.tags))
  }

  return (
    <div className="flex h-full flex-col" data-testid="note-editor">
      <div className="flex flex-wrap items-center gap-1 border-b border-border px-3 py-2 sm:px-4">
        <Button type="button" variant="ghost" size="sm" onClick={onClose} className="lg:hidden" aria-label="กลับไปรายการบันทึก">
          <ArrowLeft />
          รายการ
        </Button>
        <SaveIndicator status={status} />
        <span className="ml-auto flex items-center gap-0.5">
          <IconAction label={note.pinned ? 'เลิกปักหมุด' : 'ปักหมุด'} onClick={() => edit({ pinned: !note.pinned }, true)} pressed={note.pinned}>
            {note.pinned ? <PinOff /> : <Pin />}
          </IconAction>
          <IconAction
            label="คัดลอกเนื้อหา"
            onClick={() =>
              navigator.clipboard?.writeText(noteCopyText({ title, body })).then(
                () => toast('คัดลอกบันทึกแล้ว'),
                () => toast('คัดลอกไม่สำเร็จ', 'error'),
              )
            }
          >
            <Copy />
          </IconAction>
          <IconAction
            label={note.archivedAt ? 'นำกลับมาใช้' : 'เก็บถาวร'}
            onClick={() => {
              edit({ archivedAt: note.archivedAt ? null : new Date().toISOString(), ...(note.archivedAt ? {} : { pinned: false }) }, true)
              toast(note.archivedAt ? 'นำบันทึกกลับมาแล้ว' : 'เก็บบันทึกถาวรแล้ว', 'info')
            }}
          >
            {note.archivedAt ? <ArchiveRestore /> : <Archive />}
          </IconAction>
          <IconAction label="ลบบันทึก" onClick={() => setConfirmDelete(true)} destructive>
            <Trash2 />
          </IconAction>
        </span>
      </div>

      {conflict !== undefined && (
        <div role="alert" className="mx-3 mt-3 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm sm:mx-4" data-testid="note-conflict">
          <p className="font-semibold text-foreground">{conflict ? 'บันทึกนี้ถูกแก้ไขจากอุปกรณ์อื่น' : 'บันทึกนี้ถูกลบจากอุปกรณ์อื่น'}</p>
          <p className="mt-0.5 text-muted-foreground">{conflict ? 'เลือกว่าจะเก็บฉบับใด ระบบยังไม่ได้เขียนทับฉบับใดเลย' : 'ข้อความในหน้านี้ยังอยู่ เลือกว่าจะบันทึกเป็นบันทึกใหม่หรือไม่'}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button type="button" size="sm" onClick={() => store.resolveConflict(note.id, 'mine')}>
              {conflict ? 'ใช้ฉบับของฉัน' : 'บันทึกเป็นบันทึกใหม่'}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                if (conflict) reloadFrom(conflict)
                store.resolveConflict(note.id, 'theirs')
              }}
            >
              {conflict ? 'ใช้ฉบับล่าสุด' : 'ทิ้งข้อความนี้'}
            </Button>
          </div>
        </div>
      )}

      {draft && conflict === undefined && (
        <div role="status" className="mx-3 mt-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm sm:mx-4" data-testid="note-draft">
          <p className="font-semibold text-foreground">พบข้อความที่ยังไม่ได้บันทึกจากครั้งก่อน</p>
          <p className="mt-0.5 text-muted-foreground">เขียนไว้เมื่อ {formatThaiDateTime(new Date(draft.savedAt).toISOString())}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              onClick={() => {
                reloadFrom({ ...note, ...draft.fields })
                store.restoreDraft(note.id)
              }}
            >
              กู้คืนข้อความ
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => store.dismissDraft(note.id)}>
              ทิ้ง
            </Button>
          </div>
        </div>
      )}

      <div className="flex flex-1 flex-col gap-3 p-3 sm:p-4">
        <label htmlFor={`${id}-title`} className="sr-only">
          ชื่อบันทึก
        </label>
        <input
          id={`${id}-title`}
          value={title}
          maxLength={MAX_NOTE_TITLE}
          onChange={(e) => {
            setTitle(e.target.value)
            edit({ title: e.target.value })
          }}
          placeholder="ชื่อบันทึก"
          className="w-full rounded-lg bg-transparent px-1 text-xl font-bold text-foreground outline-none placeholder:text-muted-foreground/60 focus-visible:ring-2 focus-visible:ring-primary/30"
          data-testid="note-title"
        />
        <div className="grid gap-2 sm:grid-cols-2">
          <div>
            <label htmlFor={`${id}-cat`} className="mb-1 block text-xs font-medium text-muted-foreground">
              หมวดหมู่
            </label>
            <CategoryInput
              id={`${id}-cat`}
              value={category}
              options={categories}
              onChange={(v) => {
                setCategory(v)
                edit({ category: v.trim() || null })
              }}
            />
          </div>
          <div>
            <label htmlFor={`${id}-tags`} className="mb-1 block text-xs font-medium text-muted-foreground">
              แท็ก (คั่นด้วยจุลภาค)
            </label>
            <Input
              id={`${id}-tags`}
              value={tags}
              onChange={(e) => {
                setTags(e.target.value)
                edit({ tags: parseTags(e.target.value) })
              }}
              placeholder="เช่น ม.2, กิจกรรม"
            />
          </div>
        </div>
        <label htmlFor={`${id}-body`} className="sr-only">
          เนื้อหาบันทึก
        </label>
        <textarea
          id={`${id}-body`}
          ref={bodyRef}
          value={body}
          onChange={(e) => {
            setBody(e.target.value)
            edit({ body: e.target.value })
          }}
          placeholder="เริ่มพิมพ์บันทึก… วางลิงก์ http(s) ได้ ระบบจะแสดงไว้ด้านล่าง"
          className="min-h-60 w-full flex-1 resize-none rounded-xl border border-input bg-background px-3.5 py-3 text-[15px] leading-relaxed shadow-sm outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30"
          data-testid="note-body"
        />
        {links.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">ลิงก์ในบันทึก</p>
            <ul className="flex flex-wrap gap-2">
              {links.map((href) => (
                <li key={href}>
                  <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-64 items-center gap-1 truncate rounded-full border border-border px-2.5 py-1 text-xs text-primary hover:bg-accent">
                    <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
                    <span className="truncate">{hostLabel(href)}</span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
        <p className="text-[11px] text-muted-foreground">
          สร้างเมื่อ {formatThaiDateTime(note.createdAt)} · แก้ไขล่าสุด {formatThaiDateTime(note.updatedAt)}
          {note.archivedAt && ' · เก็บถาวรแล้ว'}
        </p>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="ลบบันทึกนี้?"
        description={`“${noteDisplayTitle({ title, body })}” จะถูกลบถาวรและกู้คืนไม่ได้ หากอยากเก็บไว้ดูภายหลังให้ใช้ “เก็บถาวร” แทน`}
        confirmLabel="ลบบันทึก"
        destructive
        onConfirm={async () => {
          setConfirmDelete(false)
          onClose()
          if (await store.deleteNote(note.id)) toast('ลบบันทึกแล้ว', 'info')
        }}
      />
    </div>
  )
}

function IconAction({ label, onClick, children, pressed, destructive }: { label: string; onClick: () => void; children: React.ReactNode; pressed?: boolean; destructive?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      className={cn('rounded-full p-2 text-muted-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 [&_svg]:size-4', destructive ? 'hover:text-destructive' : 'hover:text-foreground', pressed && 'text-amber-500')}
    >
      {children}
    </button>
  )
}
