import { GraduationCap, School } from 'lucide-react'
import { Link } from 'react-router-dom'

import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

/**
 * Public landing page at "/" for a signed-out visitor — the entry point
 * that lets a person self-identify as a teacher or a student before any
 * login form appears. Purely presentational; RootPage decides whether to
 * render this at all (an authenticated session skips straight past it).
 */
export function RoleChoicePage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-2xl space-y-8">
        <div className="space-y-1 text-center">
          <h1 className="text-2xl font-bold">ระบบการจัดการชั้นเรียน</h1>
          <p className="text-xs text-muted-foreground">จัดทำโดยครูเนม</p>
          <p className="pt-1 text-sm text-muted-foreground">กรุณาเลือกประเภทผู้ใช้งานเพื่อเข้าสู่ระบบ</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Link to="/login" className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-xl">
            <Card className="h-full cursor-pointer transition-colors hover:border-primary hover:bg-accent/40">
              <CardHeader className="items-center gap-3 py-8 text-center">
                <School className="h-10 w-10 text-primary" />
                <CardTitle className="text-base">ครูผู้สอน</CardTitle>
                <CardDescription>เข้าสู่ระบบสำหรับครู</CardDescription>
              </CardHeader>
            </Card>
          </Link>

          <Link
            to="/student/login"
            className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Card className="h-full cursor-pointer transition-colors hover:border-primary hover:bg-accent/40">
              <CardHeader className="items-center gap-3 py-8 text-center">
                <GraduationCap className="h-10 w-10 text-primary" />
                <CardTitle className="text-base">นักเรียน</CardTitle>
                <CardDescription>เข้าสู่ระบบสำหรับนักเรียน</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        </div>
      </div>
    </div>
  )
}
