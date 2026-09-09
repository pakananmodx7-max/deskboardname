import { Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useToast } from '@/components/ui/toast'
import { CalendarEntryDialog } from '@/features/student-calendar/calendar-entry-dialog'
import { toFriendlyErrorMessage } from '@/lib/errors'
import { deleteMyCalendarEntry, mergeCalendarItems } from '@/services/student-portal-service'
import type { MyAssignment, MyCalendarEntry } from '@/types/student-portal'

interface StudentCalendarNotesCardProps {
  loading: boolean
  error: string | null
  entries: MyCalendarEntry[]
  assignments: MyAssignment[]
  onEntriesChanged: (entries: MyCalendarEntry[]) => void
}

function formatItemDate(dateStr: string, timeStr?: string | null): string {
  const date = new Date(`${dateStr}T00:00:00`).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })
  return timeStr ? `${date} · ${timeStr.slice(0, 5)}` : date
}

/**
 * RIGHT column — "3. calendar" + "4. personal notes/reminders" from the
 * dashboard redesign spec, rendered as one combined widget matching
 * Section C's data model (assignment due dates merged with the
 * student's own private notes, mergeCalendarItems). Assignment due dates
 * are read-only here (no edit/delete affordance); only 'note' items get
 * the edit/delete controls, since those are the only rows this student
 * actually owns.
 */
export function StudentCalendarNotesCard({
  loading,
  error,
  entries,
  assignments,
  onEntriesChanged,
}: StudentCalendarNotesCardProps) {
  const { toast } = useToast()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingEntry, setEditingEntry] = useState<MyCalendarEntry | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const items = mergeCalendarItems(entries, assignments)

  function openCreate() {
    setEditingEntry(null)
    setDialogOpen(true)
  }

  function openEdit(entry: MyCalendarEntry) {
    setEditingEntry(entry)
    setDialogOpen(true)
  }

  function handleSaved(saved: MyCalendarEntry) {
    const exists = entries.some((e) => e.id === saved.id)
    onEntriesChanged(exists ? entries.map((e) => (e.id === saved.id ? saved : e)) : [...entries, saved])
  }

  async function handleDelete(id: string) {
    setDeletingId(id)
    try {
      await deleteMyCalendarEntry(id)
      onEntriesChanged(entries.filter((e) => e.id !== id))
    } catch (err) {
      toast(toFriendlyErrorMessage(err, 'ไม่สามารถลบบันทึกได้'), 'info')
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">ปฏิทินและบันทึกส่วนตัว</CardTitle>
        <Button size="sm" variant="outline" onClick={openCreate}>
          <Plus className="size-4" />
          เพิ่มบันทึก
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        {loading ? (
          <p className="px-5 py-6 text-center text-sm text-muted-foreground">กำลังโหลด...</p>
        ) : error ? (
          <p className="px-5 py-6 text-center text-sm text-destructive">{error}</p>
        ) : items.length === 0 ? (
          <p className="px-5 py-6 text-center text-sm text-muted-foreground">ยังไม่มีบันทึกในปฏิทิน</p>
        ) : (
          <div className="divide-y divide-border">
            {items.map((item) => {
              const key = item.kind === 'note' ? `note:${item.entry.id}` : `assignment:${item.assignmentId}`
              const dateStr = item.kind === 'note' ? item.entry.eventDate : item.eventDate
              const timeStr = item.kind === 'note' ? item.entry.eventTime : null

              return (
                <div key={key} className="flex items-start justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-muted-foreground">{formatItemDate(dateStr, timeStr)}</span>
                      {item.kind === 'assignment-due' ? (
                        <Badge variant="outline">งาน</Badge>
                      ) : (
                        <Badge variant="secondary">บันทึกของฉัน</Badge>
                      )}
                    </div>
                    <p className="mt-0.5 truncate text-sm font-medium">
                      {item.kind === 'note' ? item.entry.title : item.title}
                    </p>
                    {item.kind === 'note' && item.entry.note && (
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">{item.entry.note}</p>
                    )}
                    {item.kind === 'assignment-due' && (
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">{item.subjectName}</p>
                    )}
                  </div>

                  {item.kind === 'note' && (
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() => openEdit(item.entry)}
                        className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                      >
                        แก้ไข
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(item.entry.id)}
                        disabled={deletingId === item.entry.id}
                        className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                        aria-label="ลบบันทึก"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </CardContent>

      <CalendarEntryDialog open={dialogOpen} onOpenChange={setDialogOpen} entry={editingEntry} onSaved={handleSaved} />
    </Card>
  )
}
