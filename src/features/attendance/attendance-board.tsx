import { Briefcase, BriefcaseMedical, CheckCheck, CircleCheck, CircleDashed, CircleX, Clock, LayoutGrid, List, MessageSquareText, Save, Search, UserX } from 'lucide-react'
import { useState } from 'react'
import type * as React from 'react'

import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { RowActionsMenu } from '@/components/ui/row-actions-menu'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

import {
  BOARD_STATUS_LABEL,
  BOARD_STATUS_ORDER,
  changedStudentIds,
  countUnchecked,
  filterBoardStudents,
  markAllPresent,
  markUncheckedAbsent,
  nextBoardStatus,
  studentInitials,
  summarizeBoard,
  UNCHECKED_ENTRY,
  withNote,
  withStatus,
  type BoardEntries,
  type BoardStatus,
  type BoardStatusFilter,
  type BoardStudent,
} from './attendance-board-model'

/** Theme switches via :root[data-theme='dark'], so colors use theme
 * tokens or mid-tone tints readable on both (never Tailwind `dark:`). */
const STATUS_STYLE: Record<BoardStatus, { card: string; pill: string; avatar: string; chip: string; icon: React.ComponentType<{ className?: string }> }> = {
  present: {
    card: 'border-success/40 bg-success/[0.07]',
    pill: 'bg-success text-success-foreground',
    avatar: 'bg-success text-success-foreground',
    chip: 'bg-success/12 text-success',
    icon: CircleCheck,
  },
  late: {
    card: 'border-warning/60 bg-warning/[0.12]',
    pill: 'bg-warning text-warning-foreground',
    avatar: 'bg-warning text-warning-foreground',
    chip: 'bg-warning/20 text-orange-500',
    icon: Clock,
  },
  absent: {
    card: 'border-destructive/40 bg-destructive/[0.07]',
    pill: 'bg-destructive text-destructive-foreground',
    avatar: 'bg-destructive text-destructive-foreground',
    chip: 'bg-destructive/12 text-destructive',
    icon: CircleX,
  },
  leave: {
    card: 'border-violet-500/40 bg-violet-500/[0.08]',
    pill: 'bg-violet-500 text-white',
    avatar: 'bg-violet-500 text-white',
    chip: 'bg-violet-500/15 text-violet-500',
    icon: Briefcase,
  },
  sick: {
    card: 'border-sky-500/40 bg-sky-500/[0.08]',
    pill: 'bg-sky-500 text-white',
    avatar: 'bg-sky-500 text-white',
    chip: 'bg-sky-500/15 text-sky-600',
    icon: BriefcaseMedical,
  },
  unchecked: {
    card: 'border-border bg-card',
    pill: 'border border-dashed border-muted-foreground/40 bg-muted text-muted-foreground',
    avatar: 'bg-muted text-muted-foreground',
    chip: 'bg-muted text-muted-foreground',
    icon: CircleDashed,
  },
}

export interface AttendanceBoardProps {
  /** Sorted roster for this session. */
  students: BoardStudent[]
  entries: BoardEntries
  /** What is saved in the database (or demo store) for this session. */
  baseline: BoardEntries
  /** Roster or saved session still loading — cards show skeletons. */
  loading: boolean
  /** Set when editing must be blocked (e.g. the saved session failed to
   * load, so a save could overwrite records the teacher cannot see). */
  lockedReason?: string | null
  saving: boolean
  /** `touchedIds` = students changed by this edit. */
  onChange: (next: BoardEntries, touchedIds: string[]) => void
  onSave: () => void
}

/**
 * The subject เช็คชื่อ tab's card board, shared by the real (Supabase) and
 * demo tabs. Edits stay local (`entries`) until the parent saves. Clicking
 * a card cycles มาเรียน → มาสาย → ขาดเรียน → ลากิจ → ลาป่วย; an unchecked
 * student is never marked on its own.
 */
export function AttendanceBoard({ students, entries, baseline, loading, lockedReason, saving, onChange, onSave }: AttendanceBoardProps) {
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<BoardStatusFilter>('all')
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const [noteFor, setNoteFor] = useState<BoardStudent | null>(null)
  const [noteDraft, setNoteDraft] = useState('')
  const [bulk, setBulk] = useState<'present' | 'absent' | null>(null)

  const ids = students.map((s) => s.id)
  const summary = summarizeBoard(entries, ids)
  const changed = new Set(changedStudentIds(ids, entries, baseline))
  const unchecked = countUnchecked(entries, ids)
  const visible = filterBoardStudents(students, entries, { search, status: statusFilter })
  const interactive = !loading && !lockedReason && !saving

  function setStatus(studentId: string, status: BoardStatus) {
    onChange(withStatus(entries, studentId, status), [studentId])
  }
  function cycle(studentId: string) {
    if (!interactive) return
    setStatus(studentId, nextBoardStatus((entries[studentId] ?? UNCHECKED_ENTRY).status))
  }
  function openNote(student: BoardStudent) {
    setNoteFor(student)
    setNoteDraft((entries[student.id] ?? UNCHECKED_ENTRY).note)
  }
  function applyNote() {
    if (!noteFor) return
    onChange(withNote(entries, noteFor.id, noteDraft.trim()), [noteFor.id])
    setNoteFor(null)
  }
  function applyBulk() {
    if (bulk === 'present') onChange(markAllPresent(entries, ids), ids)
    if (bulk === 'absent') {
      const targets = ids.filter((id) => (entries[id] ?? UNCHECKED_ENTRY).status === 'unchecked')
      onChange(markUncheckedAbsent(entries, ids), targets)
    }
    setBulk(null)
  }

  function menuFor(student: BoardStudent) {
    const current = (entries[student.id] ?? UNCHECKED_ENTRY).status
    return [
      ...BOARD_STATUS_ORDER.filter((s) => s !== 'unchecked').map((status) => ({
        key: status,
        label: `${current === status ? '✓ ' : ''}${BOARD_STATUS_LABEL[status]}`,
        onSelect: () => setStatus(student.id, status),
        disabled: !interactive,
      })),
      {
        key: 'note',
        label: (entries[student.id] ?? UNCHECKED_ENTRY).note ? 'แก้ไขหมายเหตุ' : 'เพิ่มหมายเหตุ',
        onSelect: () => openNote(student),
        disabled: !interactive,
        separatorBefore: true,
      },
    ]
  }

  const saveDisabled = saving || changed.size === 0 || Boolean(lockedReason) || loading

  return (
    <div className="space-y-4 @container" data-testid="attendance-board">
      <AttendanceSummaryBar summary={summary} loading={loading || Boolean(lockedReason)} />

      <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-3 shadow-soft @[48rem]:flex-row @[48rem]:items-center">
        <label className="relative min-w-0 @[48rem]:w-72 @[48rem]:shrink-0">
          <span className="sr-only">ค้นหานักเรียน</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ค้นหาชื่อนักเรียน เลขที่ หรือหมายเหตุ..."
            className="h-9 w-full rounded-xl border border-input bg-background pl-9 pr-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          />
        </label>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5" role="group" aria-label="กรองตามสถานะ">
          <FilterChip active={statusFilter === 'all'} onClick={() => setStatusFilter('all')} label="ทั้งหมด" count={summary.total} tone="bg-primary/12 text-primary" />
          {BOARD_STATUS_ORDER.map((status) => (
            <FilterChip
              key={status}
              active={statusFilter === status}
              onClick={() => setStatusFilter(status)}
              label={BOARD_STATUS_LABEL[status]}
              count={summary[status]}
              tone={STATUS_STYLE[status].chip}
            />
          ))}
        </div>
        <div className="flex shrink-0 self-end rounded-xl border border-input p-0.5 @[48rem]:self-auto" role="group" aria-label="รูปแบบการแสดงผล">
          <ViewButton active={view === 'grid'} onClick={() => setView('grid')} label="แสดงแบบการ์ด" icon={LayoutGrid} />
          <ViewButton active={view === 'list'} onClick={() => setView('list')} label="แสดงแบบรายการ" icon={List} />
        </div>
      </div>

      {lockedReason && (
        <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {lockedReason}
        </p>
      )}

      {loading ? (
        <div className="grid grid-cols-2 gap-3 @[36rem]:grid-cols-3 @[48rem]:grid-cols-4 @[58rem]:grid-cols-5 @[74rem]:grid-cols-6" role="status" aria-label="กำลังโหลดรายชื่อ">
          {Array.from({ length: 12 }, (_, i) => (
            <div key={i} className="h-44 animate-pulse rounded-2xl bg-muted" />
          ))}
        </div>
      ) : students.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">ยังไม่มีนักเรียนในห้องเรียนนี้</p>
      ) : visible.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">ไม่พบนักเรียนที่ตรงกับการค้นหาหรือตัวกรอง</p>
      ) : view === 'grid' ? (
        <ul className={cn('grid grid-cols-2 gap-3 @[36rem]:grid-cols-3 @[48rem]:grid-cols-4 @[58rem]:grid-cols-5 @[74rem]:grid-cols-6', !interactive && 'opacity-70')}>
          {visible.map((student) => {
            const entry = entries[student.id] ?? UNCHECKED_ENTRY
            const style = STATUS_STYLE[entry.status]
            const isChanged = changed.has(student.id)
            return (
              <li
                key={student.id}
                data-status={entry.status}
                data-changed={isChanged || undefined}
                className={cn('relative rounded-2xl border transition-colors', style.card, isChanged && 'ring-2 ring-primary/50')}
              >
                <button
                  type="button"
                  onClick={() => cycle(student.id)}
                  disabled={!interactive}
                  aria-label={`${student.firstName} ${student.lastName}: ${BOARD_STATUS_LABEL[entry.status]} — คลิกเพื่อเปลี่ยนสถานะ`}
                  className="flex w-full flex-col items-center gap-1.5 rounded-2xl px-2 pb-3 pt-7 text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 disabled:cursor-not-allowed"
                >
                  <span className={cn('flex size-12 items-center justify-center rounded-full text-base font-bold', style.avatar)} aria-hidden="true">
                    {studentInitials(student.firstName, student.lastName)}
                  </span>
                  <span className="w-full truncate text-sm font-semibold text-foreground">
                    {student.firstName} {student.lastName}
                  </span>
                  <span className="h-4 w-full truncate text-xs text-muted-foreground">{student.nickname || ' '}</span>
                  <StatusPill status={entry.status} />
                  {entry.note && (
                    <span className="flex w-full items-center justify-center gap-1 truncate text-[11px] text-muted-foreground" title={entry.note}>
                      <MessageSquareText className="size-3 shrink-0" aria-hidden="true" />
                      <span className="truncate">{entry.note}</span>
                    </span>
                  )}
                </button>
                <span className="pointer-events-none absolute left-3 top-2.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  {student.number ?? '-'}
                  {isChanged && <span className="size-2 rounded-full bg-primary" title="ยังไม่บันทึก" aria-label="ยังไม่บันทึก" />}
                </span>
                <div className="absolute right-1 top-1">
                  <RowActionsMenu actions={menuFor(student)} label={`ตัวเลือกของ ${student.firstName}`} />
                </div>
              </li>
            )
          })}
        </ul>
      ) : (
        <div className={cn('overflow-hidden rounded-2xl border border-border bg-card', !interactive && 'opacity-70')}>
          <ul className="divide-y divide-border">
            {visible.map((student) => {
              const entry = entries[student.id] ?? UNCHECKED_ENTRY
              const style = STATUS_STYLE[entry.status]
              const isChanged = changed.has(student.id)
              return (
                <li key={student.id} data-status={entry.status} data-changed={isChanged || undefined} className={cn('flex items-center gap-3 px-3 py-2', isChanged && 'bg-primary/5')}>
                  <span className="w-7 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{student.number ?? '-'}</span>
                  <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-bold', style.avatar)} aria-hidden="true">
                    {studentInitials(student.firstName, student.lastName)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">
                      {student.firstName} {student.lastName}
                      {student.nickname && <span className="ml-1.5 text-xs text-muted-foreground">({student.nickname})</span>}
                    </p>
                    {entry.note && <p className="truncate text-xs text-muted-foreground">{entry.note}</p>}
                  </div>
                  {isChanged && <span className="hidden text-[11px] text-primary @[36rem]:inline">ยังไม่บันทึก</span>}
                  <button
                    type="button"
                    onClick={() => cycle(student.id)}
                    disabled={!interactive}
                    aria-label={`${student.firstName} ${student.lastName}: ${BOARD_STATUS_LABEL[entry.status]} — คลิกเพื่อเปลี่ยนสถานะ`}
                    className="shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 disabled:cursor-not-allowed"
                  >
                    <StatusPill status={entry.status} />
                  </button>
                  <RowActionsMenu actions={menuFor(student)} label={`ตัวเลือกของ ${student.firstName}`} />
                </li>
              )
            })}
          </ul>
        </div>
      )}

      <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-card/95 p-2 shadow-elevated backdrop-blur @[36rem]:p-3">
        <Button type="button" variant="outline" size="sm" onClick={() => setBulk('absent')} disabled={!interactive || unchecked === 0} className="border-destructive/40 text-destructive hover:bg-destructive/10">
          <UserX className="size-4" />
          <span className="@[36rem]:hidden">ขาด ({unchecked})</span>
          <span className="hidden @[36rem]:inline">ที่เหลือขาดเรียน ({unchecked} คน)</span>
        </Button>
        <Button type="button" size="sm" onClick={() => setBulk('present')} disabled={!interactive || students.length === 0} className="bg-success text-success-foreground hover:bg-success/90">
          <CheckCheck className="size-4" />
          <span className="@[36rem]:hidden">มาครบ</span>
          <span className="hidden @[36rem]:inline">มาครบทุกคน</span>
        </Button>
        <div className="ml-auto flex items-center gap-2 @[36rem]:gap-3">
          <span className={cn('text-sm', changed.size > 0 ? 'font-medium text-primary' : 'text-muted-foreground')} aria-live="polite">
            <span className="@[36rem]:hidden">{changed.size > 0 ? `ยังไม่บันทึก ${changed.size}` : ''}</span>
            <span className="hidden @[36rem]:inline">
              {changed.size > 0 ? `มีการเปลี่ยนแปลงที่ยังไม่บันทึก ${changed.size} รายการ` : 'ไม่มีการเปลี่ยนแปลง'}
            </span>
          </span>
          <Button type="button" size="sm" onClick={onSave} disabled={saveDisabled} aria-label="บันทึกการเช็คชื่อ">
            <Save className="size-4" />
            <span className="@[36rem]:hidden">{saving ? 'กำลังบันทึก...' : 'บันทึก'}</span>
            <span className="hidden @[36rem]:inline">{saving ? 'กำลังบันทึก...' : 'บันทึกการเช็คชื่อ'}</span>
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={bulk !== null}
        onOpenChange={(open) => {
          if (!open) setBulk(null)
        }}
        title={bulk === 'present' ? 'เช็คชื่อมาเรียนทุกคน?' : 'เช็คชื่อขาดเรียนให้คนที่เหลือ?'}
        description={
          bulk === 'present'
            ? `นักเรียนทั้ง ${students.length} คนจะเป็น "มาเรียน" รวมถึงคนที่เลือกสถานะไว้แล้ว (หมายเหตุยังอยู่) ยังไม่บันทึกจนกว่าจะกด "บันทึกการเช็คชื่อ"`
            : `นักเรียนที่ยังไม่เช็ค ${unchecked} คนจะเป็น "ขาดเรียน" คนที่เช็คแล้วไม่เปลี่ยน ยังไม่บันทึกจนกว่าจะกด "บันทึกการเช็คชื่อ"`
        }
        confirmLabel={bulk === 'present' ? 'มาครบทุกคน' : 'ขาดเรียนทั้งหมด'}
        onConfirm={applyBulk}
      />

      <Dialog
        open={noteFor !== null}
        onOpenChange={(open) => {
          if (!open) setNoteFor(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>หมายเหตุ — {noteFor ? `${noteFor.firstName} ${noteFor.lastName}` : ''}</DialogTitle>
            <DialogDescription>
              หมายเหตุจะถูกบันทึกพร้อมการเช็คชื่อเมื่อกด “บันทึกการเช็คชื่อ”
              {noteFor && (entries[noteFor.id] ?? UNCHECKED_ENTRY).status === 'unchecked' && ' — นักเรียนคนนี้ยังไม่ได้เช็คชื่อ ต้องเลือกสถานะก่อนจึงจะบันทึกหมายเหตุได้'}
            </DialogDescription>
          </DialogHeader>
          <Textarea value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} rows={3} maxLength={500} placeholder="เช่น มาพร้อมผู้ปกครอง, ลาไปแข่งขันกีฬา" aria-label="หมายเหตุ" />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setNoteFor(null)}>
              ยกเลิก
            </Button>
            <Button type="button" onClick={applyNote}>
              ใช้หมายเหตุนี้
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function StatusPill({ status }: { status: BoardStatus }) {
  const { pill, icon: Icon } = STATUS_STYLE[status]
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold', pill)}>
      <Icon className="size-3.5" aria-hidden="true" />
      {BOARD_STATUS_LABEL[status]}
    </span>
  )
}

function AttendanceSummaryBar({ summary, loading }: { summary: ReturnType<typeof summarizeBoard>; loading: boolean }) {
  const pct = (n: number) => (summary.total > 0 ? `${Math.round((n / summary.total) * 100)}%` : '-')
  return (
    <section aria-label="สรุปการเช็คชื่อ" className="grid grid-cols-2 gap-2 rounded-2xl border border-border bg-card p-3 shadow-soft @[36rem]:grid-cols-3 @[62rem]:grid-cols-7">
      {BOARD_STATUS_ORDER.map((status) => {
        const { icon: Icon, chip } = STATUS_STYLE[status]
        return (
          <div key={status} className="flex items-center gap-2.5 rounded-xl px-2 py-1.5">
            <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-xl', chip)}>
              <Icon className="size-4" aria-hidden="true" />
            </span>
            <div className="min-w-0 leading-tight">
              <p className="text-lg font-bold tabular-nums text-foreground">{loading ? '–' : summary[status]}</p>
              <p className="truncate text-xs text-muted-foreground">
                {BOARD_STATUS_LABEL[status]} <span className="tabular-nums">({loading ? '-' : pct(summary[status])})</span>
              </p>
            </div>
          </div>
        )
      })}
      <div className="col-span-2 flex items-center justify-end gap-2 px-2 @[36rem]:col-span-3 @[62rem]:col-span-1 @[62rem]:flex-col @[62rem]:items-end @[62rem]:justify-center @[62rem]:gap-0">
        <span className="text-xs text-muted-foreground">รวมทั้งหมด</span>
        <span className="text-base font-bold tabular-nums text-foreground">{loading ? '–' : `${summary.total} คน`}</span>
      </div>
    </section>
  )
}

function FilterChip({ active, onClick, label, count, tone }: { active: boolean; onClick: () => void; label: string; count: number; tone: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors',
        active ? 'bg-primary text-primary-foreground' : cn(tone, 'hover:opacity-80'),
      )}
    >
      {label}
      <span className={cn('rounded-full px-1.5 tabular-nums', active ? 'bg-primary-foreground/20' : 'bg-background/60')}>{count}</span>
    </button>
  )
}

function ViewButton({ active, onClick, label, icon: Icon }: { active: boolean; onClick: () => void; label: string; icon: React.ComponentType<{ className?: string }> }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={label}
      className={cn('rounded-lg p-1.5', active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent')}
    >
      <Icon className="size-4" />
    </button>
  )
}
