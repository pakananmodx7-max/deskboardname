import { LayoutGrid, List, Search, X } from 'lucide-react'

import { NativeSelect } from '@/components/ui/select'
import { cn } from '@/lib/utils'

import {
  DOCUMENT_CATEGORIES,
  KIND_FILTER_LABEL,
  SORT_LABEL,
  type DocumentFilters,
  type DocumentSort,
  type DocumentView,
  type KindFilter,
  type SemesterFilterOption,
} from './document-center-model'

export interface DocumentToolbarProps {
  filters: DocumentFilters
  semesters: SemesterFilterOption[]
  view: DocumentView
  onFilters: (patch: Partial<Omit<DocumentFilters, 'tab'>>) => void
  onView: (view: DocumentView) => void
}

/** Search + ประเภทไฟล์ / หมวดหมู่ / ภาคเรียน / เรียงลำดับ + grid/list. */
export function DocumentToolbar({ filters, semesters, view, onFilters, onView }: DocumentToolbarProps) {
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(15rem,2fr)_repeat(4,minmax(0,1fr))_auto]" role="search" aria-label="ค้นหาและกรองเอกสาร">
      <div className="relative sm:col-span-2 lg:col-span-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <input
          type="search"
          value={filters.query}
          onChange={(e) => onFilters({ query: e.target.value })}
          placeholder="ค้นหาเอกสาร โฟลเดอร์ หรือแท็ก..."
          aria-label="ค้นหาเอกสาร"
          className="h-10 w-full rounded-xl border border-input bg-card pl-9 pr-9 text-sm placeholder:text-muted-foreground focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        />
        {filters.query && (
          <button
            type="button"
            onClick={() => onFilters({ query: '' })}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            aria-label="ล้างคำค้นหา"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>
      <NativeSelect value={filters.kind} onChange={(e) => onFilters({ kind: e.target.value as KindFilter })} aria-label="ประเภทไฟล์" className="h-10 w-full rounded-xl">
        {(Object.keys(KIND_FILTER_LABEL) as KindFilter[]).map((k) => (
          <option key={k} value={k}>
            {k === 'all' ? 'ทุกประเภท' : KIND_FILTER_LABEL[k]}
          </option>
        ))}
      </NativeSelect>
      <NativeSelect value={filters.category} onChange={(e) => onFilters({ category: e.target.value as DocumentFilters['category'] })} aria-label="หมวดหมู่" className="h-10 w-full rounded-xl">
        <option value="all">ทุกหมวดหมู่</option>
        {DOCUMENT_CATEGORIES.map((c) => (
          <option key={c.key} value={c.key}>
            {c.label}
          </option>
        ))}
      </NativeSelect>
      <NativeSelect value={filters.semester} onChange={(e) => onFilters({ semester: e.target.value })} aria-label="ภาคเรียน" className="h-10 w-full rounded-xl">
        <option value="all">ทุกภาคเรียน</option>
        {semesters.map((s) => (
          <option key={s.key} value={s.key}>
            {s.label}
          </option>
        ))}
      </NativeSelect>
      <NativeSelect value={filters.sort} onChange={(e) => onFilters({ sort: e.target.value as DocumentSort })} aria-label="เรียงลำดับ" className="h-10 w-full rounded-xl">
        {(Object.keys(SORT_LABEL) as DocumentSort[]).map((s) => (
          <option key={s} value={s}>
            {SORT_LABEL[s]}
          </option>
        ))}
      </NativeSelect>
      <div className="flex h-10 items-center gap-0.5 justify-self-start rounded-xl border border-border bg-card p-1" role="group" aria-label="รูปแบบการแสดงผล">
        {(
          [
            { key: 'list', label: 'แสดงแบบรายการ', Icon: List },
            { key: 'grid', label: 'แสดงแบบตาราง', Icon: LayoutGrid },
          ] as const
        ).map(({ key, label, Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => onView(key)}
            aria-pressed={view === key}
            aria-label={label}
            title={label}
            className={cn(
              'flex size-8 items-center justify-center rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
              view === key ? 'bg-primary/12 text-primary' : 'text-muted-foreground hover:bg-accent',
            )}
          >
            <Icon className="size-4" />
          </button>
        ))}
      </div>
    </div>
  )
}
