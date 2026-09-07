import { ArrowDown, ArrowUp, Plus } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useToast } from '@/components/ui/toast'
import { toFriendlyErrorMessage } from '@/lib/errors'
import { getTopics, swapTopicPositions } from '@/services/topic-service'
import type { Subject } from '@/types/subject'
import type { Topic } from '@/types/topic'

import { TopicDialog } from '../topic-dialog'

interface TopicsTabProps {
  subject: Subject
}

export function TopicsTab({ subject }: TopicsTabProps) {
  const { toast } = useToast()
  const [topics, setTopics] = useState<Topic[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingTopic, setEditingTopic] = useState<Topic | null>(null)

  const refresh = useCallback(() => {
    setLoading(true)
    setError(null)
    return getTopics(subject.id)
      .then(setTopics)
      .catch((err: unknown) => setError(toFriendlyErrorMessage(err)))
      .finally(() => setLoading(false))
  }, [subject.id])

  useEffect(() => {
    refresh()
  }, [refresh])

  function openCreate() {
    setEditingTopic(null)
    setDialogOpen(true)
  }

  function openDetail(topic: Topic) {
    setEditingTopic(topic)
    setDialogOpen(true)
  }

  async function moveTopic(index: number, direction: -1 | 1) {
    const targetIndex = index + direction
    if (targetIndex < 0 || targetIndex >= topics.length) return
    try {
      await swapTopicPositions(topics[index], topics[targetIndex])
      await refresh()
    } catch (err) {
      toast(toFriendlyErrorMessage(err))
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{topics.length} หัวข้อ</p>
        <Button onClick={openCreate}>
          <Plus className="size-4" />
          เพิ่มหัวข้อ
        </Button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {loading ? (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center text-sm text-muted-foreground">กำลังโหลด...</CardContent>
        </Card>
      ) : topics.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center text-sm text-muted-foreground">ยังไม่มีหัวข้อในรายวิชานี้</CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {topics.map((topic, index) => (
            <Card key={topic.id} className="transition-shadow hover:shadow-md">
              <CardContent className="flex items-center justify-between gap-3 py-4">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex shrink-0 flex-col">
                    <button
                      type="button"
                      disabled={index === 0}
                      onClick={() => moveTopic(index, -1)}
                      className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                      aria-label="เลื่อนขึ้น"
                    >
                      <ArrowUp className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      disabled={index === topics.length - 1}
                      onClick={() => moveTopic(index, 1)}
                      className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                      aria-label="เลื่อนลง"
                    >
                      <ArrowDown className="size-3.5" />
                    </button>
                  </div>
                  <button type="button" className="min-w-0 text-left" onClick={() => openDetail(topic)}>
                    <p className="text-sm font-medium">
                      {topic.position}. {topic.title}
                    </p>
                    {topic.description && (
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">{topic.description}</p>
                    )}
                  </button>
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">{topic.taughtDate ?? '-'}</span>
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
        nextPosition={topics.length + 1}
        onSaved={refresh}
      />
    </div>
  )
}
