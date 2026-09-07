import { useEffect, useState, type FormEvent } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/toast'
import { useDemoClassroom } from '@/demo/demo-context'
import type { DemoTopic } from '@/demo/types'

interface TopicDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  subjectId: string
  topic?: DemoTopic | null
  nextOrder: number
}

function emptyForm(nextOrder: number) {
  return { title: '', description: '', order: String(nextOrder), taughtDate: new Date().toISOString().slice(0, 10) }
}

export function TopicDialog({ open, onOpenChange, subjectId, topic, nextOrder }: TopicDialogProps) {
  const { addTopic, updateTopic, deleteTopic } = useDemoClassroom()
  const { toast } = useToast()
  const [form, setForm] = useState(emptyForm(nextOrder))
  const [error, setError] = useState<string | null>(null)
  const isEditing = Boolean(topic)

  useEffect(() => {
    if (open) {
      setForm(
        topic
          ? {
              title: topic.title,
              description: topic.description,
              order: String(topic.order),
              taughtDate: topic.taughtDate,
            }
          : emptyForm(nextOrder),
      )
      setError(null)
    }
  }, [open, topic, nextOrder])

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!form.title.trim()) {
      setError('กรุณากรอกชื่อหัวข้อ')
      return
    }

    if (isEditing && topic) {
      updateTopic(topic.id, {
        title: form.title.trim(),
        description: form.description.trim(),
        order: Number(form.order) || topic.order,
        taughtDate: form.taughtDate,
      })
      toast('บันทึกหัวข้อแล้ว')
    } else {
      addTopic(subjectId, {
        title: form.title.trim(),
        description: form.description.trim(),
        order: Number(form.order) || nextOrder,
        taughtDate: form.taughtDate,
      })
      toast('เพิ่มหัวข้อแล้ว')
    }
    onOpenChange(false)
  }

  function handleDelete() {
    if (!topic) return
    deleteTopic(topic.id)
    toast('ลบหัวข้อแล้ว')
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEditing ? 'รายละเอียดหัวข้อ' : 'เพิ่มหัวข้อ'}</DialogTitle>
          <DialogDescription>{isEditing ? 'แก้ไขหรือลบหัวข้อนี้' : 'เพิ่มหัวข้อการสอนใหม่'}</DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={handleSubmit}>
          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="space-y-1.5">
            <Label htmlFor="topic-title">ชื่อหัวข้อ *</Label>
            <Input
              id="topic-title"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="topic-description">คำอธิบาย</Label>
            <Textarea
              id="topic-description"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="topic-order">ลำดับ</Label>
              <Input
                id="topic-order"
                type="number"
                min={1}
                value={form.order}
                onChange={(e) => setForm((f) => ({ ...f, order: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="topic-date">วันที่สอน</Label>
              <Input
                id="topic-date"
                type="date"
                value={form.taughtDate}
                onChange={(e) => setForm((f) => ({ ...f, taughtDate: e.target.value }))}
              />
            </div>
          </div>

          <DialogFooter className="sm:justify-between">
            {isEditing ? (
              <Button type="button" variant="destructive" onClick={handleDelete}>
                ลบหัวข้อ
              </Button>
            ) : (
              <span />
            )}
            <Button type="submit">{isEditing ? 'บันทึก' : 'เพิ่มหัวข้อ'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
