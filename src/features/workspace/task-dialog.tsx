import { Loader2, Trash2 } from 'lucide-react'
import { useId, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

import { useWorkspaceState, useWorkspaceStore } from './workspace-hooks'
import { formatThaiDateTime } from './workspace-dates'
import { categoryOptions, DEFAULT_TASK_CATEGORIES, QUADRANTS, quadrantOf, statusChangePatch, TASK_PRIORITIES, TASK_STATUSES, validateTaskFields } from './workspace-tasks-model'
import type { TaskInput, TaskPatch, TaskPriority, TaskStatus, WorkspaceTask } from './workspace-types'
import { CategoryInput } from './workspace-ui'

export interface TaskDialogTarget {
  /** Edit this task; omit to create one. */
  taskId?: string
  /** Defaults for a new task (e.g. the calendar day or matrix quadrant picked). */
  defaults?: Partial<TaskInput>
}

interface FormState {
  title: string
  description: string
  status: TaskStatus
  priority: TaskPriority
  dueDate: string
  startDate: string
  category: string
  important: boolean
  urgent: boolean
}

function initialForm(task: WorkspaceTask | undefined, defaults: Partial<TaskInput> = {}): FormState {
  const src = task ?? defaults
  return {
    title: src.title ?? '',
    description: src.description ?? '',
    status: src.status ?? 'todo',
    priority: src.priority ?? 'medium',
    dueDate: src.dueDate ?? '',
    startDate: src.startDate ?? '',
    category: src.category ?? '',
    important: src.important ?? false,
    urgent: src.urgent ?? false,
  }
}

/** Create / edit one task. The same record feeds the list, matrix, calendar and board. */
export function TaskDialog({ target, onClose }: { target: TaskDialogTarget | null; onClose: () => void }) {
  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      {target && <TaskDialogBody key={target.taskId ?? 'new'} target={target} onClose={onClose} />}
    </Dialog>
  )
}

function TaskDialogBody({ target, onClose }: { target: TaskDialogTarget; onClose: () => void }) {
  const store = useWorkspaceStore()
  const { tasks } = useWorkspaceState()
  const task = target.taskId ? tasks.find((t) => t.id === target.taskId) : undefined
  const [form, setForm] = useState<FormState>(() => initialForm(task, target.defaults))
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const id = useId()
  const categories = useMemo(() => categoryOptions(DEFAULT_TASK_CATEGORIES, tasks.map((t) => t.category)), [tasks])
  const editing = Boolean(target.taskId)
  const missing = editing && !task

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }))
  const quadrant = QUADRANTS.find((q) => q.key === quadrantOf(form))!

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (saving) return
    const fields = {
      title: form.title.trim(),
      description: form.description,
      status: form.status,
      priority: form.priority,
      dueDate: form.dueDate || null,
      startDate: form.startDate || null,
      category: form.category.trim() || null,
      important: form.important,
      urgent: form.urgent,
    }
    const invalid = validateTaskFields(fields)
    if (invalid) return setError(invalid)
    setError(null)
    setSaving(true)
    try {
      if (task) {
        const patch: TaskPatch = Object.fromEntries(Object.entries(fields).filter(([k, v]) => task[k as keyof WorkspaceTask] !== v))
        // A new status puts the card on top of that Kanban column.
        if (patch.status !== undefined) Object.assign(patch, statusChangePatch(tasks, task, fields.status))
        const ok = Object.keys(patch).length === 0 || (await store.updateTask(task.id, patch))
        if (ok) onClose()
      } else {
        const created = await store.createTask(fields)
        if (created) onClose()
      }
    } finally {
      setSaving(false)
    }
  }

  if (missing) {
    return (
      <DialogContent>
        <DialogHeader>
          <DialogTitle>ไม่พบงานนี้</DialogTitle>
          <DialogDescription>งานนี้อาจถูกลบไปแล้วจากอุปกรณ์อื่น</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" onClick={onClose}>
            ปิด
          </Button>
        </DialogFooter>
      </DialogContent>
    )
  }

  return (
    <DialogContent className="max-w-xl">
      <form onSubmit={submit} className="grid gap-4" noValidate>
        <DialogHeader>
          <DialogTitle>{editing ? 'แก้ไขงาน' : 'เพิ่มงานใหม่'}</DialogTitle>
          <DialogDescription>{task ? `แก้ไขล่าสุด ${formatThaiDateTime(task.updatedAt)}${task.completedAt ? ` · เสร็จเมื่อ ${formatThaiDateTime(task.completedAt)}` : ''}` : 'งานส่วนตัวของคุณ เห็นได้เฉพาะบัญชีนี้'}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-title`}>ชื่องาน</Label>
          <Input id={`${id}-title`} value={form.title} maxLength={300} onChange={(e) => set('title', e.target.value)} placeholder="เช่น ส่งรายงานโครงการ" autoFocus required aria-invalid={error === 'กรุณาระบุชื่องาน' || undefined} />
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-desc`}>รายละเอียด</Label>
          <Textarea id={`${id}-desc`} value={form.description} maxLength={10000} rows={3} onChange={(e) => set('description', e.target.value)} placeholder="ไม่บังคับ" />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-status`}>สถานะ</Label>
            <NativeSelect id={`${id}-status`} value={form.status} onChange={(e) => set('status', e.target.value as TaskStatus)}>
              {TASK_STATUSES.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-priority`}>ระดับความสำคัญ</Label>
            <NativeSelect id={`${id}-priority`} value={form.priority} onChange={(e) => set('priority', e.target.value as TaskPriority)}>
              {TASK_PRIORITIES.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-start`}>วันเริ่ม (ไม่บังคับ)</Label>
            <Input id={`${id}-start`} type="date" value={form.startDate} max={form.dueDate || undefined} onChange={(e) => set('startDate', e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-due`}>วันครบกำหนด</Label>
            <Input id={`${id}-due`} type="date" value={form.dueDate} min={form.startDate || undefined} onChange={(e) => set('dueDate', e.target.value)} />
          </div>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-category`}>หมวดหมู่</Label>
          <CategoryInput id={`${id}-category`} value={form.category} onChange={(v) => set('category', v)} options={categories} />
        </div>

        <fieldset className="grid gap-2 rounded-xl border border-border p-3">
          <legend className="px-1 text-sm font-medium">เมทริกซ์จัดลำดับ (Eisenhower)</legend>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4 accent-primary" checked={form.important} onChange={(e) => set('important', e.target.checked)} />
              สำคัญ
            </label>
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4 accent-primary" checked={form.urgent} onChange={(e) => set('urgent', e.target.checked)} />
              เร่งด่วน
            </label>
          </div>
          <p className="text-xs text-muted-foreground">
            อยู่ในช่อง <span className="font-semibold text-foreground">{quadrant.title}</span> — {quadrant.action}
            <span className="block">แยกจากระดับความสำคัญ (สูง/ปานกลาง/ต่ำ)</span>
          </p>
        </fieldset>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <DialogFooter className={cn(editing && 'sm:justify-between')}>
          {task && (
            <Button type="button" variant="outline-destructive" onClick={() => setConfirmDelete(true)} disabled={saving}>
              <Trash2 />
              ลบงาน
            </Button>
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
              ยกเลิก
            </Button>
            <Button type="submit" disabled={saving} data-testid="task-dialog-save">
              {saving && <Loader2 className="animate-spin" />}
              {editing ? 'บันทึก' : 'เพิ่มงาน'}
            </Button>
          </div>
        </DialogFooter>
      </form>

      {task && (
        <ConfirmDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          title="ลบงานนี้?"
          description={`“${task.title}” จะถูกลบถาวร และหายไปจากรายการ ปฏิทิน เมทริกซ์ และกระดานงาน`}
          confirmLabel="ลบงาน"
          destructive
          onConfirm={async () => {
            setConfirmDelete(false)
            onClose()
            await store.deleteTask(task.id)
          }}
        />
      )}
    </DialogContent>
  )
}
