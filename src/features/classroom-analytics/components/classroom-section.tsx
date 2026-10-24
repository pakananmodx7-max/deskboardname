import { ArrowRight, BookOpen, CalendarDays, LayoutGrid, List, Plus, School, Search, Users } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { RowActionsMenu } from '@/components/ui/row-actions-menu'
import { NativeSelect } from '@/components/ui/select'
import { useToast } from '@/components/ui/toast'
import { CreateClassroomDialog } from '@/features/classroom-management/create-classroom-dialog'
import { deletedToast } from '@/features/classroom-management/classroom-deletion-model'
import { DeleteClassroomDialog } from '@/features/classroom-management/delete-classroom-dialog'
import { EditClassroomDialog } from '@/features/classroom-management/edit-classroom-dialog'
import { buildClassroomTabPath } from '@/features/subjects-shared/subject-classroom-nav'
import { cn } from '@/lib/utils'
import { classroomLifecycleErrorMessage } from '@/services/classroom-lifecycle-errors'
import { archiveClassroom, reactivateClassroom } from '@/services/classroom-service'
import type { Classroom } from '@/types/classroom'

import { classroomInSemester, filterClassroomCards, semesterLabel, type ClassroomCardSummary, type ClassroomStatusFilter } from '../analytics'
import { formatCount } from '../resource'

export const CLASSROOMS_SECTION_ID = 'classrooms'


function classroomPath(id: string): string {
  return `/teacher/classrooms/${id}`
}

export interface ClassroomSectionProps {
  /** null while the classroom context is still loading. */
  cards: ClassroomCardSummary[] | null
  /** Student counts come from the semester roster; false while it loads. */
  countsReady: boolean
  /** Full rows for the existing edit dialog (real mode only). */
  classroomRecords?: Classroom[]
  /** Real mode: create/edit/archive enabled (existing dialogs/services). */
  editable: boolean
  scopeLabel: string
  /** The selected semester key — a new classroom outside it is announced
   * (it is not shown until that semester is selected). */
  scopeKey: string | null
  /** Called after a classroom was created/edited/archived/restored. */
  onChanged: () => void
}

/**
 * ห้องเรียนของฉัน — the classroom list, now part of the dashboard and
 * filtered by the same semester. All actions reuse the existing dialogs
 * (CreateClassroomDialog / EditClassroomDialog), services
 * (archiveClassroom / reactivateClassroom) and routes (classroom detail,
 * its นักเรียน tab where students are moved between classrooms, รายวิชา).
 * Archived classrooms (status filter “เก็บถาวร”) also offer
 * "ลบห้องเรียนถาวร" — DeleteClassroomDialog, a separate guarded flow.
 */
export function ClassroomSection({ cards, countsReady, classroomRecords, editable, scopeLabel, scopeKey, onChanged }: ClassroomSectionProps) {
  const navigate = useNavigate()
  const { toast } = useToast()
  const [search, setSearch] = useState('')
  const [grade, setGrade] = useState('')
  const [status, setStatus] = useState<ClassroomStatusFilter>('all')
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const [createOpen, setCreateOpen] = useState(false)
  const [editing, setEditing] = useState<Classroom | null>(null)
  const [archiveTarget, setArchiveTarget] = useState<ClassroomCardSummary | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null)

  const grades = [...new Set((cards ?? []).map((c) => c.gradeLabel).filter((g) => g !== '-'))].sort((a, b) => a.localeCompare(b, 'th', { numeric: true }))
  const visible = cards ? filterClassroomCards(cards, { search, grade, status }) : null
  const recordById = new Map((classroomRecords ?? []).map((c) => [c.id, c]))

  async function confirmArchiveToggle() {
    if (!archiveTarget) return
    try {
      const updated = archiveTarget.classroom.isActive ? await archiveClassroom(archiveTarget.classroom.id) : await reactivateClassroom(archiveTarget.classroom.id)
      toast(updated.isActive ? `กู้คืนห้อง "${updated.name}" แล้ว` : `เก็บถาวรห้อง "${updated.name}" แล้ว — ดูได้จากตัวกรอง “เก็บถาวร”`)
      setArchiveTarget(null)
      onChanged()
    } catch (err) {
      toast(classroomLifecycleErrorMessage(err))
      // Already archived/restored elsewhere: refresh so the card shows the real state.
      setArchiveTarget(null)
      onChanged()
    }
  }

  function actionsFor(card: ClassroomCardSummary) {
    const record = recordById.get(card.classroom.id)
    return [
      { key: 'open', label: 'เปิดห้องเรียน', onSelect: () => navigate(classroomPath(card.classroom.id)) },
      { key: 'students', label: 'ดูนักเรียน / ย้ายนักเรียน', onSelect: () => navigate(buildClassroomTabPath(card.classroom.id, 'students')) },
      { key: 'subjects', label: 'จัดการรายวิชา', onSelect: () => navigate('/teacher/subjects') },
      ...(editable && record
        ? [
            { key: 'edit', label: 'แก้ไขห้องเรียน', onSelect: () => setEditing(record), separatorBefore: true },
            card.classroom.isActive
              ? { key: 'archive', label: 'เก็บถาวร / นำออกจากรายการห้องเรียน', onSelect: () => setArchiveTarget(card) }
              : { key: 'restore', label: 'กู้คืนห้องเรียน', onSelect: () => setArchiveTarget(card) },
            ...(card.classroom.isActive
              ? []
              : [{ key: 'delete', label: 'ลบห้องเรียนถาวร', onSelect: () => setDeleteTarget({ id: card.classroom.id, name: card.classroom.name }), destructive: true, separatorBefore: true }]),
          ]
        : []),
    ]
  }

  const count = (n: number) => (countsReady ? `${formatCount(n)} คน` : '… คน')

  return (
    <section id={CLASSROOMS_SECTION_ID} aria-label="ห้องเรียนของฉัน" className="scroll-mt-6 rounded-2xl border border-border bg-card p-4 shadow-soft sm:p-5">
      <header className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex items-center gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/12 text-primary">
            <School className="size-5" />
          </span>
          <div>
            <h2 className="text-base font-bold text-foreground">ห้องเรียนของฉัน {cards ? `(${cards.length} ห้อง)` : ''}</h2>
            <p className="text-xs text-muted-foreground">จัดการห้องเรียน รายชื่อนักเรียน และรายวิชาที่เกี่ยวข้อง · {scopeLabel}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative w-full sm:w-56">
            <span className="sr-only">ค้นหาห้องเรียน</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ค้นหาห้องเรียนหรือรายวิชา..."
              className="h-9 w-full rounded-xl border border-input bg-background pl-9 pr-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            />
          </label>
          <NativeSelect value={status} onChange={(e) => setStatus(e.target.value as ClassroomStatusFilter)} aria-label="สถานะห้องเรียน" className="h-9 w-auto">
            <option value="all">ทุกสถานะ</option>
            <option value="active">กำลังสอน</option>
            <option value="archived">เก็บถาวร</option>
          </NativeSelect>
          <NativeSelect value={grade} onChange={(e) => setGrade(e.target.value)} aria-label="ระดับชั้น" className="h-9 w-auto">
            <option value="">ทุกระดับชั้น</option>
            {grades.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </NativeSelect>
          <div className="flex rounded-xl border border-input p-0.5" role="group" aria-label="รูปแบบการแสดงผล">
            <button
              type="button"
              onClick={() => setView('grid')}
              aria-pressed={view === 'grid'}
              aria-label="แสดงแบบการ์ด"
              className={cn('rounded-lg p-1.5', view === 'grid' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent')}
            >
              <LayoutGrid className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => setView('list')}
              aria-pressed={view === 'list'}
              aria-label="แสดงแบบรายการ"
              className={cn('rounded-lg p-1.5', view === 'list' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent')}
            >
              <List className="size-4" />
            </button>
          </div>
          <Button type="button" size="sm" onClick={() => setCreateOpen(true)} disabled={!editable} title={editable ? undefined : 'ไม่รองรับในโหมดสาธิต'} className="h-9 rounded-xl">
            <Plus className="size-4" />
            สร้างห้องเรียน
          </Button>
        </div>
      </header>

      {visible === null ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4" role="status" aria-label="กำลังโหลดห้องเรียน">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="h-32 animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-xl bg-muted/50 p-6 text-center">
          <p className="text-sm font-medium text-foreground">{cards && cards.length > 0 ? 'ไม่พบห้องเรียนที่ตรงกับตัวกรอง' : `ยังไม่มีห้องเรียนใน${scopeLabel}`}</p>
          {editable && cards?.length === 0 && <p className="mt-1 text-xs text-muted-foreground">กด “สร้างห้องเรียน” เพื่อเริ่มต้น</p>}
        </div>
      ) : view === 'grid' ? (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {visible.map((card) => (
            <li key={card.classroom.id} className="flex gap-3 rounded-xl border border-border bg-background/60 p-3">
              <div className="flex w-20 shrink-0 items-center justify-center rounded-lg bg-primary-light text-primary" aria-hidden="true">
                <School className="size-8" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-1">
                  <StatusBadge active={card.classroom.isActive} />
                  <RowActionsMenu actions={actionsFor(card)} label={`ตัวเลือกของห้อง ${card.classroom.name}`} />
                </div>
                <p className="truncate text-base font-bold text-foreground">{card.classroom.name}</p>
                <p className="truncate text-xs text-muted-foreground" title={card.subjectNames.join(', ')}>
                  {card.subjectNames.length > 0 ? card.subjectNames.join(', ') : 'ยังไม่มีรายวิชา'}
                </p>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Users className="size-3.5" />
                    {count(card.studentCount)}
                  </span>
                  <span className="flex items-center gap-1">
                    <BookOpen className="size-3.5" />
                    {card.subjectNames.length} รายวิชา
                  </span>
                  <span className="flex items-center gap-1">
                    <CalendarDays className="size-3.5" />
                    {card.semesterLabel}
                  </span>
                </div>
                <Link
                  to={classroomPath(card.classroom.id)}
                  className="mt-2 inline-flex items-center gap-1 rounded-lg bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary/15"
                >
                  เปิดห้องเรียน <ArrowRight className="size-3" />
                </Link>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-muted-foreground">
                <th className="px-3 py-2 font-medium">ห้องเรียน</th>
                <th className="px-3 py-2 font-medium">ภาคเรียน</th>
                <th className="px-3 py-2 font-medium">นักเรียน</th>
                <th className="px-3 py-2 font-medium">รายวิชา</th>
                <th className="px-3 py-2 font-medium">สถานะ</th>
                <th className="px-3 py-2" aria-label="การทำงาน" />
              </tr>
            </thead>
            <tbody>
              {visible.map((card) => (
                <tr key={card.classroom.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-2 font-medium">
                    <Link to={classroomPath(card.classroom.id)} className="hover:text-primary hover:underline">
                      {card.classroom.name}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{card.semesterLabel}</td>
                  <td className="px-3 py-2 tabular-nums">{count(card.studentCount)}</td>
                  <td className="max-w-[240px] truncate px-3 py-2 text-muted-foreground" title={card.subjectNames.join(', ')}>
                    {card.subjectNames.join(', ') || '-'}
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge active={card.classroom.isActive} />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <RowActionsMenu actions={actionsFor(card)} label={`ตัวเลือกของห้อง ${card.classroom.name}`} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editable && (
        <>
          <CreateClassroomDialog
            open={createOpen}
            onOpenChange={setCreateOpen}
            onCreated={(created) => {
              const inScope = scopeKey === null || classroomInSemester(created, scopeKey)
              toast(inScope ? 'สร้างห้องเรียนแล้ว' : `สร้างห้องเรียนแล้ว — ห้องนี้อยู่ใน${semesterLabel(created.academicYear, created.semester)} เลือกภาคเรียนนั้นเพื่อดูห้องนี้`)
              onChanged()
            }}
          />
          {editing && (
            <EditClassroomDialog
              open
              onOpenChange={(next) => {
                if (!next) setEditing(null)
              }}
              classroom={editing}
              onUpdated={() => {
                setEditing(null)
                onChanged()
              }}
            />
          )}
          <ConfirmDialog
            open={archiveTarget !== null}
            onOpenChange={(next) => {
              if (!next) setArchiveTarget(null)
            }}
            title={archiveTarget?.classroom.isActive ? `เก็บถาวรห้อง "${archiveTarget.classroom.name}"?` : `กู้คืนห้อง "${archiveTarget?.classroom.name ?? ''}"?`}
            description={archiveTarget?.classroom.isActive ? archiveDescription : restoreDescription}
            confirmLabel={archiveTarget?.classroom.isActive ? 'เก็บถาวร' : 'กู้คืนห้องเรียน'}
            onConfirm={confirmArchiveToggle}
          />
          <DeleteClassroomDialog
            classroom={deleteTarget}
            onOpenChange={(next) => {
              if (!next) setDeleteTarget(null)
            }}
            onDeleted={(result, name) => {
              setDeleteTarget(null)
              toast(deletedToast(name, result.queuedFiles))
              onChanged()
            }}
          />
        </>
      )}
    </section>
  )
}

const archiveDescription =
  'ห้องนี้จะถูกนำออกจากรายการห้องเรียนที่กำลังสอน และจะไม่ปรากฏในการเช็คชื่อ มอบหมายงาน หรือเลือกห้องอื่น ๆ\n' +
  'ไม่มีข้อมูลใดถูกลบ — นักเรียน การเช็คชื่อ งาน การส่งงาน คะแนน และ QR ประจำตัวยังอยู่ครบ\n' +
  'ดูห้องที่เก็บถาวรได้จากตัวกรอง “เก็บถาวร” และกู้คืนได้ทุกเมื่อ'

const restoreDescription = 'ห้องนี้จะกลับมาอยู่ในรายการห้องเรียนที่กำลังสอน พร้อมข้อมูลเดิมทั้งหมด'

function StatusBadge({ active }: { active: boolean }) {
  return (
    <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', active ? 'bg-success/12 text-success' : 'bg-muted text-muted-foreground')}>
      {active ? 'กำลังสอน' : 'เก็บถาวร'}
    </span>
  )
}
