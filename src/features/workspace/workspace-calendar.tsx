import { CalendarDays, ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import { addDays, formatThaiDate, formatThaiDateLong, formatThaiMonth, monthGrid, monthOf, shiftMonth, THAI_WEEKDAYS_SHORT, weekDays } from './workspace-dates'
import { dueState, tasksByDate } from './workspace-tasks-model'
import type { WorkspaceTask } from './workspace-types'
import { TaskRow } from './task-row'
import { EmptyState, Segmented } from './workspace-ui'

const DOT: Record<string, string> = {
  overdue: 'bg-red-500',
  today: 'bg-orange-500',
  soon: 'bg-amber-500',
  later: 'bg-primary',
  none: 'bg-primary',
  done: 'bg-emerald-500',
}

/** The most pressing state among a day's tasks (for its dot). */
function dayState(list: WorkspaceTask[], today: string): string {
  const order = ['overdue', 'today', 'soon', 'later', 'none', 'done']
  return list.map((t) => dueState(t, today)).sort((a, b) => order.indexOf(a) - order.indexOf(b))[0] ?? 'later'
}

function MonthNav({ year, month, onShift, onToday, compact }: { year: number; month: number; onShift: (d: number) => void; onToday?: () => void; compact?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <button type="button" onClick={() => onShift(-1)} className="rounded-full p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40" aria-label="เดือนก่อนหน้า">
        <ChevronLeft className="size-4" />
      </button>
      <span className={cn('font-bold text-foreground', compact ? 'text-sm' : 'text-base')} aria-live="polite">
        {formatThaiMonth(year, month)}
      </span>
      <div className="flex items-center gap-1">
        {onToday && (
          <Button type="button" variant="outline" size="sm" onClick={onToday}>
            วันนี้
          </Button>
        )}
        <button type="button" onClick={() => onShift(1)} className="rounded-full p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40" aria-label="เดือนถัดไป">
          <ChevronRight className="size-4" />
        </button>
      </div>
    </div>
  )
}

/** ภาพรวม: a small month with dots on days that have tasks. */
export function MiniCalendar({ tasks, today, selected, onSelect }: { tasks: WorkspaceTask[]; today: string; selected?: string | null; onSelect: (day: string) => void }) {
  const [view, setView] = useState(() => monthOf(today))
  const byDate = useMemo(() => tasksByDate(tasks), [tasks])
  const grid = monthGrid(view.year, view.month)
  return (
    <div data-testid="mini-calendar">
      <MonthNav compact year={view.year} month={view.month} onShift={(d) => setView((v) => shiftMonth(v.year, v.month, d))} />
      <div className="mt-2 grid grid-cols-7 text-center text-xs" role="grid" aria-label={`ปฏิทิน ${formatThaiMonth(view.year, view.month)}`}>
        {THAI_WEEKDAYS_SHORT.map((d, i) => (
          <span key={d} role="columnheader" className={cn('pb-1 font-medium', i === 0 ? 'text-red-500' : 'text-muted-foreground')}>
            {d}
          </span>
        ))}
        {grid.map((day) => {
          const inMonth = monthOf(day).month === view.month
          const list = byDate.get(day) ?? []
          const open = list.filter((t) => t.status !== 'done').length
          const isToday = day === today
          return (
            <button
              key={day}
              type="button"
              role="gridcell"
              onClick={() => onSelect(day)}
              aria-label={`${formatThaiDateLong(day)}${list.length ? ` — ${list.length} งาน` : ''}`}
              aria-current={isToday ? 'date' : undefined}
              aria-selected={selected === day}
              className={cn(
                'relative mx-auto flex size-8 flex-col items-center justify-center rounded-full tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                !inMonth && 'text-muted-foreground/50',
                isToday ? 'bg-primary font-bold text-primary-foreground' : 'hover:bg-accent',
                selected === day && !isToday && 'ring-2 ring-primary/60',
              )}
              data-date={day}
            >
              {Number(day.slice(8))}
              {list.length > 0 && <span className={cn('absolute bottom-0.5 size-1.5 rounded-full', isToday ? 'bg-primary-foreground' : DOT[dayState(list, today)], open === 0 && !isToday && 'opacity-50')} aria-hidden="true" />}
            </button>
          )
        })}
      </div>
    </div>
  )
}

type CalendarMode = 'month' | 'week'

/** ปฏิทิน tab: month or week view of tasks by due date, with a day panel. */
export function CalendarView({ tasks, today, selected, onSelect, onOpen, onCreate }: { tasks: WorkspaceTask[]; today: string; selected: string; onSelect: (day: string) => void; onOpen: (id: string) => void; onCreate: (day: string) => void }) {
  const [mode, setMode] = useState<CalendarMode>('month')
  const [view, setView] = useState(() => monthOf(selected))
  const byDate = useMemo(() => tasksByDate(tasks), [tasks])
  const days = mode === 'month' ? monthGrid(view.year, view.month) : weekDays(selected)
  const dayTasks = byDate.get(selected) ?? []

  const shift = (delta: number) => {
    if (mode === 'month') setView((v) => shiftMonth(v.year, v.month, delta))
    else {
      const next = addDays(selected, delta * 7)
      onSelect(next)
      setView(monthOf(next))
    }
  }
  const goToday = () => {
    onSelect(today)
    setView(monthOf(today))
  }
  const pick = (day: string) => {
    onSelect(day)
    if (monthOf(day).month !== view.month) setView(monthOf(day))
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <section className="min-w-0 rounded-2xl border border-border bg-card p-3 shadow-sm sm:p-4" aria-label="ปฏิทินงาน">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <Segmented
            label="มุมมองปฏิทิน"
            value={mode}
            onChange={(m) => {
              setMode(m)
              setView(monthOf(selected))
            }}
            options={[
              { key: 'month', label: 'เดือน' },
              { key: 'week', label: 'สัปดาห์' },
            ]}
          />
          <div className="min-w-0 flex-1 sm:max-w-sm">
            <MonthNav year={view.year} month={view.month} onShift={shift} onToday={goToday} />
          </div>
        </div>
        <div className="grid grid-cols-7 gap-px overflow-hidden rounded-xl border border-border bg-border" role="grid" aria-label={mode === 'month' ? formatThaiMonth(view.year, view.month) : `สัปดาห์ของ ${formatThaiDate(days[0])}`}>
          {THAI_WEEKDAYS_SHORT.map((d, i) => (
            <span key={d} role="columnheader" className={cn('bg-muted/60 py-1.5 text-center text-xs font-semibold', i === 0 ? 'text-red-500' : 'text-muted-foreground')}>
              {d}
            </span>
          ))}
          {days.map((day) => {
            const list = byDate.get(day) ?? []
            const inMonth = mode === 'week' || monthOf(day).month === view.month
            const isToday = day === today
            const isSelected = day === selected
            const limit = mode === 'week' ? 6 : 2
            return (
              <button
                key={day}
                type="button"
                role="gridcell"
                aria-selected={isSelected}
                aria-current={isToday ? 'date' : undefined}
                aria-label={`${formatThaiDateLong(day)}${list.length ? ` — ${list.length} งาน` : ' — ไม่มีงาน'}`}
                onClick={() => pick(day)}
                data-date={day}
                className={cn(
                  'flex min-w-0 flex-col items-stretch gap-1 bg-card p-1 text-left align-top transition-colors hover:bg-accent/50 focus-visible:relative focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 sm:p-1.5',
                  mode === 'month' ? 'min-h-14 sm:min-h-24' : 'min-h-40 sm:min-h-56',
                  !inMonth && 'bg-muted/30 text-muted-foreground/60',
                  isSelected && 'bg-primary/8 ring-2 ring-inset ring-primary/60',
                )}
              >
                <span className={cn('flex size-6 items-center justify-center self-center rounded-full text-xs tabular-nums sm:self-start', isToday && 'bg-primary font-bold text-primary-foreground')}>{Number(day.slice(8))}</span>
                {/* Phones: dots. Larger screens: titles. */}
                {list.length > 0 && (
                  <span className="flex flex-wrap justify-center gap-0.5 sm:hidden" aria-hidden="true">
                    {list.slice(0, 3).map((t) => (
                      <span key={t.id} className={cn('size-1.5 rounded-full', DOT[dueState(t, today)])} />
                    ))}
                  </span>
                )}
                <span className="hidden min-w-0 flex-col gap-0.5 sm:flex" aria-hidden="true">
                  {list.slice(0, limit).map((t) => {
                    const state = dueState(t, today)
                    return (
                      <span key={t.id} className={cn('truncate rounded px-1 py-0.5 text-[11px] leading-tight', state === 'done' ? 'bg-emerald-500/10 text-muted-foreground line-through' : state === 'overdue' ? 'bg-red-500/12 text-red-700 dark:text-red-300' : state === 'today' ? 'bg-orange-500/12 text-orange-700 dark:text-orange-300' : 'bg-primary/10 text-foreground')}>
                        {t.title}
                      </span>
                    )
                  })}
                  {list.length > limit && <span className="px-1 text-[11px] text-muted-foreground">+{list.length - limit}</span>}
                </span>
              </button>
            )
          })}
        </div>
        <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {[
            ['overdue', 'เลยกำหนด'],
            ['today', 'วันนี้'],
            ['soon', 'ใกล้ครบกำหนด'],
            ['later', 'กำลังจะถึง'],
            ['done', 'เสร็จแล้ว'],
          ].map(([k, label]) => (
            <span key={k} className="inline-flex items-center gap-1.5">
              <span className={cn('size-2 rounded-full', DOT[k])} aria-hidden="true" />
              {label}
            </span>
          ))}
        </p>
      </section>

      <section className="min-w-0 rounded-2xl border border-border bg-card p-4 shadow-sm" aria-labelledby="calendar-day-title" data-testid="calendar-day-panel">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 id="calendar-day-title" className="text-base font-bold text-foreground">
              {selected === today ? 'วันนี้' : formatThaiDate(selected, today)}
            </h2>
            <p className="text-xs text-muted-foreground">{formatThaiDateLong(selected)}</p>
          </div>
          <Button type="button" size="sm" onClick={() => onCreate(selected)}>
            <Plus />
            เพิ่มงาน
          </Button>
        </div>
        <div className="mt-3">
          {dayTasks.length === 0 ? (
            <EmptyState compact icon={CalendarDays} title="ไม่มีงานครบกำหนดวันนี้" description="กด “เพิ่มงาน” เพื่อสร้างงานที่ครบกำหนดในวันที่เลือก" />
          ) : (
            <ul>
              {dayTasks.map((t) => (
                <TaskRow key={t.id} task={t} today={today} onOpen={onOpen} showStatus compact hideDue />
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  )
}
