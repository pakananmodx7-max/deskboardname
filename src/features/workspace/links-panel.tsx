import { Copy, ExternalLink, Link2, Loader2, MoreHorizontal, Pencil, Pin, PinOff, Plus, Search, Trash2 } from 'lucide-react'
import { useEffect, useId, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'

import { useWorkspaceState, useWorkspaceStore } from './workspace-hooks'
import { formatThaiDateTime } from './workspace-dates'
import { DEFAULT_LINK_CATEGORIES, DEFAULT_LINK_FILTERS, filterLinks, hostLabel, LINK_SORTS, normalizeLinkUrl, safeHref, suggestTitle, validateLinkFields, type LinkFilters, type LinkSort } from './workspace-links-model'
import { categoryOptions } from './workspace-tasks-model'
import type { WorkspaceLink } from './workspace-types'
import { CategoryInput, EmptyState, ListSkeleton } from './workspace-ui'

/** Site initial in a coloured circle (no third-party favicon requests). */
export function LinkAvatar({ url }: { url: string }) {
  const host = hostLabel(url)
  const hue = [...host].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7)
  return (
    <span className="flex size-9 shrink-0 items-center justify-center rounded-xl text-sm font-bold text-white" style={{ background: `hsl(${hue} 55% 48%)` }} aria-hidden="true">
      {host.charAt(0).toUpperCase() || '?'}
    </span>
  )
}

/** Opens a stored link safely (http/https only, no opener access) and counts the visit. */
export function SafeLinkAnchor({ link, className, children, onOpened }: { link: WorkspaceLink; className?: string; children: React.ReactNode; onOpened?: () => void }) {
  const href = safeHref(link.url)
  if (!href) return <span className={cn(className, 'cursor-not-allowed opacity-60')} title="ลิงก์นี้ไม่ปลอดภัย จึงไม่เปิดให้">{children}</span>
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" className={className} onClick={onOpened} onAuxClick={onOpened}>
      {children}
    </a>
  )
}

export function LinksPanel({ loading }: { loading: boolean }) {
  const store = useWorkspaceStore()
  const { links } = useWorkspaceState()
  const { toast } = useToast()
  const [filters, setFilters] = useState<LinkFilters>(DEFAULT_LINK_FILTERS)
  const [editing, setEditing] = useState<WorkspaceLink | 'new' | null>(null)
  const [deleting, setDeleting] = useState<WorkspaceLink | null>(null)
  const [menu, setMenu] = useState<string | null>(null)
  const visible = useMemo(() => filterLinks(links, filters), [links, filters])
  const categories = useMemo(() => categoryOptions(DEFAULT_LINK_CATEGORIES, links.map((l) => l.category)), [links])
  const searchId = useId()

  // Close the card menu on any click outside it.
  useEffect(() => {
    if (!menu) return
    const close = (e: PointerEvent) => {
      if (!(e.target as Element | null)?.closest('[role="menu"],[aria-haspopup="menu"]')) setMenu(null)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [menu])

  const copy = (link: WorkspaceLink) =>
    navigator.clipboard?.writeText(link.url).then(
      () => toast('คัดลอกลิงก์แล้ว'),
      () => toast('คัดลอกไม่สำเร็จ', 'error'),
    )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-card p-3 shadow-sm">
        <div className="relative min-w-48 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <label htmlFor={searchId} className="sr-only">
            ค้นหาลิงก์
          </label>
          <Input id={searchId} type="search" value={filters.query} onChange={(e) => setFilters((f) => ({ ...f, query: e.target.value }))} placeholder="ค้นหาชื่อ ลิงก์ หรือคำอธิบาย" className="pl-9" />
        </div>
        <NativeSelect aria-label="กรองหมวดหมู่ลิงก์" value={filters.category} onChange={(e) => setFilters((f) => ({ ...f, category: e.target.value }))} className="min-w-0 flex-1 sm:flex-none">
          <option value="all">ทุกหมวดหมู่</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect aria-label="เรียงลิงก์" value={filters.sort} onChange={(e) => setFilters((f) => ({ ...f, sort: e.target.value as LinkSort }))} className="min-w-0 flex-1 sm:flex-none">
          {LINK_SORTS.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </NativeSelect>
        <label className="inline-flex items-center gap-2 px-1 text-sm">
          <input type="checkbox" className="size-4 accent-primary" checked={filters.pinnedOnly} onChange={(e) => setFilters((f) => ({ ...f, pinnedOnly: e.target.checked }))} />
          เฉพาะที่ปักหมุด
        </label>
        <Button type="button" onClick={() => setEditing('new')} data-testid="link-add">
          <Plus />
          เพิ่มลิงก์
        </Button>
      </div>

      {loading ? (
        <div className="rounded-2xl border border-border bg-card p-4">
          <ListSkeleton label="กำลังโหลดลิงก์" />
        </div>
      ) : visible.length === 0 ? (
        links.length === 0 ? (
          <EmptyState icon={Link2} title="ยังไม่มีลิงก์โปรด" description="เก็บเว็บไซต์ที่ใช้บ่อย เช่น Google Drive, ระบบของเขตพื้นที่ หรือสื่อการสอน ไว้เปิดได้ในคลิกเดียว" action={<Button type="button" size="sm" onClick={() => setEditing('new')}><Plus />เพิ่มลิงก์แรก</Button>} />
        ) : (
          <EmptyState compact icon={Search} title="ไม่พบลิงก์ที่ตรงกับการค้นหา" />
        )
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="link-list">
          {visible.map((link) => (
            <li key={link.id} className={cn('relative flex min-w-0 flex-col rounded-2xl border bg-card p-3.5 shadow-sm', link.pinned ? 'border-amber-400/60' : 'border-border')} data-testid="link-card">
              <div className="flex items-start gap-3">
                <LinkAvatar url={link.url} />
                <div className="min-w-0 flex-1">
                  <SafeLinkAnchor link={link} onOpened={() => store.linkOpened(link.id)} className="group block rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
                    <span className="flex items-center gap-1 text-sm font-semibold text-foreground group-hover:text-primary">
                      <span className="truncate">{link.title}</span>
                      <ExternalLink className="size-3.5 shrink-0 opacity-60" aria-hidden="true" />
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">{hostLabel(link.url)}</span>
                  </SafeLinkAnchor>
                </div>
                {link.pinned && <Pin className="size-4 shrink-0 text-amber-500" aria-label="ปักหมุด" />}
                <button type="button" onClick={() => setMenu(menu === link.id ? null : link.id)} aria-haspopup="menu" aria-expanded={menu === link.id} aria-label={`ตัวเลือกของ ${link.title}`} className="rounded-full p-1 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
                  <MoreHorizontal className="size-4" />
                </button>
              </div>
              {link.description && <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{link.description}</p>}
              <div className="mt-auto flex flex-wrap items-center gap-2 pt-2 text-[11px] text-muted-foreground">
                {link.category && <span className="rounded-full bg-muted px-2 py-0.5">{link.category}</span>}
                <span>{link.lastOpenedAt ? `เปิดล่าสุด ${formatThaiDateTime(link.lastOpenedAt)}` : 'ยังไม่เคยเปิด'}</span>
              </div>
              {menu === link.id && (
                <div role="menu" className="absolute right-3 top-11 z-20 w-44 overflow-hidden rounded-xl border border-border bg-card p-1 shadow-lg" onKeyDown={(e) => e.key === 'Escape' && setMenu(null)}>
                  {[
                    { label: link.pinned ? 'เลิกปักหมุด' : 'ปักหมุด', icon: link.pinned ? PinOff : Pin, run: () => void store.updateLink(link.id, { pinned: !link.pinned }) },
                    { label: 'คัดลอกลิงก์', icon: Copy, run: () => void copy(link) },
                    { label: 'แก้ไข', icon: Pencil, run: () => setEditing(link) },
                    { label: 'ลบ', icon: Trash2, run: () => setDeleting(link), danger: true },
                  ].map((item) => (
                    <button
                      key={item.label}
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMenu(null)
                        item.run()
                      }}
                      className={cn('flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none', item.danger && 'text-destructive')}
                    >
                      <item.icon className="size-4" aria-hidden="true" />
                      {item.label}
                    </button>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <LinkDialog target={editing} categories={categories} onClose={() => setEditing(null)} />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="ลบลิงก์นี้?"
        description={deleting ? `“${deleting.title}” จะถูกลบออกจากลิงก์โปรด (เว็บไซต์ต้นทางไม่ได้รับผลกระทบ)` : ''}
        confirmLabel="ลบลิงก์"
        destructive
        onConfirm={async () => {
          const target = deleting
          setDeleting(null)
          if (target && (await store.deleteLink(target.id))) toast('ลบลิงก์แล้ว', 'info')
        }}
      />
    </div>
  )
}

export function LinkDialog({ target, categories, onClose }: { target: WorkspaceLink | 'new' | null; categories: string[]; onClose: () => void }) {
  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      {target !== null && <LinkDialogBody key={target === 'new' ? 'new' : target.id} link={target === 'new' ? null : target} categories={categories} onClose={onClose} />}
    </Dialog>
  )
}

function LinkDialogBody({ link, categories, onClose }: { link: WorkspaceLink | null; categories: string[]; onClose: () => void }) {
  const store = useWorkspaceStore()
  const { toast } = useToast()
  const [url, setUrl] = useState(link?.url ?? '')
  const [title, setTitle] = useState(link?.title ?? '')
  const [description, setDescription] = useState(link?.description ?? '')
  const [category, setCategory] = useState(link?.category ?? '')
  const [pinned, setPinned] = useState(link?.pinned ?? false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const id = useId()

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (saving) return
    const check = normalizeLinkUrl(url)
    if (!check.ok) return setError(check.error)
    const finalTitle = title.trim() || suggestTitle(check.url)
    const invalid = validateLinkFields({ title: finalTitle, description, category })
    if (invalid) return setError(invalid)
    setError(null)
    setSaving(true)
    try {
      const fields = { url: check.url, title: finalTitle, description, category: category.trim() || null, pinned }
      const ok = link ? await store.updateLink(link.id, fields) : Boolean(await store.createLink(fields))
      if (ok) {
        toast(link ? 'บันทึกลิงก์แล้ว' : 'เพิ่มลิงก์แล้ว')
        onClose()
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <DialogContent>
      <form onSubmit={submit} className="grid gap-4" noValidate>
        <DialogHeader>
          <DialogTitle>{link ? 'แก้ไขลิงก์' : 'เพิ่มลิงก์โปรด'}</DialogTitle>
          <DialogDescription>รองรับเฉพาะลิงก์ที่ขึ้นต้นด้วย http:// หรือ https://</DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-url`}>ลิงก์ (URL)</Label>
          <Input id={`${id}-url`} value={url} inputMode="url" autoComplete="url" maxLength={2048} onChange={(e) => setUrl(e.target.value)} placeholder="https://" autoFocus aria-invalid={error ? true : undefined} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-title`}>ชื่อลิงก์</Label>
          <Input id={`${id}-title`} value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} placeholder="เว้นว่างได้ ระบบจะใช้ชื่อเว็บไซต์" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-desc`}>คำอธิบาย</Label>
          <Textarea id={`${id}-desc`} value={description} maxLength={1000} rows={2} onChange={(e) => setDescription(e.target.value)} placeholder="ไม่บังคับ" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-cat`}>หมวดหมู่</Label>
          <CategoryInput id={`${id}-cat`} value={category} onChange={setCategory} options={categories} />
        </div>
        <label className="inline-flex items-center gap-2 text-sm">
          <input type="checkbox" className="size-4 accent-primary" checked={pinned} onChange={(e) => setPinned(e.target.checked)} />
          ปักหมุดไว้ด้านบน
        </label>
        {error && (
          <p role="alert" className="text-sm text-destructive" data-testid="link-error">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
            ยกเลิก
          </Button>
          <Button type="submit" disabled={saving} data-testid="link-save">
            {saving && <Loader2 className="animate-spin" />}
            {link ? 'บันทึก' : 'เพิ่มลิงก์'}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  )
}
