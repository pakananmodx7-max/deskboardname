import { DatabaseZap } from 'lucide-react'

import { Card, CardContent } from '@/components/ui/card'

/**
 * Shown instead of a data-backed page/section when Supabase env vars are
 * missing, so the app never crashes just because the backend isn't wired
 * up yet in this environment.
 */
export function SupabaseConfigNotice() {
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-warning/20 text-warning-foreground">
          <DatabaseZap className="size-6" />
        </div>
        <div className="max-w-md space-y-1">
          <p className="text-sm font-semibold">ยังไม่ได้ตั้งค่าการเชื่อมต่อ Supabase</p>
          <p className="text-sm text-muted-foreground">
            กรุณาตั้งค่า <code className="rounded bg-muted px-1 py-0.5 text-xs">VITE_SUPABASE_URL</code>{' '}
            และ <code className="rounded bg-muted px-1 py-0.5 text-xs">VITE_SUPABASE_ANON_KEY</code> ใน
            ไฟล์ <code className="rounded bg-muted px-1 py-0.5 text-xs">.env.local</code> แล้วรีสตาร์ท
            เซิร์ฟเวอร์ ดูขั้นตอนเพิ่มเติมได้ที่ <code className="rounded bg-muted px-1 py-0.5 text-xs">docs/SUPABASE_SETUP.md</code>
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
