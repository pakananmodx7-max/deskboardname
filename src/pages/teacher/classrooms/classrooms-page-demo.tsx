import { School, Users } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useDemoClassroom } from '@/demo/demo-context'

/**
 * Read-only in demo mode: the demo context has no classroom create/edit/
 * archive actions (classrooms are part of the fixed seed data, same as
 * every other demo entity) — preserving existing demo behavior means
 * this page shows the same 3 seeded classrooms without introducing new
 * demo-only mutation UI that was never part of the interactive demo spec.
 */
export function ClassroomsPageDemo() {
  const { classrooms } = useDemoClassroom()
  const navigate = useNavigate()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">ห้องเรียน</h1>
        <p className="mt-1 text-sm text-muted-foreground">{classrooms.length} ห้องเรียน</p>
      </div>

      {classrooms.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <School className="size-6" />
            </div>
            <p className="text-sm font-medium">ยังไม่มีห้องเรียน</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {classrooms.map((classroom) => (
            <Card
              key={classroom.id}
              className="cursor-pointer transition-shadow hover:shadow-md"
              onClick={() => navigate(`/teacher/classrooms/${classroom.id}`)}
            >
              <CardHeader>
                <CardTitle className="text-base">{classroom.name}</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <Users className="size-3.5" />
                  {classroom.studentIds.length} คน
                </span>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
