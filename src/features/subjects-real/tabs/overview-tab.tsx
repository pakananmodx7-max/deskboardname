import { BookOpen, Users } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Card, CardContent } from '@/components/ui/card'
import { toFriendlyErrorMessage } from '@/lib/errors'
import { getSubjectStudents } from '@/services/subject-service'
import { getTopics } from '@/services/topic-service'
import type { Subject } from '@/types/subject'
import type { Topic } from '@/types/topic'

interface OverviewTabProps {
  subject: Subject
}

export function OverviewTab({ subject }: OverviewTabProps) {
  const [studentCount, setStudentCount] = useState<number | null>(null)
  const [topics, setTopics] = useState<Topic[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)

    Promise.all([getSubjectStudents(subject.id), getTopics(subject.id)])
      .then(([students, topicRows]) => {
        if (!active) return
        setStudentCount(students.length)
        setTopics(topicRows)
      })
      .catch((err: unknown) => {
        if (active) setError(toFriendlyErrorMessage(err))
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [subject.id])

  return (
    <div className="space-y-4">
      {subject.description && <p className="text-sm text-muted-foreground">{subject.description}</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card>
          <CardContent className="flex items-center justify-between pt-5">
            <div>
              <p className="text-sm text-muted-foreground">นักเรียนทั้งหมด</p>
              <p className="mt-1.5 text-2xl font-semibold tracking-tight">
                {loading ? '...' : `${studentCount ?? 0} คน`}
              </p>
            </div>
            <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Users className="size-5" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center justify-between pt-5">
            <div>
              <p className="text-sm text-muted-foreground">หัวข้อ</p>
              <p className="mt-1.5 text-2xl font-semibold tracking-tight">{loading ? '...' : topics.length}</p>
            </div>
            <div className="flex size-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
              <BookOpen className="size-5" />
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="pt-5">
          <p className="mb-3 text-sm font-semibold">หัวข้อล่าสุด</p>
          {topics.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {loading ? 'กำลังโหลด...' : 'ยังไม่มีหัวข้อในรายวิชานี้'}
            </p>
          ) : (
            <ol className="space-y-2">
              {topics.slice(0, 5).map((topic) => (
                <li key={topic.id} className="flex items-center justify-between text-sm">
                  <span>{topic.title}</span>
                  <span className="text-xs text-muted-foreground">{topic.taughtDate ?? '-'}</span>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        เช็คชื่อ งาน และคะแนน ยังใช้งานได้เฉพาะในโหมดสาธิต — ยังไม่เชื่อมต่อกับฐานข้อมูลจริงในเฟสนี้
      </p>
    </div>
  )
}
