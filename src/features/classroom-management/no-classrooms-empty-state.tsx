import { School } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { CreateClassroomDialog } from '@/features/classroom-management/create-classroom-dialog'
import type { Classroom } from '@/types/classroom'

interface NoClassroomsEmptyStateProps {
  onCreated: (classroom: Classroom) => void
}

export function NoClassroomsEmptyState({ onCreated }: NoClassroomsEmptyStateProps) {
  const [open, setOpen] = useState(false)

  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <School className="size-6" />
        </div>
        <p className="text-sm font-medium">ยังไม่มีห้องเรียน</p>
        <Button type="button" onClick={() => setOpen(true)}>
          สร้างห้องเรียน
        </Button>
      </CardContent>

      <CreateClassroomDialog open={open} onOpenChange={setOpen} onCreated={onCreated} />
    </Card>
  )
}
