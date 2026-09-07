import { FlaskConical } from 'lucide-react'

import { Card, CardContent } from '@/components/ui/card'

interface DemoOnlyNoticeProps {
  featureLabel: string
}

/**
 * Shown in place of the เช็คชื่อ/งาน/คะแนน tabs when a subject is backed
 * by real Supabase data. Those features are still demo-only (Phase 3
 * covers only subjects, subject↔classroom links, enrollment, and
 * topics) — their data model (DemoSubjectAssignment, DemoSubjectAttendance)
 * lives entirely in the in-memory demo context and has no relationship to
 * a real subject's UUID, so rendering the demo tab here would silently
 * show unrelated mock data instead of this subject's data. This notice
 * keeps that gap explicit instead of hiding it.
 */
export function DemoOnlyNotice({ featureLabel }: DemoOnlyNoticeProps) {
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-warning/15 text-warning-foreground">
          <FlaskConical className="size-6" />
        </div>
        <p className="text-sm font-medium">{featureLabel}ยังใช้งานได้เฉพาะในโหมดสาธิต (Demo)</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          ฟีเจอร์นี้ยังไม่ได้เชื่อมต่อกับฐานข้อมูลจริง — ข้อมูลจะยังคงอยู่ในโหมดสาธิตจนกว่าจะมีการพัฒนาต่อในเฟสถัดไป
        </p>
      </CardContent>
    </Card>
  )
}
