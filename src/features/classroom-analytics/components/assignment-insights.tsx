import { ArrowRight, ClipboardList, Lightbulb } from 'lucide-react'
import { Link } from 'react-router-dom'

import { NativeSelect } from '@/components/ui/select'
import { cn } from '@/lib/utils'

import type { AnalyticsSubject, AssignmentProgress, TeacherInsight } from '../analytics'
import { formatCount, type Resource } from '../resource'
import { AnalyticsCard, SectionBody, SectionEmpty } from './analytics-card'
import { AnalyticsDonut } from './charts'

export interface AssignmentStatusCardProps {
  resource: Resource<AssignmentProgress>
  onRetry: () => void
  /** Subjects in the selected semester, for the "ทุกวิชา" filter. */
  subjects?: AnalyticsSubject[]
  subjectId?: string | null
  onSubjectChange?: (subjectId: string | null) => void
}

export function AssignmentStatusCard({ resource, onRetry, subjects = [], subjectId = null, onSubjectChange }: AssignmentStatusCardProps) {
  const filter =
    onSubjectChange && subjects.length > 0 ? (
      <NativeSelect
        value={subjectId ?? ''}
        onChange={(e) => onSubjectChange(e.target.value || null)}
        aria-label="กรองตามรายวิชา"
        className="h-8 w-auto max-w-40 text-xs"
      >
        <option value="">ทุกวิชา</option>
        {subjects.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </NativeSelect>
    ) : null
  return (
    <AnalyticsCard title="สถานะการส่งงาน" icon={ClipboardList} tone="orange" action={filter}>
      <SectionBody resource={resource} onRetry={onRetry} skeleton="chart">
        {(p) =>
          p.assignmentCount === 0 ? (
            <SectionEmpty message={subjectId ? 'ยังไม่มีงานหรือแบบทดสอบในรายวิชานี้' : 'ยังไม่มีงานหรือแบบทดสอบในภาคเรียนนี้'} />
          ) : p.slots === 0 ? (
            <SectionEmpty message={`มีงาน ${formatCount(p.assignmentCount)} รายการ แต่ยังไม่มีนักเรียนในห้องเรียน`} />
          ) : (
            <>
              <AnalyticsDonut
                centerValue={formatCount(p.slots)}
                centerLabel="รายการส่งงาน"
                unit="รายการ"
                slices={[
                  { key: 'completed', label: 'ส่งแล้ว', value: p.completed, stroke: 'stroke-success', dot: 'bg-success' },
                  { key: 'pending', label: 'รอส่ง (ยังไม่ถึงกำหนด)', value: p.pending, stroke: 'stroke-warning', dot: 'bg-warning' },
                  { key: 'notSubmitted', label: 'ยังไม่ส่ง (เลยกำหนด/ขาดส่ง)', value: p.notSubmitted, stroke: 'stroke-destructive', dot: 'bg-destructive' },
                ]}
              />
              <p className="mt-4 border-t border-border pt-3 text-xs text-muted-foreground">
                งาน {formatCount(p.assignmentCount)} ชิ้น × นักเรียนในห้อง = {formatCount(p.slots)} รายการส่งงาน
                {p.completedLate > 0 && ` · ในจำนวนที่ส่งแล้ว ส่งช้า ${formatCount(p.completedLate)} รายการ`}
              </p>
            </>
          )
        }
      </SectionBody>
    </AnalyticsCard>
  )
}

const TONE_DOT: Record<TeacherInsight['tone'], string> = {
  warning: 'bg-destructive',
  info: 'bg-warning',
  positive: 'bg-success',
}

export function TeacherInsightsCard({ resource, partial, onRetry }: { resource: Resource<TeacherInsight[]>; partial: boolean; onRetry: () => void }) {
  return (
    <section
      aria-label="ข้อเสนอแนะสำหรับครู"
      className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-4 shadow-soft sm:flex-row sm:items-center sm:p-5"
    >
      <div className="flex shrink-0 items-center gap-3">
        <span className="flex size-11 items-center justify-center rounded-full bg-primary/12 text-primary">
          <Lightbulb className="size-5" />
        </span>
        <h2 className="text-base font-bold text-foreground">ข้อเสนอแนะสำหรับครู</h2>
      </div>
      <div className="min-w-0 flex-1">
        <SectionBody resource={resource} onRetry={onRetry} skeleton="block">
          {(insights) =>
            insights.length === 0 ? (
              <p className="text-sm text-muted-foreground">ยังไม่มีประเด็นที่ต้องแจ้งจากข้อมูลภาคเรียนนี้</p>
            ) : (
              <ul className="space-y-1.5 text-sm text-foreground">
                {insights.map((insight) => (
                  <li key={insight.id} className="flex items-start gap-2">
                    <span className={cn('mt-1.5 size-1.5 shrink-0 rounded-full', TONE_DOT[insight.tone])} aria-hidden="true" />
                    <span>{insight.message}</span>
                  </li>
                ))}
              </ul>
            )
          }
        </SectionBody>
        {partial && <p className="mt-1.5 text-xs text-muted-foreground">บางส่วนของข้อมูลโหลดไม่สำเร็จ ข้อเสนอแนะอาจยังไม่ครบ</p>}
      </div>
      <Link
        to="/teacher/reports"
        className="flex shrink-0 items-center justify-center gap-1.5 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-soft hover:bg-primary/90"
      >
        ดูรายงานฉบับเต็ม <ArrowRight className="size-4" />
      </Link>
    </section>
  )
}
