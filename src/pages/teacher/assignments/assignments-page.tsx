import { Plus, Users } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { NativeSelect } from '@/components/ui/select'
import { Progress } from '@/components/ui/progress'
import { useDemoClassroom } from '@/demo/demo-context'
import { CreateAssignmentDialog } from '@/features/demo-assignments/create-assignment-dialog'
import { MissingStudentsDialog } from '@/features/demo-assignments/missing-students-dialog'

type StatusFilter = 'all' | 'complete' | 'incomplete'

export function AssignmentsPage() {
  const { assignments, students } = useDemoClassroom()
  const [createOpen, setCreateOpen] = useState(false)
  const [selectedAssignmentId, setSelectedAssignmentId] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

  const selectedAssignment = assignments.find((a) => a.id === selectedAssignmentId) ?? null

  const totalCount = students.length

  const visibleAssignments = assignments.filter((assignment) => {
    if (statusFilter === 'all') return true
    const submitted = Object.values(assignment.submissions).filter(Boolean).length
    const isComplete = submitted >= totalCount
    return statusFilter === 'complete' ? isComplete : !isComplete
  })

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">งานที่มอบหมาย</h1>
          <p className="mt-1 text-sm text-muted-foreground">{assignments.length} รายการ</p>
        </div>
        <div className="flex items-center gap-2">
          <NativeSelect
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            className="w-auto"
            aria-label="กรองตามสถานะ"
          >
            <option value="all">ทุกสถานะ</option>
            <option value="incomplete">ยังส่งไม่ครบ</option>
            <option value="complete">ส่งครบแล้ว</option>
          </NativeSelect>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" />
            สร้างงานใหม่
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {visibleAssignments.map((assignment) => {
          const submitted = Object.values(assignment.submissions).filter(Boolean).length
          const percent = totalCount > 0 ? Math.round((submitted / totalCount) * 100) : 0
          return (
            <Card key={assignment.id}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">{assignment.title}</CardTitle>
                  <span className="text-xs text-muted-foreground">Due {assignment.dueDate}</span>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <Progress value={percent} />
                <p className="text-sm text-muted-foreground">
                  {submitted} / {totalCount} submitted ({percent}%)
                </p>
                <Button variant="outline" size="sm" onClick={() => setSelectedAssignmentId(assignment.id)}>
                  <Users className="size-3.5" />
                  ดูรายชื่อที่ยังไม่ส่ง
                </Button>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {visibleAssignments.length === 0 && (
        <div className="py-16 text-center text-sm text-muted-foreground">ไม่พบงานที่ตรงกับเงื่อนไข</div>
      )}

      <CreateAssignmentDialog open={createOpen} onOpenChange={setCreateOpen} />
      <MissingStudentsDialog
        assignment={selectedAssignment}
        onOpenChange={(open) => {
          if (!open) setSelectedAssignmentId(null)
        }}
      />
    </div>
  )
}
