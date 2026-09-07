import { Plus } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { NativeSelect } from '@/components/ui/select'
import { CreateClassroomDialog } from '@/features/classroom-management/create-classroom-dialog'
import type { Classroom } from '@/types/classroom'

interface ClassroomSelectorProps {
  classrooms: Classroom[]
  selectedClassroomId: string | null
  onSelect: (classroomId: string) => void
  onCreated: (classroom: Classroom) => void
}

export function ClassroomSelector({
  classrooms,
  selectedClassroomId,
  onSelect,
  onCreated,
}: ClassroomSelectorProps) {
  const [createOpen, setCreateOpen] = useState(false)

  return (
    <div className="flex items-center gap-2">
      <NativeSelect
        value={selectedClassroomId ?? ''}
        onChange={(e) => onSelect(e.target.value)}
        aria-label="เลือกห้องเรียน"
        className="w-auto min-w-32"
      >
        {classrooms.map((classroom) => (
          <option key={classroom.id} value={classroom.id}>
            {classroom.name}
          </option>
        ))}
      </NativeSelect>
      <Button type="button" variant="outline" size="sm" onClick={() => setCreateOpen(true)}>
        <Plus className="size-4" />
        ห้องเรียนใหม่
      </Button>

      <CreateClassroomDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={onCreated} />
    </div>
  )
}
