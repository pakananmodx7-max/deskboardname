import { AlarmClock, BellRing, CalendarDays, CalendarClock, CheckCircle2, ClipboardList, ExternalLink, Flag, Grid2x2, Link2, ListChecks, Pin, Plus, StickyNote } from 'lucide-react'
import { useMemo } from 'react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import { LinkAvatar, SafeLinkAnchor } from './links-panel'
import { PriorityMatrix } from './priority-matrix'
import { TaskRow } from './task-row'
import { MiniCalendar } from './workspace-calendar'
import { useWorkspaceState, useWorkspaceStore } from './workspace-hooks'
import { addDays, formatThaiDateTime, relativeDayLabel } from './workspace-dates'
import { featuredLinks, hostLabel } from './workspace-links-model'
import { noteDisplayTitle, noteExcerpt, recentNotes } from './workspace-notes-model'
import { quadrantFlags, summarizeTasks, todayTasks, upcomingTasks, type Quadrant } from './workspace-tasks-model'
import type { TaskInput } from './workspace-types'
import { EmptyState, LinkButton, ListSkeleton, Panel, StatCard } from './workspace-ui'

/** Where a card or link on ภาพรวม takes the teacher in งานของฉัน. */
export type TaskShortcut = 'all' | 'overdue' | 'today' | 'week' | 'high' | 'done' | 'matrix' | { date: string }

export interface OverviewActions {
  openTask: (id: string) => void
  createTask: (defaults?: Partial<TaskInput>) => void
  showTasks: (shortcut: TaskShortcut) => void
  openNote: (id: string | null) => void
  createNote: () => void
  showLinks: () => void
  addLink: () => void
  showCalendar: (date?: string) => void
}

/** ภาพรวม: everything here is computed from the teacher's real records. */
export function OverviewPanel({ today, loading, actions }: { today: string; loading: boolean; actions: OverviewActions }) {
  const store = useWorkspaceStore()
  const { tasks, notes, links } = useWorkspaceState()
  const summary = useMemo(() => summarizeTasks(tasks, today), [tasks, today])
  const todays = useMemo(() => todayTasks(tasks, today), [tasks, today])
  const upcoming = useMemo(() => upcomingTasks(tasks, today, 30).slice(0, 4), [tasks, today])
  const notesShown = useMemo(() => recentNotes(notes, 2), [notes])
  const linksShown = useMemo(() => featuredLinks(links, 3), [links])

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard testId="stat-pending" icon={ClipboardList} tone="blue" label="งานค้าง" value={summary.pending} loading={loading} onClick={() => actions.showTasks('all')} hint={summary.overdue > 0 ? <span className="text-red-600 dark:text-red-400">เลยกำหนด {summary.overdue} งาน</span> : undefined} />
        <StatCard testId="stat-high" icon={Flag} tone="red" label="สำคัญสูง" value={summary.highPriority} loading={loading} onClick={() => actions.showTasks('high')} />
        <StatCard testId="stat-soon" icon={CalendarClock} tone="violet" label="ใกล้ครบกำหนด" value={summary.dueSoon} loading={loading} onClick={() => actions.showTasks('week')} hint={`วันนี้ ${summary.dueToday} งาน · ภายใน 3 วัน`} />
        <StatCard testId="stat-done" icon={CheckCircle2} tone="green" label="เสร็จแล้ว" value={summary.done} loading={loading} onClick={() => actions.showTasks('done')} />
      </div>

      {!loading && (summary.overdue > 0 || summary.dueToday > 0) && (
        <div role="status" className="flex flex-wrap items-center gap-3 rounded-2xl border border-orange-500/30 bg-orange-500/8 px-4 py-3 text-sm" data-testid="workspace-reminder">
          <BellRing className="size-5 shrink-0 text-orange-600 dark:text-orange-400" aria-hidden="true" />
          <p className="min-w-0 flex-1 text-foreground">
            {summary.overdue > 0 && <span className="font-semibold text-red-600 dark:text-red-400">เลยกำหนด {summary.overdue} งาน</span>}
            {summary.overdue > 0 && summary.dueToday > 0 && ' · '}
            {summary.dueToday > 0 && <span className="font-semibold">ครบกำหนดวันนี้ {summary.dueToday} งาน</span>}
            {summary.dueSoon - summary.dueToday > 0 && <span className="text-muted-foreground"> · ใกล้ครบกำหนดอีก {summary.dueSoon - summary.dueToday} งาน</span>}
          </p>
          <Button type="button" size="sm" variant="outline" onClick={() => actions.showTasks(summary.overdue > 0 ? 'overdue' : 'today')}>
            ดูงาน
          </Button>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <Panel id="ws-today" title="งานที่ต้องจัดการวันนี้" icon={ListChecks} action={<LinkButton onClick={() => actions.showTasks('all')}>ดูทั้งหมด</LinkButton>}>
          {loading ? (
            <ListSkeleton label="กำลังโหลดงานวันนี้" />
          ) : todays.length === 0 ? (
            <EmptyState
              compact
              icon={CheckCircle2}
              title={tasks.length === 0 ? 'ยังไม่มีงาน' : 'ไม่มีงานที่ต้องทำวันนี้'}
              description={tasks.length === 0 ? 'เพิ่มงานแรกของคุณ แล้วระบบจะสรุปให้ที่นี่' : upcoming[0] ? `งานถัดไป: ${upcoming[0].title} (${relativeDayLabel(upcoming[0].dueDate!, today)})` : 'ไม่มีงานค้างที่ใกล้ครบกำหนด'}
              action={
                <Button type="button" size="sm" onClick={() => actions.createTask({ dueDate: today })}>
                  <Plus />
                  เพิ่มงานวันนี้
                </Button>
              }
            />
          ) : (
            <ul data-testid="today-tasks">
              {todays.slice(0, 6).map((t) => (
                <TaskRow key={t.id} task={t} today={today} onOpen={actions.openTask} compact />
              ))}
              {todays.length > 6 && (
                <li className="pt-2 text-xs text-muted-foreground">
                  <button type="button" className="hover:text-primary" onClick={() => actions.showTasks('today')}>
                    และอีก {todays.length - 6} งาน
                  </button>
                </li>
              )}
            </ul>
          )}
        </Panel>

        <Panel id="ws-matrix" title="จัดลำดับความสำคัญ" icon={Grid2x2} action={<LinkButton onClick={() => actions.showTasks('matrix')}>เปิดเมทริกซ์</LinkButton>}>
          {loading ? <ListSkeleton rows={3} label="กำลังโหลดเมทริกซ์" /> : <PriorityMatrix tasks={tasks} today={today} onOpen={actions.openTask} onAdd={(q: Quadrant) => actions.createTask(quadrantFlags(q))} limit={2} />}
        </Panel>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.25fr)]">
        <Panel id="ws-notes" title="บันทึกล่าสุด" icon={StickyNote} action={<LinkButton onClick={() => actions.openNote(null)}>ดูทั้งหมด</LinkButton>}>
          {loading ? (
            <ListSkeleton rows={2} label="กำลังโหลดบันทึก" />
          ) : (
            <div className="flex h-full flex-col gap-2">
              {notesShown.length === 0 ? (
                <EmptyState compact icon={StickyNote} title="ยังไม่มีบันทึก" description="จดไอเดียหรือสรุปประชุมไว้ที่นี่" />
              ) : (
                <ul className="space-y-2">
                  {notesShown.map((n) => (
                    <li key={n.id}>
                      <button type="button" onClick={() => actions.openNote(n.id)} className={cn('w-full rounded-xl border px-3 py-2.5 text-left transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40', n.pinned ? 'border-amber-400/50 border-l-4 border-l-amber-400 bg-amber-500/5' : 'border-border')}>
                        <span className="flex items-center gap-1.5">
                          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{noteDisplayTitle(n)}</span>
                          {n.pinned && <Pin className="size-3.5 shrink-0 text-amber-500" aria-label="ปักหมุด" />}
                        </span>
                        {noteExcerpt(n) && <span className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{noteExcerpt(n)}</span>}
                        <span className="mt-1 block text-[11px] text-muted-foreground">{formatThaiDateTime(n.updatedAt)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <Button type="button" variant="outline" className="mt-auto w-full" onClick={actions.createNote} data-testid="overview-new-note">
                <Plus />
                สร้างบันทึกใหม่
              </Button>
            </div>
          )}
        </Panel>

        <Panel id="ws-links" title="ลิงก์โปรด" icon={Link2} action={<LinkButton onClick={actions.showLinks}>ดูทั้งหมด</LinkButton>}>
          {loading ? (
            <ListSkeleton rows={3} label="กำลังโหลดลิงก์" />
          ) : (
            <div className="flex h-full flex-col gap-2">
              {linksShown.length === 0 ? (
                <EmptyState compact icon={Link2} title="ยังไม่มีลิงก์โปรด" description="เก็บเว็บไซต์ที่ใช้บ่อยไว้เปิดได้ในคลิกเดียว" />
              ) : (
                <ul className="divide-y divide-border/70">
                  {linksShown.map((l) => (
                    <li key={l.id}>
                      <SafeLinkAnchor link={l} onOpened={() => store.linkOpened(l.id)} className="flex items-center gap-3 rounded-lg py-2 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
                        <LinkAvatar url={l.url} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-foreground">{l.title}</span>
                          <span className="block truncate text-xs text-muted-foreground">{hostLabel(l.url)}</span>
                        </span>
                        <ExternalLink className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                      </SafeLinkAnchor>
                    </li>
                  ))}
                </ul>
              )}
              <Button type="button" variant="outline" className="mt-auto w-full" onClick={actions.addLink}>
                <Plus />
                เพิ่มลิงก์
              </Button>
            </div>
          )}
        </Panel>

        <Panel id="ws-calendar" title="ปฏิทินงาน" icon={CalendarDays} className="md:col-span-2 xl:col-span-1" action={<LinkButton onClick={() => actions.showCalendar()}>ดูทั้งหมด</LinkButton>}>
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
            <MiniCalendar tasks={tasks} today={today} onSelect={(date) => actions.showTasks({ date })} />
            <div className="min-w-0">
              <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-foreground">
                <AlarmClock className="size-4 text-primary" aria-hidden="true" />
                งานใกล้ถึงกำหนด
              </p>
              {upcoming.length === 0 ? (
                <p className="text-xs text-muted-foreground">ไม่มีงานที่ครบกำหนดใน 30 วันข้างหน้า</p>
              ) : (
                <ul className="space-y-1.5" data-testid="upcoming-tasks">
                  {upcoming.map((t) => (
                    <li key={t.id}>
                      <button type="button" onClick={() => actions.openTask(t.id)} className="flex w-full items-start gap-2 rounded-lg border border-border px-2.5 py-1.5 text-left hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
                        <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', t.dueDate === addDays(today, 1) ? 'bg-primary' : t.priority === 'high' ? 'bg-red-500' : 'bg-violet-500')} aria-hidden="true" />
                        <span className="min-w-0">
                          <span className="block text-xs font-semibold text-primary">{relativeDayLabel(t.dueDate!, today)}</span>
                          <span className="block truncate text-xs text-foreground">{t.title}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </Panel>
      </div>
    </div>
  )
}
