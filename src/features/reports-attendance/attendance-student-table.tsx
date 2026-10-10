import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Flag } from 'lucide-react'
import { useState } from 'react'
import type * as React from 'react'

import { NativeSelect } from '@/components/ui/select'
import { studentInitials } from '@/features/attendance/attendance-board-model'
import { cn } from '@/lib/utils'

import { BAND_LABEL, paginate, type AttendanceSortKey, type SortDirection, type StudentAttendanceRow } from './attendance-report-model'
import { BAND_STYLE, PAGE_SIZES } from './attendance-report-styles'

const COLUMNS: { key: AttendanceSortKey; label: string; numeric?: boolean }[] = [
  { key: 'number', label: 'เลขที่' },
  { key: 'name', label: 'ชื่อ–นามสกุล' },
  { key: 'classroom', label: 'ห้องเรียน' },
  { key: 'present', label: 'มา', numeric: true },
  { key: 'late', label: 'สาย', numeric: true },
  { key: 'leave', label: 'ลา', numeric: true },
  { key: 'absent', label: 'ขาด', numeric: true },
  { key: 'total', label: 'รวม', numeric: true },
  { key: 'rate', label: '% การเข้าเรียน' },
]

export interface AttendanceStudentTableProps {
  rows: StudentAttendanceRow[]
  sort: AttendanceSortKey
  direction: SortDirection
  onSort: (sort: AttendanceSortKey, direction: SortDirection) => void
  onOpenStudent: (studentId: string) => void
  /** Changes whenever the filters change — resets to page 1. */
  resetKey: string
  /** Hide the ห้องเรียน column (one classroom is selected). */
  hideClassroom?: boolean
}

/** Student attendance table: sortable, paginated (10/20/50/100), rows
 * needing follow-up highlighted; a row opens that student's detail. */
export function AttendanceStudentTable({ rows, sort, direction, onSort, onOpenStudent, resetKey, hideClassroom = false }: AttendanceStudentTableProps) {
  const columns = hideClassroom ? COLUMNS.filter((c) => c.key !== 'classroom') : COLUMNS
  const [pageSize, setPageSize] = useState<number>(10)
  const [pageState, setPageState] = useState({ key: resetKey, page: 1 })
  const page = pageState.key === resetKey ? pageState.page : 1
  const view = paginate(rows, page, pageSize)
  const setPage = (next: number) => setPageState({ key: resetKey, page: next })

  function toggleSort(key: AttendanceSortKey) {
    if (key === sort) onSort(key, direction === 'asc' ? 'desc' : 'asc')
    else onSort(key, key === 'number' || key === 'name' || key === 'classroom' ? 'asc' : 'desc')
  }

  const first = rows.length === 0 ? 0 : (view.page - 1) * pageSize + 1
  const last = Math.min(view.page * pageSize, rows.length)

  return (
    <div>
      <div className="overflow-x-auto">
        <table className={cn('w-full text-left text-sm', hideClassroom ? 'min-w-[680px]' : 'min-w-[760px]')}>
          <thead>
            <tr className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
              {columns.map((col) => {
                const active = sort === col.key
                const Icon = active ? (direction === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown
                return (
                  <th key={col.key} scope="col" aria-sort={active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'} className={cn('px-2.5 py-2.5 font-medium', col.numeric && 'text-center')}>
                    <button
                      type="button"
                      onClick={() => toggleSort(col.key)}
                      className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded px-1 py-0.5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40', active && 'text-foreground')}
                    >
                      {col.label}
                      <Icon className="size-3" aria-hidden="true" />
                    </button>
                  </th>
                )
              })}
              <th scope="col" className="px-2.5 py-2.5 text-center font-medium">
                สถานะ
              </th>
            </tr>
          </thead>
          <tbody>
            {view.items.map((r) => (
              <tr
                key={r.studentId}
                onClick={() => onOpenStudent(r.studentId)}
                className={cn('cursor-pointer border-b border-border/70 transition-colors last:border-0 hover:bg-accent/60', r.followUp && 'bg-destructive/[0.04]')}
              >
                <td className="px-2.5 py-2 tabular-nums text-muted-foreground">{r.number ?? '-'}</td>
                <td className="px-2.5 py-2">
                  <div className="flex items-center gap-2.5">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/12 text-xs font-bold text-primary" aria-hidden="true">
                      {studentInitials(r.firstName, r.lastName)}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        onOpenStudent(r.studentId)
                      }}
                      className="truncate text-left font-medium text-foreground hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                      aria-label={`ดูรายละเอียดการเข้าเรียนของ ${r.firstName} ${r.lastName}`}
                    >
                      {r.firstName} {r.lastName}
                    </button>
                    {r.followUp && <Flag className="size-3.5 shrink-0 text-destructive" aria-label={`ควรติดตาม: ${r.followUpReasons.join(' · ')}`} />}
                    {r.inactive && <span className="shrink-0 rounded bg-muted px-1.5 text-[10px] text-muted-foreground">พ้นสภาพ/ย้าย</span>}
                  </div>
                </td>
                {!hideClassroom && <td className="px-2.5 py-2 text-muted-foreground">{r.classroomNames.join(', ')}</td>}
                <td className="px-2.5 py-2 text-center tabular-nums">{r.present}</td>
                <td className="px-2.5 py-2 text-center tabular-nums">{r.late}</td>
                <td className="px-2.5 py-2 text-center tabular-nums">{r.leave}</td>
                <td className={cn('px-2.5 py-2 text-center tabular-nums', r.absent > 0 && 'font-semibold text-destructive')}>{r.absent}</td>
                <td className="px-2.5 py-2 text-center font-semibold tabular-nums">{r.total}</td>
                <td className="px-2.5 py-2">
                  {r.rate === null ? (
                    <span className="text-xs text-muted-foreground">ยังไม่มีข้อมูล</span>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="w-12 shrink-0 text-right tabular-nums">{r.rate.toFixed(1)}%</span>
                      <div className="h-2 w-16 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={Math.round(r.rate)} aria-valuemin={0} aria-valuemax={100} aria-label="ร้อยละการมาเรียน">
                        <div className={cn('h-full rounded-full', BAND_STYLE[r.band].bar)} style={{ width: `${Math.min(100, r.rate)}%` }} />
                      </div>
                    </div>
                  )}
                </td>
                <td className="px-2.5 py-2 text-center">
                  <span className={cn('inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold', BAND_STYLE[r.band].badge)}>{BAND_LABEL[r.band]}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-border px-4 py-3 text-sm text-muted-foreground">
        <label className="flex items-center gap-2">
          แสดง
          <NativeSelect
            value={String(pageSize)}
            onChange={(e) => {
              setPageSize(Number(e.target.value))
              setPage(1)
            }}
            aria-label="จำนวนรายการต่อหน้า"
            className="h-8 w-auto"
          >
            {PAGE_SIZES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </NativeSelect>
          รายการต่อหน้า
        </label>
        <span className="tabular-nums">
          {first}–{last} จาก {rows.length} คน
        </span>
        <nav className="ml-auto flex items-center gap-1" aria-label="เลือกหน้า">
          <PageButton label="หน้าก่อนหน้า" disabled={view.page <= 1} onClick={() => setPage(view.page - 1)}>
            <ChevronLeft className="size-4" />
          </PageButton>
          {pageNumbers(view.page, view.pageCount).map((n, i) =>
            n === null ? (
              <span key={`gap-${i}`} className="px-1">
                …
              </span>
            ) : (
              <PageButton key={n} label={`หน้า ${n}`} active={n === view.page} onClick={() => setPage(n)}>
                {n}
              </PageButton>
            ),
          )}
          <PageButton label="หน้าถัดไป" disabled={view.page >= view.pageCount} onClick={() => setPage(view.page + 1)}>
            <ChevronRight className="size-4" />
          </PageButton>
        </nav>
      </div>
    </div>
  )
}

function pageNumbers(current: number, count: number): (number | null)[] {
  if (count <= 7) return Array.from({ length: count }, (_, i) => i + 1)
  const pages = new Set([1, count, current - 1, current, current + 1].filter((n) => n >= 1 && n <= count))
  const sorted = [...pages].sort((a, b) => a - b)
  const out: (number | null)[] = []
  sorted.forEach((n, i) => {
    if (i > 0 && n - sorted[i - 1] > 1) out.push(null)
    out.push(n)
  })
  return out
}

function PageButton({ label, active, disabled, onClick, children }: { label: string; active?: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex size-8 items-center justify-center rounded-lg text-sm tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-40',
        active ? 'bg-primary text-primary-foreground' : 'hover:bg-accent',
      )}
    >
      {children}
    </button>
  )
}
