import { Plus } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useDemoClassroom } from '@/demo/demo-context'
import type { DemoSubject, DemoTopic } from '@/demo/types'
import { TopicDialog } from '@/features/demo-subjects/topic-dialog'

interface TopicsTabProps {
  subject: DemoSubject
}

export function TopicsTab({ subject }: TopicsTabProps) {
  const { topics } = useDemoClassroom()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingTopic, setEditingTopic] = useState<DemoTopic | null>(null)

  const subjectTopics = topics.filter((t) => t.subjectId === subject.id).sort((a, b) => a.order - b.order)

  function openCreate() {
    setEditingTopic(null)
    setDialogOpen(true)
  }

  function openDetail(topic: DemoTopic) {
    setEditingTopic(topic)
    setDialogOpen(true)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{subjectTopics.length} หัวข้อ</p>
        <Button onClick={openCreate}>
          <Plus className="size-4" />
          เพิ่มหัวข้อ
        </Button>
      </div>

      {subjectTopics.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center text-sm text-muted-foreground">ยังไม่มีหัวข้อในรายวิชานี้</CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {subjectTopics.map((topic) => (
            <Card
              key={topic.id}
              className="cursor-pointer transition-shadow hover:shadow-md"
              onClick={() => openDetail(topic)}
            >
              <CardContent className="flex items-center justify-between gap-3 py-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {topic.order}. {topic.title}
                  </p>
                  {topic.description && (
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">{topic.description}</p>
                  )}
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">{topic.taughtDate}</span>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <TopicDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        subjectId={subject.id}
        topic={editingTopic}
        nextOrder={subjectTopics.length + 1}
      />
    </div>
  )
}
